export interface LocalConsoleHubOptions {
  rootDir?: string;
  kontourRoot?: string;
  localRoot?: string;
  sink?: unknown;
  sinkId?: string;
  sinkRole?: string;
}

export interface DeliveryResult {
  outcome: string;
  [key: string]: unknown;
}

export class LocalConsoleHub {
  constructor(options?: LocalConsoleHubOptions);
  append(record: unknown): Promise<DeliveryResult>;
  appendEvent(event: unknown): Promise<DeliveryResult>;
  appendProjection(projection: unknown): Promise<DeliveryResult>;
  inspect(): unknown;
  currentOperatingState(options?: Record<string, unknown>): unknown;
}

export function createLocalConsoleHub(options?: LocalConsoleHubOptions): LocalConsoleHub;
