import type { ConsoleAcceptedRecordSsePayload, ConsoleStateResponse } from "./serverApiTypes";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface HubEventHandlers {
  onStatus(status: ConnectionStatus): void;
  onOpen?(): void;
  onState(state: ConsoleStateResponse): void;
  onRecordAccepted(event: ConsoleAcceptedRecordSsePayload): void;
  onError(message: string): void;
}
