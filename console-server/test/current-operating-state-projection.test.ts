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
