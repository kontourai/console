// Flow run bridge: derives kontour.console.event records from local Flow run
// files (.kontourai/flow/runs/<run-id>/state.json) and delivers them to a Console hub.
// Read-only over Flow-owned files; Flow stays the authority for run state.
// Event ids are deterministic and hub projections deduplicate by id, so
// re-bridging is state-safe; the bin also tracks sent ids across watch passes.
const fs = require("node:fs");
const path = require("node:path");
const { LocalFileSink, CompositeSink, ApiSink } = require("./emitter");
import type { ConsoleRecord, DeliveryResult, Sink } from "./types";
import { buildPipeline } from "@kontourai/console-core";
import type { Pipeline, PipelineGateExpect } from "@kontourai/console-core";
// Flow OWNS its console projection contract. The bridge consumes Flow's
// EXPORTED types (from the stable `@kontourai/flow/console-contract` subpath)
// instead of redefining run/transition/route-back shapes. Type-only imports —
// the bridge stays read-only over Flow-owned files and pulls in no Flow runtime
// (authority stays put: Flow owns process, Console aggregates).
import type {
  FlowConsoleTransitionProjection,
  FlowConsoleRunIdentity,
} from "@kontourai/flow/console-contract" with { "resolution-mode": "import" };

export const DEFAULT_FLOW_ROOT = path.join(".kontourai", "flow");

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
  /** Canonical runs boundary returned by discoverFlowRuns. */
  allowedRunsRoot?: string;
}

function readFlowJson<T>(runDir: string, allowedRunsRoot: string | undefined, ...segments: string[]): T {
  const candidate = path.join(runDir, ...segments);
  const canonicalRunsRoot = allowedRunsRoot ?? fs.realpathSync(path.dirname(runDir));
  const canonicalRunDir = fs.realpathSync(runDir);
  const canonicalCandidate = fs.realpathSync(candidate);
  if (!isWithin(canonicalRunsRoot, canonicalRunDir) || !isWithin(canonicalRunDir, canonicalCandidate)) {
    throw new Error(`Flow artifact escapes its run directory: ${candidate}`);
  }
  return JSON.parse(fs.readFileSync(canonicalCandidate, "utf8")) as T;
}

// Run state read from Flow's own state.json. The transition shape is taken from
// Flow's EXPORTED contract type (`FlowConsoleTransitionProjection`) rather than
// redefined inline; the identity fields are documented against Flow's
// `FlowConsoleRunIdentity`. We loosen the transition with Partial because the
// on-disk state.json is a predecessor/superset of the projection and the bridge
// reads it read-only, needing only a subset of fields.
type FlowTransitionOnDisk = Partial<
  Pick<
    FlowConsoleTransitionProjection,
    "type" | "status" | "from_step" | "to_step" | "at" | "gate_id" | "route_reason"
  >
>;

