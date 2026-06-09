import type { ConsoleAcceptedRecordSsePayload, ConsoleStateResponse, ConsoleTelemetryUpdatedSsePayload } from "./serverApiTypes";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface HubEventHandlers {
  onStatus(status: ConnectionStatus): void;
  onOpen?(): void;
  onState(state: ConsoleStateResponse): void;
  onRecordAccepted(event: ConsoleAcceptedRecordSsePayload): void;
  onTelemetryUpdated?(event: ConsoleTelemetryUpdatedSsePayload): void;
  onError(message: string): void;
}
