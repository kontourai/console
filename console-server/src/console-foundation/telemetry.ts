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
  TelemetryQuery,
  TelemetryQueryFilter,
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
const DEFAULT_TELEMETRY_QUERY_LIMIT = 100;
const MAX_TELEMETRY_QUERY_LIMIT = 100;
const MAX_TELEMETRY_QUERY_OFFSET = 100000;
const MAX_TELEMETRY_QUERY_TEXT_LENGTH = 200;
const MAX_TELEMETRY_QUERY_FILTERS = 25;
const MAX_TELEMETRY_QUERY_FILTER_PART_LENGTH = 120;
const MAX_TELEMETRY_QUERY_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 60 * 1000;
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
  detailAttributes?: Record<string, string>;
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

type TelemetryProductRoots = Record<string, string>;

export interface TelemetryStore {
  accept(record: TelemetryRecord, context?: ConsoleRequestContext): Promise<TelemetryDeliveryResult>;
  summarize(context?: ConsoleRequestContext, query?: TelemetryQuery): Promise<TelemetrySummary>;
  ready(): Promise<{ ok: boolean; safeMessage?: string }>;
  close(): void;
}

export interface TelemetryRepository {
  readonly adapterName: TelemetryStorageAdapterName;
  accept(record: TelemetryRecord, observedAt: string, context: ConsoleRequestContext): Promise<TelemetryDeliveryResult>;
  runtimeSources(context: ConsoleRequestContext, query?: TelemetryQuery): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>>;
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
  const productRoots = resolveTelemetryProductRoots(rootDir, options);
  const sinkRoot = resolvePath(rootDir, options.telemetrySinkRoot || path.join(options.kontourRoot || options.localRoot || LOCAL_KONTOUR_DIR, "telemetry"));
  const descriptorPaths = options.telemetryDescriptorPaths || parseCsv(process.env.CONSOLE_TELEMETRY_DESCRIPTOR_PATHS);
  const telemetryDatabaseUrl = options.telemetryDatabaseUrl || process.env.CONSOLE_DATABASE_URL || process.env.CONSOLE_TELEMETRY_DATABASE_URL;
  const adapterName = resolveTelemetryStorageAdapter(options);
  // The serve bin passes no SQL client; hosted mode requires a postgres
  // adapter, so construct one from the configured URL when possible.
  const needsSqlClient = adapterName === "postgres" || adapterName === "sql";
  const repository = createTelemetryRepository({
    rootDir,
    telemetryRoot,
    sinkRoot,
    adapterName,
    databaseUrl: telemetryDatabaseUrl,
    sqlClient: options.telemetrySqlClient ?? createOptionalPgClient(needsSqlClient ? telemetryDatabaseUrl : undefined)
  });

