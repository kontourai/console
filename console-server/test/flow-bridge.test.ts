const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { deriveFlowRunEvents, listFlowRunDirs, bridgeFlowRun } = require("../src/console-foundation/flow-bridge");
const { createConsoleHubServer } = require("../src/console-foundation/console-hub-server");

function writeRun(flowRoot: string, runId: string, state: Record<string, unknown>): string {
  const runDir = join(flowRoot, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify(state));
  return runDir;
}

const sampleState = {
  run_id: "dev-7",
  subject: "checkout-banner",
  status: "active",
  current_step: "implement",
  next_action: "return to implement and replace failing evidence attempt 1/3",
  updated_at: "2026-06-11T01:00:00Z",
  transitions: [
    { type: "step", status: "allowed", from_step: "plan", to_step: "implement", at: "2026-06-11T00:10:00Z" },
    { type: "step", status: "allowed", from_step: "implement", to_step: "verify", at: "2026-06-11T00:20:00Z" },
    { type: "route_back", from_step: "verify", to_step: "implement", gate_id: "verify-gate", route_reason: "implementation_defect", at: "2026-06-11T00:30:00Z" },
  ],
};

test("derives deterministic console events from a Flow run state", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-"));
  const runDir = writeRun(flowRoot, "dev-7", sampleState);

  const events = await deriveFlowRunEvents(runDir);
  assert.equal(events.length, 5);
  assert.equal(events[0].type, "process.started");
  assert.equal(events[0].id, "evt-flowbridge-dev-7-1");
  assert.equal(events[2].type, "process.progressed");
  assert.equal(events[3].type, "gate.routed_back");
  assert.match(events[3].payload.summary, /implementation_defect/);
  assert.equal(events[4].payload.after.currentStep, "implement");
  assert.match(String(events[4].payload.summary), /replace failing evidence/);

  // deterministic across invocations
  assert.deepEqual((await deriveFlowRunEvents(runDir)).map((e: { id: string }) => e.id), events.map((e: { id: string }) => e.id));
});

test("lists only run directories that carry state.json", () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-list-"));
  writeRun(flowRoot, "a", sampleState);
  mkdirSync(join(flowRoot, "runs", "empty"), { recursive: true });
  const dirs = listFlowRunDirs(flowRoot);
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /runs\/a$/);
});

test("bridges a run into a live hub and skips sent ids on the second pass", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-hub-"));
  const runDir = writeRun(flowRoot, "dev-7", sampleState);
  const kontourRoot = mkdtempSync(join(tmpdir(), "flow-bridge-kontour-"));
  const app = createConsoleHubServer({ rootDir: kontourRoot, kontourRoot, port: 0 });
  await new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
  const address = app.server.address() as { port: number };
  const hubUrl = `http://127.0.0.1:${address.port}`;

  try {
    const sent = new Set<string>();
    const first = await bridgeFlowRun(runDir, hubUrl, {}, sent);
    assert.equal(first.accepted, 5);
    assert.equal(first.failed, 0);

    const second = await bridgeFlowRun(runDir, hubUrl, {}, sent);
    assert.equal(second.accepted, 0);
    assert.equal(second.duplicates, 5);

    const state = await fetch(`${hubUrl}/state`).then((r) => r.json());
    assert.equal(state.summary !== undefined || state.source !== undefined, true);
  } finally {
    await new Promise((resolve: any) => app.close(resolve));
  }
});
