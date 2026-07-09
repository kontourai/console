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
  if (typeof record.at !== "string" || !record.at) {
    issues.push(issue("error", `${basePath}.at`, "at is required and must be an ISO timestamp string"));
  }
  const type = record.type === undefined ? "claim" : record.type;
  if (typeof type !== "string" || !LIVENESS_EVENT_TYPES.includes(type as LivenessEventType)) {
    issues.push(issue("error", `${basePath}.type`, `type must be one of ${LIVENESS_EVENT_TYPES.join(", ")} when present`));
  }
  if (record.ttlSeconds !== undefined && record.ttlSeconds !== null && typeof record.ttlSeconds !== "number") {
    issues.push(issue("error", `${basePath}.ttlSeconds`, "ttlSeconds must be a number when present"));
  }
  return issues;
}

/**
 * Normalize a validated liveness record body into the wire shape, synthesizing
 * `id` when the emitter omits one (relay.sh never sets `id`).
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
  const id = typeof body.id === "string" && body.id ? body.id : livenessRecordId(actor, subjectId);
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
