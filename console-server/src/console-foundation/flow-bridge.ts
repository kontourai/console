// Flow run bridge: derives kontour.console.event records from local Flow run
// files (.flow/runs/<run-id>/state.json) and delivers them to a Console hub.
// Read-only over Flow-owned files; Flow stays the authority for run state.
// Event ids are deterministic and hub projections deduplicate by id, so
// re-bridging is state-safe; the bin also tracks sent ids across watch passes.
const fs = require("node:fs");
const path = require("node:path");
import { buildPipeline } from "@kontourai/console-core";
import type { Pipeline, PipelineGateExpect } from "@kontourai/console-core";

export interface FlowBridgeEvent {
  schema: "kontour.console.event";
  version: "0.1";
  id: string;
  type: string;
  occurredAt: string;
  producer: { id: string; product: string; name: string; runId: string };
  scope: { kind: string; id: string; label: string };
  subject: { product: string; kind: string; id: string; label: string };
  actor: { kind: string; id: string; product: string; label: string };
  correlationId: string;
  sequence: number;
  payload: { after: Record<string, unknown>; summary: string };
}

export interface FlowBridgeScopeOptions {
  scopeId?: string;
  scopeLabel?: string;
}

interface FlowRunState {
  run_id: string;
  subject?: string;
  status: string;
  current_step: string;
  next_action?: string;
  updated_at?: string;
  transitions?: Array<{
    type?: string;
    status?: string;
    from_step?: string;
    to_step?: string | null;
    at?: string;
    gate_id?: string;
    route_reason?: string;
  }>;
}

function consoleStatus(state: FlowRunState): string {
  if (state.status === "completed") return "completed";
  if (state.status === "blocked") return "blocked";
  return "running";
}

/**
 * Derives the deterministic event sequence for one Flow run directory.
 * Event ids are stable across invocations so hub-side deduplication makes
 * re-bridging safe.
 */