  return {
    async accept(record: TelemetryRecord, context: ConsoleRequestContext = localRequestContext()): Promise<TelemetryDeliveryResult> {
      const observedAt = new Date().toISOString();
      return repository.accept(record, observedAt, context);
    },

    async summarize(context: ConsoleRequestContext = localRequestContext(), query?: TelemetryQuery): Promise<TelemetrySummary> {
      return summarizeTelemetry({
        rootDir,
        productRoots,
        descriptorPaths,
        includeProductRecordSources: context.runtimeMode !== "hosted",
        runtimeSources: await repository.runtimeSources(context, query),
        query
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

  async runtimeSources(context: ConsoleRequestContext, query?: TelemetryQuery): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>> {
    if (!this.sqlClient) {
      const warnings = [issue("warning", `telemetry-storage:${this.adapterName}`, "telemetry SQL storage is selected but no SQL telemetry client is wired")];
      return [sourceSummary(`${this.adapterName}-telemetry-storage`, "runtime", this.adapterName, [], warnings)];
    }
    try {
      const select = sqlTelemetrySelect(query, "postgres");
      const result = await this.sqlClient.query<{
        event_id: string;
        event_type: string;
        session_id: string;
        observed_at?: string | Date | null;
        received_at?: string | Date | null;
        payload: TelemetryRecord;
      }>(
        select.text,
        [context.tenantId, ...select.values]
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

  async runtimeSources(context: ConsoleRequestContext, query?: TelemetryQuery): Promise<Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>> {
    const database = this.openDatabase();
    if (!database) {
      const warnings = [issue("warning", "telemetry-storage:sqlite", this.unavailableMessage || "sqlite telemetry storage is not available")];
      return [sourceSummary("sqlite-telemetry-storage", "runtime", "sqlite", [], warnings)];
    }
    try {
      const select = sqlTelemetrySelect(query, "sqlite");
      const rows = database.prepare(select.text).all(context.tenantId, ...select.values);
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

export function parseTelemetryQuery(searchParams: URLSearchParams): TelemetryQuery | undefined {
  if ([...searchParams.keys()].length === 0) return undefined;
  const validation: ValidationIssue[] = [];
  const preset = parsePreset(searchParams.get("preset"), validation);
  const from = parseIsoTimestampParam("from", searchParams.get("from"), validation);
  const to = parseIsoTimestampParam("to", searchParams.get("to"), validation);
  const q = parseQueryText(searchParams.get("q"), validation);
  const filters = parseTelemetryFilters(searchParams.getAll("filter"), validation);
  const limit = parseBoundedInteger("limit", searchParams.get("limit"), 1, MAX_TELEMETRY_QUERY_LIMIT, DEFAULT_TELEMETRY_QUERY_LIMIT, validation);
  const offset = parseBoundedInteger("offset", searchParams.get("offset"), 0, MAX_TELEMETRY_QUERY_OFFSET, 0, validation);
  const sort = parseSort(searchParams.get("sort"), validation);

  if (preset !== "custom" && (from || to) && searchParams.has("preset")) {
    validation.push(issue("error", "query.preset", "from/to require preset=custom when preset is provided"));
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    validation.push(issue("error", "query.from", "from must be before to"));
  }
  if (from && to && Date.parse(to) - Date.parse(from) > MAX_TELEMETRY_QUERY_RANGE_MS) {
    validation.push(issue("error", "query.to", "from/to range may not exceed 31 days"));
  }
  if (validation.length) {
    const error = requestError("BAD_REQUEST", 400, "invalid telemetry query");
    error.validation = validation;
    throw error;
  }
  return {
    preset,
    from,
    to,
    q,
    filters,
    limit,
    offset,
    sort
  };
}

function parsePreset(value: string | null, validation: ValidationIssue[]): TelemetryQuery["preset"] {
  if (value === null || value === "") return undefined;
  if (value === "live" || value === "15m" || value === "24h" || value === "7d" || value === "custom") return value;
  validation.push(issue("error", "query.preset", "preset must be live, 15m, 24h, 7d, or custom"));
  return undefined;
}

function parseSort(value: string | null, validation: ValidationIssue[]): TelemetryQuery["sort"] {
  if (value === null || value === "") return "desc";
  if (value === "desc" || value === "asc") return value;
  validation.push(issue("error", "query.sort", "sort must be desc or asc"));
  return "desc";
}

function parseIsoTimestampParam(name: "from" | "to", value: string | null, validation: ValidationIssue[]): string | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    validation.push(issue("error", `query.${name}`, `${name} must be an ISO timestamp`));
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function parseQueryText(value: string | null, validation: ValidationIssue[]): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TELEMETRY_QUERY_TEXT_LENGTH) {
    validation.push(issue("error", "query.q", `q must be ${MAX_TELEMETRY_QUERY_TEXT_LENGTH} characters or fewer`));
    return undefined;
  }
  return trimmed;
}

function parseTelemetryFilters(values: string[], validation: ValidationIssue[]): TelemetryQueryFilter[] {
  if (values.length > MAX_TELEMETRY_QUERY_FILTERS) {
    validation.push(issue("error", "query.filter", `filter may be repeated at most ${MAX_TELEMETRY_QUERY_FILTERS} times`));
  }
  return values.slice(0, MAX_TELEMETRY_QUERY_FILTERS).flatMap((value, index) => {
    const separator = value.indexOf(":");
    const facetId = separator >= 0 ? value.slice(0, separator).trim() : "";
    const filterValue = separator >= 0 ? value.slice(separator + 1).trim() : "";
    if (!facetId || !filterValue || facetId.length > MAX_TELEMETRY_QUERY_FILTER_PART_LENGTH || filterValue.length > MAX_TELEMETRY_QUERY_FILTER_PART_LENGTH) {
      validation.push(issue("error", `query.filter[${index}]`, "filter must be formatted as facetId:value with bounded non-empty parts"));
      return [];
    }
    return [{ facetId, label: facetId, value: filterValue }];
  });
}

function parseBoundedInteger(name: "limit" | "offset", value: string | null, min: number, max: number, fallback: number, validation: ValidationIssue[]): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    validation.push(issue("error", `query.${name}`, `${name} must be an integer`));
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    validation.push(issue("error", `query.${name}`, `${name} must be between ${min} and ${max}`));
    return fallback;
  }
  return parsed;
}

function summarizeTelemetry(input: {
  rootDir: string;
  productRoots: TelemetryProductRoots;
  descriptorPaths: string[];
  includeProductRecordSources: boolean;
  runtimeSources: Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>;
  query?: TelemetryQuery;
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

  const descriptor = loadTelemetryDescriptor(input.rootDir, input.productRoots, input.descriptorPaths);
  const productRecords = input.includeProductRecordSources
    ? readDescriptorRecordSources(input.rootDir, input.productRoots, descriptor)
    : { sources: [], records: [] };
  for (const productSource of productRecords.sources) {
    sources.push(productSource.source);
    warnings.push(...productSource.source.warnings);
    addRecords(records, seen, productSource.records);
  }

  const effectiveRange = effectiveQueryRange(input.query);
  const matchedRecords = applyTelemetryQuery(records, input.query, effectiveRange, activeFacetDescriptors(descriptor)).sort(input.query?.sort === "asc" ? compareRecordTimeAsc : compareRecordTimeDesc);
  const paginatedRecords = input.query
    ? matchedRecords.slice(input.query.offset, input.query.offset + input.query.limit)
    : matchedRecords;

  return {
    generatedAt: new Date().toISOString(),
    sources,
    totals: {
      recordCount: matchedRecords.length,
      sessionCount: new Set(matchedRecords.map((record: TelemetryRecordSummary) => record.sessionId).filter(Boolean)).size,
      eventTypeCounts: countBy(matchedRecords, "eventType"),
      productRecordCount: productRecords.records.length
    },
    analytics: buildAnalytics(matchedRecords, descriptor),
    records: paginatedRecords,
    query: input.query ? querySummary(input.query, effectiveRange) : undefined,
    pagination: input.query ? paginationSummary(input.query, paginatedRecords.length, matchedRecords.length) : undefined,
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

function readDescriptorRecordSources(rootDir: string, productRoots: TelemetryProductRoots, descriptor: TelemetryDescriptor): { sources: Array<{ source: TelemetrySourceSummary; records: TelemetryRecordSummary[] }>; records: TelemetryRecordSummary[] } {
  const sources = (descriptor.recordSources || []).map((source: TelemetryRecordSourceDescriptor) => readDescriptorRecordSource(rootDir, productRoots, source));
  return {
    sources,
    records: sources.flatMap((source) => source.records)
  };
}

function readDescriptorRecordSource(rootDir: string, productRoots: TelemetryProductRoots, source: TelemetryRecordSourceDescriptor): { source: TelemetrySourceSummary; records: TelemetryRecordSummary[] } {
  const sourceRoot = resolveDescriptorRoot(rootDir, productRoots, source.root || ".");
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

function resolveDescriptorRoot(rootDir: string, productRoots: TelemetryProductRoots, descriptorRoot: string): string {
  if (descriptorRoot.startsWith("console:")) {
    return resolveContainedPath(rootDir, descriptorRoot.slice("console:".length));
  }
  const productRef = parseProductRootRef(descriptorRoot);
  const productRoot = productRef.productId
    ? productRoots[productRef.productId]
    : defaultTelemetryProductRoot(productRoots);
  if (!productRoot) return missingProductRoot(rootDir, productRef.productId);
  return resolveContainedPath(productRoot, productRef.relativePath);
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
    if (isSensitiveTelemetryKey(attribute) || isSensitiveTelemetrySelector(selector)) {
      attributes[attribute] = "[redacted]";
      continue;
    }
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
  const facets = activeFacetDescriptors(descriptor);
  return {
    facets: facets.map((facet: TelemetryFacetDescriptor) => ({
      id: facet.id,
      label: facet.label || facet.id,
      counts: topAttributeCounts(records, facet.attribute, facet.limit || 12)
    })),
    flows: (descriptor.flows || []).map((flow: TelemetryFlowDescriptor) => summarizeDescriptorFlow(records, flow))
  };
}

function activeFacetDescriptors(descriptor: TelemetryDescriptor): TelemetryFacetDescriptor[] {
  const byId = new Map(defaultFacetDescriptors().map((facet) => [facet.id, facet]));
  for (const facet of descriptor.facets || []) byId.set(facet.id, facet);
  return Array.from(byId.values());
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
      attributes: record.attributes,
      details: flowDetails(record, flow.detailAttributes || {})
    }));
  const uniqueItems = dedupeFlowItems(items);
  return {
    id: flow.id,
    label: flow.label || flow.id,
    total: uniqueItems.length,
    items: uniqueItems.slice(0, flow.limit || 10)
  };
}

function flowDetails(record: TelemetryRecordSummary, detailAttributes: Record<string, string>): Array<{ label: string; value: string }> | undefined {
  const details = Object.entries(detailAttributes).flatMap(([label, attribute]) => {
    if (!label || isSensitiveTelemetryKey(label) || isSensitiveTelemetrySelector(attribute)) return [];
    const value = recordAttribute(record, attribute);
    return value ? [{ label, value }] : [];
  });
  return details.length ? details : undefined;
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

function resolveTelemetryProductRoots(rootDir: string, options: ConsoleHubServerOptions): TelemetryProductRoots {
  const configured = {
    ...parseProductRoots(process.env.CONSOLE_TELEMETRY_PRODUCT_ROOTS),
    ...(options.telemetryProductRoots || {})
  };
  const roots: TelemetryProductRoots = {};
  for (const [productId, productRoot] of Object.entries(configured)) {
    if (isSafeProductId(productId) && productRoot) roots[productId] = resolvePath(rootDir, productRoot);
  }
  if (options.telemetryFlowAgentsRoot && !roots["flow-agents"]) {
    roots["flow-agents"] = path.resolve(resolvePath(rootDir, options.telemetryFlowAgentsRoot), "..");
  }
  return roots;
}

function parseProductRoots(value: string | undefined): TelemetryProductRoots {
  const roots: TelemetryProductRoots = {};
  if (!value) return roots;
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const productId = trimmed.slice(0, separator).trim();
    const productRoot = trimmed.slice(separator + 1).trim();
    if (isSafeProductId(productId) && productRoot) roots[productId] = productRoot;
  }
  return roots;
}

function isSafeProductId(productId: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(productId);
}

function defaultTelemetryProductRoot(productRoots: TelemetryProductRoots): string | undefined {
  return productRoots["flow-agents"] || Object.values(productRoots)[0];
}

function parseProductRootRef(descriptorRoot: string): { productId?: string; relativePath: string } {
  if (!descriptorRoot.startsWith("product:")) return { relativePath: descriptorRoot };
  const withoutScheme = descriptorRoot.slice("product:".length);
  const separator = withoutScheme.indexOf(":");
  if (separator > 0) {
    const productId = withoutScheme.slice(0, separator);
    if (isSafeProductId(productId)) return { productId, relativePath: withoutScheme.slice(separator + 1) || "." };
  }
  return { relativePath: withoutScheme || "." };
}

function loadTelemetryDescriptor(rootDir: string, productRoots: TelemetryProductRoots, descriptorPaths: string[] = []): TelemetryDescriptor {
  const candidates = [
    ...descriptorPaths.map((descriptorPath) => resolveDescriptorPath(rootDir, productRoots, descriptorPath)),
    path.join(rootDir, "console.telemetry.json"),
    ...Object.values(productRoots).flatMap((productRoot) => [
      resolveContainedPath(productRoot, "console.telemetry.json"),
      resolveContainedPath(productRoot, path.join(".kontour", "console.telemetry.json"))
    ])
  ];
  const descriptors = uniqueExistingDescriptorPaths(candidates)
    .filter((candidate: string) => fs.existsSync(candidate))
    .map((candidate: string) => readTelemetryDescriptor(candidate));
  return mergeTelemetryDescriptors(descriptors);
}

function uniqueExistingDescriptorPaths(candidates: string[]): string[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = fs.existsSync(candidate) ? fs.realpathSync(candidate) : path.resolve(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveDescriptorPath(rootDir: string, productRoots: TelemetryProductRoots, descriptorPath: string): string {
  if (descriptorPath.startsWith("console:")) return resolveContainedPath(rootDir, descriptorPath.slice("console:".length));
  if (!descriptorPath.startsWith("product:")) return resolvePath(rootDir, descriptorPath);
  const productRef = parseProductRootRef(descriptorPath);
  const productRoot = productRef.productId
    ? productRoots[productRef.productId]
    : defaultTelemetryProductRoot(productRoots);
  return productRoot ? resolveContainedPath(productRoot, productRef.relativePath) : missingProductRoot(rootDir, productRef.productId);
}

function missingProductRoot(rootDir: string, productId: string | undefined): string {
  const safeId = productId && isSafeProductId(productId) ? productId : "default";
  return path.join(rootDir, ".missing-telemetry-product-root", safeId);
}

function readTelemetryDescriptor(filePath: string): TelemetryDescriptor {
  try {
    if (!isContainedRealPath(path.dirname(filePath), filePath)) return {};
    const parsed = JSON.parse(readDescriptorJsonFile(filePath));
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
  return isOpenRecord(value)
    && typeof value.id === "string"
    && (value.detailAttributes === undefined || isDescriptorStringMap(value.detailAttributes));
}

function isRecordSourceDescriptor(value: unknown): value is TelemetryRecordSourceDescriptor {
  return isOpenRecord(value) && typeof value.id === "string";
}

function isDescriptorStringMap(value: unknown): value is Record<string, string> {
  if (!isOpenRecord(value) || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, selector]) => (
    typeof selector === "string"
    && key.length > 0
    && key.length <= MAX_TELEMETRY_QUERY_FILTER_PART_LENGTH
    && selector.length > 0
    && selector.length <= MAX_TELEMETRY_QUERY_FILTER_PART_LENGTH
  ));
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

function applyTelemetryQuery(records: TelemetryRecordSummary[], query: TelemetryQuery | undefined, range: { from?: string; to?: string }, facets: TelemetryFacetDescriptor[]): TelemetryRecordSummary[] {
  if (!query) return records;
  const search = query.q?.toLowerCase();
  const facetAttributes = new Map(facets.map((facet) => [facet.id, facet.attribute]));
  return records.filter((record) => {
    if (!matchesTimeRange(record, range)) return false;
    if (search && !searchableRecordText(record).some((value) => value.toLowerCase().includes(search))) return false;
    return matchesQueryFilters(record, query.filters, facetAttributes);
  });
}

function matchesTimeRange(record: TelemetryRecordSummary, range: { from?: string; to?: string }): boolean {
  if (!range.from && !range.to) return true;
  const observed = Date.parse(record.observedAt || "");
  if (!Number.isFinite(observed)) return false;
  if (range.from && observed < Date.parse(range.from)) return false;
  if (range.to && observed > Date.parse(range.to)) return false;
  return true;
}

function searchableRecordText(record: TelemetryRecordSummary): string[] {
  return [
    record.eventId,
    record.eventType,
    record.sessionId,
    record.sourceId,
    record.sourceKind,
    record.status,
    record.outcome,
    record.agentName,
    record.runtime,
    record.runtimeVersion,
    record.model,
    record.hookEventName,
    record.runtimeSessionId,
    record.turnId,
    record.project,
    record.cwd,
    record.delegationTarget,
    record.toolName,
    record.taskSlug,
    record.title,
    ...Object.values(record.attributes || {})
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function matchesQueryFilters(record: TelemetryRecordSummary, filters: TelemetryQueryFilter[], facetAttributes: Map<string, string>): boolean {
  const byFacet = filters.reduce((groups: Record<string, Set<string>>, filter) => {
    groups[filter.facetId] ||= new Set<string>();
    groups[filter.facetId].add(filter.value);
    return groups;
  }, {});
  return Object.entries(byFacet).every(([facetId, values]) => {
    const attribute = facetAttributes.get(facetId) || facetId;
    return values.has(recordAttribute(record, attribute) || record.attributes?.[facetId] || "");
  });
}

function effectiveQueryRange(query: TelemetryQuery | undefined): { from?: string; to?: string } {
  if (!query) return {};
  if (query.from || query.to) return { from: query.from, to: query.to };
  const now = Date.now();
  if (query.preset === "live") return { from: new Date(now - LIVE_WINDOW_MS).toISOString() };
  if (query.preset === "15m") return { from: new Date(now - 15 * 60 * 1000).toISOString() };
  if (query.preset === "24h") return { from: new Date(now - 24 * 60 * 60 * 1000).toISOString() };
  if (query.preset === "7d") return { from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() };
  return {};
}

function querySummary(query: TelemetryQuery, range: { from?: string; to?: string }) {
  return {
    preset: query.preset,
    from: range.from,
    to: range.to,
    q: query.q,
    filters: query.filters,
    sort: query.sort
  };
}

function paginationSummary(query: TelemetryQuery, returnedCount: number, totalMatchedCount: number) {
  const nextOffset = query.offset + returnedCount < totalMatchedCount ? query.offset + returnedCount : undefined;
  return {
    limit: query.limit,
    offset: query.offset,
    returnedCount,
    totalMatchedCount,
    nextOffset
  };
}

function sqlTelemetrySelect(query: TelemetryQuery | undefined, dialect: "postgres" | "sqlite"): { text: string; values: unknown[] } {
  const range = effectiveQueryRange(query);
  const where = ["tenant_id = PLACEHOLDER"];
  const values: unknown[] = [];
  if (range.from) {
    values.push(range.from);
    where.push("coalesce(observed_at, received_at) >= PLACEHOLDER");
  }
  if (range.to) {
    values.push(range.to);
    where.push("coalesce(observed_at, received_at) <= PLACEHOLDER");
  }
  values.push(sqlReadLimit(query));
  const order = query?.sort === "asc" ? "asc" : "desc";
  const template = `select event_id, event_type, session_id, observed_at, received_at, payload
         from console_telemetry_events
         where ${where.join(" and ")}
         order by coalesce(observed_at, received_at) ${order}
         limit PLACEHOLDER`;
  let index = 0;
  const text = template.replace(/PLACEHOLDER/g, () => {
    index += 1;
    return dialect === "postgres" ? `$${index}` : "?";
  });
  return { text, values };
}

function sqlReadLimit(query: TelemetryQuery | undefined): number {
  if (!query) return MAX_JSONL_LINES_PER_FILE;
  if (query.q || query.filters.length) return MAX_JSONL_LINES_PER_FILE;
  return Math.min(MAX_JSONL_LINES_PER_FILE, Math.max(query.limit + query.offset, query.limit));
}

function compactStringRecord(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => [key, isSensitiveTelemetryKey(key) ? "[redacted]" : value]));
}

function isSensitiveTelemetryKey(key: string): boolean {
  return /authorization|api[-_]?key|password|secret|token/i.test(key);
}

function isSensitiveTelemetrySelector(selector: string): boolean {
  return selector.split(".").some((segment) => isSensitiveTelemetryKey(segment));
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

export function createOptionalPgClient(databaseUrl: string | undefined): ConsoleSqlClient | undefined {
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

function compareRecordTimeAsc(left: TelemetryRecordSummary, right: TelemetryRecordSummary): number {
  return Date.parse(left.observedAt || "") - Date.parse(right.observedAt || "");
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
