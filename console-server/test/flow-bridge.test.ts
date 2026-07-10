const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFile } = require("node:child_process");
const { mkdtempSync, mkdirSync, renameSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");
const { DEFAULT_FLOW_ROOT, deriveFlowRunEvents, discoverFlowRuns, listFlowRunDirs, bridgeFlowRun, buildFlowBridgeSink } = require("../src/console-foundation/flow-bridge");
const { createConsoleHubServer } = require("../src/console-foundation/console-hub-server");
const consoleFoundation = require("../src/console-foundation");
const { InMemorySink } = consoleFoundation;
const { existsSync } = require("node:fs");

const execFileAsync = promisify(execFile);
const tsxLoader = require.resolve("tsx");

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

test("package root exports pinned Flow discovery", () => {
  assert.equal(consoleFoundation.discoverFlowRuns, discoverFlowRuns);
});

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

test("default discovery selects .kontourai/flow and ignores legacy-only runs", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "flow-bridge-default-"));
  const canonicalRoot = join(projectRoot, DEFAULT_FLOW_ROOT);
  const legacyRoot = join(projectRoot, ".flow");
  const canonicalRun = writeRun(canonicalRoot, "canonical", { ...sampleState, run_id: "canonical" });
  writeRun(legacyRoot, "legacy", { ...sampleState, run_id: "legacy" });

  assert.equal(DEFAULT_FLOW_ROOT, join(".kontourai", "flow"));
  assert.deepEqual(listFlowRunDirs(canonicalRoot), [canonicalRun]);
});

test("explicit Flow roots remain confined when runs is a symlink", () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-confined-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "flow-bridge-outside-"));
  writeRun(outsideRoot, "outside", { ...sampleState, run_id: "outside" });
  symlinkSync(join(outsideRoot, "runs"), join(flowRoot, "runs"), "dir");

  assert.deepEqual(listFlowRunDirs(flowRoot), []);
});

test("explicit Flow root overrides discover their own runs", () => {
  const customRoot = mkdtempSync(join(tmpdir(), "flow-bridge-custom-"));
  const customRun = writeRun(customRoot, "custom", { ...sampleState, run_id: "custom" });

  assert.deepEqual(listFlowRunDirs(customRoot), [customRun]);
});

test("pinned discovery boundary rejects a run replaced by an external symlink", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-run-swap-"));
  const runDir = writeRun(flowRoot, "selected", { ...sampleState, run_id: "selected" });
  const discovery = discoverFlowRuns(flowRoot);
  const outsideRoot = mkdtempSync(join(tmpdir(), "flow-bridge-run-swap-outside-"));
  const outsideRun = writeRun(outsideRoot, "outside", { ...sampleState, run_id: "outside" });
  renameSync(runDir, join(flowRoot, "runs", "selected-original"));
  symlinkSync(outsideRun, runDir, "dir");

  await assert.rejects(
    deriveFlowRunEvents(runDir, { allowedRunsRoot: discovery.allowedRunsRoot }),
    /escapes its run directory/,
  );
});

test("CLI default bridges canonical runs and ignores legacy runs", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "flow-bridge-cli-"));
  writeRun(join(projectRoot, DEFAULT_FLOW_ROOT), "canonical", { ...sampleState, run_id: "canonical" });
  writeRun(join(projectRoot, ".flow"), "legacy", { ...sampleState, run_id: "legacy" });
  const hubRoot = mkdtempSync(join(tmpdir(), "flow-bridge-cli-hub-"));
  const app = createConsoleHubServer({ rootDir: hubRoot, kontourRoot: hubRoot, port: 0 });
  await new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
  const address = app.server.address() as { port: number };

  try {
    const cliPath = join(__dirname, "..", "bin", "kontour-flow-bridge.ts");
    const { stdout } = await execFileAsync(process.execPath, [
      "--import", tsxLoader, cliPath, "--no-local", "--hub", `http://127.0.0.1:${address.port}`,
    ], { cwd: projectRoot });
    assert.match(stdout, /^canonical:/m);
    assert.doesNotMatch(stdout, /^legacy:/m);
  } finally {
    await new Promise((resolve: any) => app.close(resolve));
  }
});