// Documented against Flow's contract: `run_id`, `subject`, `status`,
// `current_step`, `updated_at` are Flow's own `FlowConsoleRunIdentity` fields.
interface FlowRunState {
  run_id: FlowConsoleRunIdentity["run_id"];
  subject?: string;
  status: string;
  current_step: string;
  next_action?: string;
  updated_at?: string;
  transitions?: FlowTransitionOnDisk[];
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
  const state = readFlowJson<FlowRunState>(runDir, options.allowedRunsRoot, "state.json");
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
      const definition = readFlowJson<Record<string, unknown>>(runDir, options.allowedRunsRoot, "definition.json");
      const pipeline = buildPipeline(definition, state);
      // Attach Surface TrustReports to gate-expects whose evidence files carry TrustBundles.
      await attachTrustReports(runDir, pipeline, options.allowedRunsRoot);
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
async function attachTrustReports(runDir: string, pipeline: Pipeline, allowedRunsRoot?: string): Promise<void> {
  // Read the evidence manifest (evidence/manifest.json is the canonical location
  // in Flow 1.3+; the bridge only reads — Flow owns these files).
  const manifestPath = path.join(runDir, "evidence", "manifest.json");
  if (!fs.existsSync(manifestPath)) return;

  let manifest: Record<string, unknown>;
  try {
    manifest = readFlowJson<Record<string, unknown>>(runDir, allowedRunsRoot, "evidence", "manifest.json");
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
      rawDef = readFlowJson<Record<string, unknown>>(runDir, allowedRunsRoot, "definition.json");
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

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export interface FlowRunDiscovery {
  allowedRunsRoot?: string;
  runDirs: string[];
}

/** Discovers run directories and pins the canonical boundary used for later reads. */
export function discoverFlowRuns(flowRoot: string): FlowRunDiscovery {
  const runsDir = path.join(flowRoot, "runs");
  if (!fs.existsSync(runsDir)) return { runDirs: [] };

  let canonicalFlowRoot: string;
  let canonicalRunsDir: string;
  try {
    canonicalFlowRoot = fs.realpathSync(flowRoot);
    canonicalRunsDir = fs.realpathSync(runsDir);
  } catch {
    return { runDirs: [] };
  }
  if (!isWithin(canonicalFlowRoot, canonicalRunsDir)) return { runDirs: [] };

  const runDirs = fs.readdirSync(canonicalRunsDir, { withFileTypes: true })
    .filter((entry: { isDirectory(): boolean; name: string }) => entry.isDirectory())
    .map((entry: { name: string }) => path.join(runsDir, entry.name))
    .filter((dir: string) => {
      const statePath = path.join(dir, "state.json");
      if (!fs.existsSync(statePath)) return false;
      try {
        const canonicalRunDir = fs.realpathSync(dir);
        return isWithin(canonicalRunsDir, canonicalRunDir) &&
          isWithin(canonicalRunDir, fs.realpathSync(statePath));
      } catch {
        return false;
      }
    });
  return { allowedRunsRoot: canonicalRunsDir, runDirs };
}

/** Lists run directories under a Flow product root that carry state.json. */
export function listFlowRunDirs(flowRoot: string): string[] {
  return discoverFlowRuns(flowRoot).runDirs;
}

export interface FlowBridgeDelivery {
  runId: string;
  events: number;
  accepted: number;
  duplicates: number;
  failed: number;
}

// Translation (Flow run → ConsoleRecord) stays in deriveFlowRunEvents above.
// Delivery is now generic: the bridge hands records to a configured Sink and
// is agnostic about where they land (local disk, hosted API, memory). The Sink
// layer is the ONLY place that knows destinations — see issue #73.

export interface FlowBridgeSinkConfig extends FlowBridgeScopeOptions {
  /** Local mirror root (.kontour by default). Pass null to disable local. */
  localRoot?: string | null;
  /** Hosted console base URL. When set, an ApiSink is added to the fanout. */
  hubUrl?: string;
  /** Hosted console auth token (Bearer / x-console-api-token). */
  authToken?: string;
  /** Tenant routed to the hosted console via x-console-tenant(-id). */
  tenantId?: string;
}

/**
 * Builds the CompositeSink the bridge delivers through. Local-vs-hosted is pure
 * configuration: a LocalFileSink mirror is always present (unless localRoot is
 * null), and an ApiSink is appended whenever a hubUrl is configured. The shared
 * sentIds set is threaded into the ApiSink so re-delivery is idempotent across
 * watch passes.
 */
export function buildFlowBridgeSink(config: FlowBridgeSinkConfig = {}, sentIds?: Set<string>): Sink {
  const sinks: Sink[] = [];
  if (config.localRoot !== null) {
    sinks.push(new LocalFileSink({ root: config.localRoot ?? ".kontour" }));
  }
  if (config.hubUrl) {
    sinks.push(new ApiSink(config.hubUrl, config.authToken ?? "", {
      tenantId: config.tenantId,
      sentIds,
    }));
  }
  if (sinks.length === 0) {
    throw new TypeError("buildFlowBridgeSink requires at least one destination (localRoot or hubUrl)");
  }
  if (sinks.length === 1) return sinks[0];
  return new CompositeSink(sinks);
}

function countDelivery(delivery: FlowBridgeDelivery, result: DeliveryResult, recordId: string, sentIds?: Set<string>): void {
  // A composite "accepted" means every active child accepted (LocalFileSink and,
  // when configured, ApiSink). "skipped" surfaces from the ApiSink dedup path.
  if (result.outcome === "skipped") {
    delivery.duplicates += 1;
    return;
  }
  if (result.outcome === "accepted") {
    delivery.accepted += 1;
    sentIds?.add(recordId);
    return;
  }
  delivery.failed += 1;
}

/**
 * Derives one run's events and delivers them through the configured Sink. The
 * second argument is either a Sink (preferred) or a hub URL string (legacy
 * convenience — a default LocalFileSink-less ApiSink targeting that hub is
 * built for you). Pass a shared `sentIds` set to skip already-delivered events
 * across passes; the hub also dedups by id, so re-sending is state-safe.
 */
export async function bridgeFlowRun(
  runDir: string,
  sinkOrHubUrl: Sink | string,
  options: FlowBridgeScopeOptions = {},
  sentIds?: Set<string>,
): Promise<FlowBridgeDelivery> {
  const events = await deriveFlowRunEvents(runDir, options);
  const sink: Sink = typeof sinkOrHubUrl === "string"
    ? new ApiSink(sinkOrHubUrl, "", { sentIds })
    : sinkOrHubUrl;

  const delivery: FlowBridgeDelivery = {
    runId: events[0]?.producer.runId ?? path.basename(runDir),
    events: events.length,
    accepted: 0,
    duplicates: 0,
    failed: 0,
  };

  for (const event of events) {
    // Honour the caller's sentIds even when the sink doesn't (e.g. local-only),
    // so watch passes report duplicates rather than re-counting accepts.
    if (sentIds?.has(event.id)) {
      delivery.duplicates += 1;
      continue;
    }
    const result = await sink.deliver(event as unknown as ConsoleRecord);
    countDelivery(delivery, result, event.id, sentIds);
  }

  return delivery;
}
