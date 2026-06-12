export type RecordKind = "event" | "projection";
export type DeliveryOutcome = "accepted" | "skipped" | "failed";
export type ValidationSeverity = "error" | "warning";
export type SourceKind = "fixture" | "local";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonArray = JsonValue[];
export type OpenRecord = Record<string, unknown>;

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

export type JsonObject = Record<string, unknown>;

export interface ConsoleLink {
  from?: CrossProductRef;
  relation?: string;
  to?: CrossProductRef;
  createdAt?: string;
}

export interface ConsoleActionRecord extends JsonObject {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
  readOnly?: boolean;
  authority?: JsonObject;
  subjectRefs?: CrossProductRef[];
}

export interface ConsoleInquiryRecord extends JsonObject {
  id: string;
  label?: string;
  outcome: string;
  asker?: string;
  claimRefs?: CrossProductRef[];
  ruleRefs?: CrossProductRef[];
  statusFunctionVersion?: string;
  resolvedAt?: string;
  sourceRef?: CrossProductRef;
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
  inquiries?: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
  links?: ConsoleLink[];
  timeline?: Record<string, unknown>[];
}

export type ConsoleApiErrorCode =
  | "BAD_REQUEST"
  | "BODY_TOO_LARGE"
  | "INVALID_BODY"
  | "INVALID_JSON"
  | "INVALID_RECORD"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "ORIGIN_NOT_ALLOWED"
  | "SINK_DELIVERY_FAILED"
  | (string & {});

export interface ConsoleApiError {
  error: ConsoleApiErrorCode;
  safeMessage?: string;
  validation?: ValidationIssue[];
}

export type ConsoleStateResponse = OperatingState;
export type ConsoleEventsResponse = EventStreamInspection[];
export type ConsoleRecordsRequest = ConsoleRecord;
export type ConsoleRecordsResponse = DeliveryResult | ConsoleApiError;
export type TelemetryRecordKind = "runtime" | "workflow-sidecar";
export type ConsoleSseEventName = "ready" | "state" | "record.accepted" | "telemetry.updated";
export type ConsoleStreamPath = "/stream";
export type ConsoleEventsCompatibilityPath = "/events";

export interface ConsoleReadySsePayload {
  connectedAt: string;
}

export type ConsoleStateSsePayload = OperatingState;

export interface ConsoleAcceptedRecordSsePayload {
  delivery: DeliveryResult;
  state: OperatingState;
}

export interface ConsoleTelemetryUpdatedSsePayload {
  telemetry: {
    generatedAt: string;
    recordCount: number;
  };
}

export interface ConsoleSsePayloadMap {
  ready: ConsoleReadySsePayload;
  state: ConsoleStateSsePayload;
  "record.accepted": ConsoleAcceptedRecordSsePayload;
  "telemetry.updated": ConsoleTelemetryUpdatedSsePayload;
}

export type ConsoleStreamSsePayload = ConsoleSsePayloadMap[ConsoleSseEventName];
export type ConsoleEventsSsePayload = ConsoleStreamSsePayload;

export interface ConsoleProducer {
  product?: string;
  id?: string;
  name?: string;
  [key: string]: unknown;
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
  producer: ConsoleProducer;
  payload: JsonObject;
  links?: ConsoleLink[];
  observedAt?: string;
  sequence?: number;
  summary?: string;
}

export interface ConsoleProjectionRecord extends ConsoleRecordBase {
  schema: "kontour.console.projection";
  generatedAt: string;
  derivedFrom: Record<string, unknown>;
}

export type ConsoleRecord = ConsoleEventRecord | ConsoleProjectionRecord | ConsoleRecordBase;

