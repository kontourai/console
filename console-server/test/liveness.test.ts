// Liveness validation + normalization tests (flow-agents #295, console #125).
//
// `kontour.console.liveness` is a flat claim/heartbeat/release fact about one
// (actor, subjectId) pair (scripts/liveness/relay.sh) — no subject/payload/
// producer envelope. These tests pin the schema boundary (validateLivenessRecord)
// and the id-synthesis contract (normalizeLivenessRecord) directly, independent
// of the HTTP layer (covered separately in console-hub-server.test.ts) and the
// projection fold (covered in current-operating-state-projection.test.ts).

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isLivenessRecord,
  validateLivenessRecord,
  validateLivenessRecordBody,
  livenessRecordId,
  livenessSessionKey,
  LIVENESS_SCHEMA
} = require("../src/console-foundation");

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema: LIVENESS_SCHEMA,
    version: "0.1",
    type: "claim",
    subjectId: "task-alpha",
    actor: "actor-1",
    at: "2026-07-07T10:00:00.000Z",
    ttlSeconds: 900,
    ...overrides
  };
}

test("isLivenessRecord matches only the kontour.console.liveness schema", () => {
  assert.equal(isLivenessRecord(validRecord()), true);
  assert.equal(isLivenessRecord({ schema: "kontour.console.event" }), false);
  assert.equal(isLivenessRecord(null), false);
  assert.equal(isLivenessRecord(undefined), false);
});

test("validateLivenessRecord accepts a well-formed claim/heartbeat/release record", () => {
  assert.equal(validateLivenessRecord(validRecord({ type: "claim" }), "record").length, 0);
  assert.equal(validateLivenessRecord(validRecord({ type: "heartbeat" }), "record").length, 0);
  assert.equal(validateLivenessRecord(validRecord({ type: "release" }), "record").length, 0);
});

test("validateLivenessRecord defaults type to claim when omitted (matches relay.sh's jq default)", () => {
  const { type, ...withoutType } = validRecord();
  assert.equal(validateLivenessRecord(withoutType, "record").length, 0);
});

test("validateLivenessRecord rejects missing subjectId, actor, at, or a bad type/ttlSeconds", () => {
  const flags = (issues: any[], path: string) => issues.some((i) => i.path === path && i.severity === "error");

  const { subjectId, ...noSubject } = validRecord();
  assert.ok(flags(validateLivenessRecord(noSubject, "record"), "record.subjectId"));

  const { actor, ...noActor } = validRecord();
  assert.ok(flags(validateLivenessRecord(noActor, "record"), "record.actor"));

  const { at, ...noAt } = validRecord();
  assert.ok(flags(validateLivenessRecord(noAt, "record"), "record.at"));

  assert.ok(flags(validateLivenessRecord(validRecord({ type: "bogus" }), "record"), "record.type"));
  assert.ok(flags(validateLivenessRecord(validRecord({ ttlSeconds: "900" }), "record"), "record.ttlSeconds"));
  assert.ok(flags(validateLivenessRecord({ schema: "kontour.console.event" }, "record"), "record.schema"));
});

test("validateLivenessRecordBody throws INVALID_RECORD with the diagnostic validation array on a bad body", () => {
  assert.throws(() => validateLivenessRecordBody(validRecord({ subjectId: "" })), (err: any) => {
    assert.equal(err.code, "INVALID_RECORD");
    assert.equal(err.statusCode, 400);
    assert.ok(err.validation.some((i: any) => i.path === "record.subjectId"));
    return true;
  });
});

test("validateLivenessRecordBody collapses claim/heartbeat/release for one session onto ONE id", () => {
  // Liveness is current-state, not an event log: the id omits type AND at, so all
  // three lifecycle events for one (actor, subjectId) share the SAME id and
  // upsert-in-place under the core-records (tenant_id, record_id) primary key —
  // exactly one Postgres row per session, no unbounded per-heartbeat growth.
  const claim = validateLivenessRecordBody(validRecord({ type: "claim" }));
  assert.equal(claim.id, "liveness:actor-1:task-alpha");
  assert.equal(claim.id, livenessRecordId("actor-1", "task-alpha"));

  const heartbeat = validateLivenessRecordBody(validRecord({ type: "heartbeat", at: "2026-07-07T10:05:00.000Z" }));
  const release = validateLivenessRecordBody(validRecord({ type: "release", at: "2026-07-07T10:10:00.000Z" }));
  assert.equal(heartbeat.id, claim.id);
  assert.equal(release.id, claim.id);
});

test("livenessRecordId / livenessSessionKey encode components so a colon in subjectId cannot collide two pairs", () => {
  // Without encoding, ("a", "b:c") and ("a:b", "c") would both naively join to
  // "a:b:c" and collide onto one row/one map slot. encodeURIComponent prevents that.
  const a = livenessRecordId("a", "b:c");
  const b = livenessRecordId("a:b", "c");
  assert.notEqual(a, b);
  assert.equal(a, "liveness:a:b%3Ac");
  assert.equal(b, "liveness:a%3Ab:c");
  // The session key (in-memory map key) uses the same encoding, so it agrees.
  assert.notEqual(livenessSessionKey("a", "b:c"), livenessSessionKey("a:b", "c"));
});

test("validateLivenessRecordBody preserves an explicit id when the caller provides one", () => {
  const normalized = validateLivenessRecordBody(validRecord({ id: "explicit-id-1" }));
  assert.equal(normalized.id, "explicit-id-1");
});
