export type RecordKind = "event" | "projection";
export type DeliveryOutcome = "accepted" | "skipped" | "failed";
export type ValidationSeverity = "error" | "warning";
export type SourceKind = "fixture" | "local";

export interface CrossProductRef {
  product: string;
  kind: string;
  id: string;
  apiVersion?: string;
  name?: string;
  uid?: string;
  label?: string;
  url?: string;
  scope?: Partial<CrossProductRef>;
  [key: string]: unknown;
}

export interface ConsoleLink {
  from?: CrossProductRef;
  relation?: string;
  to?: CrossProductRef;
  createdAt?: string;
}

export interface OperatingState {
  generatedAt?: string | null;
  currentStage?: string;
  source?: {
    mode?: string;
    streamIds?: string[];
    acceptedEventCount?: number;
    duplicateEventCount?: number;
    lastAcceptedEventId?: string | null;
  };
  processes?: Record<string, unknown>[];
  gates?: Record<string, unknown>[];
  claims?: Record<string, unknown>[];
  evidence?: Record<string, unknown>[];
  learnings?: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
  links?: ConsoleLink[];
  timeline?: Record<string, unknown>[];
}

export interface ConsoleRecordBase {
  schema: string;
  version: string;
  id?: string;
  producer?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ConsoleEventRecord extends ConsoleRecordBase {
  schema: "kontour.console.event";
  id: string;
  type: string;
  occurredAt: string;
  subject: CrossProductRef;
  payload: Record<string, unknown>;
}

export interface ConsoleProjectionRecord extends ConsoleRecordBase {
  schema: "kontour.console.projection";
  generatedAt: string;
  derivedFrom: Record<string, unknown>;
}

export type ConsoleRecord = ConsoleEventRecord | ConsoleProjectionRecord | ConsoleRecordBase;

export interface ValidationIssue {
  severity: ValidationSeverity;
  path: string;
  message: string;
}

export interface ValidationSummary {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ClassifiedRecord {
  recordKind: RecordKind;
  recordId: string;
  validation: ValidationIssue[];
}

export interface DeliveryResult {
  sinkId: string;
  sinkRole: string;
  outcome: DeliveryOutcome;
  status: string;
  recordId: string;
  recordKind: RecordKind;
  observedAt: string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
  children?: DeliveryResult[];
  [key: string]: unknown;
}

export interface Sink {
  sinkId?: string;
  sinkRole?: string;
  id?: string;
  name?: string;
  deliver(record: ConsoleRecord): DeliveryResult | Promise<DeliveryResult>;
}

export interface KontourEmitterOptions {
  sink: Sink;
}

export interface LocalFileSinkOptions {
  root?: string;
  sinkId?: string;
  sinkRole?: string;
}

export interface CompositeSinkOptions {
  sinkId?: string;
  sinkRole?: string;
}

export interface InMemorySinkOptions {
  sinkId?: string;
  sinkRole?: string;
}

export interface InspectOptions {
  rootDir?: string;
}

export interface InspectLocalOptions extends InspectOptions {
  kontourRoot?: string;
  localRoot?: string;
}

export interface LoaderOptions {
  sourceKind?: SourceKind;
  sourceRoot?: string;
  recursive?: boolean;
  containmentRoot?: string;
}

export interface EventSummary {
  acceptedEventCount: number;
  eventTypeCounts: Record<string, number>;
  firstOccurredAt?: string;
  lastOccurredAt?: string;
}

export interface ProjectionSummary {
  objectCounts: Record<string, number>;
  currentState: Record<string, unknown>;
}

export interface EventStreamInspection {
  filePath: string;
  relativePath: string;
  sourceKind?: SourceKind;
  sourceRoot?: string;
  events: ConsoleEventRecord[];
  summary: EventSummary;
  validation: ValidationIssue[];
}

export interface ProjectionInspection {
  filePath: string;
  relativePath: string;
  sourceKind?: SourceKind;
  sourceRoot?: string;
  snapshot: ConsoleProjectionRecord;
  summary: ProjectionSummary;
  actions: ActionDescriptor[];
  validation: ValidationIssue[];
}

export interface InspectionReport {
  rootDir: string;
  kontourRoot?: string;
  eventStreams: EventStreamInspection[];
  projections: ProjectionInspection[];
  validation: ValidationSummary;
}

export interface ActionDescriptor {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
  authority?: Record<string, unknown>;
  subjectRefs: CrossProductRef[];
  readOnly: true;
  warnings: ValidationIssue[];
  source: Record<string, unknown>;
}

export interface SurfaceClaimStatusOptions {
  claimId?: string;
}

export interface FlowProcessStatusOptions {
  processId?: string;
  status?: string;
  gateId?: string;
}

export interface SurveyReviewStateOptions {
  reviewId?: string;
  claimId?: string;
  providerFieldRef?: string;
}

export interface CurrentOperatingStateOptions {
  generatedAt?: string | null;
}

export interface LocalConsoleHubOptions extends LocalFileSinkOptions {
  rootDir?: string;
  kontourRoot?: string;
  localRoot?: string;
  sink?: Sink;
}

export interface ConsoleHubServerOptions extends LocalConsoleHubOptions {
  hub?: Hub;
  host?: string;
  port?: number;
}

export interface ListenOptions {
  host?: string;
  port?: number;
}

export interface Hub {
  append(record: ConsoleRecord): Promise<DeliveryResult>;
  appendEvent?(event: ConsoleEventRecord): Promise<DeliveryResult>;
  appendProjection?(projection: ConsoleProjectionRecord): Promise<DeliveryResult>;
  inspect(): InspectionReport;
  currentOperatingState(options?: CurrentOperatingStateOptions): OperatingState;
}

export interface ConsoleHubServer {
  hub: Hub;
  server: import("node:http").Server;
  listen(listenOptions?: ListenOptions, callback?: () => void): import("node:http").Server;
  close(callback?: (error?: Error) => void): import("node:http").Server;
}

export interface RequestError extends Error {
  code?: string;
  statusCode?: number;
  safeMessage?: string;
}
