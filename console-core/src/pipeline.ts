// Pure pipeline builder: derives a structured CI-style Pipeline from a Flow
// definition (spec.steps / spec.gates) plus the run state.json.
// No side effects; deterministic so re-compute is safe.

// ── Types ──────────────────────────────────────────────────────────────────

export interface PipelineGateExpect {
  id: string;
  label: string;
  required: boolean;
  kind: string;
}

export interface PipelineGate {
  id: string;
  label: string;
  status: string;
  expects: PipelineGateExpect[];
}

export type PipelineStageStatus = "passed" | "current" | "blocked" | "ready" | "pending" | "failed";

export interface PipelineStage {
  id: string;
  label: string;
  order: number;
  status: PipelineStageStatus;
  gates: PipelineGate[];
  /** Human sentence explaining why the stage is in its current status. */
  reason?: string;
  /** Set when a non-terminal stage has zero gates — nothing verifies this stage. */
  configWarning?: string;
}

export interface PipelineEdge {
  from: string;
  to: string;
  kind: "next" | "route-back";
}

export interface Pipeline {
  runId: string;
  runLabel: string;
  runStatus: string;
  stages: PipelineStage[];
  edges: PipelineEdge[];
  currentStageId: string | null;
  isDag?: boolean;
}

// ── Input types (from definition.json / state.json) ────────────────────────

interface FlowDefinitionStep {
  id: string;
  next: string | null;
  needs?: string[];
}

interface FlowDefinitionGateExpect {
  id: string;
  kind?: string;
  required?: boolean;
  description?: string;
  claim?: Record<string, unknown>;
}

interface FlowDefinitionGate {
  step: string;
  expects?: FlowDefinitionGateExpect[];
}

interface FlowDefinition {
  // Resource contract envelope (spec.steps / spec.gates)
  spec?: {
    steps?: FlowDefinitionStep[];
    gates?: Record<string, FlowDefinitionGate>;
  };
  // Flat envelope used by the Flow CLI run dir definition.json
  steps?: FlowDefinitionStep[];
  gates?: Record<string, FlowDefinitionGate>;
}

interface GateOutcome {
  gate_id?: string;
  status?: string;
}

interface FlowTransition {
  type?: string;
  from_step?: string;
  to_step?: string | null;
  gate_id?: string;
  route_reason?: string;
  at?: string;
}

interface FlowRunState {
  run_id?: string;
  subject?: string;
  status?: string;
  current_step?: string;
  gate_outcomes?: GateOutcome[];
  transitions?: FlowTransition[];
  next_action?: string;
}

// ── Builder ─────────────────────────────────────────────────────────────────

const EMPTY_PIPELINE: Pipeline = {
  runId: "",
  runLabel: "",
  runStatus: "unknown",
  stages: [],
  edges: [],
  currentStageId: null,
};

