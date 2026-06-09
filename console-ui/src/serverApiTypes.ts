import type { OperatingState } from "@kontour/console-core";

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

export interface ConsoleTelemetryAnalyticsSummary {
  facets: ConsoleTelemetryFacetSummary[];
  flows: ConsoleTelemetryFlowSummary[];
}

export interface ConsoleTelemetryResponse {
  generatedAt: string;
  sources: ConsoleTelemetrySourceSummary[];
  totals: {
    recordCount: number;
    sessionCount: number;
    eventTypeCounts: Record<string, number>;
    productRecordCount: number;
  };
  analytics: ConsoleTelemetryAnalyticsSummary;
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
