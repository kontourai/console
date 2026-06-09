const fs = require("node:fs");
const path = require("node:path");
import type {
  ConsoleRequestContext,
  ConsoleHubServerOptions,
  ConsoleSqlClient,
  OpenRecord,
  TelemetryDeliveryResult,
  TelemetryAnalyticsSummary,
  TelemetryStorageAdapterName,
  TelemetryFlowItem,
  TelemetryFlowSummary,
  TelemetryRecord,
  TelemetryRecordSummary,
  TelemetrySourceSummary,
  TelemetrySummary,
  ValidationIssue
} from "./types";
import { resolveTelemetryStorageAdapter } from "./config";

const MAX_JSONL_LINES_PER_FILE = 5000;
const MAX_TELEMETRY_READ_BYTES = 1024 * 1024;
const MAX_TELEMETRY_SINK_BYTES = 5 * 1024 * 1024;
const TELEMETRY_LOG_FILES = ["full.jsonl", "analytics.jsonl"];
const LOCAL_KONTOUR_DIR = ".kontour";
const SQLITE_TELEMETRY_MIGRATION = path.resolve(__dirname, "..", "..", "migrations", "sqlite", "0001_telemetry_events.sql");

interface TelemetryDescriptor {
  facets?: TelemetryFacetDescriptor[];
  flows?: TelemetryFlowDescriptor[];
  recordSources?: TelemetryRecordSourceDescriptor[];
}

interface TelemetryFacetDescriptor {
  id: string;
  label?: string;
  attribute: string;
  limit?: number;
}

interface TelemetryFlowDescriptor {
  id: string;
  label?: string;
  match?: TelemetryDescriptorMatch;
  titleAttribute?: string;
  limit?: number;
}

interface TelemetryDescriptorMatch {
  attribute: string;
  equals?: string;
  includes?: string;
}

interface TelemetryRecordSourceDescriptor {
  id: string;
  label?: string;
  root?: string;
  files?: string[];
  attributes?: Record<string, string>;
}

export interface TelemetryStore {
  accept(record: TelemetryRecord, context?: ConsoleRequestContext): Promise<TelemetryDeliveryResult>;
  summarize(context?: ConsoleRequestContext): Promise<TelemetrySummary>;
  ready(): Promise<{ ok: boolean; safeMessage?: string }>;
  close(): void;
}

export interface TelemetryRepository {
  readonly adapterName: TelemetryStorageAdapterName;
  accept(record: TelemetryRecord, observedAt: string, context: ConsoleRequestContext): Promise<TelemetryDeliveryResult>;
  runtimeSources(context: ConsoleRequestContext): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>>;
  ready(): Promise<{ ok: boolean; safeMessage?: string }>;
  close?(): void;
}

export interface TelemetryRepositoryConfig {
  rootDir: string;
  telemetryRoot: string;
  sinkRoot: string;
  adapterName: TelemetryStorageAdapterName;
  databaseUrl?: string;
  sqlClient?: ConsoleSqlClient;
}

export function createTelemetryStore(options: ConsoleHubServerOptions = {}): TelemetryStore {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const telemetryRoot = resolvePath(rootDir, options.telemetryRoot || path.join("..", ".telemetry"));
  const flowAgentsRoot = resolvePath(rootDir, options.telemetryFlowAgentsRoot || path.join("..", "flow-agents", ".flow-agents"));
  const sinkRoot = resolvePath(rootDir, options.telemetrySinkRoot || path.join(options.kontourRoot || options.localRoot || LOCAL_KONTOUR_DIR, "telemetry"));
  const descriptorPaths = options.telemetryDescriptorPaths || parseCsv(process.env.CONSOLE_TELEMETRY_DESCRIPTOR_PATHS);
  const repository = createTelemetryRepository({
    rootDir,
    telemetryRoot,
    sinkRoot,
    adapterName: resolveTelemetryStorageAdapter(options),
    databaseUrl: options.telemetryDatabaseUrl || process.env.CONSOLE_DATABASE_URL || process.env.CONSOLE_TELEMETRY_DATABASE_URL,
    sqlClient: options.telemetrySqlClient
  });

  return {
    async accept(record: TelemetryRecord, context: ConsoleRequestContext = localRequestContext()): Promise<TelemetryDeliveryResult> {
      const observedAt = new Date().toISOString();
      return repository.accept(record, observedAt, context);
    },

    async summarize(context: ConsoleRequestContext = localRequestContext()): Promise<TelemetrySummary> {
      return summarizeTelemetry({
        rootDir,
        flowAgentsRoot,
        descriptorPaths,
        includeProductRecordSources: context.runtimeMode !== "hosted",
        runtimeSources: await repository.runtimeSources(context)
      });
    },

    ready(): Promise<{ ok: boolean; safeMessage?: string }> {
      return repository.ready();
    },

    close(): void {
      repository.close?.();
    }
  };
}

