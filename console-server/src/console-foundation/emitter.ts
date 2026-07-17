const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_CONSOLE_RUNTIME_ROOT } = require("./runtime-root");
import type {
  ApiSinkFetch,
  ApiSinkOptions,
  ClassifiedRecord,
  CompositeSinkOptions,
  ConsoleRecord,
  DeliveryOutcome,
  DeliveryResult,
  DeliveryResultFields,
  InMemorySinkOptions,
  KontourEmitterOptions,
  LocalFileSinkOptions,
  Sink
} from "./types";
import { isLivenessRecord } from "./liveness";

const DEFAULT_ROOT = DEFAULT_CONSOLE_RUNTIME_ROOT;
type SinkIdentity = Pick<Sink, "sinkId" | "sinkRole" | "id" | "name">;

export class KontourEmitter {
  sink: Sink;

  constructor(options: KontourEmitterOptions) {
    if (!options.sink || typeof options.sink.deliver !== "function") {
      throw new TypeError("KontourEmitter requires a sink with deliver(record)");
    }
    this.sink = options.sink;
  }

  emit(record: ConsoleRecord): Promise<DeliveryResult> {
    const classified = classifyRecord(record);
    if (classified.validation.some((item) => item.severity === "error")) {
      return Promise.resolve(formatDeliveryResult({
        sinkId: "kontour-emitter",
        sinkRole: "emitter",
        outcome: "failed",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        errorCode: "INVALID_RECORD",
        safeMessage: classified.validation.find((item) => item.severity === "error")!.message
      }));
    }
    return Promise.resolve(this.sink.deliver(record));
  }

  emitEvent(event: ConsoleRecord): Promise<DeliveryResult> {
    return this.emit(event);
  }

  emitProjection(projection: ConsoleRecord): Promise<DeliveryResult> {
    return this.emit(projection);
  }
}

export class LocalFileSink {
  root: string;
  sinkId: string;
  sinkRole: string;

  constructor(options: LocalFileSinkOptions = {}) {
    this.root = path.resolve(options.root || DEFAULT_ROOT);
    this.sinkId = options.sinkId || "local-file";
    this.sinkRole = options.sinkRole || "LocalFileSink";
  }

  deliver(record: ConsoleRecord): DeliveryResult {
    const classified = classifyRecord(record);
    if (classified.validation.some((item) => item.severity === "error")) {
      return formatDeliveryResult({
        sinkId: this.sinkId,
        sinkRole: this.sinkRole,
        outcome: "failed",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        errorCode: "INVALID_RECORD",
        safeMessage: classified.validation.find((item) => item.severity === "error")!.message
      });
    }

    try {
      fs.mkdirSync(this.root, { recursive: true });
      if (fs.lstatSync(this.root).isSymbolicLink()) {
        throw new Error("kontour root must not be a symbolic link");
      }
      const realRoot = fs.realpathSync.native(this.root);
      const destination = classified.recordKind === "event"
        ? this.eventPath(record)
        : this.projectionPath(record);
      ensureContained(this.root, destination);
      ensureSafeDirectory(this.root, realRoot, path.dirname(destination));
      ensureSafeDestination(realRoot, destination);

      if (classified.recordKind === "event") {
        fs.appendFileSync(destination, `${JSON.stringify(record)}\n`, "utf8");
      } else {
        fs.writeFileSync(destination, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      }

      return formatDeliveryResult({
        sinkId: this.sinkId,
        sinkRole: this.sinkRole,
        outcome: "accepted",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        destination: path.relative(this.root, destination)
      });
    } catch (error) {
      return formatDeliveryResult({
        sinkId: this.sinkId,
        sinkRole: this.sinkRole,
        outcome: "failed",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        errorCode: safeErrorCode(error),
        safeMessage: safeErrorMessage(error)
      });
    }
  }

  eventPath(event: ConsoleRecord): string {
    // Liveness records (flow-agents #295) carry no producer/scope envelope — they
    // are a flat actor/subjectId fact, not a `kontour.console.event`. Bucket them
    // into one fixed append-only stream rather than sanitizing an absent
    // producer.id/scope.kind/scope.id (which would throw).
    if (isLivenessRecord(event)) {
      return path.resolve(this.root, "events", "liveness", "liveness.jsonl");
    }
    const producer = sanitizePathToken(event.producer && event.producer.id, "producer.id");
    const scopeKind = sanitizePathToken(event.scope && event.scope.kind, "scope.kind");
    const scopeId = sanitizePathToken(event.scope && event.scope.id, "scope.id");
    return path.resolve(this.root, "events", producer, `${scopeKind}-${scopeId}.jsonl`);
  }

  projectionPath(projection: ConsoleRecord): string {
    const producer = sanitizePathToken(projection.producer && projection.producer.id, "producer.id");
    const scopeKind = sanitizePathToken(projection.scope && projection.scope.kind, "scope.kind");
    const scopeId = sanitizePathToken(projection.scope && projection.scope.id, "scope.id");
    return path.resolve(this.root, "projections", producer, `${scopeKind}-${scopeId}.json`);
  }
}

export class CompositeSink {
  sinks: Sink[];
  sinkId: string;
  sinkRole: string;

