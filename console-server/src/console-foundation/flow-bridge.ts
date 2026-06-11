// Flow run bridge: derives kontour.console.event records from local Flow run
// files (.flow/runs/<run-id>/state.json) and delivers them to a Console hub.
// Read-only over Flow-owned files; Flow stays the authority for run state.
// Event ids are deterministic and hub projections deduplicate by id, so
// re-bridging is state-safe; the bin also tracks sent ids across watch passes.
const fs = require("node:fs");
const path = require("node:path");

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
export function deriveFlowRunEvents(runDir: string, options: FlowBridgeScopeOptions = {}): FlowBridgeEvent[] {
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

  return events;
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
  const events = deriveFlowRunEvents(runDir, options);
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