export function createTelemetryRepository(config: TelemetryRepositoryConfig): TelemetryRepository {
  if (config.adapterName === "local-jsonl") return new LocalJsonlTelemetryRepository(config.rootDir, config.telemetryRoot, config.sinkRoot);
  if (config.adapterName === "sqlite") return new SqliteTelemetryRepository(config.rootDir, config.databaseUrl);
  return new PostgresTelemetryRepository(config.adapterName, config.databaseUrl, config.sqlClient);
}

class LocalJsonlTelemetryRepository implements TelemetryRepository {
  readonly adapterName = "local-jsonl" as const;
  private readonly accepted: TelemetryRecord[] = [];

  constructor(
    private readonly rootDir: string,
    private readonly telemetryRoot: string,
    private readonly sinkRoot: string
  ) {}

  async accept(record: TelemetryRecord, observedAt: string): Promise<TelemetryDeliveryResult> {
    const destination = path.join(this.sinkRoot, "records.jsonl");
    try {
      fs.mkdirSync(this.sinkRoot, { recursive: true });
      rotateTelemetrySink(destination);
      fs.appendFileSync(destination, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      return deliveryFailure(record, observedAt);
    }
    this.accepted.push(record);
    if (this.accepted.length > MAX_JSONL_LINES_PER_FILE) this.accepted.splice(0, this.accepted.length - MAX_JSONL_LINES_PER_FILE);
    return delivery(record, observedAt);
  }

  async runtimeSources(): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>> {
    const sources = TELEMETRY_LOG_FILES.map((fileName: string) => {
      const filePath = path.join(this.telemetryRoot, fileName);
      return readTelemetryJsonl(filePath, safeDisplayPath(this.rootDir, filePath), `local-${fileName}`);
    });
    const acceptedFilePath = path.join(this.sinkRoot, "records.jsonl");
    sources.push(readTelemetryJsonl(acceptedFilePath, safeDisplayPath(this.rootDir, acceptedFilePath), "local-accepted-jsonl"));
    const acceptedRecords = this.accepted.map((record: TelemetryRecord) => summarizeRuntimeRecord(record, "process-accepted", "process memory"));
    sources.push(sourceSummary("process-accepted", "runtime", "process memory", acceptedRecords, []));
    return sources;
  }

  async ready(): Promise<{ ok: boolean; safeMessage?: string }> {
    return { ok: true };
  }

  close(): void {}
}

class PostgresTelemetryRepository implements TelemetryRepository {
  readonly adapterName: TelemetryStorageAdapterName;
  private readonly sqlClient?: ConsoleSqlClient;
  private readonly ownsSqlClient: boolean;

  constructor(
    adapterName: "postgres" | "sql",
    private readonly databaseUrl?: string,
    sqlClient?: ConsoleSqlClient
  ) {
    this.adapterName = adapterName;
    this.ownsSqlClient = !sqlClient;
    this.sqlClient = sqlClient || createOptionalPgClient(databaseUrl);
  }

  async accept(record: TelemetryRecord, observedAt: string, context: ConsoleRequestContext): Promise<TelemetryDeliveryResult> {
    if (!this.sqlClient) return this.notConfigured(record, observedAt);
    try {
      await this.sqlClient.query(
        `insert into console_telemetry_events
          (tenant_id, event_id, schema_version, event_type, session_id, observed_at, received_at, payload)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (tenant_id, event_id) do update set
          schema_version = excluded.schema_version,
          event_type = excluded.event_type,
          session_id = excluded.session_id,
          observed_at = excluded.observed_at,
          received_at = excluded.received_at,
          payload = excluded.payload`,
        [
          context.tenantId,
          record.event_id,
          record.schema_version,
          record.event_type,
          record.session_id,
          normalizeTimestamp(record.timestamp) || observedAt,
          observedAt,
          record
        ]
      );
      return postgresDelivery(record, observedAt);
    } catch {
      return postgresDeliveryFailure(record, observedAt);
    }
  }

  async runtimeSources(context: ConsoleRequestContext): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>> {
    if (!this.sqlClient) {
      const warnings = [issue("warning", `telemetry-storage:${this.adapterName}`, "telemetry SQL storage is selected but no SQL telemetry client is wired")];
      return [sourceSummary(`${this.adapterName}-telemetry-storage`, "runtime", this.adapterName, [], warnings)];
    }
    try {
      const result = await this.sqlClient.query<{
        event_id: string;
        event_type: string;
        session_id: string;
        observed_at?: string | Date | null;
        received_at?: string | Date | null;
        payload: TelemetryRecord;
      }>(
        `select event_id, event_type, session_id, observed_at, received_at, payload
         from console_telemetry_events
         where tenant_id = $1
         order by coalesce(observed_at, received_at) desc
         limit $2`,
        [context.tenantId, MAX_JSONL_LINES_PER_FILE]
      );
      const records = result.rows
        .filter((row) => isTelemetryRecord(row.payload))
        .map((row) => summarizeRuntimeRecord({
          ...row.payload,
          timestamp: normalizeTimestamp(row.payload.timestamp) || timestampString(row.observed_at) || timestampString(row.received_at)
        }, "postgres-telemetry-events", "postgres"));
      return [sourceSummary("postgres-telemetry-events", "runtime", "postgres", records, [])];
    } catch {
      const warnings = [issue("warning", "telemetry-storage:postgres", "unable to read telemetry from postgres")];
      return [sourceSummary("postgres-telemetry-events", "runtime", "postgres", [], warnings)];
    }
  }