  constructor(sinks: Sink[], options: CompositeSinkOptions = {}) {
    if (!Array.isArray(sinks) || sinks.length === 0) {
      throw new TypeError("CompositeSink requires at least one child sink");
    }
    sinks.forEach((sink: Sink, index: number) => {
      if (!sink || typeof sink.deliver !== "function") {
        throw new TypeError(`CompositeSink child ${index} must provide deliver(record)`);
      }
    });
    this.sinks = sinks.slice();
    this.sinkId = options.sinkId || "composite";
    this.sinkRole = options.sinkRole || "CompositeSink";
  }

  async deliver(record: ConsoleRecord): Promise<DeliveryResult> {
    const classified = classifyRecord(record);
    const childResults = await Promise.all(this.sinks.map(async (sink: Sink, index: number) => {
      try {
        return normalizeChildResult(await sink.deliver(record), sink, index, classified);
      } catch (error) {
        return formatDeliveryResult({
          sinkId: sink.sinkId || sink.id || `sink-${index}`,
          sinkRole: sink.sinkRole || sink.name || "sink",
          outcome: "failed",
          recordId: classified.recordId,
          recordKind: classified.recordKind,
          errorCode: safeErrorCode(error),
          safeMessage: safeErrorMessage(error, { exposeKnown: false })
        });
      }
    }));

    return formatDeliveryResult({
      sinkId: this.sinkId,
      sinkRole: this.sinkRole,
      outcome: childResults.some(hasFailedResult) ? "failed" : "accepted",
      status: childResults.some(hasFailedResult) ? "partial" : "accepted",
      recordId: classified.recordId,
      recordKind: classified.recordKind,
      children: childResults
    });
  }
}

export class InMemorySink {
  sinkId: string;
  sinkRole: string;
  records: ConsoleRecord[];
  results: DeliveryResult[];

  constructor(options: InMemorySinkOptions = {}) {
    this.sinkId = options.sinkId || "in-memory";
    this.sinkRole = options.sinkRole || "InMemorySink";
    this.records = [];
    this.results = [];
  }

  deliver(record: ConsoleRecord): DeliveryResult {
    const classified = classifyRecord(record);
    this.records.push(record);
    const result = formatDeliveryResult({
      sinkId: this.sinkId,
      sinkRole: this.sinkRole,
      outcome: "accepted",
      recordId: classified.recordId,
      recordKind: classified.recordKind
    });
    this.results.push(result);
    return result;
  }
}

// Hosted delivery sink: the only network-aware Sink. The flow-bridge and any
// other producer reach the hosted console by composing this into a
// CompositeSink, so local-vs-hosted is configuration, not code. Idempotent via
// a shared sentIds set (re-uses the bridge's event-id dedup); transient (5xx /
// network) failures are retried with linear backoff; auth + tenant travel in
// headers the hub already understands.
export class ApiSink {
  hubUrl: string;
  token: string;
  sinkId: string;
  sinkRole: string;
  tenantId?: string;
  maxAttempts: number;
  retryBackoffMs: number;
  sentIds?: Set<string>;
  private fetchImpl: ApiSinkFetch;
  private sleep: (ms: number) => Promise<void>;