test("CLI default does not discover a legacy-only run", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "flow-bridge-cli-legacy-"));
  writeRun(join(projectRoot, ".flow"), "legacy", { ...sampleState, run_id: "legacy" });
  const cliPath = join(__dirname, "..", "bin", "kontour-flow-bridge.ts");
  const { stdout } = await execFileAsync(process.execPath, ["--import", tsxLoader, cliPath], { cwd: projectRoot });

  assert.match(stdout, /no Flow runs under .*\.kontourai\/flow/);
  assert.doesNotMatch(stdout, /^legacy:/m);
});

test("deriveFlowRunEvents ignores a definition symlink that escapes the run", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-definition-link-"));
  const runDir = writeRun(flowRoot, "linked-definition", { ...sampleState, run_id: "linked-definition" });
  const outsideDefinition = join(mkdtempSync(join(tmpdir(), "flow-bridge-definition-outside-")), "definition.json");
  writeFileSync(outsideDefinition, JSON.stringify({ steps: [{ id: "outside-secret-stage", next: null }] }));
  symlinkSync(outsideDefinition, join(runDir, "definition.json"));

  const events = await deriveFlowRunEvents(runDir);
  assert.equal(events.some((event: { type: string }) => event.type === "flow.pipeline.snapshot"), false);
  assert.equal(JSON.stringify(events).includes("outside-secret-stage"), false);
});

test("deriveFlowRunEvents ignores an evidence manifest symlink that escapes the run", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-manifest-link-"));
  const runDir = writeRun(flowRoot, "linked-manifest", { ...sampleState, run_id: "linked-manifest" });
  writeFileSync(join(runDir, "definition.json"), JSON.stringify({
    steps: [{ id: "verify", next: null }],
    gates: {
      "verify-gate": {
        step: "verify",
        expects: [{
          id: "tests-passed",
          kind: "trust.bundle",
          required: true,
          bundle_claim: { claimType: "quality.tests" },
        }],
      },
    },
  }));
  const evidenceDir = join(runDir, "evidence");
  mkdirSync(evidenceDir);
  const outsideManifest = join(mkdtempSync(join(tmpdir(), "flow-bridge-manifest-outside-")), "manifest.json");
  writeFileSync(outsideManifest, JSON.stringify({
    evidence: [{
      kind: "trust.bundle",
      bundle_report: { claims: [{ claimType: "quality.tests", status: "verified", secret: "outside-secret" }] },
    }],
  }));
  symlinkSync(outsideManifest, join(evidenceDir, "manifest.json"));

  const events = await deriveFlowRunEvents(runDir);
  assert.equal(JSON.stringify(events).includes("outside-secret"), false);
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

test("bridges a run through a configured Sink (no hardcoded POST)", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-sink-"));
  const runDir = writeRun(flowRoot, "dev-7", sampleState);

  // Translation (Flow → ConsoleRecord) is decoupled from delivery: the bridge
  // hands records to whatever Sink it's given. Here an InMemorySink stands in
  // for the local/api fanout — no network, no hardcoded fetch.
  const memory = new InMemorySink({ sinkId: "bridge-memory" });
  const sent = new Set<string>();

  const first = await bridgeFlowRun(runDir, memory, {}, sent);
  assert.equal(first.accepted, 5);
  assert.equal(first.failed, 0);
  assert.equal(memory.records.length, 5);
  assert.equal(memory.records[0].id, "evt-flowbridge-dev-7-1");

  // Idempotent across passes: sentIds dedups so nothing is re-delivered.
  const second = await bridgeFlowRun(runDir, memory, {}, sent);
  assert.equal(second.accepted, 0);
  assert.equal(second.duplicates, 5);
  assert.equal(memory.records.length, 5);
});

