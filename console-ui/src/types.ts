export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface ConsoleRef {
  product?: string;
  kind?: string;
  id?: string;
  label?: string;
  name?: string;
}

export interface ConsoleSource {
  mode?: string;
  streamIds?: string[];
  acceptedEventCount?: number;
  duplicateEventCount?: number;
  lastAcceptedEventId?: string | null;
}

export interface ConsoleProcess {
  id: string;
  label?: string;
  status?: string;
  currentStep?: string | { id?: string; label?: string };
  percentComplete?: number;
  updatedAt?: string;
}

export interface ConsoleGate {
  id: string;
  label?: string;
  status?: string;
  processRef?: ConsoleRef;
  missingEvidence?: string[];
  routeBack?: {
    reason?: string;
    targetStep?: string;
    attempt?: number;
    maxAttempts?: number;
  };
  updatedAt?: string;
}

export interface ConsoleClaim {
  id: string;
  label?: string;
  status?: string;
  freshness?: {
    status?: string;
    lastCheckedAt?: string;
    expiresAt?: string;
  };
  materiality?: string;
  updatedAt?: string;
  lastVerifiedAt?: string;
}

export interface ConsoleAction {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
  readOnly?: boolean;
  authority?: {
    product?: string;
    command?: string;
  };
}

export interface TimelineItem {
  id: string;
  type?: string;
  occurredAt?: string;
  observedAt?: string;
  summary?: string;
  streamId?: string;
  producer?: {
    product?: string;
    id?: string;
    name?: string;
  };
  subjectRef?: ConsoleRef;
}

export interface OperatingState {
  generatedAt?: string | null;
  currentStage?: string;
  source?: ConsoleSource;
  processes?: ConsoleProcess[];
  gates?: ConsoleGate[];
  claims?: ConsoleClaim[];
  actions?: ConsoleAction[];
  timeline?: TimelineItem[];
}

export interface RecordAcceptedEvent {
  delivery?: {
    outcome?: string;
    recordId?: string;
    observedAt?: string;
  };
  state?: OperatingState;
}

export interface HubEventHandlers {
  onStatus(status: ConnectionStatus): void;
  onOpen?(): void;
  onState(state: OperatingState): void;
  onRecordAccepted(event: RecordAcceptedEvent): void;
  onError(message: string): void;
}