  async ready(): Promise<{ ok: boolean; safeMessage?: string }> {
    if (!this.sqlClient) return { ok: false, safeMessage: this.databaseUrl ? "SQL telemetry client is not wired" : "database URL is not configured" };
    try {
      await this.sqlClient.query("select 1 as ok");
      return { ok: true };
    } catch {
      return { ok: false, safeMessage: "database readiness check failed" };
    }
  }

  close(): void {
    if (!this.ownsSqlClient) return;
    const client = this.sqlClient as { end?: () => Promise<void> | void } | undefined;
    if (client && typeof client.end === "function") void client.end();
  }

  private notConfigured(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
    return {
      sinkId: `${this.adapterName}-telemetry-api`,
      sinkRole: "TelemetryApi",
      outcome: "failed",
      status: "not_configured",
      recordId: record.event_id,
      recordKind: "telemetry",
      observedAt,
      retryable: true,
      errorCode: "TELEMETRY_STORAGE_NOT_CONFIGURED",
      safeMessage: this.databaseUrl
        ? "telemetry SQL storage is selected but no SQL telemetry client is wired"
        : "telemetry SQL storage is selected but no database URL is configured"
    };
  }
}

class SqliteTelemetryRepository implements TelemetryRepository {
  readonly adapterName = "sqlite" as const;
  private readonly databasePath: string;
  private database?: any;
  private unavailableMessage?: string;

  constructor(rootDir: string, databaseUrl?: string) {
    this.databasePath = resolveSqliteDatabasePath(rootDir, databaseUrl);
  }

  async accept(record: TelemetryRecord, observedAt: string, context: ConsoleRequestContext): Promise<TelemetryDeliveryResult> {
    const database = this.openDatabase();
    if (!database) return this.notConfigured(record, observedAt);
    try {
      database.prepare(
        `insert into console_telemetry_events
          (tenant_id, event_id, schema_version, event_type, session_id, observed_at, received_at, payload)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (tenant_id, event_id) do update set
          schema_version = excluded.schema_version,
          event_type = excluded.event_type,
          session_id = excluded.session_id,
          observed_at = excluded.observed_at,
          received_at = excluded.received_at,
          payload = excluded.payload`
      ).run(
        context.tenantId,
        record.event_id,
        record.schema_version,
        record.event_type,
        record.session_id,
        normalizeTimestamp(record.timestamp) || observedAt,
        observedAt,
        JSON.stringify(record)
      );
      return sqliteDelivery(record, observedAt);
    } catch {
      return sqliteDeliveryFailure(record, observedAt);
    }
  }

  async runtimeSources(context: ConsoleRequestContext): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>> {
    const database = this.openDatabase();
    if (!database) {
      const warnings = [issue("warning", "telemetry-storage:sqlite", this.unavailableMessage || "sqlite telemetry storage is not available")];
      return [sourceSummary("sqlite-telemetry-storage", "runtime", "sqlite", [], warnings)];
    }
    try {
      const rows = database.prepare(
        `select event_id, event_type, session_id, observed_at, received_at, payload
         from console_telemetry_events
         where tenant_id = ?
         order by coalesce(observed_at, received_at) desc
         limit ?`
      ).all(context.tenantId, MAX_JSONL_LINES_PER_FILE);
      const records = rows
        .map((row: any) => sqlitePayloadRecord(row))
        .filter(isTelemetryRecord)
        .map((record: TelemetryRecord) => summarizeRuntimeRecord(record, "sqlite-telemetry-events", "sqlite"));
      return [sourceSummary("sqlite-telemetry-events", "runtime", "sqlite", records, [])];
    } catch {
      const warnings = [issue("warning", "telemetry-storage:sqlite", "unable to read telemetry from sqlite")];
      return [sourceSummary("sqlite-telemetry-events", "runtime", "sqlite", [], warnings)];
    }
  }

  async ready(): Promise<{ ok: boolean; safeMessage?: string }> {
    const database = this.openDatabase();
    if (!database) return { ok: false, safeMessage: this.unavailableMessage || "sqlite telemetry storage is not available" };
    try {
      database.prepare("select 1 as ok").get();
      return { ok: true };
    } catch {
      return { ok: false, safeMessage: "sqlite readiness check failed" };
    }
  }

  private openDatabase(): any | undefined {
    if (this.database) return this.database;
    try {
      fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
      const sqlite = require("node:sqlite");
      this.database = new sqlite.DatabaseSync(this.databasePath);
      this.database.exec(fs.readFileSync(SQLITE_TELEMETRY_MIGRATION, "utf8"));
      return this.database;
    } catch (error) {
      this.unavailableMessage = "sqlite telemetry storage is not available";
      return undefined;
    }
  }

