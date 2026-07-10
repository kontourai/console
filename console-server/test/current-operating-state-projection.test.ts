const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCurrentOperatingState,
  createOperatingStateProjection,
  inspectFixtures,
  validateLivenessRecord,
  validateLivenessRecordBody
} = require("../src/console-foundation");

const rootDir = process.env.KONTOUR_REPO_ROOT || process.cwd();

// The hosted Postgres hub folds events into an incremental projection (in sequence
// order) instead of re-running buildCurrentOperatingState over the full retained
// history on every /state read (ops#34). These tests pin the parity contract: for
// sequence-ordered events the incremental path must produce a byte-identical
// OperatingState to the batch path — including dedup, counters, and the empty case.

function sequenceOrdered(events: any[]): any[] {
  return [...events].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
}

function foldIncrementally(events: any[], options?: any) {
  const projection = createOperatingStateProjection("inline-events", options);
  for (const event of events) projection.apply(event);
  return projection.materialize(options);
}

function handoffEvents(): any[] {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item: any) =>
    item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  assert.ok(stream, "surface-flow-handoff fixture stream is present");
  const events = sequenceOrdered(stream.events);
  // Guard the contract's precondition: strictly ascending unique sequences.
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i].sequence > events[i - 1].sequence, "fixture events are sequence-ordered");
  }
  return events;
}

test("incremental projection equals buildCurrentOperatingState over real fixture events", () => {
  const events = handoffEvents();
  const options = { generatedAt: "2026-06-03T10:01:45Z" };
  assert.deepEqual(foldIncrementally(events, options), buildCurrentOperatingState(events, options));
});

test("incremental projection equals batch with no options (generatedAt derived)", () => {
  const events = handoffEvents();
  assert.deepEqual(foldIncrementally(events), buildCurrentOperatingState(events));
});

test("incremental projection dedups a replayed event id exactly like the batch path", () => {
  const events = handoffEvents();
  const withDuplicate = [...events, events[events.length - 1]]; // replay the last event

  const batch = buildCurrentOperatingState(withDuplicate);
  const incremental = foldIncrementally(withDuplicate);

  assert.equal(incremental.source.duplicateEventCount, batch.source.duplicateEventCount);
  assert.ok(incremental.source.duplicateEventCount >= 1, "the replayed event is counted as a duplicate");
  assert.equal(incremental.source.acceptedEventCount, batch.source.acceptedEventCount);
  assert.deepEqual(incremental, batch);
});

test("empty projection equals buildCurrentOperatingState([])", () => {
  assert.deepEqual(createOperatingStateProjection().materialize(), buildCurrentOperatingState([]));
});

// flow-agents #295 — liveness claim/heartbeat/release folds into `actors[]`,
// the currently-active (actor, subjectId) holders. Unlike `kontour.console.event`,
// a liveness record has no subject/payload/producer envelope (see relay.sh).

function livenessRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema: "kontour.console.liveness",
    version: "0.1",
    type: "claim",
    subjectId: "task-alpha",
    actor: "actor-1",
    at: "2026-07-07T10:00:00.000Z",
    ttlSeconds: 900,
    ...overrides
  };
}

// Read-time TTL expiry means materialize() consults a clock. Every liveness test
// injects a FIXED `now` so results never depend on wall-clock time. WITHIN_TTL is
// 5 min after the fixture's `at` (10:00) with a 900s (15 min) TTL — still active.
const WITHIN_TTL = { now: "2026-07-07T10:05:00.000Z" };

test("a liveness claim makes an actor appear active in the projection", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord());
  const state = projection.materialize(WITHIN_TTL);

  assert.equal(state.actors!.length, 1);
  const actor = state.actors![0] as Record<string, unknown>;
  assert.equal(actor.actor, "actor-1");
  assert.equal(actor.subjectId, "task-alpha");
  assert.equal(actor.status, "active");
  assert.equal(actor.lastSeenAt, "2026-07-07T10:00:00.000Z");
  assert.equal(actor.ttlSeconds, 900);
});

test("a liveness heartbeat refreshes lastSeenAt and keeps the actor active", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord());
  projection.apply(livenessRecord({ type: "heartbeat", at: "2026-07-07T10:05:00.000Z" }));
  const state = projection.materialize(WITHIN_TTL);

  assert.equal(state.actors!.length, 1);
  const actor = state.actors![0] as Record<string, unknown>;
  assert.equal(actor.lastSeenAt, "2026-07-07T10:05:00.000Z");
  // A heartbeat need not repeat the claim's TTL — it carries forward.
  assert.equal(actor.ttlSeconds, 900);
});

