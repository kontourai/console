export type RecordKind = "event" | "projection" | "economics";
export type DeliveryOutcome = "accepted" | "skipped" | "failed";
export type ValidationSeverity = "error" | "warning";
export type SourceKind = "fixture" | "local";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonArray = JsonValue[];
export type OpenRecord = Record<string, unknown>;

export interface CrossProductRef {
  product: string;
  kind: string;
  id: string;
  apiVersion?: string;
  name?: string;
  uid?: string;
  label?: string;
  url?: string;
  scope?: Partial<CrossProductRef>;
  [key: string]: unknown;
}

export type JsonObject = Record<string, unknown>;

export interface ConsoleLink {
  from?: CrossProductRef;
  relation?: string;
  to?: CrossProductRef;
  createdAt?: string;
}

export interface ConsoleActionRecord extends JsonObject {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
  readOnly?: boolean;
  authority?: JsonObject;
  subjectRefs?: CrossProductRef[];
}

export interface ConsoleInquiryRecord extends JsonObject {
  id: string;
  label?: string;
  outcome: string;
  asker?: string;
  claimRefs?: CrossProductRef[];
  ruleRefs?: CrossProductRef[];
  statusFunctionVersion?: string;
  resolvedAt?: string;
  sourceRef?: CrossProductRef;
}

export interface OperatingState {
  generatedAt?: string | null;
  currentStage?: string;
  source?: {
    mode?: string;
    streamIds?: string[];
    acceptedEventCount?: number;
    duplicateEventCount?: number;
    lastAcceptedEventId?: string | null;
  };
  processes?: Record<string, unknown>[];
  gates?: Record<string, unknown>[];
  claims?: Record<string, unknown>[];
  evidence?: Record<string, unknown>[];
  learnings?: Record<string, unknown>[];
  inquiries?: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
  links?: ConsoleLink[];
  pipeline?: Record<string, unknown>;
  timeline?: Record<string, unknown>[];
  /**
   * Currently-active actors folded from `kontour.console.liveness` claim/heartbeat/
   * release records (flow-agents #295) — one entry per (actor, subjectId) pair
   * still held. `release` removes the entry rather than marking it inactive, so
   * this array always reflects who is active right now, not full history.
   */
  actors?: Record<string, unknown>[];
  /** TTL-expired actors still retained within the bounded liveness prune horizon. */
  reclaimableActors?: Record<string, unknown>[];
}

export type ConsoleApiErrorCode =
  | "BAD_REQUEST"
  | "BODY_TOO_LARGE"
  | "INVALID_BODY"
  | "INVALID_JSON"
  | "INVALID_RECORD"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "ORIGIN_NOT_ALLOWED"
  | "SINK_DELIVERY_FAILED"
  | (string & {});

export interface ConsoleApiError {
  error: ConsoleApiErrorCode;
  safeMessage?: string;
  validation?: ValidationIssue[];
}

export type ConsoleStateResponse = OperatingState;
export type ConsoleEventsResponse = EventStreamInspection[];
export type ConsoleRecordsRequest = ConsoleRecord;
export type ConsoleRecordsResponse = DeliveryResult | ConsoleApiError;
export type TelemetryRecordKind = "runtime" | "workflow-sidecar";
export type ConsoleSseEventName = "ready" | "state" | "record.accepted" | "telemetry.updated";
export type ConsoleStreamPath = "/stream";
export type ConsoleEventsCompatibilityPath = "/events";

export interface ConsoleReadySsePayload {
  connectedAt: string;
}

export type ConsoleStateSsePayload = OperatingState;

export interface ConsoleAcceptedRecordSsePayload {
  delivery: DeliveryResult;
  state: OperatingState;
}

export interface ConsoleTelemetryUpdatedSsePayload {
  telemetry: {
    generatedAt: string;
    recordCount: number;
  };
}

export interface ConsoleSsePayloadMap {
  ready: ConsoleReadySsePayload;
  state: ConsoleStateSsePayload;
  "record.accepted": ConsoleAcceptedRecordSsePayload;
  "telemetry.updated": ConsoleTelemetryUpdatedSsePayload;
}