  close(): void {
    if (!this.database) return;
    this.database.close();
    this.database = undefined;
  }

  private notConfigured(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
    return {
      sinkId: "sqlite-telemetry-api",
      sinkRole: "TelemetryApi",
      outcome: "failed",
      status: "not_configured",
      recordId: record.event_id,
      recordKind: "telemetry",
      observedAt,
      retryable: true,
      errorCode: "TELEMETRY_STORAGE_NOT_CONFIGURED",
      safeMessage: this.unavailableMessage || "sqlite telemetry storage is not available"
    };
  }
}

export function validateTelemetryRecordBody(body: unknown): TelemetryRecord {
  if (!isOpenRecord(body)) throw requestError("INVALID_BODY", 400, "request body must be a JSON object");
  const missing = ["schema_version", "event_type", "session_id", "event_id"].filter((field: string) => typeof body[field] !== "string" || !body[field]);
  if (missing.length) {
    const error = requestError("INVALID_TELEMETRY_RECORD", 400, "telemetry record validation failed");
    error.validation = missing.map((field: string) => issue("error", `record.${field}`, "field is required and must be a non-empty string"));
    throw error;
  }
  return body as TelemetryRecord;
}

function summarizeTelemetry(input: {
  rootDir: string;
  flowAgentsRoot: string;
  descriptorPaths: string[];
  includeProductRecordSources: boolean;
  runtimeSources: Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>;
}): TelemetrySummary {
  const sources: TelemetrySourceSummary[] = [];
  const warnings: ValidationIssue[] = [];
  const records: TelemetryRecordSummary[] = [];
  const seen = new Set<string>();

  for (const source of input.runtimeSources) {
    sources.push(source.source);
    warnings.push(...source.source.warnings);
    addRecords(records, seen, source.records);
  }

  const descriptor = loadTelemetryDescriptor(input.rootDir, input.flowAgentsRoot, input.descriptorPaths);
  const productRecords = input.includeProductRecordSources
    ? readDescriptorRecordSources(input.rootDir, input.flowAgentsRoot, descriptor)
    : { sources: [], records: [] };
  for (const productSource of productRecords.sources) {
    sources.push(productSource.source);
    warnings.push(...productSource.source.warnings);
    addRecords(records, seen, productSource.records);
  }

  return {
    generatedAt: new Date().toISOString(),
    sources,
    totals: {
      recordCount: records.length,
      sessionCount: new Set(records.map((record: TelemetryRecordSummary) => record.sessionId).filter(Boolean)).size,
      eventTypeCounts: countBy(records, "eventType"),
      productRecordCount: productRecords.records.length
    },
    analytics: buildAnalytics(records, descriptor),
    records: records.sort(compareRecordTimeDesc),
    warnings
  };
}

function readTelemetryJsonl(filePath: string, displayPath: string, sourceId: string): { source: TelemetrySourceSummary; records: TelemetryRecordSummary[] } {
  const warnings: ValidationIssue[] = [];
  const records: TelemetryRecordSummary[] = [];
  if (!fs.existsSync(filePath)) {
    warnings.push(issue("warning", displayPath, "telemetry log not found"));
    return sourceSummary(sourceId, "runtime", displayPath, records, warnings);
  }

  const readResult = readTelemetryTail(filePath);
  const lines = readResult.body.split(/\r?\n/).filter((line: string) => line.trim());
  const visibleLines = lines.slice(-MAX_JSONL_LINES_PER_FILE);
  const offset = lines.length - visibleLines.length;
  visibleLines.forEach((line: string, index: number) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (isTelemetryRecord(parsed)) records.push(summarizeRuntimeRecord(parsed, sourceId, displayPath));
      else warnings.push(issue("warning", `${displayPath}:${offset + index + 1}`, "telemetry line did not match supported envelope"));
    } catch (error) {
      warnings.push(issue("warning", `${displayPath}:${offset + index + 1}`, `invalid JSON: ${safeErrorMessage(error)}`));
    }
  });
  if (lines.length > MAX_JSONL_LINES_PER_FILE) {
    warnings.push(issue("warning", displayPath, `telemetry log truncated to ${MAX_JSONL_LINES_PER_FILE} lines`));
  }
  if (readResult.truncatedBytes) {
    warnings.push(issue("warning", displayPath, `telemetry log read was capped at ${MAX_TELEMETRY_READ_BYTES} bytes`));
  }

  return sourceSummary(sourceId, "runtime", displayPath, records, warnings);
}