  constructor(hubUrl: string, token: string = "", options: ApiSinkOptions = {}) {
    if (typeof hubUrl !== "string" || !hubUrl) {
      throw new TypeError("ApiSink requires a hubUrl");
    }
    // Token is optional: a hub may run unauthenticated on loopback. When set,
    // it travels as both a Bearer header and x-console-api-token.
    this.hubUrl = hubUrl.replace(/\/$/, "");
    this.token = typeof token === "string" ? token : "";
    this.sinkId = options.sinkId || "api";
    this.sinkRole = options.sinkRole || "ApiSink";
    this.tenantId = options.tenantId;
    this.maxAttempts = Number.isFinite(options.maxAttempts) && (options.maxAttempts as number) > 0
      ? Math.floor(options.maxAttempts as number)
      : 3;
    this.retryBackoffMs = Number.isFinite(options.retryBackoffMs) && (options.retryBackoffMs as number) >= 0
      ? (options.retryBackoffMs as number)
      : 100;
    this.sentIds = options.sentIds;
    const injectedFetch = options.fetch;
    if (injectedFetch) {
      this.fetchImpl = injectedFetch;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = ((input, init) => (globalThis.fetch as Function)(input, init)) as ApiSinkFetch;
    } else {
      throw new TypeError("ApiSink requires a fetch implementation");
    }
    this.sleep = options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
      // Also send the dedicated header so the hub authorizes either way.
      headers["x-console-api-token"] = this.token;
    }
    if (this.tenantId) {
      // Issue sketch names x-console-tenant; the hub reads x-console-tenant-id.
      // Send both so the sink is correct against the current and sketched hub.
      headers["x-console-tenant"] = this.tenantId;
      headers["x-console-tenant-id"] = this.tenantId;
    }
    return headers;
  }

  async deliver(record: ConsoleRecord): Promise<DeliveryResult> {
    const classified = classifyRecord(record);
    if (classified.validation.some((item) => item.severity === "error")) {
      return formatDeliveryResult({
        sinkId: this.sinkId,
        sinkRole: this.sinkRole,
        outcome: "failed",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        errorCode: "INVALID_RECORD",
        safeMessage: classified.validation.find((item) => item.severity === "error")!.message
      });
    }

    // Idempotent: a record already delivered through this sink is skipped, not
    // re-POSTed. The hub also dedups by id, so this is purely to avoid churn.
    if (this.sentIds && this.sentIds.has(classified.recordId)) {
      return formatDeliveryResult({
        sinkId: this.sinkId,
        sinkRole: this.sinkRole,
        outcome: "skipped",
        status: "skipped",
        recordId: classified.recordId,
        recordKind: classified.recordKind
      });
    }

    const body = JSON.stringify(record);
    const url = `${this.hubUrl}/records`;
    let lastErrorCode = "SINK_DELIVERY_FAILED";
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: this.headers(),
          body
        });
        if (response.ok) {
          this.sentIds?.add(classified.recordId);
          return formatDeliveryResult({
            sinkId: this.sinkId,
            sinkRole: this.sinkRole,
            outcome: "accepted",
            recordId: classified.recordId,
            recordKind: classified.recordKind,
            destination: url
          });
        }
        lastStatus = response.status;
        lastErrorCode = `HTTP_${response.status}`;
        // 4xx is not transient — surface immediately without retrying.
        if (response.status < 500) {
          return formatDeliveryResult({
            sinkId: this.sinkId,
            sinkRole: this.sinkRole,
            outcome: "failed",
            recordId: classified.recordId,
            recordKind: classified.recordKind,
            retryable: false,
            errorCode: lastErrorCode,
            safeMessage: `hosted console rejected the record (status ${response.status})`
          });
        }
      } catch {
        // Network / fetch error — transient, retry below.
        lastErrorCode = "SINK_DELIVERY_FAILED";
        lastStatus = undefined;
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(this.retryBackoffMs * attempt);
      }
    }

    return formatDeliveryResult({
      sinkId: this.sinkId,
      sinkRole: this.sinkRole,
      outcome: "failed",
      recordId: classified.recordId,
      recordKind: classified.recordKind,
      retryable: true,
      errorCode: lastErrorCode,
      safeMessage: lastStatus !== undefined
        ? `hosted console delivery failed after ${this.maxAttempts} attempts (status ${lastStatus})`
        : `hosted console delivery failed after ${this.maxAttempts} attempts`
    });
  }
}

