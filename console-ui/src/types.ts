import type { OperatingState, RecordAcceptedEvent } from "@kontour/console-core";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface HubEventHandlers {
  onStatus(status: ConnectionStatus): void;
  onOpen?(): void;
  onState(state: OperatingState): void;
  onRecordAccepted(event: RecordAcceptedEvent): void;
  onError(message: string): void;
}