test("a liveness release removes the actor from the projection", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord());
  assert.equal(projection.materialize(WITHIN_TTL).actors!.length, 1);

  projection.apply(livenessRecord({ type: "release", at: "2026-07-07T10:10:00.000Z" }));
  const state = projection.materialize(WITHIN_TTL);

  assert.equal(state.actors!.length, 0);
});

test("a liveness actor expires at read time once now passes lastSeenAt + ttlSeconds (zombie guard)", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord()); // claim at 10:00, ttl 900s → active until 10:15

  // Same folded state, two clocks: active within TTL, expired past it — no
  // release was ever sent (the crashed/dropped-session case).
  assert.equal(projection.materialize({ now: "2026-07-07T10:14:00.000Z" }).actors!.length, 1);
  assert.equal(projection.materialize({ now: "2026-07-07T10:16:00.000Z" }).actors!.length, 0);
});

test("a liveness actor with no ttlSeconds expires against the default TTL (30 min)", () => {
  const projection = createOperatingStateProjection();
  const { ttlSeconds, ...noTtl } = livenessRecord();
  projection.apply(noTtl); // claim at 10:00, no ttl → default 1800s → active until 10:30

  assert.equal(projection.materialize({ now: "2026-07-07T10:29:00.000Z" }).actors!.length, 1);
  assert.equal(projection.materialize({ now: "2026-07-07T10:31:00.000Z" }).actors!.length, 0);
});

test("a liveness actor with an unparseable lastSeenAt expires fail-closed without read-time mutation", () => {
  const projection = createOperatingStateProjection("inline-events", WITHIN_TTL);
  projection.apply(livenessRecord({ at: "not-a-timestamp" }));

  assert.equal(projection.materialize(WITHIN_TTL).actors!.length, 0);
  // A second read produces the same result; materialization only derives
  // activeness and does not rewrite the folded entry.
  assert.equal(projection.materialize(WITHIN_TTL).actors!.length, 0);
});

test("liveness actors are isolated per (actor, subjectId) pair and per projection instance (tenant scoping)", () => {
  const tenantAProjection = createOperatingStateProjection();
  const tenantBProjection = createOperatingStateProjection();

  tenantAProjection.apply(livenessRecord({ actor: "actor-a", subjectId: "task-a" }));
  tenantBProjection.apply(livenessRecord({ actor: "actor-b", subjectId: "task-b" }));

  const stateA = tenantAProjection.materialize(WITHIN_TTL);
  const stateB = tenantBProjection.materialize(WITHIN_TTL);

  assert.equal(stateA.actors!.length, 1);
  assert.equal((stateA.actors![0] as Record<string, unknown>).actor, "actor-a");
  assert.equal(stateB.actors!.length, 1);
  assert.equal((stateB.actors![0] as Record<string, unknown>).actor, "actor-b");
  // Neither projection ever saw the other tenant's actor.
  assert.ok(!stateA.actors!.some((a: any) => a.actor === "actor-b"));
  assert.ok(!stateB.actors!.some((a: any) => a.actor === "actor-a"));
});

test("two actors holding two different subjects both appear active", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord({ actor: "actor-1", subjectId: "task-1" }));
  projection.apply(livenessRecord({ actor: "actor-2", subjectId: "task-2" }));
  const state = projection.materialize(WITHIN_TTL);

  assert.equal(state.actors!.length, 2);
  const names = state.actors!.map((a: any) => a.actor).sort();
  assert.deepEqual(names, ["actor-1", "actor-2"]);
});

test("incremental liveness projection equals buildCurrentOperatingState over the same liveness records (claim+heartbeat)", () => {
  // No explicit ids: production liveness shares ONE id per session (collapsed),
  // so both paths must fold heartbeat as a state UPDATE, never dedup it away.
  const events = [
    livenessRecord({ actor: "actor-parity", subjectId: "task-parity" }),
    livenessRecord({ type: "heartbeat", actor: "actor-parity", subjectId: "task-parity", at: "2026-07-07T10:05:00.000Z" })
  ];
  assert.deepEqual(foldIncrementally(events, WITHIN_TTL), buildCurrentOperatingState(events, WITHIN_TTL));
});

test("active liveness metadata is timestamp-deterministic across arrival permutations and conflicts", () => {
  const options = { now: "2026-07-07T10:06:00.000Z" };
  const claim = livenessRecord({ at: "2026-07-07T10:00:00.000Z", host: "host-old", branch: "branch-a", actor_key: "key-a" });
  const heartbeat = livenessRecord({ type: "heartbeat", at: "2026-07-07T10:05:00.000Z", host: "host-new", artifact_dir: "/new" });
  const expected = foldIncrementally([claim, heartbeat], options);
  const reversed = foldIncrementally([heartbeat, claim], options);

  assert.deepEqual(reversed.actors, expected.actors);
  assert.deepEqual(expected.actors, buildCurrentOperatingState([claim, heartbeat], options).actors);
  assert.equal((expected.actors![0] as any).host, "host-new");
  assert.equal((expected.actors![0] as any).branch, "branch-a");
  assert.equal((expected.actors![0] as any).artifactDir, "/new");
});