export function classifyRecord(record: ConsoleRecord): ClassifiedRecord {
  const { validateEvent, validateProjection } = require("./index");
  const { validateLivenessRecord } = require("./liveness");
  const recordKind = record && record.schema === "kontour.console.projection" ? "projection" : "event";
  // Liveness (flow-agents #295) is a flat claim/heartbeat/release fact, not a
  // `kontour.console.event` envelope — validate it against its own schema so a
  // well-formed liveness record is never rejected (and appended, like any other
  // event, rather than overwritten like a projection snapshot).
  const validation = isLivenessRecord(record)
    ? validateLivenessRecord(record, "record")
    : recordKind === "projection"
      ? validateProjection(record, "record")
      : validateEvent(record, "record");
  return {
    recordKind,
    recordId: recordKind === "projection" ? projectionRecordId(record) : eventRecordId(record),
    validation
  };
}

function eventRecordId(event: ConsoleRecord): string {
  return event && typeof event.id === "string" && event.id ? event.id : "unknown-event";
}

function projectionRecordId(projection: ConsoleRecord): string {
  if (projection && typeof projection.id === "string" && projection.id) return projection.id;
  return [
    projection && projection.schema,
    projection && projection.version,
    projection && projection.producer && projection.producer.product,
    projection && projection.producer && projection.producer.id,
    projection && projection.scope && projection.scope.kind,
    projection && projection.scope && projection.scope.id,
    stableDerivedFromIdentity(projection && projection.derivedFrom)
  ].map((value: unknown) => value || "unknown").join(":");
}

function stableDerivedFromIdentity(derivedFrom: unknown): string {
  if (!derivedFrom || typeof derivedFrom !== "object") return "unknown";
  return stableStringify(stripGeneratedAt(derivedFrom));
}

function stripGeneratedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripGeneratedAt);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().reduce((copy: Record<string, unknown>, key: string) => {
    if (key !== "generatedAt") copy[key] = stripGeneratedAt(record[key]);
    return copy;
  }, {});
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key: string) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function normalizeChildResult(result: unknown, sink: SinkIdentity, index: number, classified: ClassifiedRecord): DeliveryResult {
  if (!result || typeof result !== "object") {
    return formatDeliveryResult({
      sinkId: sink.sinkId || sink.id || `sink-${index}`,
      sinkRole: sink.sinkRole || sink.name || "sink",
      outcome: "accepted",
      recordId: classified.recordId,
      recordKind: classified.recordKind
    });
  }
  const delivery = result as Partial<DeliveryResult>;
  const children = Array.isArray(delivery.children)
    ? delivery.children.map((child: unknown, childIndex: number) => normalizeNestedResult(child, classified, childIndex))
    : undefined;
  const outcome = children && children.some(hasFailedResult)
    ? "failed"
    : normalizeOutcome(delivery.outcome || delivery.status);
  return formatDeliveryResult({
    sinkId: delivery.sinkId || sink.sinkId || sink.id || `sink-${index}`,
    sinkRole: delivery.sinkRole || sink.sinkRole || sink.name || "sink",
    outcome,
    status: children && children.some(hasFailedResult) ? "partial" : delivery.status,
    recordId: delivery.recordId || classified.recordId,
    recordKind: delivery.recordKind || classified.recordKind,
    destination: delivery.destination,
    retryable: delivery.retryable,
    errorCode: delivery.errorCode,
    safeMessage: delivery.safeMessage,
    observedAt: delivery.observedAt,
    children
  });
}

function normalizeNestedResult(result: unknown, classified: ClassifiedRecord, index: number): DeliveryResult {
  return normalizeChildResult(result, { sinkId: `child-${index}`, sinkRole: "nested" }, index, classified);
}