export function buildPipeline(
  definition: unknown,
  runState: unknown,
): Pipeline {
  // Defensive: if missing definition or steps, return empty
  const def = definition as FlowDefinition | undefined;
  // Support both the resource-contract envelope (spec.steps) and the flat
  // CLI envelope (steps at top level, as written by "flow start" run dirs).
  const steps: FlowDefinitionStep[] = def?.spec?.steps ?? def?.steps ?? [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ...EMPTY_PIPELINE };
  }

  const state = runState as FlowRunState | undefined;
  const runId = state?.run_id ?? "";
  const subject = state?.subject ?? runId;
  const runStatus = state?.status ?? "unknown";
  const currentStep = state?.current_step ?? null;
  const gateOutcomes: GateOutcome[] = Array.isArray(state?.gate_outcomes)
    ? (state!.gate_outcomes as GateOutcome[])
    : [];
  const transitions: FlowTransition[] = Array.isArray(state?.transitions)
    ? (state!.transitions as FlowTransition[])
    : [];

  // Gate definitions indexed by gateId (handles both spec.gates and top-level gates)
  const gateDefs: Record<string, FlowDefinitionGate> = def?.spec?.gates ?? def?.gates ?? {};

  // Map gateId → outcome status
  const outcomeByGateId = new Map<string, string>();
  for (const o of gateOutcomes) {
    if (o.gate_id) outcomeByGateId.set(o.gate_id, o.status ?? "pending");
  }

  // Which gates caused a route-back (those stages are "failed")
  const routeBackGateIds = new Set<string>();
  const routeBackEdges: PipelineEdge[] = [];
  for (const t of transitions) {
    if (t.type === "route_back" && t.gate_id) {
      routeBackGateIds.add(t.gate_id);
      // Determine the step that owns this gate
      const gateDef = gateDefs[t.gate_id];
      const fromStep = gateDef?.step ?? t.from_step ?? "";
      const toStep = t.to_step ?? "";
      if (fromStep && toStep && fromStep !== toStep) {
        routeBackEdges.push({ from: fromStep, to: toStep, kind: "route-back" });
      }
    }
  }

  // Detect if any step has `needs` (DAG mode)
  const isDag = steps.some((s) => Array.isArray(s.needs) && s.needs.length > 0);

  // Build a map from step id to step
  const stepById = new Map<string, FlowDefinitionStep>();
  for (const step of steps) {
    stepById.set(step.id, step);
  }

  // Build effective predecessors map per step:
  // If a step has `needs`, use those; otherwise derive from which step has `next` pointing to it.
  const predecessorsOf = new Map<string, string[]>();

  if (isDag) {
    // Build next-pointer map: stepId → predecessor via next chain
    const nextPredecessor = new Map<string, string>();
    for (const step of steps) {
      if (step.next) {
        nextPredecessor.set(step.next, step.id);
      }
    }

    for (const step of steps) {
      if (Array.isArray(step.needs) && step.needs.length > 0) {
        predecessorsOf.set(step.id, [...step.needs]);
      } else {
        // Fall back to next-chain derived predecessor
        const pred = nextPredecessor.get(step.id);
        predecessorsOf.set(step.id, pred ? [pred] : []);
      }
    }
  }

  // Determine which stages are "passed" for readiness computation:
  // A stage is passed if index < currentStepIndex in linear mode,
  // or if all its gates have passed outcomes (DAG mode).
  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  // For DAG: compute which steps have all gates passed (or are before cursor in linear)
  const isStepPassed = (stepId: string, stepIndex: number, stepGates: PipelineGate[]): boolean => {
    if (!isDag) {
      return currentStepIndex >= 0 && stepIndex < currentStepIndex;
    }
    // DAG mode: a step is "passed" if:
    // - it has gates and all have "passed" outcome, OR
    // - it's before the current step index AND no route-back gate
    const hasRouteBackGate = stepGates.some((g) => routeBackGateIds.has(g.id));
    if (hasRouteBackGate) return false;
    if (stepGates.length > 0) {
      return stepGates.every((g) => g.status === "passed");
    }
    // No gates: rely on position
    return currentStepIndex >= 0 && stepIndex < currentStepIndex;
  };

  // Build stages first pass to get gate info
  const stageGatesMap = new Map<string, PipelineGate[]>();
  const stageIndexMap = new Map<string, number>();

  for (const [index, step] of steps.entries()) {
    const stepGates: PipelineGate[] = Object.entries(gateDefs)
      .filter(([, gate]) => gate.step === step.id)
      .map(([gateId, gate]) => {
        const gateStatus = gateOutcomeStatus(gateId, outcomeByGateId, routeBackGateIds);
        const expects: PipelineGateExpect[] = (gate.expects ?? []).map((e) => ({
          id: e.id,
          label: e.description ?? e.id,
          required: e.required ?? true,
          kind: e.kind ?? "unknown",
        }));
        return {
          id: gateId,
          label: gateId,
          status: gateStatus,
          expects,
        };
      });
    stageGatesMap.set(step.id, stepGates);
    stageIndexMap.set(step.id, index);
  }

  // Compute passed set for all steps
  const passedStepIds = new Set<string>();
  for (const step of steps) {
    const idx = stageIndexMap.get(step.id)!;
    const gates = stageGatesMap.get(step.id)!;
    if (isStepPassed(step.id, idx, gates)) {
      passedStepIds.add(step.id);
    }
  }

  // Build stages with correct statuses
  const stages: PipelineStage[] = steps.map((step, index) => {
    const stepGates = stageGatesMap.get(step.id)!;

    const hasRouteBackGate = stepGates.some((g) => routeBackGateIds.has(g.id));

    let stageStatus: PipelineStageStatus;

    if (hasRouteBackGate) {
      stageStatus = "failed";
    } else if (isDag) {
      // DAG status derivation (spec canonical order: failed > current > passed > ready > blocked > pending)
      const preds = predecessorsOf.get(step.id) ?? [];
      const allPredsPassed = preds.every((predId) => passedStepIds.has(predId));

      if (step.id === currentStep) {
        stageStatus = "current";
      } else if (passedStepIds.has(step.id)) {
        stageStatus = "passed";
      } else if (allPredsPassed && preds.length > 0) {
        // All predecessors passed but this step hasn't started yet
        stageStatus = "ready";
      } else if (preds.length === 0) {
        // Root step (no predecessors): if not current and not passed, check position
        if (currentStepIndex >= 0 && index < currentStepIndex) {
          stageStatus = "passed";
        } else if (index === currentStepIndex) {
          stageStatus = "current";
        } else {
          stageStatus = "pending";
        }
      } else {
        // Some predecessor not yet passed
        stageStatus = "blocked";
      }
    } else {
      // Linear mode (original behavior)
      if (currentStepIndex < 0) {
        stageStatus = "pending";
      } else if (index < currentStepIndex) {
        stageStatus = "passed";
      } else if (index === currentStepIndex) {
        const hasBlockingGate = stepGates.some((g) =>
          g.status === "failed" || g.status === "waiting"
        );
        stageStatus =
          runStatus === "blocked" || hasBlockingGate ? "blocked" : "current";
      } else {
        stageStatus = "pending";
      }
    }

    // Compute reason sentence
    const reason = computeStageReason(stageStatus, step.id, stepGates, predecessorsOf, passedStepIds, transitions);

    // Compute configWarning: non-terminal stage with zero gates
    const isTerminal = step.next === null || step.next === undefined;
    const hasSuccessor = !isTerminal;
    const configWarning =
      hasSuccessor && stepGates.length === 0
        ? "No gate defined — nothing verifies this stage."
        : undefined;

    return {
      id: step.id,
      label: step.id,
      order: index,
      status: stageStatus,
      gates: stepGates,
      reason,
      configWarning,
    };
  });

  // Build "next" edges from step.next links
  const nextEdges: PipelineEdge[] = steps
    .filter((s) => s.next)
    .map((s) => ({ from: s.id, to: s.next as string, kind: "next" as const }));

  // Build fan-in edges for steps that have `needs`:
  // each needs entry creates a "next" kind edge from predecessor → step
  const fanInEdges: PipelineEdge[] = [];
  if (isDag) {
    for (const step of steps) {
      if (Array.isArray(step.needs) && step.needs.length > 0) {
        for (const needId of step.needs) {
          // Only add if not already in nextEdges (avoid duplicate when next also points here)
          const alreadyInNext = nextEdges.some((e) => e.from === needId && e.to === step.id);
          if (!alreadyInNext) {
            fanInEdges.push({ from: needId, to: step.id, kind: "next" });
          }
        }
      }
    }
  }

  // Deduplicate route-back edges by from+to pair
  const seenEdgeKeys = new Set<string>();
  const uniqueRouteBackEdges = routeBackEdges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });

  // In DAG mode, replace next edges with fan-in edges (which represent the actual DAG structure)
  // For linear mode, use next edges as before.
  const structuralEdges = isDag ? [...nextEdges, ...fanInEdges] : nextEdges;

  // Deduplicate structural edges
  const seenStructural = new Set<string>();
  const uniqueStructuralEdges = structuralEdges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    if (seenStructural.has(key)) return false;
    seenStructural.add(key);
    return true;
  });

  return {
    runId: `run-${runId}`,
    runLabel: subject ? `${subject} (${runId})` : runId,
    runStatus,
    stages,
    edges: [...uniqueStructuralEdges, ...uniqueRouteBackEdges],
    currentStageId: currentStep ?? null,
    isDag: isDag || undefined,
  };
}