test("buildFlowBridgeSink local-only: LocalFileSink, no ApiSink, no network", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-local-"));
  const runDir = writeRun(flowRoot, "dev-7", sampleState);
  const kontourRoot = mkdtempSync(join(tmpdir(), "flow-bridge-local-root-"));

  // No hubUrl → a lone LocalFileSink, not a CompositeSink, and no ApiSink.
  const sink = buildFlowBridgeSink({ localRoot: kontourRoot });
  assert.equal(sink.sinkRole, "LocalFileSink");

  const delivery = await bridgeFlowRun(runDir, sink, {}, new Set<string>());
  assert.equal(delivery.accepted, 5);
  assert.equal(delivery.failed, 0);

  // Events landed on local disk under the configured root.
  const eventDir = join(kontourRoot, "events", "flow-bridge");
  assert.equal(existsSync(eventDir), true);
});

test("buildFlowBridgeSink defaults its local mirror to .kontourai/console", () => {
  const sink = buildFlowBridgeSink();

  assert.equal(sink.sinkRole, "LocalFileSink");
  assert.equal(sink.root, join(process.cwd(), ".kontourai", "console"));
});

test("buildFlowBridgeSink composes Local + Api when a hub is configured", () => {
  const kontourRoot = mkdtempSync(join(tmpdir(), "flow-bridge-composite-"));
  const sink = buildFlowBridgeSink({ localRoot: kontourRoot, hubUrl: "https://console.kontourai.io", authToken: "tok" });

  assert.equal(sink.sinkRole, "CompositeSink");
  assert.equal(sink.sinks.length, 2);
  assert.equal(sink.sinks[0].sinkRole, "LocalFileSink");
  assert.equal(sink.sinks[1].sinkRole, "ApiSink");
});

test("attachTrustReports: trust.bundle evidence in manifest produces trustReport on gate-expect", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-trust-"));
  const runId = "trust-run-1";
  const runDir = join(flowRoot, "runs", runId);
  mkdirSync(runDir, { recursive: true });

  // State with current_step at verify
  const state = {
    run_id: runId,
    subject: "checkout-banner",
    status: "active",
    current_step: "verify",
    updated_at: "2026-06-15T00:00:00Z",
    transitions: [],
  };
  writeFileSync(join(runDir, "state.json"), JSON.stringify(state));

  // Definition with trust.bundle gate expect (Flow 1.3+ format)
  const definition = {
    steps: [
      { id: "plan", next: "verify" },
      { id: "verify", next: null },
    ],
    gates: {
      "verify-gate": {
        step: "verify",
        expects: [
          {
            id: "tests-passed",
            kind: "trust.bundle",
            required: true,
            description: "Test results are ready for verification.",
            bundle_claim: {
              claimType: "quality.tests",
              subjectType: "flow-step",
              subjectId: "builder.verify",
              accepted_statuses: ["verified"],
            },
          },
        ],
      },
    },
  };
  writeFileSync(join(runDir, "definition.json"), JSON.stringify(definition));

  // Evidence manifest with a trust.bundle entry (Flow 1.3+ format)
  const evidenceDir = join(runDir, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const manifest = {
    schema_version: "0.1",
    run_id: runId,
    evidence: [
      {
        id: "ev.1749000000.1",
        gate_id: "verify-gate",
        kind: "trust.bundle",
        status: "passed",
        bundle: {
          schemaVersion: 3,
          source: "ci/main",
          claims: [
            {
              id: "claim.quality.tests",
              subjectType: "flow-step",
              subjectId: "builder.verify",
              surface: "quality.developer-evidence",
              claimType: "quality.tests",
              fieldOrBehavior: "testSuite",
              value: "all tests passed",
              createdAt: "2026-06-15T00:00:00.000Z",
              updatedAt: "2026-06-15T00:00:00.000Z",
            },
          ],
          evidence: [
            {
              id: "evitem.1",
              claimId: "claim.quality.tests",
              evidenceType: "test_output",
              method: "validation",
              sourceRef: "ci/main",
              excerptOrSummary: "All 42 tests passed.",
              observedAt: "2026-06-15T00:00:00.000Z",
              collectedBy: "ci/main",
              passing: true,
              supportStrength: "entails",
            },
          ],
          policies: [],
          events: [
            {
              id: "ev.verify.claim",
              claimId: "claim.quality.tests",
              status: "verified",
              createdAt: "2026-06-15T00:00:00.000Z",
              actor: "ci/main",
            },
          ],
        },
        bundle_report: {
          id: "report.1749000000",
          generatedAt: "2026-06-15T00:00:00.000Z",
          claims: [
            { id: "claim.quality.tests", claimType: "quality.tests", status: "verified" },
          ],
          summary: { counts: { total: 1, byStatus: { verified: 1 } } },
        },
        attached_at: "2026-06-15T00:00:00.000Z",
      },
    ],
  };
  writeFileSync(join(evidenceDir, "manifest.json"), JSON.stringify(manifest));

  const events = await deriveFlowRunEvents(runDir);

  // Find the pipeline snapshot event (sequence 0)
  const pipelineEvent = events.find((e: { type: string }) => e.type === "flow.pipeline.snapshot");
  assert.ok(pipelineEvent, "should have a pipeline snapshot event");

  const pipeline = (pipelineEvent.payload.after as { pipeline: unknown }).pipeline as {
    stages: Array<{
      id: string;
      gates: Array<{ expects: Array<{ id: string; kind: string; trustReport?: unknown }> }>;
    }>;
  };

  const verifyStage = pipeline.stages.find((s: { id: string }) => s.id === "verify");
  assert.ok(verifyStage, "verify stage should exist");
  if (!verifyStage) return;

  const verifyGate = verifyStage.gates[0];
  assert.ok(verifyGate, "verify gate should exist");
  if (!verifyGate) return;

  const testsPassedExpect = verifyGate.expects.find((e: { id: string }) => e.id === "tests-passed");
  assert.ok(testsPassedExpect, "tests-passed expect should exist");
  if (!testsPassedExpect) return;

  // The kind should be the claimType (quality.tests) from the bundle_claim selector
  assert.equal(testsPassedExpect.kind, "quality.tests", "expect.kind should be the bundle_claim claimType");

  // The trustReport should be attached — derived from the Hachure bundle
  assert.ok(testsPassedExpect.trustReport !== undefined, "trustReport should be attached from trust.bundle evidence");

  // Verify the trustReport has the expected structure (TrustReport from buildTrustReport)
  const tr = testsPassedExpect.trustReport as { claims?: Array<{ claimType?: string; status?: string }> };
  assert.ok(Array.isArray(tr.claims), "trustReport.claims should be an array");
  const qualityClaim = (tr.claims ?? []).find((c: { claimType?: string }) => c.claimType === "quality.tests");
  assert.ok(qualityClaim, "trustReport should contain a quality.tests claim");
  assert.equal((qualityClaim as { status?: string })?.status, "verified", "claim status should be verified");
});