export interface ConsoleObjectRecord extends JsonObject {
  id?: string;
  label?: string;
  status?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface ConsoleProjectionSnapshot extends ConsoleProjectionRecord {
  claims?: ConsoleObjectRecord[];
  processes?: ConsoleObjectRecord[];
  gates?: ConsoleObjectRecord[];
  reviewItems?: ConsoleObjectRecord[];
  evidence?: ConsoleObjectRecord[];
  decisions?: ConsoleObjectRecord[];
  actions?: ConsoleObjectRecord[];
  exceptions?: ConsoleObjectRecord[];
  learnings?: ConsoleObjectRecord[];
  inquiries?: ConsoleObjectRecord[];
  links?: ConsoleLink[];
}

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

export interface DeliveryResultFields {
  sinkId: string;
  sinkRole: string;
  outcome: DeliveryOutcome;
  status?: string;
  recordId: string;
  recordKind: RecordKind;
  observedAt?: string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
  children?: DeliveryResult[];
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
  snapshot: ConsoleProjectionSnapshot;
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
  allowedOrigins?: string[];
  runtimeMode?: ConsoleRuntimeMode;
  hostedAuthTokens?: ConsoleHostedAuthToken[];
  hostedTenantIds?: string[];
  defaultTenantId?: string;
  telemetryStorageAdapter?: TelemetryStorageAdapterName;
  telemetryDatabaseUrl?: string;
  telemetrySqlClient?: ConsoleSqlClient;
  telemetryDescriptorPaths?: string[];
  telemetryProductRoots?: Record<string, string>;
  telemetryRoot?: string;
  telemetryFlowAgentsRoot?: string;
  telemetrySinkRoot?: string;
  telemetryToken?: string;
  serveUi?: boolean;
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
  validation?: ValidationIssue[];
}

export type ConsoleRuntimeMode = "local" | "hosted";

export interface ConsoleHostedAuthToken {
  token: string;
  tenantId: string;
  label?: string;
}

export interface ConsoleRequestContext {
  tenantId: string;
  runtimeMode: ConsoleRuntimeMode;
}

export interface ConsoleSqlQueryResult<Row = OpenRecord> {
  rows: Row[];
  rowCount?: number | null;
}

export interface ConsoleSqlClient {
  query<Row = OpenRecord>(text: string, values?: unknown[]): Promise<ConsoleSqlQueryResult<Row>>;
}

export interface TelemetryRecord extends JsonObject {
  schema_version: string;
  event_type: string;
  session_id: string;
  event_id: string;
}

export interface TelemetryRecordSummary {
  sourceId: string;
  sourceKind: TelemetryRecordKind;
  eventId: string;
  eventType: string;
  sessionId: string;
  observedAt?: string;
  status?: string;
  outcome?: string;
  durationMs?: number;
  agentName?: string;
  runtime?: string;
  runtimeVersion?: string;
  model?: string;
  hookEventName?: string;
  runtimeSessionId?: string;
  turnId?: string;
  project?: string;
  cwd?: string;
  delegationTarget?: string;
  toolName?: string;
  taskSlug?: string;
  title?: string;
  attributes?: Record<string, string>;
  path?: string;
}

export type TelemetryQueryPreset = "live" | "15m" | "24h" | "7d" | "custom";
export type TelemetrySortDirection = "desc" | "asc";

export interface TelemetryQueryFilter {
  facetId: string;
  label: string;
  value: string;
}

export interface TelemetryQuery {
  preset?: TelemetryQueryPreset;
  from?: string;
  to?: string;
  q?: string;
  filters: TelemetryQueryFilter[];
  limit: number;
  offset: number;
  sort: TelemetrySortDirection;
}

export interface TelemetryQuerySummary {
  preset?: TelemetryQueryPreset;
  from?: string;
  to?: string;
  q?: string;
  filters: TelemetryQueryFilter[];
  sort: TelemetrySortDirection;
}

export interface TelemetryPaginationSummary {
  limit: number;
  offset: number;
  returnedCount: number;
  totalMatchedCount: number;
  nextOffset?: number;
}

export interface TelemetryCountSummary {
  name: string;
  count: number;
}

export interface TelemetryFlowItem {
  slug: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  attributes?: Record<string, string>;
  details?: Array<{ label: string; value: string }>;
}

export interface TelemetryFacetSummary {
  id: string;
  label: string;
  counts: TelemetryCountSummary[];
}

export interface TelemetryFlowSummary {
  id: string;
  label: string;
  total: number;
  items: TelemetryFlowItem[];
}

export interface TelemetryAnalyticsSummary {
  facets: TelemetryFacetSummary[];
  flows: TelemetryFlowSummary[];
}

export interface TelemetrySourceSummary {
  id: string;
  kind: TelemetryRecordKind;
  path: string;
  recordCount: number;
  warningCount: number;
  warnings: ValidationIssue[];
}

export interface TelemetrySummary {
  generatedAt: string;
  sources: TelemetrySourceSummary[];
  totals: {
    recordCount: number;
    sessionCount: number;
    eventTypeCounts: Record<string, number>;
    productRecordCount: number;
  };
  analytics: TelemetryAnalyticsSummary;
  records: TelemetryRecordSummary[];
  query?: TelemetryQuerySummary;
  pagination?: TelemetryPaginationSummary;
  warnings: ValidationIssue[];
}

export type TelemetryRecordsRequest = TelemetryRecord;

export interface TelemetryDeliveryResult {
  sinkId: string;
  sinkRole: string;
  outcome: "accepted" | "failed";
  status: string;
  recordId: string;
  recordKind: "telemetry";
  observedAt: string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
}

export type TelemetryStorageAdapterName = "local-jsonl" | "sqlite" | "postgres" | "sql";

export interface ReplayEventStream {
  filePath?: string;
  relativePath?: string;
  events: ConsoleEventRecord[];
}

export interface ReplayInput {
  filePath?: string;
  relativePath?: string;
  events?: ConsoleEventRecord[];
  eventStreams?: ReplayEventStream[];
}

export interface ReplayEventEntry {
  event: ConsoleEventRecord;
  streamId: string;
  streamIndex: number;
  eventIndex: number;
}