test("release metadata epoch resets pre-release fields for a newer reclaim in every order", () => {
  const options = { now: "2026-07-07T10:12:00.000Z" };
  const claim = livenessRecord({ at: "2026-07-07T10:00:00.000Z", host: "old-host", branch: "old-branch" });
  const release = livenessRecord({ type: "release", at: "2026-07-07T10:05:00.000Z" });
  const reclaim = livenessRecord({ type: "claim", at: "2026-07-07T10:10:00.000Z", host: "new-host" });
  const expected = foldIncrementally([claim, release, reclaim], options);
  const reordered = foldIncrementally([reclaim, claim, release], options);

  assert.deepEqual(reordered.actors, expected.actors);
  assert.deepEqual(expected.actors, buildCurrentOperatingState([claim, release, reclaim], options).actors);
  assert.equal((expected.actors![0] as any).host, "new-host");
  assert.equal((expected.actors![0] as any).branch, undefined);
});

test("incremental liveness projection equals buildCurrentOperatingState for a release (actor removed in both paths)", () => {
  // Regression: claim + release share one id; neither path may drop the release
  // as a duplicate — both must project the actor as removed.
  const events = [
    livenessRecord({ actor: "actor-rel", subjectId: "task-rel" }),
    livenessRecord({ type: "release", actor: "actor-rel", subjectId: "task-rel", at: "2026-07-07T10:10:00.000Z" })
  ];
  const incremental = foldIncrementally(events, WITHIN_TTL);
  const batch = buildCurrentOperatingState(events, WITHIN_TTL);
  assert.deepEqual(incremental, batch);
  assert.equal(incremental.actors!.length, 0);
});

test("liveness timestamp ordering prevents resurrection across release reorder permutations with batch parity", () => {
  const claim = livenessRecord({ at: "2026-07-07T10:00:00.000Z" });
  const staleHeartbeat = livenessRecord({ type: "heartbeat", at: "2026-07-07T10:05:00.000Z" });
  const release = livenessRecord({ type: "release", at: "2026-07-07T10:10:00.000Z" });
  const options = { now: "2026-07-07T10:11:00.000Z" };
  const permutations = [
    [claim, release, staleHeartbeat],
    [claim, staleHeartbeat, release],
    [release, claim, staleHeartbeat]
  ];

  for (const events of permutations) {
    const incremental = foldIncrementally(events, options);
    const batch = buildCurrentOperatingState(events, options);
    assert.deepEqual(incremental, batch);
    assert.equal(incremental.actors!.length, 0);
  }
});

test("an equal timestamp cannot displace a release, while a strictly newer claim legitimately reclaims", () => {
  const options = { now: "2026-07-07T10:12:00.000Z" };
  const events = [
    livenessRecord({ type: "release", at: "2026-07-07T10:10:00.000Z" }),
    livenessRecord({ type: "heartbeat", at: "2026-07-07T10:10:00.000Z" }),
    livenessRecord({ type: "claim", at: "2026-07-07T10:11:00.000Z" })
  ];
  const projection = createOperatingStateProjection("inline-events", options);
  projection.apply(events[0]);
  projection.apply(events[1]);
  assert.equal(projection.materialize(options).actors!.length, 0);

  projection.apply(events[2]);
  const incremental = projection.materialize(options);
  assert.deepEqual(incremental, buildCurrentOperatingState(events, options));
  assert.equal(incremental.actors!.length, 1);
  assert.equal((incremental.actors![0] as any).lastSeenAt, "2026-07-07T10:11:00.000Z");
});

test("equal-time release precedence is arrival-order independent with incremental and batch parity", () => {
  const options = { now: "2026-07-07T10:01:00.000Z" };
  const active = livenessRecord({ type: "heartbeat", at: "2026-07-07T10:00:00.000Z" });
  const release = livenessRecord({ type: "release", at: "2026-07-07T10:00:00.000Z" });
  for (const events of [[active, release], [release, active]]) {
    const incremental = foldIncrementally(events, options);
    const batch = buildCurrentOperatingState(events, options);
    assert.deepEqual(incremental, batch);
    assert.equal(incremental.actors!.length, 0);
  }
});

