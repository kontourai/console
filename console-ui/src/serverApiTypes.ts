import type { OperatingState } from "@kontourai/console-core";

export type ConsoleStateResponse = OperatingState;

export interface ConsoleTelemetrySourceSummary {
  id: string;
  kind?: string;
  path?: string;
  status?: string;
  recordCount: number;
  sessionCount?: number;
  lastObservedAt?: string | null;
  warningCount?: number;
  warnings?: Array<{ severity?: string; path?: string; message?: string }>;
}

export interface ConsoleTelemetryRecentEvent {
  eventId: string;
  sourceId: string;
  sourceKind?: string;
  eventType: string;
  observedAt?: string | null;
  sessionId?: string;
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
  title?: string;
  taskSlug?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCostUsd?: number;
  attributes?: Record<string, string>;
  status?: string;
  outcome?: string;
  durationMs?: number;
  path?: string;
}

export interface ConsoleTelemetryCountSummary {
  name: string;
  count: number;
}

export interface ConsoleTelemetryFlowItem {
  slug: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  attributes?: Record<string, string>;
  details?: Array<{ label: string; value: string }>;
}

export interface ConsoleTelemetryFacetSummary {
  id: string;
  label: string;
  counts: ConsoleTelemetryCountSummary[];
}

export interface ConsoleTelemetryFlowSummary {
  id: string;
  label: string;
  total: number;
  items: ConsoleTelemetryFlowItem[];
}

export type TelemetryQueryPreset = "live" | "15m" | "24h" | "7d" | "custom";
export type TelemetrySortDirection = "asc" | "desc";

export interface TelemetryQueryFilter {
  facetId: string;
  value: string;
}

export interface TelemetryQueryInput {
  preset?: TelemetryQueryPreset;
  from?: string;
  to?: string;
  q?: string;
  filters?: TelemetryQueryFilter[];
  limit?: number;
  offset?: number;
  sort?: TelemetrySortDirection;
}

export interface ConsoleTelemetryQuerySummary {
  preset?: TelemetryQueryPreset;
  from?: string;
  to?: string;
  q?: string;
  filters?: TelemetryQueryFilter[];
  limit?: number;
  offset?: number;
  sort?: TelemetrySortDirection;
}

export interface ConsoleTelemetryPaginationSummary {
  returnedCount?: number;
  matchedCount?: number;
  totalMatchedCount?: number;
  totalCount?: number;
  limit?: number;
  pageSize?: number;
  offset?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
}

export interface ConsoleTelemetryUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ConsoleTelemetryUsageBreakdown extends ConsoleTelemetryUsageTotals {
  key: string;
  label: string;
}

export type ConsoleTelemetryActionClass =
  | "edit"
  | "read"
  | "search"
  | "execute"
  | "web"
  | "delegate"
  | "other";

export interface ConsoleTelemetryActionClassSummary {
  actionClass: ConsoleTelemetryActionClass;
  label: string;
  count: number;
  sessionCount: number;
}

export interface ConsoleTelemetryTurnCost extends ConsoleTelemetryUsageTotals {
  turnId: string;
  sessionId: string;
  model?: string;
  toolCount: number;
  startedAt?: string;
}

export interface ConsoleTelemetryTurnCostSummary {
  turns: ConsoleTelemetryTurnCost[];
  turnCount: number;
  totalEstimatedCostUsd: number;
}

export interface ConsoleTelemetryToolReliability {
  toolName: string;
  actionClass: ConsoleTelemetryActionClass;
  count: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  failureRate: number;
  failCount: number;
  passCount: number;
  ambiguousCount: number;
}

export interface ConsoleTelemetryToolReliabilitySummary {
  tools: ConsoleTelemetryToolReliability[];
}

export interface ConsoleTelemetryActivityBucket {
  startedAt: string;
  byActionClass: Record<ConsoleTelemetryActionClass, number>;
  total: number;
}

export interface ConsoleTelemetryActivityTimeline {
  bucket: "hour" | "day";
  buckets: ConsoleTelemetryActivityBucket[];
}

export interface ConsoleTelemetryAnalyticsSummary {
  facets: ConsoleTelemetryFacetSummary[];
  flows: ConsoleTelemetryFlowSummary[];
  usageByModel: ConsoleTelemetryUsageBreakdown[];
  usageByProject: ConsoleTelemetryUsageBreakdown[];
  usageByAgent: ConsoleTelemetryUsageBreakdown[];
  usageByRuntime: ConsoleTelemetryUsageBreakdown[];
  usageByTaskSlug: ConsoleTelemetryUsageBreakdown[];
  actionClasses: ConsoleTelemetryActionClassSummary[];
  costPerTurn: ConsoleTelemetryTurnCostSummary;
  toolReliability: ConsoleTelemetryToolReliabilitySummary;
  activityTimeline: ConsoleTelemetryActivityTimeline;
}

export interface ConsoleTelemetryResponse {
  generatedAt: string;
  sources: ConsoleTelemetrySourceSummary[];
  totals: {
    recordCount: number;
    sessionCount: number;
    eventTypeCounts: Record<string, number>;
    productRecordCount: number;
    usage: ConsoleTelemetryUsageTotals;
  };
  analytics: ConsoleTelemetryAnalyticsSummary;
  query?: ConsoleTelemetryQuerySummary;
  pagination?: ConsoleTelemetryPaginationSummary;
  records: ConsoleTelemetryRecentEvent[];
  warnings: Array<{ severity?: string; path?: string; message?: string }>;
}