function hasFailedResult(result: DeliveryResult): boolean {
  return result && (
    result.outcome === "failed" ||
    (Array.isArray(result.children) && result.children.some(hasFailedResult))
  );
}

function normalizeOutcome(value: unknown): DeliveryOutcome {
  if (value === "accepted" || value === "skipped" || value === "failed") return value;
  return "failed";
}

export function formatDeliveryResult(fields: DeliveryResultFields): DeliveryResult {
  const result: DeliveryResult = {
    sinkId: fields.sinkId,
    sinkRole: fields.sinkRole,
    outcome: fields.outcome,
    status: fields.status || fields.outcome,
    recordId: fields.recordId,
    recordKind: fields.recordKind,
    observedAt: fields.observedAt || new Date().toISOString()
  };
  if (fields.destination) result.destination = fields.destination;
  if (fields.retryable !== undefined) result.retryable = fields.retryable;
  if (fields.errorCode) result.errorCode = fields.errorCode;
  if (fields.safeMessage) result.safeMessage = fields.safeMessage;
  if (fields.children) result.children = fields.children;
  return result;
}

function sanitizePathToken(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty path token`);
  }
  // Still reject genuine traversal / unsafe inputs outright — an absolute path,
  // any ".." segment, or a control char is never a legitimate id and must not
  // reach the filesystem in any form. Path separators, by contrast, are encoded
  // below rather than rejected.
  if (path.isAbsolute(value) || value.includes("..") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a repo-relative safe path token`);
  }
  // Percent-encode the path separators (and "%" itself, so the mapping stays
  // reversible and injective — distinct ids never collide on one file). This
  // lets a hierarchical id like a repo scope's "owner/repo" survive as a single
  // safe filename token instead of being rejected (#188): the record keeps its
  // natural id, only the derived filename is encoded. The result contains no
  // separator and no "..", so the path stays inside the events/projections dir —
  // and ensureContained/ensureSafeDestination re-verify that regardless.
  return value.replace(/[%\\/]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

function ensureContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("destination must stay inside the configured kontour root");
  }
}

function ensureSafeDestination(realRoot: string, target: string): void {
  const realParent = fs.realpathSync.native(path.dirname(target));
  const parentRelative = path.relative(realRoot, realParent);
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
    throw new Error("destination parent must stay inside the configured kontour root");
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error("destination must not be a symbolic link");
  }
}

function ensureSafeDirectory(root: string, realRoot: string, targetDir: string): void {
  ensureContained(root, targetDir);
  const relative = path.relative(root, targetDir);
  let current = root;

  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, segment);
    if (fs.existsSync(next)) {
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink()) {
        throw new Error("destination directory must not contain symbolic links");
      }
      if (!stat.isDirectory()) {
        throw new Error("destination directory path must contain only directories");
      }
      const realNext = fs.realpathSync.native(next);
      const nextRelative = path.relative(realRoot, realNext);
      if (nextRelative.startsWith("..") || path.isAbsolute(nextRelative)) {
        throw new Error("destination directory must stay inside the configured kontour root");
      }
    } else {
      fs.mkdirSync(next);
    }
    current = next;
  }
}

function safeErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "SINK_DELIVERY_FAILED";
}

function safeErrorMessage(error: unknown, options: { exposeKnown?: boolean } = {}): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "sink delivery failed";
  const message = String(error.message).split(/\r?\n/)[0];
  if (options.exposeKnown === false) return "sink delivery failed";
  if (
    message.includes("path token") ||
    message.includes("configured kontour root") ||
    message.includes("symbolic link") ||
    message.includes("symbolic links") ||
    message.includes("only directories")
  ) {
    return message.slice(0, 160);
  }
  return "sink delivery failed";
}

// The producer helpers above are named exports (`export class` / `export
// function`) rather than a trailing `module.exports = {...}` so the compiled
// emitter.d.ts emits real declarations instead of an empty `export {}` — the
// docs position these sinks as THE producer integration surface, so consumers
// (and the console-foundation index re-export) need their types (#71).