test("seconds-precision liveness validates, folds, and orders against millisecond events", () => {
  const options = { now: "2026-07-10T05:34:00.000Z" };
  const seconds = validateLivenessRecordBody(livenessRecord({
    type: "heartbeat",
    at: "2026-07-10T05:33:49Z"
  }));
  const laterRelease = livenessRecord({ type: "release", at: "2026-07-10T05:33:49.250Z" });
  assert.equal(seconds.at, "2026-07-10T05:33:49Z");

  for (const events of [[seconds, laterRelease], [laterRelease, seconds]]) {
    const incremental = foldIncrementally(events, options);
    assert.deepEqual(incremental, buildCurrentOperatingState(events, options));
    assert.equal(incremental.actors!.length, 0);
  }
});

test("seconds and .000 timestamps share an ordering millisecond and release wins the tie", () => {
  const options = { now: "2026-07-10T05:34:00.000Z" };
  const active = livenessRecord({ type: "heartbeat", at: "2026-07-10T05:33:49.000Z" });
  const release = livenessRecord({ type: "release", at: "2026-07-10T05:33:49Z" });
  for (const events of [[active, release], [release, active]]) {
    const incremental = foldIncrementally(events, options);
    assert.deepEqual(incremental, buildCurrentOperatingState(events, options));
    assert.equal(incremental.actors!.length, 0);
  }
});

test("an unparseable incoming at is oldest and cannot displace a parseable winner", () => {
  const options = { now: "2026-07-07T10:06:00.000Z" };
  const events = [
    livenessRecord({ type: "heartbeat", at: "2026-07-07T10:05:00.000Z" }),
    livenessRecord({ type: "release", at: "not-a-timestamp" })
  ];
  const incremental = foldIncrementally(events, options);
  assert.deepEqual(incremental, buildCurrentOperatingState(events, options));
  assert.equal(incremental.actors!.length, 1);
  assert.equal((incremental.actors![0] as any).lastSeenAt, "2026-07-07T10:05:00.000Z");
});

test("offset, year-zero, and garbage timestamps validate as errors and fold as oldest", () => {
  const options = { now: "2026-07-10T05:34:00.000Z" };
  const canonical = livenessRecord({ type: "heartbeat", at: "2026-07-10T05:33:49.000Z" });
  for (const at of ["2026-07-10T05:33:49+02:00", "0000-01-01T00:00:00Z", "garbage"]) {
    assert.ok(validateLivenessRecord(livenessRecord({ at }), "record").some((issue: any) => issue.path === "record.at"), at);
    const events = [canonical, livenessRecord({ type: "release", at })];
    const incremental = foldIncrementally(events, options);
    assert.deepEqual(incremental, buildCurrentOperatingState(events, options));
    assert.equal(incremental.actors!.length, 1, at);
    assert.equal((incremental.actors![0] as any).lastSeenAt, canonical.at);

    const lone = foldIncrementally([livenessRecord({ at })], options);
    assert.deepEqual(lone, buildCurrentOperatingState([livenessRecord({ at })], options));
    assert.equal(lone.actors!.length, 0, at);
  }
});

test("release watermarks use the bounded maximum horizon so mixed TTLs cannot resurrect", () => {
  const observed = { now: "2026-07-07T10:10:00.000Z" };
  const projection = createOperatingStateProjection("inline-events", observed);
  const release = livenessRecord({ type: "release", at: "2026-07-07T10:10:00.000Z", ttlSeconds: 120 });
  const staleHeartbeat = livenessRecord({ type: "heartbeat", at: "2026-07-07T10:05:00.000Z", ttlSeconds: 3600 });
  projection.apply(release);
  assert.equal(projection.materialize(observed).actors!.length, 0);

  assert.equal(projection.wouldAdvanceLiveness(staleHeartbeat, { now: "2026-07-07T10:12:00.001Z" }), false);
  assert.equal(projection.materialize({ now: "2026-07-07T10:12:00.001Z" }).actors!.length, 0);

  // Retention is still finite: after the one-day accepted maximum the watermark
  // is pruned, while the stale one-hour heartbeat is necessarily expired.
  assert.equal(projection.wouldAdvanceLiveness(staleHeartbeat, { now: "2026-07-08T10:10:00.001Z" }), true);
  projection.apply(staleHeartbeat);
  assert.equal(projection.materialize({ now: "2026-07-08T10:10:00.001Z" }).actors!.length, 0);
});

test("corrupted replay TTL values fall back to bounded expiry with incremental and batch parity", () => {
  const invalidTtls = [Number.POSITIVE_INFINITY, Number.NaN, -1, 0, 86401];
  const options = { now: "2026-07-07T10:31:00.000Z" };
  for (const ttlSeconds of invalidTtls) {
    const events = [livenessRecord({ at: "2026-07-07T10:00:00.000Z", ttlSeconds })];
    const incremental = foldIncrementally(events, options);
    const batch = buildCurrentOperatingState(events, options);
    assert.deepEqual(incremental, batch);
    assert.equal(incremental.actors!.length, 0);
  }
});
