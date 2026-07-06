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
  ConsoleTelemetryResponse,
  ConsoleEconomicsRollup,
  ConsoleValueComparison,
  ConsoleEconomicsDelegationRollup,
  TelemetryQueryInput
} from "./serverApiTypes";
import { normalizeTelemetryQuery } from "./utils/telemetryQuery";

const viteEnv = (import.meta as ImportMeta & { env?: Partial<ImportMetaEnv & { DEV?: boolean }> }).env;
// When an explicit VITE_CONSOLE_HUB_URL override is set, use it.
// In Vite dev mode (import.meta.env.DEV === true) the UI runs on its own dev
// server so fall back to the local hub default.
// In production (bundled and served from the hub at its origin), use
// window.location.origin so the UI connects to the same host automatically.
export const DEFAULT_HUB_URL = viteEnv?.VITE_CONSOLE_HUB_URL
  || (viteEnv?.DEV ? "http://127.0.0.1:3737" : (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3737"));

/**
 * True when the UI is running at the same origin as the hub (production bundle
 * served from the hub). Used to decide whether to check for a hosted session.
 */
export const IS_SAME_ORIGIN = typeof window !== "undefined" && DEFAULT_HUB_URL === window.location.origin;

export interface HubConnection {
  close(): void;
}

export interface HubAuthOptions {
  token?: string;
  tenantId?: string;
  /**
   * When true, rely on the browser-managed HttpOnly session cookie for auth.
   * No Authorization header is sent. EventSource is always used for streaming
   * (browser auto-sends the cookie). This mode is set by App.tsx when GET
   * /session returns 200 at the same origin.
   */
  useCookie?: boolean;
}

export interface HubSessionInfo {
  tenantId: string;
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

export async function getTelemetry(hubUrl: string, auth: HubAuthOptions = {}, query?: TelemetryQueryInput): Promise<ConsoleTelemetryResponse> {
  return getJson<ConsoleTelemetryResponse>(hubUrl, telemetryPath(query), auth);
}

// Economics read-models (console #117). Mirror getTelemetry: tenant-scoped on the
// server via the request context; the UI just reads the projection.
export async function getEconomics(hubUrl: string, auth: HubAuthOptions = {}): Promise<ConsoleEconomicsRollup> {
  return getJson<ConsoleEconomicsRollup>(hubUrl, "/api/economics", auth);
}

export async function getEconomicsValue(hubUrl: string, auth: HubAuthOptions = {}): Promise<ConsoleValueComparison> {
  return getJson<ConsoleValueComparison>(hubUrl, "/api/economics/value", auth);
}

// Delegation efficiency read-model (flow-agents #415). Per-(role, model) rollups
// with proxy cost + honest outcome coverage; tenant-scoped server-side.
export async function getEconomicsDelegations(hubUrl: string, auth: HubAuthOptions = {}): Promise<ConsoleEconomicsDelegationRollup> {
  return getJson<ConsoleEconomicsDelegationRollup>(hubUrl, "/api/economics/delegations", auth);
}

/**
 * GET /ingest/flow/:runId — read-only fetch of a stored FlowConsoleProjection
 * for a referenced child run (hosted Flow ingest contract v1). Returns the raw
 * projection as `unknown` (the type-only Flow contract import lives at the
 * UI/panel boundary; this layer stays Flow-dependency-free). Returns null when
 * the run has no recorded projection (404) or on any non-OK response — callers
 * must render an honest empty/error state and never fabricate a projection.
 */
export async function getFlowRunProjection(
  hubUrl: string,
  runId: string,
  auth: HubAuthOptions = {}
): Promise<unknown | null> {
  const response = await fetch(hubApiUrl(hubUrl, `/ingest/flow/${encodeURIComponent(runId)}`), {
    headers: {
      ...authHeaders(auth),
      accept: "application/json"
    }
  });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
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

/**
 * GET /session — returns {tenantId} when a valid session cookie is present.
 * Returns null when unauthenticated (401) or on any network error.
 * Only meaningful when called against the same origin as the current page.
 */
export async function getSession(hubUrl: string): Promise<HubSessionInfo | null> {
  try {
    const response = await fetch(hubApiUrl(hubUrl, "/session"), {
      headers: { accept: "application/json" }
    });
    if (response.status === 200) {
      return await response.json() as HubSessionInfo;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /session/logout — clears the session cookie.
 * Ignores errors — the page reload or redirect will handle the rest.
 */
export async function postSessionLogout(hubUrl: string): Promise<void> {
  try {
    await fetch(hubApiUrl(hubUrl, "/session/logout"), { method: "POST" });
  } catch {
    // Ignore — best effort logout.
  }
}

export function connectStream(hubUrl: string, handlers: HubEventHandlers, auth: HubAuthOptions = {}): HubConnection {
  const streamUrl = hubApiUrl(hubUrl, "/stream");
  handlers.onStatus("connecting");

  // Cookie auth mode: browser auto-sends the HttpOnly session cookie.
  // EventSource is the right choice here — it sends cookies automatically
  // and is sufficient since there are no custom headers to add.
  if (auth.useCookie) {
    const source = new EventSource(streamUrl);
    return wireEventSource(source, streamUrl, handlers);
  }

  if (auth.token || auth.tenantId) return connectFetchStream(streamUrl, handlers, auth);

  const source = new EventSource(streamUrl);
  return wireEventSource(source, streamUrl, handlers);
}

function wireEventSource(source: EventSource, streamUrl: string, handlers: HubEventHandlers): HubConnection {
  source.addEventListener("open", () => {
    handlers.onStatus("connected");
    handlers.onOpen?.();
  });

  source.addEventListener("state", (event) => {
    const state = parseSseJson<ConsoleSsePayloadMap["state"]>((event as MessageEvent).data, "state");
    if (state) handlers.onState(state);
  });

  source.addEventListener("record.accepted", (event) => {
    const accepted = parseSseJson<ConsoleAcceptedRecordSsePayload>((event as MessageEvent).data, "record.accepted");
    if (!accepted) return;
    handlers.onRecordAccepted(accepted);
    handlers.onState(accepted.state);
  });

  source.addEventListener("telemetry.updated", (event) => {
    const updated = parseSseJson<ConsoleTelemetryUpdatedSsePayload>((event as MessageEvent).data, "telemetry.updated");
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

function telemetryPath(query?: TelemetryQueryInput): string {
  const normalized = query ? normalizeTelemetryQuery(query) : undefined;
  const params = new URLSearchParams();
  if (normalized?.preset) params.set("preset", normalized.preset);
  if (normalized?.from) params.set("from", normalized.from);
  if (normalized?.to) params.set("to", normalized.to);
  if (normalized?.q) params.set("q", normalized.q);
  for (const filter of normalized?.filters || []) params.append("filter", `${filter.facetId}:${filter.value}`);
  if (typeof normalized?.limit === "number") params.set("limit", String(normalized.limit));
  if (typeof normalized?.offset === "number") params.set("offset", String(normalized.offset));
  if (normalized?.sort) params.set("sort", normalized.sort);
  const encoded = params.toString();
  return encoded ? `/api/telemetry?${encoded}` : "/api/telemetry";
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
  if (auth.useCookie) return {};
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
