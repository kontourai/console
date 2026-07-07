const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCurrentOperatingState,
  createOperatingStateProjection,
  inspectFixtures
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
  const projection = createOperatingStateProjection();
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

test("a liveness claim makes an actor appear active in the projection", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord({ id: "liveness-claim-1" }));
  const state = projection.materialize();

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
  projection.apply(livenessRecord({ id: "liveness-claim-2" }));
  projection.apply(livenessRecord({
    id: "liveness-heartbeat-2",
    type: "heartbeat",
    at: "2026-07-07T10:05:00.000Z"
  }));
  const state = projection.materialize();

  assert.equal(state.actors!.length, 1);
  const actor = state.actors![0] as Record<string, unknown>;
  assert.equal(actor.lastSeenAt, "2026-07-07T10:05:00.000Z");
  // A heartbeat need not repeat the claim's TTL — it carries forward.
  assert.equal(actor.ttlSeconds, 900);
});

test("a liveness release removes the actor from the projection", () => {
  const projection = createOperatingStateProjection();
  projection.apply(livenessRecord({ id: "liveness-claim-3" }));
  assert.equal(projection.materialize().actors!.length, 1);

  projection.apply(livenessRecord({
    id: "liveness-release-3",
    type: "release",
    at: "2026-07-07T10:10:00.000Z"
  }));
  const state = projection.materialize();

  assert.equal(state.actors!.length, 0);
});

test("liveness actors are isolated per (actor, subjectId) pair and per projection instance (tenant scoping)", () => {
  const tenantAProjection = createOperatingStateProjection();
  const tenantBProjection = createOperatingStateProjection();

  tenantAProjection.apply(livenessRecord({ id: "tenant-a-claim", actor: "actor-a", subjectId: "task-a" }));
  tenantBProjection.apply(livenessRecord({ id: "tenant-b-claim", actor: "actor-b", subjectId: "task-b" }));

  const stateA = tenantAProjection.materialize();
  const stateB = tenantBProjection.materialize();

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
  projection.apply(livenessRecord({ id: "multi-1", actor: "actor-1", subjectId: "task-1" }));
  projection.apply(livenessRecord({ id: "multi-2", actor: "actor-2", subjectId: "task-2" }));
  const state = projection.materialize();

  assert.equal(state.actors!.length, 2);
  const names = state.actors!.map((a: any) => a.actor).sort();
  assert.deepEqual(names, ["actor-1", "actor-2"]);
});

test("incremental liveness projection equals buildCurrentOperatingState over the same liveness records", () => {
  const events = [
    livenessRecord({ id: "parity-claim", actor: "actor-parity", subjectId: "task-parity" }),
    livenessRecord({ id: "parity-heartbeat", type: "heartbeat", actor: "actor-parity", subjectId: "task-parity", at: "2026-07-07T10:05:00.000Z" })
  ];
  assert.deepEqual(foldIncrementally(events), buildCurrentOperatingState(events));
});
