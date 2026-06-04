import type { OperatingState, RecordAcceptedEvent } from "@kontour/console-core";
import type { HubEventHandlers } from "./types";

export const DEFAULT_HUB_URL = "http://127.0.0.1:3737";

export interface HubConnection {
  close(): void;
}

export function connectHubEvents(hubUrl: string, handlers: HubEventHandlers): HubConnection {
  const eventsUrl = new URL("/events", normalizeHubUrl(hubUrl));
  handlers.onStatus("connecting");

  const source = new EventSource(eventsUrl.toString());

  source.addEventListener("open", () => {
    handlers.onStatus("connected");
    handlers.onOpen?.();
  });

  source.addEventListener("state", (event) => {
    const state = parseJson<OperatingState>(event.data, "state");
    if (state) handlers.onState(state);
  });

  source.addEventListener("record.accepted", (event) => {
    const accepted = parseJson<RecordAcceptedEvent>(event.data, "record.accepted");
    if (!accepted) return;
    handlers.onRecordAccepted(accepted);
    if (accepted.state) handlers.onState(accepted.state);
  });

  source.addEventListener("error", () => {
    handlers.onStatus(source.readyState === EventSource.CLOSED ? "disconnected" : "error");
    handlers.onError(`Event stream unavailable at ${eventsUrl.toString()}`);
  });

  return {
    close() {
      source.close();
      handlers.onStatus("disconnected");
    }
  };
}

function normalizeHubUrl(hubUrl: string): string {
  const trimmed = hubUrl.trim();
  if (!trimmed) return DEFAULT_HUB_URL;
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function parseJson<T>(value: string, eventName: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(`Ignoring malformed ${eventName} event`, error);
    return null;
  }
}
