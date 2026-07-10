import type { ConsoleLivenessRecord, LivenessEventType, ValidationIssue, ValidationSeverity } from "./types";

/**
 * `kontour.console.liveness` — a best-effort mirror of one local claim/heartbeat/
 * release liveness event (flow-agents #295, scripts/liveness/relay.sh), folded
 * into the OperatingState projection's `actors[]` (console #125) so hosted
 * Operate/Overview panels can show who is currently active.
 *
 * This schema is validated and normalized here (shared by the API ingest
 * boundary in console-hub-server.ts, the local-file classifier in emitter.ts,
 * and the replay-time inspector in index.ts) so the three call sites can never
 * disagree on what counts as a well-formed liveness record.
 */
export const LIVENESS_SCHEMA = "kontour.console.liveness" as const;
export const LIVENESS_EVENT_TYPES: LivenessEventType[] = ["claim", "heartbeat", "release"];

/**
 * Default liveness TTL, in seconds (30 minutes) — mirrors flow-agents'
 * DEFAULT_TTL_SECONDS (scripts/hooks/lib/liveness-policy.js). Used at read time to
 * expire an actor whose last-seen liveness event is older than its TTL, so an
 * actor that sends `claim` then crashes/drops the network before `release` stops
 * being reported as active instead of lingering as a zombie forever.
 */
export const DEFAULT_LIVENESS_TTL_SECONDS = 1800;
/** Finite safety horizon for accepted liveness records and release watermarks. */
export const MAX_LIVENESS_TTL_SECONDS = 86400;
const CANONICAL_LIVENESS_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/** Fleet-compatible UTC-Z timestamp domain shared by validation and ordering. */
export function parseCanonicalLivenessAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = CANONICAL_LIVENESS_AT_PATTERN.exec(value);
  if (!match || match[1] === "0000") return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || !Number.isInteger(milliseconds)) return undefined;

  // Date.parse normalizes some invalid calendar/time fields (for example,
  // February 30 or 24:00). Compare parsed UTC components, but deliberately do
  // not require an exact string round trip: seconds precision and 1-9 digit
  // fractions are valid fleet inputs and normalize to JavaScript epoch-ms.
  const parsed = new Date(milliseconds);
  const expectedMilliseconds = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  if (parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3])
    || parsed.getUTCHours() !== Number(match[4])
    || parsed.getUTCMinutes() !== Number(match[5])
    || parsed.getUTCSeconds() !== Number(match[6])
    || parsed.getUTCMilliseconds() !== expectedMilliseconds) return undefined;
  return milliseconds;
}

/**
 * Stable, collision-safe identity for one liveness session — the (actor,
 * subjectId) pair. Both the persisted record id (`liveness:<key>`) and the
 * in-memory actors-map key derive from THIS single helper so they can never
 * drift apart. Each component is `encodeURIComponent`-escaped before joining so
 * a `subjectId` (or `actor`) that itself contains a `:` — e.g. a branch/task
 * path token — can never collide two distinct pairs onto one row / one map slot.
 */
export function livenessSessionKey(actor: string, subjectId: string): string {
  return `${encodeURIComponent(actor)}:${encodeURIComponent(subjectId)}`;
}

/** The persisted/synthesized record id for a liveness session (one row per pair). */
export function livenessRecordId(actor: string, subjectId: string): string {
  return `liveness:${livenessSessionKey(actor, subjectId)}`;
}

/** Canonical equal-time precedence: release owns a session over active events. */
export function livenessEventRank(type: unknown): number {
  return type === "release" ? 1 : 0;
}

export function livenessOrderTuple(at: unknown, type: unknown): { atMs: number; rank: number } | undefined {
  const atMs = parseCanonicalLivenessAt(at);
  return atMs === undefined ? undefined : { atMs, rank: livenessEventRank(type) };
}

