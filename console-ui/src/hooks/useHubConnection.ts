import { useEffect, useState } from "react";
import type { OperatingState } from "@kontourai/console-core";
import { connectHubEvents, DEFAULT_HUB_URL, type HubAuthOptions } from "../hubClient";
import type { ConsoleAcceptedRecordSsePayload, ConsoleTelemetryUpdatedSsePayload } from "../serverApiTypes";
import type { ConnectionStatus } from "../types";

const EMPTY_STATE: OperatingState = {
  currentStage: "Waiting for hub state.",
  processes: [],
  gates: [],
  claims: [],
  actions: [],
  timeline: []
};

export function useHubConnection(hubUrl: string, auth: HubAuthOptions = {}) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [state, setState] = useState<OperatingState>(EMPTY_STATE);
  const [lastAccepted, setLastAccepted] = useState<ConsoleAcceptedRecordSsePayload | null>(null);
  const [lastTelemetryUpdated, setLastTelemetryUpdated] = useState<ConsoleTelemetryUpdatedSsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const connection = connectHubEvents(hubUrl, {
      onStatus: setStatus,
      onOpen: () => setError(null),
      onState: setState,
      onRecordAccepted: setLastAccepted,
      onTelemetryUpdated: setLastTelemetryUpdated,
      onError: setError
    }, auth);
    return () => connection.close();
  }, [hubUrl, auth.token, auth.tenantId]);

  return { status, state, lastAccepted, lastTelemetryUpdated, error };
}
