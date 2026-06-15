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

export type PipelineStageStatus = "passed" | "current" | "blocked" | "pending" | "failed";

export interface PipelineStage {
  id: string;
  label: string;
  order: number;
  status: PipelineStageStatus;
  gates: PipelineGate[];
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
}

// ── Input types (from definition.json / state.json) ────────────────────────

interface FlowDefinitionStep {
  id: string;
  next: string | null;
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
  spec?: {
    steps?: FlowDefinitionStep[];
    gates?: Record<string, FlowDefinitionGate>;
  };
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
  const steps: FlowDefinitionStep[] = def?.spec?.steps ?? [];
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

  // Gate definitions indexed by gateId
  const gateDefs: Record<string, FlowDefinitionGate> = def?.spec?.gates ?? {};

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

  // Current step index
  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  // Build stages
  const stages: PipelineStage[] = steps.map((step, index) => {
    // Gates belonging to this step
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

    // Stage status derivation
    // A stage whose gate caused a route-back is "failed" regardless of its
    // position relative to the current step. This models the CI case where
    // verify routed back to implement: verify = failed, implement = current.
    const hasRouteBackGate = stepGates.some((g) => routeBackGateIds.has(g.id));

    let stageStatus: PipelineStageStatus;
    if (hasRouteBackGate) {
      stageStatus = "failed";
    } else if (currentStepIndex < 0) {
      // No current step match — treat all as pending
      stageStatus = "pending";
    } else if (index < currentStepIndex) {
      stageStatus = "passed";
    } else if (index === currentStepIndex) {
      // blocked if run status is blocked OR any gate for this stage is in a failing/waiting state
      const hasBlockingGate = stepGates.some((g) =>
        g.status === "failed" || g.status === "waiting"
      );
      stageStatus =
        runStatus === "blocked" || hasBlockingGate ? "blocked" : "current";
    } else {
      stageStatus = "pending";
    }

    return {
      id: step.id,
      label: step.id,
      order: index,
      status: stageStatus,
      gates: stepGates,
    };
  });

  // Build "next" edges from step.next links
  const nextEdges: PipelineEdge[] = steps
    .filter((s) => s.next)
    .map((s) => ({ from: s.id, to: s.next as string, kind: "next" as const }));

  // Deduplicate route-back edges by from+to pair
  const seenEdgeKeys = new Set<string>();
  const uniqueRouteBackEdges = routeBackEdges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });

  return {
    runId: `run-${runId}`,
    runLabel: subject ? `${subject} (${runId})` : runId,
    runStatus,
    stages,
    edges: [...nextEdges, ...uniqueRouteBackEdges],
    currentStageId: currentStep ?? null,
  };
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