// ── Reason computation ───────────────────────────────────────────────────────

function computeStageReason(
  status: PipelineStageStatus,
  stepId: string,
  gates: PipelineGate[],
  predecessorsOf: Map<string, string[]>,
  passedStepIds: Set<string>,
  transitions: Array<{ type?: string; gate_id?: string; route_reason?: string; from_step?: string }>,
): string {
  switch (status) {
    case "passed":
      return "Complete";
    case "pending":
      return "Not yet reachable";
    case "ready":
      return "Dependencies met — ready to run";
    case "blocked": {
      const preds = predecessorsOf.get(stepId) ?? [];
      const unmetPreds = preds.filter((p) => !passedStepIds.has(p));
      if (unmetPreds.length > 0) {
        return `Waiting on: ${unmetPreds.join(", ")}`;
      }
      return "Waiting on predecessor stages";
    }
    case "current": {
      if (gates.length === 0) {
        return "In progress";
      }
      // Find first non-passed gate
      const waitingGate = gates.find((g) => g.status === "waiting" || g.status === "pending");
      if (waitingGate) {
        return `Awaiting evidence for ${waitingGate.id}`;
      }
      return "In progress";
    }
    case "failed": {
      // Find the gate that triggered a route-back for this step
      const failedTransition = transitions.find(
        (t) => t.type === "route_back" && t.from_step === stepId && t.gate_id,
      );
      if (failedTransition?.gate_id) {
        const routeReason = failedTransition.route_reason;
        return routeReason
          ? `Gate ${failedTransition.gate_id} failed: ${routeReason}`
          : `Gate ${failedTransition.gate_id} failed`;
      }
      // Fallback: find any failed gate
      const failedGate = gates.find((g) => g.status === "failed");
      if (failedGate) {
        return `Gate ${failedGate.id} failed`;
      }
      return "Stage failed";
    }
  }
}

function gateOutcomeStatus(
  gateId: string,
  outcomeByGateId: Map<string, string>,
  routeBackGateIds: Set<string>,
): string {
  if (outcomeByGateId.has(gateId)) {
    const s = outcomeByGateId.get(gateId)!;
    // Normalise known outcome values
    if (s === "passed" || s === "pass") return "passed";
    if (s === "failed" || s === "fail") return "failed";
    if (s === "waiting") return "waiting";
    return s;
  }
  // A gate that caused a route-back without an explicit outcome is "failed"
  if (routeBackGateIds.has(gateId)) return "failed";
  return "pending";
}