test("attachTrustReports: no manifest.json gracefully produces no trustReport", async () => {
  const flowRoot = mkdtempSync(join(tmpdir(), "flow-bridge-no-manifest-"));
  const runId = "no-manifest-run";
  const runDir = join(flowRoot, "runs", runId);
  mkdirSync(runDir, { recursive: true });

  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    run_id: runId, subject: "test", status: "active", current_step: "verify",
    updated_at: "2026-06-15T00:00:00Z", transitions: [],
  }));

  const definition = {
    steps: [{ id: "verify", next: null }],
    gates: {
      "verify-gate": {
        step: "verify",
        expects: [{
          id: "tests-passed",
          kind: "trust.bundle",
          required: true,
          description: "Tests",
          bundle_claim: { claimType: "quality.tests", subjectId: "builder.verify", accepted_statuses: ["verified"] },
        }],
      },
    },
  };
  writeFileSync(join(runDir, "definition.json"), JSON.stringify(definition));
  // No evidence directory / manifest.json

  const events = await deriveFlowRunEvents(runDir);
  const pipelineEvent = events.find((e: { type: string }) => e.type === "flow.pipeline.snapshot");
  assert.ok(pipelineEvent, "should still have a pipeline snapshot");

  const pipeline = (pipelineEvent.payload.after as { pipeline: unknown }).pipeline as {
    stages: Array<{ gates: Array<{ expects: Array<{ trustReport?: unknown }> }> }>;
  };
  const expect_ = pipeline.stages[0]?.gates[0]?.expects[0];
  assert.ok(expect_ !== undefined);
  // No trustReport — no crash
  assert.equal(expect_?.trustReport, undefined, "should not have trustReport when no manifest");
});