export interface ConsoleEventStreamSummary {
  relativePath: string;
  sourceKind?: string;
  events: unknown[];
  summary?: Record<string, unknown>;
  validation?: Array<{ severity?: string; path?: string; message?: string }>;
}

export type ConsoleEventsResponse = ConsoleEventStreamSummary[];

export interface ConsoleRef {
  product: string;
  kind: string;
  id: string;
  [key: string]: unknown;
}

export interface ConsoleEventRecordRequest {
  schema: "kontour.console.event";
  version: string;
  id: string;
  type: string;
  occurredAt: string;
  producer: Record<string, unknown>;
  subject: ConsoleRef;
  payload: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ConsoleProjectionRecordRequest {
  schema: "kontour.console.projection";
  version: string;
  id?: string;
  generatedAt: string;
  producer: Record<string, unknown>;
  scope: Record<string, unknown>;
  derivedFrom: Record<string, unknown>;
  [key: string]: unknown;
}

export type ConsoleRecordsRequest = ConsoleEventRecordRequest | ConsoleProjectionRecordRequest;

export interface ConsoleApiError {
  error: string;
  safeMessage?: string;
  validation?: Array<{ severity?: string; path?: string; message?: string }>;
}

export interface ConsoleDeliveryResult {
  outcome?: string;
  recordId?: string;
  observedAt?: string;
  [key: string]: unknown;
}

export type ConsoleRecordsResponse = ConsoleDeliveryResult | ConsoleApiError;

export type ConsoleSseEventName = "ready" | "state" | "record.accepted" | "telemetry.updated";

export interface ConsoleReadySsePayload {
  connectedAt: string;
}

export interface ConsoleAcceptedRecordSsePayload {
  delivery: ConsoleDeliveryResult;
  state: ConsoleStateResponse;
}

export interface ConsoleTelemetryUpdatedSsePayload {
  telemetry: {
    generatedAt: string;
    recordCount: number;
  };
}

export interface ConsoleSsePayloadMap {
  ready: ConsoleReadySsePayload;
  state: ConsoleStateResponse;
  "record.accepted": ConsoleAcceptedRecordSsePayload;
  "telemetry.updated": ConsoleTelemetryUpdatedSsePayload;
}

// ── Economics read-models (console #117 / flow-agents #349) ────────────────────
//    Mirror console-server/types.ts. The record is the #349 shape (snake_case,
//    nested); these are the projection READ-MODELS the UI renders.
export interface ConsoleEconomicsFindingsBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface ConsoleEconomicsTaskDayRollup {
  taskSlug: string;
  day: string;
  runs: number;
  totalCostUsd: number;
  costByPhase: Record<string, number>;
  defectsCaught: number;
  caughtFalseCompletions: number;
}

export interface ConsoleEconomicsCaughtDefects {
  defectsCaught: number;
  bySeverity: ConsoleEconomicsFindingsBySeverity;
  caughtFalseCompletions: number;
  gateFires: number;
}

export interface ConsoleEconomicsFunnel {
  runs: number;
  totalIterations: number;
  totalRouteBacks: number;
  firstPassRate: number;
  humanWaitS: number;
}

export interface ConsoleEconomicsRollup {
  generatedAt: string;
  tenantId: string;
  runCount: number;
  cost: ConsoleEconomicsTaskDayRollup[];
  caughtDefects: ConsoleEconomicsCaughtDefects;
  funnel: ConsoleEconomicsFunnel;
}

export interface ConsoleValueCell {
  model_tier: string;
  kit_condition: string;
  runs: number;
  acceptanceRate: number;
  iterationsToAccept: number;
  defectsCaught: number;
  dollarsPerAcceptable: number | null;
}

export interface ConsoleValueComparison {
  generatedAt: string;
  tenantId: string;
  /** How many records carried the optional (model_tier, kit_condition) tags. */
  taggedRunCount: number;
  cells: ConsoleValueCell[];
  headline: {
    smallPlusKit: ConsoleValueCell | null;
    largeBare: ConsoleValueCell | null;
    verdict: "meets" | "below" | "exceeds" | "unknown";
    ratio: number | null;
  };
}

// ── Delegation efficiency read-model (flow-agents #415) ────────────────────────
//    HONESTY: costUsd is a MODEL-GRANULARITY PROXY (no per-sub-agent token
//    isolation); `unavailable` outcomes are excluded from acceptanceRate.
export interface ConsoleEconomicsRoleModelRollup {
  role: string;
  /** Bare model name (the `@provider` suffix is stripped to join cost.by_model). */
  model: string;
  delegations: number;
  reworkCount: number;
  divergedCount: number;
  failedCount: number;
  acceptedCount: number;
  /** NOT a success or failure — excluded from acceptanceRate's denominator. */
  unavailableCount: number;
  /** accepted / (accepted+rework+diverged+failed); null when that denominator is 0. */
  acceptanceRate: number | null;
  /** PROXY cost from cost.by_model; null when the model isn't in by_model. */
  costUsd: number | null;
  costGranularity: "model-proxy";
}

export interface ConsoleEconomicsDelegationRollup {
  generatedAt: string;
  tenantId: string;
  /** Runs that carried any delegations. */
  runCount: number;
  perRoleModel: ConsoleEconomicsRoleModelRollup[];
  /** Outcome coverage across all delegations. */
  coverage: { measurable: number; unavailable: number };
  signals: {
    /** False on every runtime today → the cost column is a proxy, not exact spend. */
    perDelegationTokens: boolean;
    perDelegationOutcome: "full" | "partial" | "none" | "n/a" | "mixed";
  };
}
