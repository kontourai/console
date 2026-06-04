// @ts-nocheck
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  LocalConsoleHub,
  createLocalConsoleHub,
  inspectFixtures
} = require("../src/console-foundation");

test("local console hub appends handoff events and exposes replayed current state", async () => {
  const rootDir = tempRoot();
  const hub = createLocalConsoleHub({ rootDir });
  const stream = surfaceFlowHandoffStream();

  const results = [];
  for (const event of stream.events) {
    results.push(await hub.appendEvent(event));
  }

  const report = hub.inspect();
  const state = hub.currentOperatingState({ generatedAt: "2026-06-03T10:01:45Z" });

  assert.deepEqual(results.map((result) => result.outcome), ["accepted", "accepted", "accepted", "accepted", "accepted", "accepted"]);
  assert.equal(results[0].sinkRole, "LocalConsoleHub");
  assert.equal(report.kontourRoot, path.join(rootDir, ".kontour"));
  assert.equal(report.validation.errors.length, 0);
  assert.equal(report.eventStreams.length, 2);
  assert.equal(report.eventStreams.reduce((sum, item) => sum + item.events.length, 0), 6);
  assert.equal(fs.existsSync(path.join(rootDir, ".kontour", "events", "flow-local", "project-provider-directory-refresh.jsonl")), true);
  assert.equal(fs.existsSync(path.join(rootDir, ".kontour", "events", "surface-local", "project-provider-directory-refresh.jsonl")), true);

  assert.equal(state.source.acceptedEventCount, 6);
  assert.equal(state.source.duplicateEventCount, 0);
  assert.equal(state.source.lastAcceptedEventId, "evt-surface-flow-handoff-006");
  assert.equal(state.currentStage, "Provider directory freshness passed; Provider directory refresh can continue.");
  assert.equal(state.processes[0].currentStep.id, "publish-refreshed-operating-state");
  assert.equal(state.processes[0].percentComplete, 74);
  assert.equal(state.gates[0].status, "passed");
  assert.equal(state.claims[0].status, "verified");
  assert.equal(state.claims[0].freshness.status, "fresh");
  assert.equal(state.evidence[0].id, "evidence-provider-directory-crawl-2026-06-03");
  assert.equal(state.actions[0].id, "action-resume-provider-directory-refresh");
  assert.equal(state.actions[0].readOnly, true);
});

test("local console hub accepts custom local root and failed appends do not create state", async () => {
  const rootDir = tempRoot();
  const hub = new LocalConsoleHub({ rootDir, kontourRoot: "custom-kontour" });
  const result = await hub.appendEvent({
    schema: "kontour.console.event",
    version: "0.1",
    id: "bad-event"
  });
  const report = hub.inspect();
  const state = hub.currentOperatingState();

  assert.equal(result.outcome, "failed");
  assert.equal(result.errorCode, "INVALID_RECORD");
  assert.equal(report.kontourRoot, path.join(rootDir, "custom-kontour"));
  assert.equal(report.eventStreams.length, 0);
  assert.equal(state.source.acceptedEventCount, 0);
  assert.equal(state.generatedAt, null);
  assert.equal(state.currentStage, "No events replayed.");
});

function surfaceFlowHandoffStream() {
  const report = inspectFixtures({ rootDir: process.env.KONTOUR_REPO_ROOT || process.cwd() });
  return report.eventStreams.find((item) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-console-hub-"));
}
