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
 * Reads the Flow evidence manifest (evidence/manifest.json) from the run
 * directory and attaches derived Surface TrustReports to matching gate-expects.
 *
 * Matching logic (Flow 1.3+ trust.bundle format):
 *   For each gate-expect whose kind is "trust.bundle", look up the manifest
 *   entry that has kind=="trust.bundle" and whose bundle_report (or bundle)
 *   contains a claim matching the expect's bundle_claim selector
 *   (claimType + optional subjectId).
 *
 *   For each match:
 *     1. Call buildTrustReport(entry.bundle) for live derivation.
 *     2. Fall back to entry.bundle_report if bundle is absent.
 *     3. Attach as expect.trustReport.
 *
 * Graceful: any missing file, parse error, or derivation error is silently
 * skipped — the pipeline still renders without trust report data.
 */
async function attachTrustReports(runDir: string, pipeline: Pipeline): Promise<void> {
  // Read the evidence manifest (evidence/manifest.json is the canonical location
  // in Flow 1.3+; the bridge only reads — Flow owns these files).
  const manifestPath = path.join(runDir, "evidence", "manifest.json");
  if (!fs.existsSync(manifestPath)) return;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch { return; /* malformed manifest — skip gracefully */ }

  const evidenceEntries = Array.isArray(manifest["evidence"])
    ? (manifest["evidence"] as Array<Record<string, unknown>>)
    : [];

  // Filter to trust.bundle evidence entries only (Flow 1.3+).
  const trustBundleEntries = evidenceEntries.filter((e) => e["kind"] === "trust.bundle");
  if (trustBundleEntries.length === 0) return;

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

  // For each gate-expect whose Flow definition kind is "trust.bundle", find the
  // matching manifest entry and attach a derived TrustReport.
  //
  // We need the raw definition to read bundle_claim selectors. Re-read it here
  // rather than threading it through — it was already parsed in the caller.
  let rawDef: Record<string, unknown> = {};
  try {
    const defPath = path.join(runDir, "definition.json");
    if (fs.existsSync(defPath)) {
      rawDef = JSON.parse(fs.readFileSync(defPath, "utf8")) as Record<string, unknown>;
    }
  } catch { /* if definition is unreadable, selector matching falls back to id */ }

  // Build a lookup: expectId → bundle_claim selector from the definition.
  const bundleClaimByExpectId = new Map<string, Record<string, unknown>>();
  const gateSection = (rawDef["spec"] as Record<string, unknown> | undefined)?.["gates"] ?? rawDef["gates"] ?? {};
  if (gateSection && typeof gateSection === "object") {
    for (const [, gateDef] of Object.entries(gateSection as Record<string, unknown>)) {
      const g = gateDef as Record<string, unknown>;
      const expects = Array.isArray(g["expects"]) ? (g["expects"] as Array<Record<string, unknown>>) : [];
      for (const ex of expects) {
        if (ex["kind"] === "trust.bundle" && ex["bundle_claim"] && typeof ex["bundle_claim"] === "object") {
          bundleClaimByExpectId.set(String(ex["id"]), ex["bundle_claim"] as Record<string, unknown>);
        }
      }
    }
  }

  for (const stage of pipeline.stages) {
    for (const gate of stage.gates) {
      for (const expect of gate.expects as PipelineGateExpect[]) {
        if (expect.trustReport !== undefined) continue;
        // The pipeline-built expect.kind is the claimType (if trust.bundle) or the raw kind.
        // Detect trust.bundle expects by looking up the selector we extracted from the definition.
        const selector = bundleClaimByExpectId.get(expect.id);
        // If no selector found but we have trust.bundle entries, try matching by expect.kind
        // as a claimType (handles cases where definition re-read was unavailable).
        const claimType: string | undefined =
          typeof selector?.["claimType"] === "string" ? selector["claimType"] as string : undefined;
        const subjectId: string | undefined =
          typeof selector?.["subjectId"] === "string" ? selector["subjectId"] as string : undefined;

        // Only process trust.bundle expects (selector present, or kind looks like claimType)
        if (!selector) continue;

        // Find the manifest entry that best matches this expect's bundle_claim selector.
        // Match: entry's bundle or bundle_report contains a claim with matching claimType
        // and (if specified) subjectId.
        const matched = trustBundleEntries.find((entry) => {
          // Check via bundle_report.claims (cached) or bundle.claims (live).
          const reportClaims = Array.isArray((entry["bundle_report"] as Record<string, unknown> | undefined)?.["claims"])
            ? ((entry["bundle_report"] as Record<string, unknown>)["claims"] as Array<Record<string, unknown>>)
            : [];
          const bundleData = entry["bundle"] as Record<string, unknown> | undefined;
          const bundleClaims = Array.isArray(bundleData?.["claims"])
            ? (bundleData!["claims"] as Array<Record<string, unknown>>)
            : [];
          const allClaims = [...reportClaims, ...bundleClaims];
          if (allClaims.length === 0) return false;

          return allClaims.some((c) => {
            const claimTypeMatch = !claimType || String(c["claimType"] ?? c["type"] ?? "") === claimType;
            const subjectMatch = !subjectId || String(c["subjectId"] ?? c["id"] ?? "") === subjectId;
            return claimTypeMatch && subjectMatch;
          });
        });

        if (!matched) continue;

        const bundleData = matched["bundle"] as Record<string, unknown> | undefined;

        // Prefer live derivation from the raw bundle; fall back to embedded bundle_report.
        if (buildTrustReport && bundleData &&
          Array.isArray(bundleData["claims"]) && Array.isArray(bundleData["evidence"])) {
          try {
            (expect as PipelineGateExpect).trustReport = buildTrustReport(bundleData);
          } catch { /* derivation error — try fallback */ }
        }

        // Fallback: use the embedded bundle_report if live derivation wasn't possible.
        if (expect.trustReport === undefined && matched["bundle_report"]) {
          (expect as PipelineGateExpect).trustReport = matched["bundle_report"];
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
