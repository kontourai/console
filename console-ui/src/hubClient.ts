import type { HubEventHandlers } from "./types";
import type {
  ConsoleAcceptedRecordSsePayload,
  ConsoleEventsResponse,
  ConsoleRecordsRequest,
  ConsoleRecordsResponse,
  ConsoleSseEventName,
  ConsoleSsePayloadMap,
  ConsoleStateResponse
} from "./serverApiTypes";

export const DEFAULT_HUB_URL = "http://127.0.0.1:3737";

export interface HubConnection {
  close(): void;
}

export function connectHubEvents(hubUrl: string, handlers: HubEventHandlers): HubConnection {
  return connectStream(hubUrl, handlers);
}

export async function getState(hubUrl: string): Promise<ConsoleStateResponse> {
  return getJson<ConsoleStateResponse>(hubUrl, "/state");
}

export async function getEvents(hubUrl: string): Promise<ConsoleEventsResponse> {
  return getJson<ConsoleEventsResponse>(hubUrl, "/events");
}

export async function postRecord(hubUrl: string, record: ConsoleRecordsRequest): Promise<ConsoleRecordsResponse> {
  const response = await fetch(hubApiUrl(hubUrl, "/records"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(record)
  });
  return parseResponseJson<ConsoleRecordsResponse>(response);
}

export function connectStream(hubUrl: string, handlers: HubEventHandlers): HubConnection {
  const streamUrl = hubApiUrl(hubUrl, "/stream");
  handlers.onStatus("connecting");

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

function hubApiUrl(hubUrl: string, path: string): string {
  return new URL(path, normalizeHubUrl(hubUrl)).toString();
}

function normalizeHubUrl(hubUrl: string): string {
  const trimmed = hubUrl.trim();
  if (!trimmed) return DEFAULT_HUB_URL;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

async function getJson<T>(hubUrl: string, path: string): Promise<T> {
  const response = await fetch(hubApiUrl(hubUrl, path), {
    headers: {
      accept: "application/json"
    }
  });
  return parseResponseJson<T>(response);
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