/** Compare liveness ownership tuples `(parseable at, event rank)`. */
export function compareLivenessOrder(
  incomingAtMs: number | undefined,
  incomingType: unknown,
  existingAtMs: number | undefined,
  existingType: unknown
): number {
  if (incomingAtMs === undefined || existingAtMs === undefined) {
    if (incomingAtMs === existingAtMs) return 0;
    return incomingAtMs === undefined ? -1 : 1;
  }
  if (incomingAtMs !== existingAtMs) return incomingAtMs > existingAtMs ? 1 : -1;
  return Math.sign(livenessEventRank(incomingType) - livenessEventRank(existingType));
}

export function isLivenessRecord(record: { schema?: unknown } | null | undefined): record is ConsoleLivenessRecord {
  return Boolean(record) && (record as { schema?: unknown }).schema === LIVENESS_SCHEMA;
}

export function validateLivenessRecord(body: unknown, basePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    issues.push(issue("error", basePath, "liveness record must be a JSON object"));
    return issues;
  }
  const record = body as Record<string, unknown>;
  if (record.schema !== LIVENESS_SCHEMA) {
    issues.push(issue("error", `${basePath}.schema`, `expected ${LIVENESS_SCHEMA}`));
  }
  if (typeof record.version !== "string" || !record.version) {
    issues.push(issue("error", `${basePath}.version`, "version is required and must be a non-empty string"));
  }
  if (typeof record.subjectId !== "string" || !record.subjectId) {
    issues.push(issue("error", `${basePath}.subjectId`, "subjectId is required and must be a non-empty string"));
  }
  if (typeof record.actor !== "string" || !record.actor) {
    issues.push(issue("error", `${basePath}.actor`, "actor is required and must be a non-empty string"));
  }
  if (parseCanonicalLivenessAt(record.at) === undefined) {
    issues.push(issue("error", `${basePath}.at`, "at is required and must be an ISO-8601 UTC Z timestamp with optional 1-9 digit fractional seconds"));
  }
  const type = record.type === undefined ? "claim" : record.type;
  if (typeof type !== "string" || !LIVENESS_EVENT_TYPES.includes(type as LivenessEventType)) {
    issues.push(issue("error", `${basePath}.type`, `type must be one of ${LIVENESS_EVENT_TYPES.join(", ")} when present`));
  }
  if (record.ttlSeconds !== undefined && record.ttlSeconds !== null
    && (typeof record.ttlSeconds !== "number" || !Number.isFinite(record.ttlSeconds)
      || record.ttlSeconds <= 0 || record.ttlSeconds > MAX_LIVENESS_TTL_SECONDS)) {
    issues.push(issue("error", `${basePath}.ttlSeconds`, `ttlSeconds must be finite, positive, and at most ${MAX_LIVENESS_TTL_SECONDS} when present`));
  }
  return issues;
}

/**
 * Normalize a validated liveness record body into the wire shape, always
 * replacing `id` with the session identity.
 *
 * Liveness is CURRENT STATE, not an event log: the synthesized id is
 * `liveness:<actor>:<subjectId>` — it deliberately omits `type` and `at` so that
 * claim → heartbeat → release for one session all map to the SAME id and
 * upsert-in-place under the core-records (tenant_id, record_id) primary key. A
 * tenant therefore holds exactly one row per (actor, subjectId) reflecting its
 * latest state, instead of an unbounded row per heartbeat (which would also make
 * PostgresConsoleHub cold-start replay slower with uptime).
 */
export function normalizeLivenessRecord(body: Record<string, unknown>): ConsoleLivenessRecord {
  const type = (typeof body.type === "string" ? body.type : "claim") as LivenessEventType;
  const actor = String(body.actor);
  const subjectId = String(body.subjectId);
  const at = String(body.at);
  // console #139: collapse must not depend on caller cooperation. Honouring a
  // caller id would let each heartbeat create a new persisted row.
  const id = livenessRecordId(actor, subjectId);
  return {
    ...body,
    schema: LIVENESS_SCHEMA,
    version: typeof body.version === "string" && body.version ? body.version : "0.1",
    id,
    type,
    subjectId,
    actor,
    at
  } as ConsoleLivenessRecord;
}

function issue(severity: ValidationSeverity, path: string, message: string): ValidationIssue {
  return { severity, path, message };
}
