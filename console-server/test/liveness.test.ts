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
  parseCanonicalLivenessAt,
  livenessOrderTuple,
  LIVENESS_SCHEMA,
  MAX_LIVENESS_TTL_SECONDS
} = require("../src/console-foundation");

test("parseCanonicalLivenessAt accepts UTC Z timestamps with optional 1-9 digit fractions", () => {
  for (const [accepted, expected] of [
    ["2026-07-10T05:33:49Z", Date.UTC(2026, 6, 10, 5, 33, 49)],
    ["2026-07-10T05:33:49.1Z", Date.UTC(2026, 6, 10, 5, 33, 49, 100)],
    ["2026-07-10T05:33:49.123Z", Date.UTC(2026, 6, 10, 5, 33, 49, 123)],
    ["2026-07-10T05:33:49.123456789Z", Date.UTC(2026, 6, 10, 5, 33, 49, 123)],
    ["2026-07-10T05:33:49.123999999Z", Date.UTC(2026, 6, 10, 5, 33, 49, 123)],
    ["2026-07-10T05:33:49.999999999Z", Date.UTC(2026, 6, 10, 5, 33, 49, 999)]
  ] as const) {
    assert.equal(parseCanonicalLivenessAt(accepted), expected, accepted);
    assert.equal(validateLivenessRecord(validRecord({ at: accepted }), "record").length, 0, accepted);
  }
  for (const rejected of [
    "infinity",
    "-infinity",
    "now",
    "2026-07-07T04:00:00.123-06:00",
    "2026-07-07T10:00:00+02:00",
    "2026-07-07T10:00:00.1234567890Z",
    "2026-07-07T10:00:00.123z",
    "2026-07-07T24:00:00.000Z",
    "0000-01-01T00:00:00Z",
    "2026-02-30T10:00:00.000Z"
  ]) {
    assert.equal(parseCanonicalLivenessAt(rejected), undefined, rejected);
    assert.ok(validateLivenessRecord(validRecord({ at: rejected }), "record").some((issue: any) => issue.path === "record.at"));
  }
});

test("livenessOrderTuple models exact nullable migration watermarks and release rank", () => {
  const canonical = "2026-07-07T10:00:00.123Z";
  assert.deepEqual(livenessOrderTuple(canonical, "heartbeat"), { atMs: Date.parse(canonical), rank: 0 });
  assert.deepEqual(livenessOrderTuple(canonical, "release"), { atMs: Date.parse(canonical), rank: 1 });
  for (const rejected of [
    "infinity", "-infinity", "now",
    "2026-07-07T04:00:00.123-06:00",
    "2026-07-07T10:00:00+02:00",
    "2026-07-07T10:00:00.1234567890Z",
    "2026-07-07T24:00:00.000Z"
  ]) {
    assert.equal(livenessOrderTuple(rejected, "release"), undefined, rejected);
  }
});

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
  assert.ok(flags(validateLivenessRecord(validRecord({ ttlSeconds: 0 }), "record"), "record.ttlSeconds"));
  assert.ok(flags(validateLivenessRecord(validRecord({ ttlSeconds: Number.POSITIVE_INFINITY }), "record"), "record.ttlSeconds"));
  assert.ok(flags(validateLivenessRecord(validRecord({ ttlSeconds: MAX_LIVENESS_TTL_SECONDS + 1 }), "record"), "record.ttlSeconds"));
  assert.ok(flags(validateLivenessRecord(validRecord({ at: "not-a-timestamp" }), "record"), "record.at"));
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

test("validateLivenessRecordBody overrides an explicit id to preserve one-row session collapse", () => {
  // console #139: the collapse guarantee must not depend on caller cooperation.
  const normalized = validateLivenessRecordBody(validRecord({ id: "explicit-id-1" }));
  assert.equal(normalized.id, "liveness:actor-1:task-alpha");
});
