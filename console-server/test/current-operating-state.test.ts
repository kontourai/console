// @ts-nocheck
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildCurrentOperatingState,
  inspectFixtures
} = require("../src/console-foundation");

const rootDir = process.env.KONTOUR_REPO_ROOT || process.cwd();

test("replays Surface and Flow handoff events into current operating state", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const state = buildCurrentOperatingState([stream], { generatedAt: "2026-06-03T10:01:45Z" });

  assert.equal(state.generatedAt, "2026-06-03T10:01:45Z");
  assert.equal(state.source.mode, "event_replay");
  assert.equal(state.source.acceptedEventCount, 6);
  assert.equal(state.source.duplicateEventCount, 0);
  assert.equal(state.source.lastAcceptedEventId, "evt-surface-flow-handoff-006");
  assert.equal(state.currentStage, "Provider directory freshness passed; Provider directory refresh can continue.");

  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].id, "run-provider-directory-refresh");
  assert.equal(state.processes[0].status, "running");
  assert.equal(state.processes[0].currentStep.id, "publish-refreshed-operating-state");
  assert.equal(state.processes[0].percentComplete, 74);
  assert.equal(state.processes[0].updatedAt, "2026-06-03T10:01:41Z");
  assert.equal(state.processes[0].sourceRef.uid, "flow-run-provider-directory-refresh");
  assert.equal(state.processes[0].claimRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(state.processes[0].nextActionRefs[0].uid, "flow-action-resume-provider-directory-refresh");

  assert.equal(state.gates.length, 1);
  assert.equal(state.gates[0].id, "gate-provider-directory-freshness");
  assert.equal(state.gates[0].status, "passed");
  assert.equal(state.gates[0].processRef.uid, "flow-run-provider-directory-refresh");
  assert.equal(state.gates[0].expectationRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(state.gates[0].evidenceRefs[0].uid, "surface-evidence-provider-directory-crawl-2026-06-03");

  assert.equal(state.claims.length, 1);
  assert.equal(state.claims[0].id, "claim-provider-directory-current");
  assert.equal(state.claims[0].status, "verified");
  assert.equal(state.claims[0].freshness.status, "fresh");
  assert.equal(state.claims[0].lastVerifiedAt, "2026-06-03T10:01:39Z");
  assert.equal(state.claims[0].sourceRef.apiVersion, "surface.kontour.ai/v1alpha1");

  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0].id, "evidence-provider-directory-crawl-2026-06-03");
  assert.equal(state.evidence[0].status, "available");
  assert.equal(state.evidence[0].claimRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(state.evidence[0].gateRefs[0].uid, "flow-gate-provider-directory-freshness");

  assert.equal(state.actions.length, 1);
  assert.equal(state.actions[0].id, "action-resume-provider-directory-refresh");
  assert.equal(state.actions[0].readOnly, true);
  assert.equal(state.actions[0].authority.command, "flow.run.resume");
  assert.equal(state.actions[0].subjectRefs[0].uid, "flow-run-provider-directory-refresh");

  const relations = new Set(state.links.map((link) => link.relation));
  assert.equal(relations.has("controls"), true);
  assert.equal(relations.has("blocks"), true);
  assert.equal(relations.has("evidenced_by"), true);
  assert.equal(state.timeline.length, 6);
  assert.equal(state.timeline[5].id, "evt-surface-flow-handoff-006");
});

test("replay accepts inspection reports and ignores duplicate event ids", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const duplicated = {
    ...stream,
    events: [stream.events[0], ...stream.events]
  };

  const state = buildCurrentOperatingState({
    eventStreams: [duplicated]
  }, { generatedAt: "2026-06-03T10:01:45Z" });

  assert.equal(state.source.acceptedEventCount, 6);
  assert.equal(state.source.duplicateEventCount, 1);
  assert.equal(state.timeline[0].id, "evt-surface-flow-handoff-001");
  assert.equal(state.timeline[5].id, "evt-surface-flow-handoff-006");
});

test("replay orders accepted events by sequence before file order", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const shuffled = {
    ...stream,
    events: [...stream.events].reverse()
  };

  const state = buildCurrentOperatingState([shuffled], { generatedAt: "2026-06-03T10:01:45Z" });

  assert.equal(state.timeline[0].id, "evt-surface-flow-handoff-001");
  assert.equal(state.timeline[5].id, "evt-surface-flow-handoff-006");
  assert.equal(state.gates[0].status, "passed");
});

test("replay defaults generatedAt from the last accepted event", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const state = buildCurrentOperatingState([stream]);

  assert.equal(state.generatedAt, "2026-06-03T10:01:42Z");
});
