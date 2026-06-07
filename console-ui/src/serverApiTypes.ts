import type { OperatingState } from "@kontour/console-core";

export type ConsoleStateResponse = OperatingState;

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

export type ConsoleSseEventName = "ready" | "state" | "record.accepted";

export interface ConsoleReadySsePayload {
  connectedAt: string;
}

export interface ConsoleAcceptedRecordSsePayload {
  delivery: ConsoleDeliveryResult;
  state: ConsoleStateResponse;
}

export interface ConsoleSsePayloadMap {
  ready: ConsoleReadySsePayload;
  state: ConsoleStateResponse;
  "record.accepted": ConsoleAcceptedRecordSsePayload;
}