function summarizeRuntimeRecord(record: TelemetryRecord, sourceId: string, filePath: string): TelemetryRecordSummary {
  const cwd = nestedString(record, ["context", "cwd"]);
  const project = projectNameFromCwd(cwd);
  const delegation = delegationTarget(record);
  const hookEventName = nestedString(record, ["hook", "event_name"]);
  const runtimeSessionId = nestedString(record, ["hook", "runtime_session_id"]);
  const turnId = nestedString(record, ["hook", "turn_id"]);
  const model = nestedString(record, ["hook", "model"]) || nestedString(record, ["usage", "model"]);
  const runtimeVersion = nestedString(record, ["agent", "version"]);
  const agentName = nestedString(record, ["agent", "name"]);
  const runtime = nestedString(record, ["agent", "runtime"]);
  const toolName = nestedString(record, ["tool", "normalized_name"]) || nestedString(record, ["tool", "name"]);
  const status = nestedString(record, ["status"]) || hookEventName;
  const outcome = nestedString(record, ["outcome"]) || nestedString(record, ["tool", "status"]);
  return {
    sourceId,
    sourceKind: "runtime",
    eventId: record.event_id,
    eventType: record.event_type,
    sessionId: record.session_id,
    observedAt: normalizeTimestamp(record.timestamp),
    status,
    outcome,
    durationMs: numberField(record, "duration_ms"),
    agentName,
    runtime,
    runtimeVersion,
    model,
    hookEventName,
    runtimeSessionId,
    turnId,
    project,
    cwd,
    delegationTarget: delegation,
    toolName,
    attributes: compactStringRecord({
      sourceKind: "runtime",
      eventType: record.event_type,
      sessionId: record.session_id,
      agentName,
      runtime,
      runtimeVersion,
      model,
      hookEventName,
      runtimeSessionId,
      turnId,
      project,
      cwd,
      toolName,
      status,
      outcome,
      delegationTarget: delegation
    }),
    path: filePath
  };
}

function readDescriptorRecordSources(rootDir: string, flowAgentsRoot: string, descriptor: TelemetryDescriptor): { sources: Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>; records: TelemetryRecordSummary[] } {
  const sources = (descriptor.recordSources || []).map((source: TelemetryRecordSourceDescriptor) => readDescriptorRecordSource(rootDir, flowAgentsRoot, source));
  return {
    sources,
    records: sources.flatMap((source) => source.records)
  };
}

function readDescriptorRecordSource(rootDir: string, flowAgentsRoot: string, source: TelemetryRecordSourceDescriptor): { source: TelemetrySourceSummary; records: TelemetryRecordSummary[] } {
  const sourceRoot = resolveDescriptorRoot(rootDir, flowAgentsRoot, source.root || ".");
  const displayRoot = safeDisplayPath(rootDir, sourceRoot);
  const warnings: ValidationIssue[] = [];
  const records: TelemetryRecordSummary[] = [];
  if (!fs.existsSync(sourceRoot)) {
    warnings.push(issue("warning", displayRoot, "descriptor record source not found"));
    return sourceSummary(source.id, "workflow-sidecar", displayRoot, records, warnings);
  }

  const files = listDescriptorFiles(sourceRoot, source.files || ["*.json"]);
  for (const filePath of files) {
    const displayPath = safeDisplayPath(rootDir, filePath);
    try {
      if (!isContainedRealPath(sourceRoot, path.dirname(filePath))) {
        warnings.push(issue("warning", displayPath, "descriptor record escaped source root"));
        continue;
      }
      const data = JSON.parse(readDescriptorJsonFile(filePath));
      if (!isOpenRecord(data)) continue;
      const attributes = descriptorAttributes(data, source.attributes || {});
      const taskSlug = attributes.taskSlug || path.basename(path.dirname(filePath));
      const eventType = attributes.eventType || `${source.id}.${path.basename(filePath, path.extname(filePath))}`;
      records.push({
        sourceId: source.id,
        sourceKind: "workflow-sidecar",
        eventId: attributes.eventId || `${taskSlug}:${path.basename(filePath)}`,
        eventType,
        sessionId: attributes.sessionId || taskSlug,
        observedAt: attributes.observedAt,
        status: attributes.status,
        title: attributes.title,
        taskSlug,
        attributes: compactStringRecord({
          sourceKind: "workflow-sidecar",
          eventType,
          taskSlug,
          ...attributes
        }),
        path: displayPath
      });
    } catch (error) {
      warnings.push(issue("warning", displayPath, isDescriptorEscapeError(error) ? "descriptor record escaped source root" : "unable to read descriptor record"));
    }
  }

  return sourceSummary(source.id, "workflow-sidecar", displayRoot, records, warnings);
}

function isDescriptorEscapeError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
  return code === "ELOOP";
}

function readDescriptorJsonFile(filePath: string): string {
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("descriptor record is not a regular file");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function resolveDescriptorRoot(rootDir: string, flowAgentsRoot: string, descriptorRoot: string): string {
  const productRoot = path.resolve(flowAgentsRoot, "..");
  if (descriptorRoot.startsWith("console:")) {
    return resolveContainedPath(rootDir, descriptorRoot.slice("console:".length));
  }
  const productRelative = descriptorRoot.startsWith("product:")
    ? descriptorRoot.slice("product:".length)
    : descriptorRoot;
  return resolveContainedPath(productRoot, productRelative);
}

function resolveContainedPath(root: string, maybeRelativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, maybeRelativePath);
  if (!isContainedPath(resolvedRoot, resolved)) return resolvedRoot;
  if (!fs.existsSync(resolvedRoot)) return resolved;
  if (fs.existsSync(resolved)) {
    return isContainedRealPath(resolvedRoot, resolved) ? fs.realpathSync(resolved) : fs.realpathSync(resolvedRoot);
  }
  const ancestor = nearestExistingAncestor(resolved);
  return isContainedRealPath(resolvedRoot, ancestor) ? resolved : fs.realpathSync(resolvedRoot);
}

