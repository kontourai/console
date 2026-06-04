// @ts-nocheck
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = ".kontour";

class KontourEmitter {
  constructor(options = {}) {
    if (!options.sink || typeof options.sink.deliver !== "function") {
      throw new TypeError("KontourEmitter requires a sink with deliver(record)");
    }
    this.sink = options.sink;
  }

  emit(record) {
    const classified = classifyRecord(record);
    if (classified.validation.some((item) => item.severity === "error")) {
      return Promise.resolve(formatDeliveryResult({
        sinkId: "kontour-emitter",
        sinkRole: "emitter",
        outcome: "failed",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        errorCode: "INVALID_RECORD",
        safeMessage: classified.validation.find((item) => item.severity === "error").message
      }));
    }
    return Promise.resolve(this.sink.deliver(record));
  }

  emitEvent(event) {
    return this.emit(event);
  }

  emitProjection(projection) {
    return this.emit(projection);
  }
}

class LocalFileSink {
  constructor(options = {}) {
    this.root = path.resolve(options.root || DEFAULT_ROOT);
    this.sinkId = options.sinkId || "local-file";
    this.sinkRole = options.sinkRole || "LocalFileSink";
  }

  deliver(record) {
    const classified = classifyRecord(record);
    if (classified.validation.some((item) => item.severity === "error")) {
      return formatDeliveryResult({
        sinkId: this.sinkId,
        sinkRole: this.sinkRole,
        outcome: "failed",
        recordId: classified.recordId,
        recordKind: classified.recordKind,
        errorCode: "INVALID_RECORD",
        safeMessage: classified.validation.find((item) => item.severity === "error").message
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

  eventPath(event) {
    const producer = sanitizePathToken(event.producer && event.producer.id, "producer.id");
    const scopeKind = sanitizePathToken(event.scope && event.scope.kind, "scope.kind");
    const scopeId = sanitizePathToken(event.scope && event.scope.id, "scope.id");
    return path.resolve(this.root, "events", producer, `${scopeKind}-${scopeId}.jsonl`);
  }

  projectionPath(projection) {
    const producer = sanitizePathToken(projection.producer && projection.producer.id, "producer.id");
    const scopeKind = sanitizePathToken(projection.scope && projection.scope.kind, "scope.kind");
    const scopeId = sanitizePathToken(projection.scope && projection.scope.id, "scope.id");
    return path.resolve(this.root, "projections", producer, `${scopeKind}-${scopeId}.json`);
  }
}

class CompositeSink {
  constructor(sinks, options = {}) {
    if (!Array.isArray(sinks) || sinks.length === 0) {
      throw new TypeError("CompositeSink requires at least one child sink");
    }
    sinks.forEach((sink, index) => {
      if (!sink || typeof sink.deliver !== "function") {
        throw new TypeError(`CompositeSink child ${index} must provide deliver(record)`);
      }
    });
    this.sinks = sinks.slice();
    this.sinkId = options.sinkId || "composite";
    this.sinkRole = options.sinkRole || "CompositeSink";
  }

  async deliver(record) {
    const classified = classifyRecord(record);
    const childResults = await Promise.all(this.sinks.map(async (sink, index) => {
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

class InMemorySink {
  constructor(options = {}) {
    this.sinkId = options.sinkId || "in-memory";
    this.sinkRole = options.sinkRole || "InMemorySink";
    this.records = [];
    this.results = [];
  }

  deliver(record) {
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

function classifyRecord(record) {
  const { validateEvent, validateProjection } = require("./index");
  const recordKind = record && record.schema === "kontour.console.projection" ? "projection" : "event";
  const validation = recordKind === "projection"
    ? validateProjection(record, "record")
    : validateEvent(record, "record");
  return {
    recordKind,
    recordId: recordKind === "projection" ? projectionRecordId(record) : eventRecordId(record),
    validation
  };
}

function eventRecordId(event) {
  return event && typeof event.id === "string" && event.id ? event.id : "unknown-event";
}

function projectionRecordId(projection) {
  if (projection && typeof projection.id === "string" && projection.id) return projection.id;
  return [
    projection && projection.schema,
    projection && projection.version,
    projection && projection.producer && projection.producer.product,
    projection && projection.producer && projection.producer.id,
    projection && projection.scope && projection.scope.kind,
    projection && projection.scope && projection.scope.id,
    stableDerivedFromIdentity(projection && projection.derivedFrom)
  ].map((value) => value || "unknown").join(":");
}

function stableDerivedFromIdentity(derivedFrom) {
  if (!derivedFrom || typeof derivedFrom !== "object") return "unknown";
  return stableStringify(stripGeneratedAt(derivedFrom));
}

function stripGeneratedAt(value) {
  if (Array.isArray(value)) return value.map(stripGeneratedAt);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((copy, key) => {
    if (key !== "generatedAt") copy[key] = stripGeneratedAt(value[key]);
    return copy;
  }, {});
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function normalizeChildResult(result, sink, index, classified) {
  if (!result || typeof result !== "object") {
    return formatDeliveryResult({
      sinkId: sink.sinkId || sink.id || `sink-${index}`,
      sinkRole: sink.sinkRole || sink.name || "sink",
      outcome: "accepted",
      recordId: classified.recordId,
      recordKind: classified.recordKind
    });
  }
  const children = Array.isArray(result.children)
    ? result.children.map((child, childIndex) => normalizeNestedResult(child, classified, childIndex))
    : undefined;
  const outcome = children && children.some(hasFailedResult)
    ? "failed"
    : normalizeOutcome(result.outcome || result.status);
  return formatDeliveryResult({
    sinkId: result.sinkId || sink.sinkId || sink.id || `sink-${index}`,
    sinkRole: result.sinkRole || sink.sinkRole || sink.name || "sink",
    outcome,
    status: children && children.some(hasFailedResult) ? "partial" : result.status,
    recordId: result.recordId || classified.recordId,
    recordKind: result.recordKind || classified.recordKind,
    destination: result.destination,
    retryable: result.retryable,
    errorCode: result.errorCode,
    safeMessage: result.safeMessage,
    observedAt: result.observedAt,
    children
  });
}

function normalizeNestedResult(result, classified, index) {
  return normalizeChildResult(result, { sinkId: `child-${index}`, sinkRole: "nested" }, index, classified);
}

function hasFailedResult(result) {
  return result && (
    result.outcome === "failed" ||
    (Array.isArray(result.children) && result.children.some(hasFailedResult))
  );
}

function normalizeOutcome(value) {
  if (value === "accepted" || value === "skipped" || value === "failed") return value;
  return "failed";
}

function formatDeliveryResult(fields) {
  const result = {
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

function sanitizePathToken(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty path token`);
  }
  if (path.isAbsolute(value) || value.includes("..") || /[\\/]/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a repo-relative safe path token`);
  }
  return value;
}

function ensureContained(root, target) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("destination must stay inside the configured kontour root");
  }
}

function ensureSafeDestination(realRoot, target) {
  const realParent = fs.realpathSync.native(path.dirname(target));
  const parentRelative = path.relative(realRoot, realParent);
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
    throw new Error("destination parent must stay inside the configured kontour root");
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error("destination must not be a symbolic link");
  }
}

function ensureSafeDirectory(root, realRoot, targetDir) {
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

function safeErrorCode(error) {
  return error && error.code ? String(error.code) : "SINK_DELIVERY_FAILED";
}

function safeErrorMessage(error, options = {}) {
  if (!error || !error.message) return "sink delivery failed";
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

module.exports = {
  KontourEmitter,
  LocalFileSink,
  CompositeSink,
  InMemorySink,
  classifyRecord,
  formatDeliveryResult
};
