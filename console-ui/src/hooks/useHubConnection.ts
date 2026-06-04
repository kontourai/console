import { useEffect, useState } from "react";
import { connectHubEvents, DEFAULT_HUB_URL } from "../hubClient";
import type { ConnectionStatus, OperatingState, RecordAcceptedEvent } from "../types";

const EMPTY_STATE: OperatingState = {
  currentStage: "Waiting for hub state.",
  processes: [],
  gates: [],
  claims: [],
  actions: [],
  timeline: []
};

export function useHubConnection(hubUrl: string) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [state, setState] = useState<OperatingState>(EMPTY_STATE);
  const [lastAccepted, setLastAccepted] = useState<RecordAcceptedEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const connection = connectHubEvents(hubUrl, {
      onStatus: setStatus,
      onOpen: () => setError(null),
      onState: setState,
      onRecordAccepted: setLastAccepted,
      onError: setError
    });
    return () => connection.close();
  }, [hubUrl]);

  return { status, state, lastAccepted, error };
}