function isContainedRealPath(root: string, candidate: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const realCandidate = fs.realpathSync(candidate);
    return isContainedPath(realRoot, realCandidate);
  } catch {
    return false;
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nearestExistingAncestor(filePath: string): string {
  let current = filePath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function listDescriptorFiles(root: string, patterns: string[]): string[] {
  const fileNames = new Set(patterns);
  const allowAnyJson = fileNames.has("*.json");
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const file of fs.readdirSync(child, { withFileTypes: true })) {
        if ((file.isFile() || file.isSymbolicLink()) && (allowAnyJson || fileNames.has(file.name))) files.push(path.join(child, file.name));
      }
    } else if ((entry.isFile() || entry.isSymbolicLink()) && (allowAnyJson || fileNames.has(entry.name))) {
      files.push(child);
    }
  }
  return files;
}

function descriptorAttributes(data: OpenRecord, mappings: Record<string, string>): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [attribute, selector] of Object.entries(mappings)) {
    const value = selectorValue(data, selector);
    if (typeof value === "string" && value) attributes[attribute] = value;
  }
  return attributes;
}

function selectorValue(data: OpenRecord, selector: string): unknown {
  return selector.split(".").reduce((current: unknown, key: string) => {
    if (!isOpenRecord(current)) return undefined;
    return current[key];
  }, data);
}

function buildAnalytics(records: TelemetryRecordSummary[], descriptor: TelemetryDescriptor): TelemetryAnalyticsSummary {
  const facets = descriptor.facets && descriptor.facets.length ? descriptor.facets : defaultFacetDescriptors();
  return {
    facets: facets.map((facet: TelemetryFacetDescriptor) => ({
      id: facet.id,
      label: facet.label || facet.id,
      counts: topAttributeCounts(records, facet.attribute, facet.limit || 12)
    })),
    flows: (descriptor.flows || []).map((flow: TelemetryFlowDescriptor) => summarizeDescriptorFlow(records, flow))
  };
}

function topAttributeCounts(records: TelemetryRecordSummary[], attribute: string, limit: number) {
  return Object.entries(records.reduce((counts: Record<string, number>, record: TelemetryRecordSummary) => {
    const value = recordAttribute(record, attribute);
    if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {}))
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit);
}

function summarizeDescriptorFlow(records: TelemetryRecordSummary[], flow: TelemetryFlowDescriptor): TelemetryFlowSummary {
  const items = records
    .filter((record: TelemetryRecordSummary) => record.taskSlug && descriptorMatch(record, flow.match))
    .map((record: TelemetryRecordSummary): TelemetryFlowItem => ({
      slug: record.taskSlug || record.sessionId,
      title: recordAttribute(record, flow.titleAttribute || "title") || record.title,
      status: record.status,
      updatedAt: record.observedAt,
      attributes: record.attributes
    }));
  const uniqueItems = dedupeFlowItems(items);
  return {
    id: flow.id,
    label: flow.label || flow.id,
    total: uniqueItems.length,
    items: uniqueItems.slice(0, flow.limit || 10)
  };
}

function dedupeFlowItems(items: TelemetryFlowItem[]): TelemetryFlowItem[] {
  const bySlug = new Map<string, TelemetryFlowItem>();
  for (const item of items) {
    const existing = bySlug.get(item.slug);
    if (!existing || Date.parse(item.updatedAt || "") > Date.parse(existing.updatedAt || "")) {
      bySlug.set(item.slug, item);
    }
  }
  return Array.from(bySlug.values()).sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
}

function delegationTarget(record: TelemetryRecord): string | undefined {
  const targets = nestedValue(record, ["delegation", "targets"]);
  if (Array.isArray(targets) && typeof targets[0] === "string") return targets[0];
  const query = nestedString(record, ["delegation", "targets", "query"]);
  if (query) return query;
  return undefined;
}

function defaultFacetDescriptors(): TelemetryFacetDescriptor[] {
  return [
    { id: "projects", label: "Projects", attribute: "project" },
    { id: "tools", label: "Tools", attribute: "toolName" },
    { id: "runtimes", label: "Runtimes", attribute: "runtime" },
    { id: "models", label: "Models", attribute: "model" },
    { id: "agents", label: "Agents", attribute: "agentName" },
    { id: "events", label: "Events", attribute: "eventType" },
    { id: "outcomes", label: "Outcomes", attribute: "outcome" },
    { id: "hooks", label: "Hook events", attribute: "hookEventName" },
    { id: "delegations", label: "Delegation targets", attribute: "delegationTarget" },
    { id: "workflow-status", label: "Workflow status", attribute: "status" }
  ];
}

