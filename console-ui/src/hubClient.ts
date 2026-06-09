import type { HubEventHandlers } from "./types";
import type {
  ConsoleAcceptedRecordSsePayload,
  ConsoleEventsResponse,
  ConsoleRecordsRequest,
  ConsoleRecordsResponse,
  ConsoleSseEventName,
  ConsoleSsePayloadMap,
  ConsoleStateResponse,
  ConsoleTelemetryUpdatedSsePayload,
  ConsoleTelemetryResponse
} from "./serverApiTypes";

const viteEnv = (import.meta as ImportMeta & { env?: Partial<ImportMetaEnv> }).env;
export const DEFAULT_HUB_URL = viteEnv?.VITE_CONSOLE_HUB_URL || "http://127.0.0.1:3737";

export interface HubConnection {
  close(): void;
}

export interface HubAuthOptions {
  token?: string;
  tenantId?: string;
}

export function connectHubEvents(hubUrl: string, handlers: HubEventHandlers, auth: HubAuthOptions = {}): HubConnection {
  return connectStream(hubUrl, handlers, auth);
}

export async function getState(hubUrl: string, auth: HubAuthOptions = {}): Promise<ConsoleStateResponse> {
  return getJson<ConsoleStateResponse>(hubUrl, "/state", auth);
}

export async function getEvents(hubUrl: string, auth: HubAuthOptions = {}): Promise<ConsoleEventsResponse> {
  return getJson<ConsoleEventsResponse>(hubUrl, "/events", auth);
}

export async function getTelemetry(hubUrl: string, auth: HubAuthOptions = {}): Promise<ConsoleTelemetryResponse> {
  return getJson<ConsoleTelemetryResponse>(hubUrl, "/api/telemetry", auth);
}

export async function postRecord(hubUrl: string, record: ConsoleRecordsRequest, auth: HubAuthOptions = {}): Promise<ConsoleRecordsResponse> {
  const response = await fetch(hubApiUrl(hubUrl, "/records"), {
    method: "POST",
    headers: {
      ...authHeaders(auth),
      "content-type": "application/json"
    },
    body: JSON.stringify(record)
  });
  return parseResponseJson<ConsoleRecordsResponse>(response);
}

export function connectStream(hubUrl: string, handlers: HubEventHandlers, auth: HubAuthOptions = {}): HubConnection {
  const streamUrl = hubApiUrl(hubUrl, "/stream");
  handlers.onStatus("connecting");
  if (auth.token || auth.tenantId) return connectFetchStream(streamUrl, handlers, auth);

  const source = new EventSource(streamUrl);

  source.addEventListener("open", () => {
    handlers.onStatus("connected");
    handlers.onOpen?.();
  });

  source.addEventListener("state", (event) => {
    const state = parseSseJson<ConsoleSsePayloadMap["state"]>(event.data, "state");
    if (state) handlers.onState(state);
  });

  source.addEventListener("record.accepted", (event) => {
    const accepted = parseSseJson<ConsoleAcceptedRecordSsePayload>(event.data, "record.accepted");
    if (!accepted) return;
    handlers.onRecordAccepted(accepted);
    handlers.onState(accepted.state);
  });

  source.addEventListener("telemetry.updated", (event) => {
    const updated = parseSseJson<ConsoleTelemetryUpdatedSsePayload>(event.data, "telemetry.updated");
    if (!updated) return;
    handlers.onTelemetryUpdated?.(updated);
  });

  source.addEventListener("error", () => {
    handlers.onStatus(source.readyState === EventSource.CLOSED ? "disconnected" : "error");
    handlers.onError(`Event stream unavailable at ${streamUrl}`);
  });

  return {
    close() {
      source.close();
      handlers.onStatus("disconnected");
    }
  };
}

function connectFetchStream(streamUrl: string, handlers: HubEventHandlers, auth: HubAuthOptions): HubConnection {
  const controller = new AbortController();
  let closed = false;
  fetch(streamUrl, {
    headers: {
      ...authHeaders(auth),
      accept: "text/event-stream"
    },
    signal: controller.signal
  }).then(async (response) => {
    if (!response.ok || !response.body) throw new Error(`Event stream failed with HTTP ${response.status}`);
    handlers.onStatus("connected");
    handlers.onOpen?.();
    await readSseStream(response.body, handlers, () => closed);
  }).catch((error) => {
    if (closed) return;
    handlers.onStatus("error");
    handlers.onError(error instanceof Error ? error.message : `Event stream unavailable at ${streamUrl}`);
  });

  return {
    close() {
      closed = true;
      controller.abort();
      handlers.onStatus("disconnected");
    }
  };
}

function hubApiUrl(hubUrl: string, path: string): string {
  return new URL(path, normalizeHubUrl(hubUrl)).toString();
}

function normalizeHubUrl(hubUrl: string): string {
  const trimmed = hubUrl.trim();
  if (!trimmed) return DEFAULT_HUB_URL;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

async function getJson<T>(hubUrl: string, path: string, auth: HubAuthOptions): Promise<T> {
  const response = await fetch(hubApiUrl(hubUrl, path), {
    headers: {
      ...authHeaders(auth),
      accept: "application/json"
    }
  });
  return parseResponseJson<T>(response);
}

function authHeaders(auth: HubAuthOptions): Record<string, string> {
  return Object.fromEntries(Object.entries({
    authorization: auth.token ? `Bearer ${auth.token}` : undefined,
    "x-console-tenant-id": auth.tenantId || undefined
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

async function readSseStream(body: ReadableStream<Uint8Array>, handlers: HubEventHandlers, isClosed: () => boolean): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!isClosed()) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleSseFrame(buffer.slice(0, boundary), handlers);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function handleSseFrame(frame: string, handlers: HubEventHandlers): void {
  let eventName = "message" as ConsoleSseEventName;
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event: ")) eventName = line.slice("event: ".length) as ConsoleSseEventName;
    if (line.startsWith("data: ")) data.push(line.slice("data: ".length));
  }
  dispatchSseEvent(eventName, data.join("\n"), handlers);
}

function dispatchSseEvent(eventName: ConsoleSseEventName, data: string, handlers: HubEventHandlers): void {
  if (eventName === "state") {
    const state = parseSseJson<ConsoleSsePayloadMap["state"]>(data, "state");
    if (state) handlers.onState(state);
  } else if (eventName === "record.accepted") {
    const accepted = parseSseJson<ConsoleAcceptedRecordSsePayload>(data, "record.accepted");
    if (!accepted) return;
    handlers.onRecordAccepted(accepted);
    handlers.onState(accepted.state);
  } else if (eventName === "telemetry.updated") {
    const updated = parseSseJson<ConsoleTelemetryUpdatedSsePayload>(data, "telemetry.updated");
    if (updated) handlers.onTelemetryUpdated?.(updated);
  }
}

async function parseResponseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  if (!response.ok) {
    throw new Error(`Hub request failed with HTTP ${response.status}`);
  }
  return body;
}

function parseSseJson<T>(value: string, eventName: ConsoleSseEventName): T | null {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`Ignoring malformed ${eventName} event`, error);
    return null;
  }
}
