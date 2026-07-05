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

export interface ConsoleTelemetryAnalyticsSummary {
  facets: ConsoleTelemetryFacetSummary[];
  flows: ConsoleTelemetryFlowSummary[];
  usageByModel: ConsoleTelemetryUsageBreakdown[];
  usageByProject: ConsoleTelemetryUsageBreakdown[];
  usageByAgent: ConsoleTelemetryUsageBreakdown[];
  usageByRuntime: ConsoleTelemetryUsageBreakdown[];
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