function loadTelemetryDescriptor(rootDir: string, flowAgentsRoot: string, descriptorPaths: string[] = []): TelemetryDescriptor {
  const candidates = [
    ...descriptorPaths.map((descriptorPath) => resolvePath(rootDir, descriptorPath)),
    path.join(rootDir, "console.telemetry.json"),
    path.resolve(flowAgentsRoot, "..", "console.telemetry.json"),
    path.resolve(flowAgentsRoot, "..", ".kontour", "console.telemetry.json")
  ];
  const descriptors = candidates
    .filter((candidate: string) => fs.existsSync(candidate))
    .map((candidate: string) => readTelemetryDescriptor(candidate));
  return mergeTelemetryDescriptors(descriptors);
}

function readTelemetryDescriptor(filePath: string): TelemetryDescriptor {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isOpenRecord(parsed)) return {};
    return {
      facets: Array.isArray(parsed.facets) ? parsed.facets.filter(isFacetDescriptor) : [],
      flows: Array.isArray(parsed.flows) ? parsed.flows.filter(isFlowDescriptor) : [],
      recordSources: Array.isArray(parsed.recordSources) ? parsed.recordSources.filter(isRecordSourceDescriptor) : []
    };
  } catch {
    return {};
  }
}

function mergeTelemetryDescriptors(descriptors: TelemetryDescriptor[]): TelemetryDescriptor {
  return {
    facets: descriptors.flatMap((descriptor) => descriptor.facets || []),
    flows: descriptors.flatMap((descriptor) => descriptor.flows || []),
    recordSources: descriptors.flatMap((descriptor) => descriptor.recordSources || [])
  };
}

function isFacetDescriptor(value: unknown): value is TelemetryFacetDescriptor {
  return isOpenRecord(value) && typeof value.id === "string" && typeof value.attribute === "string";
}

function isFlowDescriptor(value: unknown): value is TelemetryFlowDescriptor {
  return isOpenRecord(value) && typeof value.id === "string";
}

function isRecordSourceDescriptor(value: unknown): value is TelemetryRecordSourceDescriptor {
  return isOpenRecord(value) && typeof value.id === "string";
}

function descriptorMatch(record: TelemetryRecordSummary, match?: TelemetryDescriptorMatch): boolean {
  if (!match) return true;
  const value = recordAttribute(record, match.attribute);
  if (!value) return false;
  if (typeof match.equals === "string") return value === match.equals;
  if (typeof match.includes === "string") return value.toLowerCase().includes(match.includes.toLowerCase());
  return true;
}

function recordAttribute(record: TelemetryRecordSummary, attribute: string): string | undefined {
  const direct = record[attribute as keyof TelemetryRecordSummary];
  if (typeof direct === "string") return direct;
  return record.attributes?.[attribute];
}