export async function deriveFlowRunEvents(runDir: string, options: FlowBridgeScopeOptions = {}): Promise<FlowBridgeEvent[]> {
  const statePath = path.join(runDir, "state.json");
  const state: FlowRunState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const runId = state.run_id;
  const subject = state.subject ?? runId;
  const scopeId = options.scopeId ?? "flow-local";
  const scopeLabel = options.scopeLabel ?? "Flow local runs";
  const transitions = Array.isArray(state.transitions) ? state.transitions : [];
  const startedAt = transitions[0]?.at ?? state.updated_at ?? new Date().toISOString();

  const base = (sequence: number, type: string, occurredAt: string, summary: string, after: Record<string, unknown>): FlowBridgeEvent => ({
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-flowbridge-${runId}-${sequence}`,
    type,
    occurredAt,
    producer: { id: "flow-bridge", product: "flow", name: "Flow run bridge", runId: `run-${runId}` },
    scope: { kind: "project", id: scopeId, label: scopeLabel },
    subject: { product: "flow", kind: "run", id: `run-${runId}`, label: `${subject} (${runId})` },
    actor: { kind: "agent", id: "flow-bridge", product: "flow", label: "Flow run bridge" },
    correlationId: `corr-flow-${runId}`,
    sequence,
    payload: { after, summary },
  });

  const events: FlowBridgeEvent[] = [];
  events.push(base(1, "process.started", startedAt, `Flow run ${runId} (${subject}) recorded.`, {
    status: "running",
    currentStep: transitions[0]?.from_step ?? state.current_step,
  }));

  transitions.forEach((transition, index) => {
    const sequence = index + 2;
    const occurredAt = transition.at ?? state.updated_at ?? startedAt;
    if (transition.type === "route_back") {
      events.push(base(sequence, "gate.routed_back", occurredAt,
        `Gate ${transition.gate_id ?? "gate"} routed back to ${transition.to_step}` +
        (transition.route_reason ? ` (${transition.route_reason}).` : "."), {
          status: "running",
          currentStep: transition.to_step ?? state.current_step,
        }));
      return;
    }
    const terminal = transition.to_step === null || transition.to_step === undefined;
    events.push(base(sequence, "process.progressed", occurredAt,
      terminal
        ? `Flow run ${runId} reached its terminal step.`
        : `Advanced from ${transition.from_step} to ${transition.to_step}.`, {
        status: terminal ? consoleStatus(state) : "running",
        currentStep: terminal ? state.current_step : (transition.to_step ?? state.current_step),
      }));
  });

  const finalSequence = transitions.length + 2;
  events.push(base(finalSequence, "process.progressed", state.updated_at ?? startedAt,
    state.next_action ? `Current state: ${state.next_action}` : `Current step: ${state.current_step}.`, {
      status: consoleStatus(state),
      currentStep: state.current_step,
    }));

  // Pipeline snapshot: sequence 0 sorts first; only emitted when definition.json exists
  const definitionPath = path.join(runDir, "definition.json");
  if (fs.existsSync(definitionPath)) {
    try {
      const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
      const pipeline = buildPipeline(definition, state);
      // Attach Surface TrustReports to gate-expects whose evidence files carry TrustBundles.
      await attachTrustReports(runDir, pipeline);
      const pipelineEvent: FlowBridgeEvent = {
        schema: "kontour.console.event",
        version: "0.1",
        id: `evt-flowbridge-${runId}-pipeline`,
        type: "flow.pipeline.snapshot",
        occurredAt: state.updated_at ?? startedAt,
        producer: { id: "flow-bridge", product: "flow", name: "Flow run bridge", runId: `run-${runId}` },
        scope: { kind: "project", id: scopeId, label: scopeLabel },
        subject: { product: "flow", kind: "run", id: `run-${runId}`, label: `${subject} (${runId})` },
        actor: { kind: "agent", id: "flow-bridge", product: "flow", label: "Flow run bridge" },
        correlationId: `corr-flow-${runId}`,
        sequence: 0,
        payload: {
          after: { pipeline },
          summary: `Pipeline snapshot for ${runId}: ${pipeline.stages.length} stages, current=${pipeline.currentStageId ?? "none"}.`,
        },
      };
      events.unshift(pipelineEvent);
    } catch {
      // Graceful: if definition.json is malformed, skip pipeline snapshot
    }
  }

  return events;
}

// ── Trust report attachment ───────────────────────────────────────────────────

/**
 * Loads Surface TrustBundles from evidence files in the run directory and
 * attaches derived TrustReports to matching gate-expects. Graceful: any parse
 * or derivation error is silently skipped — the pipeline still renders.
 */
async function attachTrustReports(runDir: string, pipeline: Pipeline): Promise<void> {
  // Load candidate files: evidence/ subdir and any .json trust-artifact at top level
  const candidateFiles: string[] = [];
  const evidenceDir = path.join(runDir, "evidence");
  if (fs.existsSync(evidenceDir)) {
    try {
      const entries: string[] = fs.readdirSync(evidenceDir).filter((f: string) => f.endsWith(".json"));
      for (const entry of entries) candidateFiles.push(path.join(evidenceDir, entry));
    } catch { /* skip unreadable dirs */ }
  }
  // Also check run-dir top-level for trust artifacts (Flow CLI typically writes them here)
  try {
    const entries: string[] = fs.readdirSync(runDir).filter((f: string) => f.endsWith(".json") && f !== "state.json" && f !== "definition.json");
    for (const entry of entries) candidateFiles.push(path.join(runDir, entry));
  } catch { /* skip */ }

  if (candidateFiles.length === 0) return;

  // Parse candidates and identify Surface TrustBundles (schemaVersion 2 or 3)
  const bundles: Array<{ file: string; bundle: Record<string, unknown>; verifyUrl?: string }> = [];
  for (const file of candidateFiles) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      const sv = raw["schemaVersion"];
      if ((sv === 2 || sv === 3) && Array.isArray(raw["claims"]) && Array.isArray(raw["evidence"])) {
        const verifyUrl = typeof raw["verifyUrl"] === "string" ? raw["verifyUrl"] :
          typeof raw["verification_url"] === "string" ? raw["verification_url"] : undefined;
        bundles.push({ file, bundle: raw, verifyUrl });
      } else if (typeof raw["verifyUrl"] === "string" || typeof raw["verification_url"] === "string") {
        // Evidence file with only a verification URL (no bundle present yet)
        const verifyUrl = (typeof raw["verifyUrl"] === "string" ? raw["verifyUrl"] : raw["verification_url"]) as string;
        bundles.push({ file, bundle: raw, verifyUrl });
      }
    } catch { /* skip malformed files */ }
  }

  if (bundles.length === 0) return;

  // Lazily import buildTrustReport — keep the require dynamic so the CJS build
  // can tree-shake if surface is absent, and to avoid top-level async.
  type BuildTrustReportFn = (bundle: Record<string, unknown>) => unknown;
  let buildTrustReport: BuildTrustReportFn | null = null;
  try {
    const surfaceMod = await import("@kontourai/surface");
    const fn = (surfaceMod as unknown as Record<string, unknown>)["buildTrustReport"];
    if (typeof fn === "function") {
      buildTrustReport = fn as BuildTrustReportFn;
    }
  } catch { /* @kontourai/surface not available; skip trust reports */ }

  // For each gate-expect of kind surface.claim, try to match a bundle and attach the report
  for (const stage of pipeline.stages) {
    for (const gate of stage.gates) {
      for (const expect of gate.expects as PipelineGateExpect[]) {
        if (expect.kind !== "surface.claim") continue;
        if (expect.trustReport !== undefined || expect.verifyUrl !== undefined) continue;

        // Match: prefer a bundle whose source or claims subject matches the expect id/label
        const matched = bundles.find((b) => {
          const source = typeof b.bundle["source"] === "string" ? b.bundle["source"] as string : "";
          const claims = Array.isArray(b.bundle["claims"]) ? b.bundle["claims"] as Array<Record<string, unknown>> : [];
          return source.includes(expect.id) ||
            source.includes(expect.label) ||
            claims.some((c) => String(c["subjectId"] ?? "").includes(expect.id) ||
              String(c["claimType"] ?? "").includes(expect.id) ||
              String(c["subjectId"] ?? "").includes(expect.label));
        }) ?? bundles[0]; // fall back to first bundle if only one available

        if (!matched) continue;

        if (matched.verifyUrl) {
          (expect as PipelineGateExpect).verifyUrl = matched.verifyUrl;
        }
        if (buildTrustReport && Array.isArray(matched.bundle["claims"]) && Array.isArray(matched.bundle["evidence"])) {
          try {
            (expect as PipelineGateExpect).trustReport = buildTrustReport(matched.bundle);
          } catch { /* derivation error — skip */ }
        }
      }
    }
  }
}

/** Lists run directories under a Flow root (.flow) that carry state.json. */
export function listFlowRunDirs(flowRoot: string): string[] {
  const runsDir = path.join(flowRoot, "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry: { isDirectory(): boolean; name: string }) => entry.isDirectory())
    .map((entry: { name: string }) => path.join(runsDir, entry.name))
    .filter((dir: string) => fs.existsSync(path.join(dir, "state.json")));
}

export interface FlowBridgeDelivery {
  runId: string;
  events: number;
  accepted: number;
  duplicates: number;
  failed: number;
}

/**
 * Derives and POSTs one run's events to a hub /records endpoint. Pass a
 * shared `sentIds` set to skip already-delivered events across passes (the
 * hub's projections also deduplicate by id, so re-sending is state-safe but
 * grows sink storage).
 */
export async function bridgeFlowRun(
  runDir: string,
  hubUrl: string,
  options: FlowBridgeScopeOptions = {},
  sentIds?: Set<string>,
): Promise<FlowBridgeDelivery> {
  const events = await deriveFlowRunEvents(runDir, options);
  const delivery: FlowBridgeDelivery = {
    runId: events[0]?.producer.runId ?? path.basename(runDir),
    events: events.length,
    accepted: 0,
    duplicates: 0,
    failed: 0,
  };
  for (const event of events) {
    if (sentIds?.has(event.id)) {
      delivery.duplicates += 1;
      continue;
    }
    const response = await fetch(`${hubUrl.replace(/\/$/, "")}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (response.ok) {
      delivery.accepted += 1;
      sentIds?.add(event.id);
    } else {
      delivery.failed += 1;
    }
  }
  return delivery;
}