export type ConsoleStreamSsePayload = ConsoleSsePayloadMap[ConsoleSseEventName];
export type ConsoleEventsSsePayload = ConsoleStreamSsePayload;

export interface ConsoleProducer {
  product?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ConsoleRecordBase {
  schema: string;
  version: string;
  id?: string;
  producer?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  /**
   * Tenant a record belongs to. Self-description only — the authoritative tenant
   * is bound from the verified principal at ingest (ADR 0003 call 2). A body that
   * disagrees with the principal's tenant is rejected; otherwise ingest stamps
   * this field from the principal before the record is appended.
   */
  tenant_id?: string;
  [key: string]: unknown;
}

export interface ConsoleEventRecord extends ConsoleRecordBase {
  schema: "kontour.console.event";
  id: string;
  type: string;
  occurredAt: string;
  subject: CrossProductRef;
  producer: ConsoleProducer;
  payload: JsonObject;
  links?: ConsoleLink[];
  observedAt?: string;
  sequence?: number;
  summary?: string;
}

export interface ConsoleProjectionRecord extends ConsoleRecordBase {
  schema: "kontour.console.projection";
  generatedAt: string;
  derivedFrom: Record<string, unknown>;
}

// ── Liveness (flow-agents #295, console #125) ──────────────────────────────
//
// A best-effort mirror of a single local claim/heartbeat/release liveness event
// (scripts/liveness/relay.sh), STRICTLY OPTIONAL and off by default. Unlike
// `kontour.console.event`, a liveness record carries no `subject`/`payload`/
// `producer` envelope — it is a flat fact about one actor holding (or releasing)
// one subjectId. Console folds it into the OperatingState projection's `actors[]`
// so hosted Operate/Overview panels can show who is currently active, without
// conflating it with Surface's unrelated `claim.*` verification-claim events.
export type LivenessEventType = "claim" | "heartbeat" | "release";

export interface ConsoleLivenessRecord extends ConsoleRecordBase {
  schema: "kontour.console.liveness";
  /** Synthesized server-side (`liveness:<actor>:<subjectId>:<type>:<at>`) when the
   *  emitter omits it, so repeat POSTs of the same event stay idempotent while
   *  distinct events keep separate history (core_records primary key is
   *  (tenant_id, record_id)). */
  id?: string;
  type: LivenessEventType;
  subjectId: string;
  actor: string;
  actor_key?: string | null;
  /** ISO timestamp of the liveness event; required — doubles as `lastSeenAt`. */
  at: string;
  ttlSeconds?: number | null;
  host?: string | null;
  branch?: string | null;
  artifact_dir?: string | null;
}

export type ConsoleRecord = ConsoleEventRecord | ConsoleProjectionRecord | ConsoleLivenessRecord | ConsoleRecordBase;

// ── Economics (ADR 0003 calls 1, 3, 4; console #117 / flow-agents #349) ───────
//
// A per-run economics FACT — an additive versioned KIND on the one `/records`
// ingress (call 1), routed to the telemetry plane (operational), never
// `hub.append`. The rollups and the value comparison are REBUILDABLE projections
// over the record stream (call 3).
//
// The record shape is the AUTHORITATIVE flow-agents #349 `kontour.console.economics`
// v0.1 contract (snake_case, nested): `cost`/`time`/`iterations`/`defects` objects,
// with `cost` and `defects` co-required (the R7 Goodhart guard — a cost-only record
// is schema-invalid). Per-phase attribution lives in the top-level `phases[]` array
// (never a `cost.by_phase`); when no phase context exists, everything lands in a
// single `{phase:"unattributed", ...}` entry (the phase-sum invariant).
//
// The value-experiment dimensions `model_tier` / `kit_condition` / `acceptance_label`
// are NOT on the base record — they are #350 HARNESS tags that EXTEND it on harness
// runs only (the schema is `additionalProperties: true`). They are therefore OPTIONAL
// here. `acceptance_label`, when present, is the INDEPENDENT kontourai/evals oracle's
// verdict (call 4) — Console renders it verbatim and NEVER re-derives acceptance from
// kit gates.

export type EconomicsModelTier = "small" | "large";
export type EconomicsKitCondition = "bare" | "+kit";
export type EconomicsAcceptanceLabel = "accepted" | "rejected";
export type EconomicsVerificationVerdict = "PASS" | "FAIL" | "NOT_VERIFIED";

export interface EconomicsCostByModel {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  estimated_cost_usd?: number;
}

export interface EconomicsCost {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  estimated_cost_usd: number;
  by_model: EconomicsCostByModel[];
}

export interface EconomicsTime {
  wall_clock_s: number;
  human_wait_s: number;
}

export interface EconomicsPhase {
  phase: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  estimated_cost_usd?: number;
  wall_clock_s?: number;
}

export interface EconomicsIterations {
  count: number;
  route_backs: number;
}

export interface EconomicsFindingsBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface EconomicsDefects {
  gate_fires: number;
  findings_by_severity: EconomicsFindingsBySeverity;
  /** Claimed passes contradicted by a trusted backstop — the strongest ROI evidence. */
  caught_false_completions: number;
  verification_verdict: EconomicsVerificationVerdict;
}

/** A delegation outcome (flow-agents #415). `unavailable` = NOT measurable — it is
 *  never folded into any accepted/failed bucket (honesty rule 2). */
export type EconomicsDelegationOutcome = "accepted" | "rework" | "diverged" | "failed" | "unavailable";

/** One delegated sub-agent entry on a run (flow-agents #415, part 4). Passed through
 *  ingestion untouched via additionalProperties; typed here so the projection can read it. */
export interface EconomicsDelegation {
  agent_id?: string;
  /** The routing role, e.g. `delegate-design`. The (role, model) grouping dimension. */
  role?: string;
  /** Resolved model WITH an `@provider` suffix (e.g. `claude-opus-4-8@anthropic`);
   *  the projection strips the suffix to join against `cost.by_model[].model` (bare). */
  resolved_model?: string;
  summary?: string;
  /** Present only when this delegation was escalated from another role. */
  escalated_from?: string;
  /** >1 means the orchestrator re-prompted this delegate. */
  dispatch_count?: number;
  outcome?: EconomicsDelegationOutcome;
}

/** Full outcome coverage on this harness; `partial` = some delegations carry outcomes. */
export type EconomicsPerDelegationOutcome = "full" | "partial" | "none" | "n/a";

/** Harness-capability declaration (flow-agents #415). The panel is gated on these:
 *  `per_delegation_tokens` is false on every runtime today → per-delegation cost is a
 *  MODEL-GRANULARITY PROXY, never real per-sub-agent spend (honesty rule 1 + 3). */
export interface EconomicsSignals {
  runtime?: string;
  /** False on every runtime today → per-delegation cost is UNAVAILABLE (proxy only). */
  per_delegation_tokens?: boolean;
  /** How much outcome is measurable on this harness. */
  per_delegation_outcome?: EconomicsPerDelegationOutcome;
}

export interface ConsoleEconomicsRecord extends ConsoleRecordBase {
  schema: "kontour.console.economics";
  version: "0.1";
  run_id: string;
  /** Epoch-millis string of the run end (session.end). Nullable per #349. */
  at?: string | null;
  /** The task the run served — the natural per-run join dimension. Nullable per #349. */
  task_slug?: string | null;
  model?: string | null;
  pricing_version?: string | null;
  cost: EconomicsCost;
  time: EconomicsTime;
  phases?: EconomicsPhase[];
  iterations: EconomicsIterations;
  defects: EconomicsDefects;
  /**
   * Self-description only; ingest STAMPS the authoritative tenant from the
   * principal. #349 permits a body `null`, but ingest always overwrites this with
   * the principal's tenant before append, so the stored value is a string.
   */
  tenant_id?: string;
  // ── #350 harness experiment tags (OPTIONAL; present only on harness runs) ──
  model_tier?: EconomicsModelTier;
  kit_condition?: EconomicsKitCondition;
  /** The INDEPENDENT oracle's verdict — never re-derived from kit gates (call 4). */
  acceptance_label?: EconomicsAcceptanceLabel;
  // ── #415 delegation efficiency (OPTIONAL; passed through ingest untouched) ──
  /** One entry per delegated sub-agent; `[]` when none. */
  delegations?: EconomicsDelegation[];
  /** Harness-capability declaration gating the delegation panel's honesty labels. */
  signals?: EconomicsSignals;
}

/** Cost + paired-defect trend for one task_slug over one day (R5: never cost-only). */
export interface EconomicsTaskDayRollup {
  /** The run's `task_slug`, or `unattributed` when the record carries none. */
  taskSlug: string;
  /** Calendar day (UTC), `YYYY-MM-DD`. */
  day: string;
  runs: number;
  totalCostUsd: number;
  /** Per-phase cost from the top-level `phases[]`; an `unattributed` bucket otherwise. */
  costByPhase: Record<string, number>;
  /** All findings caught pre-merge (sum over findings_by_severity). */
  defectsCaught: number;
  caughtFalseCompletions: number;
}

export interface EconomicsCaughtDefects {
  /** Findings caught pre-merge across all runs (sum of every severity). */
  defectsCaught: number;
  /** Per-severity totals. */
  bySeverity: EconomicsFindingsBySeverity;
  /** The strongest ROI evidence — surfaced distinctly (R3). */
  caughtFalseCompletions: number;
  /** Total gate fires across runs. */
  gateFires: number;
}

export interface EconomicsFunnel {
  runs: number;
  totalIterations: number;
  totalRouteBacks: number;
  /** Share of runs completed in a single iteration with no route-backs. */
  firstPassRate: number;
  /** Aggregate human-decision wait, seconds (from time.human_wait_s). */
  humanWaitS: number;
}

export interface EconomicsRollup {
  generatedAt: string;
  tenantId: string;
  runCount: number;
  /** task_slug×day cost trend with the paired defect counts on the same row (R5). */
  cost: EconomicsTaskDayRollup[];
  caughtDefects: EconomicsCaughtDefects;
  funnel: EconomicsFunnel;
}

/** One `(model_tier, kit_condition)` cell of the value comparison. */
export interface ValueCell {
  model_tier: string;
  kit_condition: string;
  runs: number;
  acceptanceRate: number;
  iterationsToAccept: number;
  defectsCaught: number;
  /** `totalCost / acceptedCount`; `null` when nothing was accepted (never a fake 0). */
  dollarsPerAcceptable: number | null;
}

export interface ValueComparison {
  generatedAt: string;
  tenantId: string;
  /** How many records carried the optional `(model_tier, kit_condition)` tags. */
  taggedRunCount: number;
  /** Grouped by `(model_tier, kit_condition)` — only over tagged (harness) records. */
  cells: ValueCell[];
  /** The headline claim: `small+kit` vs `large-bare`. Null cells → no verdict yet. */
  headline: {
    smallPlusKit: ValueCell | null;
    largeBare: ValueCell | null;
    /** `meets`/`exceeds`/`below` on $/acceptable; `unknown` until both cells exist. */
    verdict: "meets" | "below" | "exceeds" | "unknown";
    /** largeBare$/acceptable ÷ smallPlusKit$/acceptable (>1 ⇒ small+kit is cheaper). */
    ratio: number | null;
  };
}

// ── Delegation efficiency read-model (flow-agents #415, part 4) ────────────────
//    HONESTY: cost here is a MODEL-GRANULARITY PROXY joined from `cost.by_model`,
//    never real per-sub-agent spend (no runtime isolates per-delegation tokens).
//    `unavailable` outcomes are excluded from acceptanceRate — never a success/fail.

/** How the (role, model) cost was derived. Always `model-proxy` today — there is no
 *  per-delegation token isolation, so cost is attributed at model granularity. */
export type EconomicsDelegationCostGranularity = "model-proxy";

/** One `(role, model)` rollup of delegation outcomes + proxy cost. */
export interface EconomicsRoleModelRollup {
  role: string;
  /** Bare model name (the `@provider` suffix is stripped to join `cost.by_model`). */
  model: string;
  /** Count of delegation entries in this (role, model) group. */
  delegations: number;
  reworkCount: number;
  divergedCount: number;
  failedCount: number;
  acceptedCount: number;
  /** NOT a success or failure — excluded from the acceptanceRate denominator. */
  unavailableCount: number;
  /** accepted / (accepted+rework+diverged+failed); `null` when that denominator is 0. */
  acceptanceRate: number | null;
  /** PROXY cost: the model's `estimated_cost_usd` from `cost.by_model` summed over the
   *  runs in this group; `null` when the model isn't present in `by_model`. */
  costUsd: number | null;
  /** Always `model-proxy` — never real per-delegation spend. */
  costGranularity: EconomicsDelegationCostGranularity;
}

/** Outcome coverage across ALL delegations: how many were measurable vs `unavailable`. */
export interface EconomicsDelegationCoverage {
  measurable: number;
  unavailable: number;
}

/** Signals aggregated (worst-case) across the tenant's records. */
export interface EconomicsDelegationSignals {
  /** False on every runtime today → the cost column is a proxy, not exact spend. */
  perDelegationTokens: boolean;
  /** Worst/aggregated coverage; `mixed` when records disagree. */
  perDelegationOutcome: "full" | "partial" | "none" | "n/a" | "mixed";
}

export interface EconomicsDelegationRollup {
  generatedAt: string;
  tenantId: string;
  /** Runs that carried any delegations. */
  runCount: number;
  /** Per-(role, model) rollups; model is the bare name. */
  perRoleModel: EconomicsRoleModelRollup[];
  /** Outcome coverage across all delegations. */
  coverage: EconomicsDelegationCoverage;
  /** Harness-capability signals gating the panel's honesty rendering. */
  signals: EconomicsDelegationSignals;
}

export interface ConsoleObjectRecord extends JsonObject {
  id?: string;
  label?: string;
  status?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface ConsoleProjectionSnapshot extends ConsoleProjectionRecord {
  claims?: ConsoleObjectRecord[];
  processes?: ConsoleObjectRecord[];
  gates?: ConsoleObjectRecord[];
  reviewItems?: ConsoleObjectRecord[];
  evidence?: ConsoleObjectRecord[];
  decisions?: ConsoleObjectRecord[];
  actions?: ConsoleObjectRecord[];
  exceptions?: ConsoleObjectRecord[];
  learnings?: ConsoleObjectRecord[];
  inquiries?: ConsoleObjectRecord[];
  links?: ConsoleLink[];
}

export interface ValidationIssue {
  severity: ValidationSeverity;
  path: string;
  message: string;
}

export interface ValidationSummary {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ClassifiedRecord {
  recordKind: RecordKind;
  recordId: string;
  validation: ValidationIssue[];
}

export interface DeliveryResult {
  sinkId: string;
  sinkRole: string;
  outcome: DeliveryOutcome;
  status: string;
  recordId: string;
  recordKind: RecordKind;
  observedAt: string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
  children?: DeliveryResult[];
  [key: string]: unknown;
}

export interface DeliveryResultFields {
  sinkId: string;
  sinkRole: string;
  outcome: DeliveryOutcome;
  status?: string;
  recordId: string;
  recordKind: RecordKind;
  observedAt?: string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
  children?: DeliveryResult[];
}

export interface Sink {
  sinkId?: string;
  sinkRole?: string;
  id?: string;
  name?: string;
  deliver(record: ConsoleRecord): DeliveryResult | Promise<DeliveryResult>;
}

export interface KontourEmitterOptions {
  sink: Sink;
}

export interface LocalFileSinkOptions {
  root?: string;
  sinkId?: string;
  sinkRole?: string;
}

export interface CompositeSinkOptions {
  sinkId?: string;
  sinkRole?: string;
}

export interface InMemorySinkOptions {
  sinkId?: string;
  sinkRole?: string;
}

export type ApiSinkFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ApiSinkOptions {
  sinkId?: string;
  sinkRole?: string;
  /** Tenant routed via the x-console-tenant / x-console-tenant-id headers. */
  tenantId?: string;
  /** Max delivery attempts on transient (5xx / network) failures. Default 3. */
  maxAttempts?: number;
  /** Base backoff in milliseconds between retries. Default 100. */
  retryBackoffMs?: number;
  /** Injectable fetch (defaults to global fetch) — keeps the sink testable. */
  fetch?: ApiSinkFetch;
  /** Sleep hook between retries (defaults to setTimeout) — testable backoff. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Shared set of already-delivered record ids. Re-uses the bridge's event-id
   * dedup so re-delivering an accepted record is a no-op (idempotent).
   */
  sentIds?: Set<string>;
}

export interface InspectOptions {
  rootDir?: string;
}

export interface InspectLocalOptions extends InspectOptions {
  kontourRoot?: string;
  localRoot?: string;
}

export interface LoaderOptions {
  sourceKind?: SourceKind;
  sourceRoot?: string;
  recursive?: boolean;
  containmentRoot?: string;
}

export interface EventSummary {
  acceptedEventCount: number;
  eventTypeCounts: Record<string, number>;
  firstOccurredAt?: string;
  lastOccurredAt?: string;
}

export interface ProjectionSummary {
  objectCounts: Record<string, number>;
  currentState: Record<string, unknown>;
}

export interface EventStreamInspection {
  filePath: string;
  relativePath: string;
  sourceKind?: SourceKind;
  sourceRoot?: string;
  events: Array<ConsoleEventRecord | ConsoleLivenessRecord>;
  summary: EventSummary;
  validation: ValidationIssue[];
}

export interface ProjectionInspection {
  filePath: string;
  relativePath: string;
  sourceKind?: SourceKind;
  sourceRoot?: string;
  snapshot: ConsoleProjectionSnapshot;
  summary: ProjectionSummary;
  actions: ActionDescriptor[];
  validation: ValidationIssue[];
}

export interface InspectionReport {
  rootDir: string;
  kontourRoot?: string;
  eventStreams: EventStreamInspection[];
  projections: ProjectionInspection[];
  validation: ValidationSummary;
}

export interface ActionDescriptor {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
  authority?: Record<string, unknown>;
  subjectRefs: CrossProductRef[];
  readOnly: true;
  warnings: ValidationIssue[];
  source: Record<string, unknown>;
}

export interface SurfaceClaimStatusOptions {
  claimId?: string;
}

export interface FlowProcessStatusOptions {
  processId?: string;
  status?: string;
  gateId?: string;
}

export interface SurveyReviewStateOptions {
  reviewId?: string;
  claimId?: string;
  providerFieldRef?: string;
}

export interface CurrentOperatingStateOptions {
  generatedAt?: string | null;
  /**
   * Clock for read-time liveness-actor expiry (flow-agents #295): an actor whose
   * last-seen liveness event is older than its TTL is not reported active. Accepts
   * epoch millis or an ISO string; defaults to `Date.now()` when absent. Injected
   * so tests are deterministic and never depend on wall-clock time.
   */
  now?: number | string;
}

export interface LocalConsoleHubOptions extends LocalFileSinkOptions {
  rootDir?: string;
  kontourRoot?: string;
  localRoot?: string;
  sink?: Sink;
}

export interface ConsoleHubServerOptions extends LocalConsoleHubOptions {
  hub?: Hub;
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  runtimeMode?: ConsoleRuntimeMode;
  hostedAuthTokens?: ConsoleHostedAuthToken[];
  hostedTenantIds?: string[];
  defaultTenantId?: string;
  /** Dedicated session-cookie HMAC secret (#104); else env CONSOLE_SESSION_SECRET. */
  sessionSecret?: string;
  telemetryStorageAdapter?: TelemetryStorageAdapterName;
  telemetryDatabaseUrl?: string;
  telemetrySqlClient?: ConsoleSqlClient;
  telemetryDescriptorPaths?: string[];
  telemetryProductRoots?: Record<string, string>;
  telemetryRoot?: string;
  telemetrySinkRoot?: string;
  telemetryToken?: string;
  /**
   * Per-product bearer token guarding `POST /ingest/flow` (the hosted Flow
   * ingest contract v1). When absent (and `CONSOLE_INGEST_TOKEN` is unset) the
   * ingest endpoint is DISABLED and returns 404 — console never accepts
   * unauthenticated writes. Mirrors Flow-side: its HostedConsoleSink disables
   * when no token is configured, so an authenticated request is always expected.
   */
  ingestToken?: string;
  serveUi?: boolean;
}

export interface ListenOptions {
  host?: string;
  port?: number;
}

export interface Hub {
  append(record: ConsoleRecord): Promise<DeliveryResult>;
  appendEvent?(event: ConsoleEventRecord): Promise<DeliveryResult>;
  appendProjection?(projection: ConsoleProjectionRecord): Promise<DeliveryResult>;
  inspect(): InspectionReport;
  currentOperatingState(options?: CurrentOperatingStateOptions): OperatingState;
}

export interface ConsoleHubServer {
  hub: Hub;
  server: import("node:http").Server;
  listen(listenOptions?: ListenOptions, callback?: () => void): import("node:http").Server;
  close(callback?: (error?: Error) => void): import("node:http").Server;
}

export interface RequestError extends Error {
  code?: string;
  statusCode?: number;
  safeMessage?: string;
  validation?: ValidationIssue[];
}

export type ConsoleRuntimeMode = "local" | "hosted";

export interface ConsoleHostedAuthToken {
  token: string;
  tenantId: string;
  label?: string;
}

export type ConsolePrincipalKind = "user" | "machine";

/**
 * The verified identity a request authenticated as (console #98, ADR 0003 call 2).
 *
 * This is the load-bearing security object: `tenantId` here is the ONLY
 * authoritative tenant. It is the verified tenant claim from an OIDC/M2M access
 * token — never a value read from the request payload. Ingest stamps the tenant
 * from `principal.tenantId` and rejects a record whose body disagrees, so cross-
 * tenant writes are impossible by construction.
 *
 * Present only for OIDC/M2M-authenticated (JWT) requests. Loopback-local and the
 * legacy static-token / cookie-session paths leave it undefined (ADR 0003 call 6,
 * local-first): scope enforcement never applies to a request with no principal.
 */
export interface ConsolePrincipal {
  /** "user" = OIDC human (identified by `sub`); "machine" = M2M client credential. */
  kind: ConsolePrincipalKind;
  /** OIDC `sub` (human) or the client identity (machine). Stable subject id. */
  subject: string;
  /** AUTHORITATIVE tenant — the verified tenant claim; the only source of truth. */
  tenantId: string;
  /** OAuth scopes granted to the token, e.g. ["records:read","telemetry:write"]. */
  scopes: string[];
  /** OAuth client id for kind:"machine" (from the `client_id`/`cid` claim). */
  clientId?: string;
  /** Verified token issuer (`iss`), for provenance. */
  issuer?: string;
}

export interface ConsoleRequestContext {
  /** Authoritative tenant. Equals `principal.tenantId` when authenticated via
   *  OIDC/M2M; otherwise the tenant bound to the legacy credential / local default. */
  tenantId: string;
  runtimeMode: ConsoleRuntimeMode;
  /** How the request was authenticated (ADR 0003). Required — it is the predicate
   *  for scope authorization (Phase 2): only the legacy methods skip scope checks,
   *  so an unset/new method fails safe (gets scope-enforced). */
  authMethod: "local" | "session" | "token" | "jwt";
  /** OAuth scopes granted to a JWT-authenticated request (ADR 0003, Phase 2).
   *  Only populated for authMethod "jwt"; undefined for legacy credentials.
   *  Mirrors `principal.scopes` when a principal is present. */
  scopes?: string[];
  /** The verified identity (console #98). Present for JWT (OIDC/M2M) requests;
   *  undefined for loopback-local and legacy static-token/session credentials. */
  principal?: ConsolePrincipal;
}

export interface ConsoleSqlQueryResult<Row = OpenRecord> {
  rows: Row[];
  rowCount?: number | null;
}

export interface ConsoleSqlClient {
  query<Row = OpenRecord>(text: string, values?: unknown[]): Promise<ConsoleSqlQueryResult<Row>>;
}

export interface TelemetryRecord extends JsonObject {
  schema_version: string;
  event_type: string;
  session_id: string;
  event_id: string;
}

export interface TelemetryRecordSummary {
  sourceId: string;
  sourceKind: TelemetryRecordKind;
  eventId: string;
  eventType: string;
  sessionId: string;
  observedAt?: string;
  status?: string;
  outcome?: string;
  durationMs?: number;
  agentName?: string;
  runtime?: string;
  runtimeVersion?: string;
  model?: string;
  hookEventName?: string;
  runtimeSessionId?: string;
  turnId?: string;
  project?: string;
  cwd?: string;
  delegationTarget?: string;
  toolName?: string;
  taskSlug?: string;
  title?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCostUsd?: number;
  usageByModel?: TelemetryUsageBreakdown[];
  attributes?: Record<string, string>;
  path?: string;
}

export type TelemetryQueryPreset = "live" | "15m" | "24h" | "7d" | "custom";
export type TelemetrySortDirection = "desc" | "asc";

export interface TelemetryQueryFilter {
  facetId: string;
  label: string;
  value: string;
}

export interface TelemetryQuery {
  preset?: TelemetryQueryPreset;
  from?: string;
  to?: string;
  q?: string;
  filters: TelemetryQueryFilter[];
  limit: number;
  offset: number;
  sort: TelemetrySortDirection;
}

export interface TelemetryQuerySummary {
  preset?: TelemetryQueryPreset;
  from?: string;
  to?: string;
  q?: string;
  filters: TelemetryQueryFilter[];
  sort: TelemetrySortDirection;
}

export interface TelemetryPaginationSummary {
  limit: number;
  offset: number;
  returnedCount: number;
  totalMatchedCount: number;
  nextOffset?: number;
}

export interface TelemetryCountSummary {
  name: string;
  count: number;
}

export interface TelemetryFlowItem {
  slug: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  attributes?: Record<string, string>;
  details?: Array<{ label: string; value: string }>;
}

export interface TelemetryFacetSummary {
  id: string;
  label: string;
  counts: TelemetryCountSummary[];
}

export interface TelemetryFlowSummary {
  id: string;
  label: string;
  total: number;
  items: TelemetryFlowItem[];
}

export interface TelemetryUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface TelemetryUsageBreakdown extends TelemetryUsageTotals {
  key: string;
  label: string;
}

export interface TelemetryAnalyticsSummary {
  facets: TelemetryFacetSummary[];
  flows: TelemetryFlowSummary[];
  usageByModel: TelemetryUsageBreakdown[];
  usageByProject: TelemetryUsageBreakdown[];
  usageByAgent: TelemetryUsageBreakdown[];
  usageByRuntime: TelemetryUsageBreakdown[];
}

export interface TelemetrySourceSummary {
  id: string;
  kind: TelemetryRecordKind;
  path: string;
  recordCount: number;
  warningCount: number;
  warnings: ValidationIssue[];
}

export interface TelemetrySummary {
  generatedAt: string;
  sources: TelemetrySourceSummary[];
  totals: {
    recordCount: number;
    sessionCount: number;
    eventTypeCounts: Record<string, number>;
    productRecordCount: number;
    usage: TelemetryUsageTotals;
  };
  analytics: TelemetryAnalyticsSummary;
  records: TelemetryRecordSummary[];
  query?: TelemetryQuerySummary;
  pagination?: TelemetryPaginationSummary;
  warnings: ValidationIssue[];
}

export type TelemetryRecordsRequest = TelemetryRecord;

export interface TelemetryDeliveryResult {
  sinkId: string;
  sinkRole: string;
  outcome: "accepted" | "failed";
  status: string;
  recordId: string;
  recordKind: "telemetry";
  observedAt: string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
}

export type TelemetryStorageAdapterName = "local-jsonl" | "sqlite" | "postgres" | "sql";

export interface ReplayEventStream {
  filePath?: string;
  relativePath?: string;
  events: Array<ConsoleEventRecord | ConsoleLivenessRecord>;
}

export interface ReplayInput {
  filePath?: string;
  relativePath?: string;
  events?: Array<ConsoleEventRecord | ConsoleLivenessRecord>;
  eventStreams?: ReplayEventStream[];
}

export interface ReplayEventEntry {
  event: ConsoleEventRecord | ConsoleLivenessRecord;
  streamId: string;
  streamIndex: number;
  eventIndex: number;
}