function compactStringRecord(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

function addRecords(records: TelemetryRecordSummary[], seen: Set<string>, additions: TelemetryRecordSummary[]): void {
  for (const record of additions) {
    const key = `${record.sourceKind}:${record.eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(record);
  }
}

function delivery(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
  return {
    sinkId: "local-telemetry-api",
    sinkRole: "TelemetryApi",
    outcome: "accepted",
    status: "persisted",
    recordId: record.event_id,
    recordKind: "telemetry",
    observedAt
  };
}

function deliveryFailure(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
  return {
    sinkId: "local-telemetry-api",
    sinkRole: "TelemetryApi",
    outcome: "failed",
    status: "persistence_failed",
    recordId: record.event_id,
    recordKind: "telemetry",
    observedAt,
    retryable: true,
    errorCode: "TELEMETRY_PERSISTENCE_FAILED",
    safeMessage: "telemetry record could not be persisted"
  };
}

function postgresDelivery(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
  return {
    sinkId: "postgres-telemetry-api",
    sinkRole: "TelemetryApi",
    outcome: "accepted",
    status: "persisted",
    recordId: record.event_id,
    recordKind: "telemetry",
    observedAt
  };
}

function postgresDeliveryFailure(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
  return {
    sinkId: "postgres-telemetry-api",
    sinkRole: "TelemetryApi",
    outcome: "failed",
    status: "persistence_failed",
    recordId: record.event_id,
    recordKind: "telemetry",
    observedAt,
    retryable: true,
    errorCode: "TELEMETRY_PERSISTENCE_FAILED",
    safeMessage: "telemetry record could not be persisted"
  };
}

function sqliteDelivery(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
  return {
    sinkId: "sqlite-telemetry-api",
    sinkRole: "TelemetryApi",
    outcome: "accepted",
    status: "persisted",
    recordId: record.event_id,
    recordKind: "telemetry",
    observedAt
  };
}

function sqliteDeliveryFailure(record: TelemetryRecord, observedAt: string): TelemetryDeliveryResult {
  return {
    sinkId: "sqlite-telemetry-api",
    sinkRole: "TelemetryApi",
    outcome: "failed",
    status: "persistence_failed",
    recordId: record.event_id,
    recordKind: "telemetry",
    observedAt,
    retryable: true,
    errorCode: "TELEMETRY_PERSISTENCE_FAILED",
    safeMessage: "telemetry record could not be persisted"
  };
}

function sqlitePayloadRecord(row: any): unknown {
  if (!row || typeof row.payload !== "string") return undefined;
  try {
    const parsed = JSON.parse(row.payload);
    if (!isOpenRecord(parsed)) return undefined;
    return {
      ...parsed,
      timestamp: normalizeTimestamp(parsed.timestamp) || timestampString(row.observed_at) || timestampString(row.received_at)
    };
  } catch {
    return undefined;
  }
}

function resolveSqliteDatabasePath(rootDir: string, databaseUrl?: string): string {
  if (!databaseUrl) return path.join(rootDir, LOCAL_KONTOUR_DIR, "telemetry", "console.sqlite");
  if (databaseUrl.startsWith("file:")) {
    try {
      return path.resolve(decodeURIComponent(new URL(databaseUrl).pathname));
    } catch {
      return resolvePath(rootDir, databaseUrl.slice("file:".length));
    }
  }
  return resolvePath(rootDir, databaseUrl);
}

function rotateTelemetrySink(destination: string): void {
  if (!fs.existsSync(destination)) return;
  const size = fs.statSync(destination).size;
  if (size < MAX_TELEMETRY_SINK_BYTES) return;
  const rotated = `${destination}.1`;
  if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
  fs.renameSync(destination, rotated);
}

function readTelemetryTail(filePath: string): { body: string; truncatedBytes: boolean } {
  const stats = fs.statSync(filePath);
  const start = Math.max(0, stats.size - MAX_TELEMETRY_READ_BYTES);
  const length = stats.size - start;
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, start);
    let body = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = body.indexOf("\n");
      body = firstNewline >= 0 ? body.slice(firstNewline + 1) : "";
    }
    return { body, truncatedBytes: start > 0 };
  } finally {
    fs.closeSync(descriptor);
  }
}

function sourceSummary(id: string, kind: "runtime" | "workflow-sidecar", filePath: string, records: TelemetryRecordSummary[], warnings: ValidationIssue[]) {
  return {
    source: {
      id,
      kind,
      path: filePath,
      recordCount: records.length,
      warningCount: warnings.length,
      warnings
    },
    records
  };
}

function isTelemetryRecord(value: unknown): value is TelemetryRecord {
  return isOpenRecord(value)
    && typeof value.schema_version === "string"
    && typeof value.event_type === "string"
    && typeof value.session_id === "string"
    && typeof value.event_id === "string";
}

function isOpenRecord(value: unknown): value is OpenRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberField(data: OpenRecord, field: string): number | undefined {
  return typeof data[field] === "number" ? data[field] as number : undefined;
}

function nestedString(data: unknown, keys: string[]): string | undefined {
  let current = data;
  for (const key of keys) {
    if (!isOpenRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

function nestedValue(data: unknown, keys: string[]): unknown {
  let current = data;
  for (const key of keys) {
    if (!isOpenRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function projectNameFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const normalized = path.normalize(cwd);
  const basename = path.basename(normalized);
  return basename === "." || basename === path.sep ? undefined : basename;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/.test(value)) return new Date(Number(value)).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function timestampString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : undefined;
}

function localRequestContext(): ConsoleRequestContext {
  return { tenantId: "local", runtimeMode: "local" };
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function createOptionalPgClient(databaseUrl: string | undefined): ConsoleSqlClient | undefined {
  if (!databaseUrl) return undefined;
  try {
    const pg = require("pg");
    return new pg.Pool({ connectionString: databaseUrl });
  } catch {
    return undefined;
  }
}

function countBy(records: TelemetryRecordSummary[], field: "eventType"): Record<string, number> {
  return records.reduce((counts: Record<string, number>, record: TelemetryRecordSummary) => {
    const value = record[field] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function compareRecordTimeDesc(left: TelemetryRecordSummary, right: TelemetryRecordSummary): number {
  return Date.parse(right.observedAt || "") - Date.parse(left.observedAt || "");
}

function resolvePath(rootDir: string, maybeRelativePath: string): string {
  return path.resolve(path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.join(rootDir, maybeRelativePath));
}

function safeDisplayPath(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : `[external]/${path.basename(filePath)}`;
}

function issue(severity: "error" | "warning", issuePath: string, message: string): ValidationIssue {
  return { severity, path: issuePath, message };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestError(code: string, statusCode: number, safeMessage: string) {
  const error = new Error(safeMessage) as Error & { code?: string; statusCode?: number; safeMessage?: string; validation?: ValidationIssue[] };
  error.code = code;
  error.statusCode = statusCode;
  error.safeMessage = safeMessage;
  return error;
}
