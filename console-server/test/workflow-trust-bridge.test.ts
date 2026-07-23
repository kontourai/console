const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFile } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, renameSync, realpathSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");
const {
  bridgeWorkflowTrustProjection,
  buildCurrentOperatingState,
  discoverWorkflowTrustProjections,
  InMemorySink,
  isWorkflowTrustProjectionEnvelope,
  readWorkflowTrustProjectionEnvelope,
  translateWorkflowTrustProjectionEnvelope,
  // The process-bridge sibling, imported so this file can prove console#254's
  // core acceptance criterion: process-bridge and trust-bridge output for the
  // SAME workflow fold into ONE process, not two.
  translateWorkflowProcessProjectionEnvelope,
} = require("../src/console-foundation");
const { createConsoleHubServer } = require("../src/console-foundation/console-hub-server");

const execFileAsync = promisify(execFile);
const tsxLoader = require.resolve("tsx");

// Trust envelope + Surface trust report fixtures below are hand-built to
// mirror flow-agents' REAL producer output field-for-field
// (src/lib/workflow-trust-projection.ts's `buildWorkflowTrustProjection` /
// `mapTrustSource` / `deriveGateAssociations`, flow-agents#891, and
// `@kontourai/surface`'s `buildTrustReport`/`TrustReport` shape) -- console
// does not depend on flow-agents (see workflow-trust-bridge.ts's module doc
// comment), mirroring the same "generate one matching the producer" approach
// workflow-process-bridge.test.ts already uses for the process envelope.

const DEFAULT_TRUST_SCOPE = { kind: "repo", id: "flow-agents" };
const DEFAULT_TRUST_PRODUCER = { id: "flow-agents-trust", product: "flow-agents" };

function trustEnvelope(trustEntries: Record<string, unknown> | Record<string, unknown>[], generatedAt = "2026-07-20T12:00:00Z", scope = DEFAULT_TRUST_SCOPE, producer = DEFAULT_TRUST_PRODUCER) {
  return {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt,
    scope,
    producer,
    derivedFrom: {
      mode: "direct_snapshot",
      eventHistory: "unavailable",
      directSnapshot: {
        id: "flow-agents-trust:repo:flow-agents",
        emittedAt: generatedAt,
        producer,
        reason: "workflow-trust projection is derived read-only from validated local trust.bundle files and workflow/assignment sidecars; Console event history is unavailable",
        sourceRef: {
          product: "flow-agents",
          kind: "workflow-trust",
          id: ".kontourai/flow-agents/*/trust.bundle",
          label: "Local workflow trust bundles",
        },
      },
    },
    trusts: Array.isArray(trustEntries) ? trustEntries : [trustEntries],
  };
}

/** Mirrors `qualifiedWorkflowSubjectId` in workflow-subject-identity.ts: `<producer.product>:<scope.kind>:<scope.id>:<taskSlug>`. */
function qualifiedWorkflowId(taskSlug: string, scope = DEFAULT_TRUST_SCOPE, producerProduct = DEFAULT_TRUST_PRODUCER.product) {
  return `${producerProduct}:${scope.kind}:${scope.id}:${taskSlug}`;
}

function qualifiedGateId(taskSlug: string, gateId: string, scope = DEFAULT_TRUST_SCOPE, producerProduct = DEFAULT_TRUST_PRODUCER.product) {
  return `${qualifiedWorkflowId(taskSlug, scope, producerProduct)}:gate:${gateId}`;
}

/** A minimal but field-faithful `@kontourai/surface` `buildTrustReport` output for one gate-associated, verified claim. */
function trustReport(taskSlug: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 5,
    source: "console-trust-projection-test",
    id: `report-${taskSlug}`,
    generatedAt: "2026-07-20T11:58:00Z",
    statusFunctionVersion: "1.0.0",
    claims: [
      {
        id: "claim-tests",
        subjectType: "workflow",
        subjectId: `${taskSlug}/gate/tests-evidence`,
        facet: "flow-agents.workflow",
        claimType: "builder.verify.tests",
        fieldOrBehavior: "required tests pass",
        value: "pass",
        status: "verified",
        createdAt: "2026-07-20T10:00:00Z",
        updatedAt: "2026-07-20T10:05:00Z",
        freshness: { asOf: "2026-07-20T11:58:00Z", stale: false },
        metadata: {
          gate_claim: { expectation_id: "tests-evidence", claim_type: "builder.verify.tests", subject_type: "workflow", step_id: "verify" },
        },
      },
    ],
    evidence: [
      {
        id: "ev-tests",
        claimId: "claim-tests",
        evidenceType: "test_output",
        method: "validation",
        sourceRef: `${taskSlug}/evidence.json`,
        excerptOrSummary: "node --test passes",
        observedAt: "2026-07-20T10:04:00Z",
        collectedBy: "flow-agents/workflow-sidecar",
        passing: true,
      },
    ],
    events: [
      { id: "evt-tests", claimId: "claim-tests", status: "verified", actor: "flow-agents/workflow-sidecar", method: "validation", evidenceIds: ["ev-tests"], createdAt: "2026-07-20T10:04:30Z", verifiedAt: "2026-07-20T10:04:30Z" },
    ],
    policies: [],
    evidenceRequirementsByClaimId: {},
    transparencyGaps: [],
    changeRecords: [],
    subjectGroups: [],
    claimGroupRollups: [],
    summary: {
      totalClaims: 1,
      byStatus: { verified: 1 },
      byFacet: {},
      confidenceBasis: { sourceQuality: {}, reviewerAuthority: {}, evidenceStrength: {}, corroboratedClaims: 0, averageExtractionConfidence: null, freshnessAtRisk: [], conflictedClaims: [] },
      transparencyGapsByType: {},
      highImpactUnsupported: [],
      staleClaims: [],
      disputedClaims: [],
      recomputeNeededClaims: [],
    },
    ...overrides,
  };
}

function trustEntry(taskSlug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `trust.workflow.${taskSlug}.f00dcafe`,
    family: "workflow",
    nonAuthority: true,
    subjectRef: { product: "flow-agents", kind: "workflow", id: taskSlug, label: taskSlug },
    sourceRef: { product: "flow-agents", kind: "trust-bundle", id: taskSlug, label: `${taskSlug}/trust.bundle` },
    payload: trustReport(taskSlug),
    gateAssociations: [{ gateId: "tests-evidence", claimIds: ["claim-tests"], evidenceIds: ["ev-tests"], eventIds: ["evt-tests"] }],
    sourceOfTruthRefs: [
      { product: "github", kind: "work-item", id: "github:kontourai/flow-agents#254", label: "github:kontourai/flow-agents#254", url: "https://github.com/kontourai/flow-agents/issues/254", sourcePath: `${taskSlug}/state.json` },
    ],
    extensions: { "flow-agents": { task_slug: taskSlug, source_path: `${taskSlug}/trust.bundle` } },
    ...overrides,
  };
}

const checkoutBannerTrust = trustEntry("checkout-banner");

// ── AC: evidence/claims planes light up ─────────────────────────────────────

test("a trust entry's gate association folds into a gate with evidenceRefs and expectationRefs (claims)", () => {
  const { events, warnings } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(checkoutBannerTrust));
  assert.deepEqual(warnings, []);
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-trust.jsonl", events }]);

  assert.equal(state.gates.length, 1);
  const gate = state.gates[0] as any;
  assert.equal(gate.id, qualifiedGateId("checkout-banner", "tests-evidence"));
  assert.equal(gate.evidenceRefs.length, 1);
  assert.equal(gate.evidenceRefs[0].kind, "evidence");
  assert.equal(gate.expectationRefs.length, 1);
  assert.equal(gate.expectationRefs[0].kind, "claim");
  assert.equal(gate.processRef.id, qualifiedWorkflowId("checkout-banner"));
});

test("a trust entry's evidence and claims populate the evidence[] and claims[] planes", () => {
  const { events } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(checkoutBannerTrust));
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-trust.jsonl", events }]);

  assert.equal(state.evidence.length, 1);
  assert.equal((state.evidence[0] as any).summary, "node --test passes");
  assert.equal((state.evidence[0] as any).claimRefs.length, 1);

  assert.equal(state.claims.length, 1);
  assert.equal((state.claims[0] as any).status, "verified");
});

test("the FULL Surface trust report is retrievable from both the process and the gate object, verbatim", () => {
  const { events } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(checkoutBannerTrust));
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-trust.jsonl", events }]);

  assert.equal(state.processes.length, 1);
  assert.deepEqual((state.processes[0] as any).trustReport, checkoutBannerTrust.payload);
  assert.deepEqual((state.gates[0] as any).trustReport, checkoutBannerTrust.payload);
});

test("a trust entry with NO gate associations still delivers the report on the process (no data loss)", () => {
  const noGateEntry = trustEntry("solo-workflow", { gateAssociations: [] });
  const { events, warnings } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(noGateEntry));
  assert.deepEqual(warnings, []);
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-trust.jsonl", events }]);

  assert.equal(state.gates.length, 0);
  assert.equal(state.processes.length, 1);
  assert.deepEqual((state.processes[0] as any).trustReport, noGateEntry.payload);
});

// ── AC: Surface stays authority -- never a fabricated verdict ──────────────

test("gate events never assert a pass/fail status -- Surface's own claim statuses are relayed on the claims plane, not recomputed onto the gate", () => {
  const { events } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(checkoutBannerTrust));
  const gateEvent = events.find((event: any) => event.type === "gate.opened");
  assert.equal((gateEvent!.payload as any).after.status, undefined);
});

// ── AC: fail-safe per-entry / per-sub-record validation ────────────────────

test("a malformed trust entry is skipped, valid siblings still deliver", () => {
  const malformed: any = { ...checkoutBannerTrust, id: "trust.workflow.malformed.9999", subjectRef: undefined };
  const validEntry = trustEntry("pricing-audit");
  const { events, warnings } = translateWorkflowTrustProjectionEnvelope(trustEnvelope([malformed, validEntry]));

  // 1 process + 1 gate + 1 claim + 1 evidence event for the valid sibling only.
  assert.equal(events.length, 4);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /subjectRef/);

  const state = buildCurrentOperatingState([{ relativePath: "malformed.jsonl", events }]);
  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].id, qualifiedWorkflowId("pricing-audit"));
});

test("a malformed gate association is skipped with a warning; the entry's other data still delivers", () => {
  const badGateAssociation = trustEntry("bad-gate", {
    gateAssociations: [{ gateId: "", claimIds: ["claim-tests"], evidenceIds: ["ev-tests"], eventIds: ["evt-tests"] }],
  });
  const { events, warnings } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(badGateAssociation));

  assert.match(warnings.join("\n"), /gateAssociations\[0\] is not well-formed/);
  const state = buildCurrentOperatingState([{ relativePath: "bad-gate.jsonl", events }]);
  assert.equal(state.gates.length, 0);
  // The process (carrying the full report) and the claim/evidence planes still deliver.
  assert.equal(state.processes.length, 1);
  assert.equal(state.claims.length, 1);
  assert.equal(state.evidence.length, 1);
});

test("readWorkflowTrustProjectionEnvelope rejects a structurally malformed envelope (missing producer.product / scope.id)", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-trust-envelope-malformed-"));
  const missingProducerProduct = { ...trustEnvelope(checkoutBannerTrust), producer: { id: "flow-agents-trust" } };
  const missingScopeId = { ...trustEnvelope(checkoutBannerTrust), scope: { kind: "repo" } };

  const p1 = join(dir, "missing-producer-product.json");
  writeFileSync(p1, JSON.stringify(missingProducerProduct));
  assert.throws(() => readWorkflowTrustProjectionEnvelope(p1), /producer\.product/);

  const p2 = join(dir, "missing-scope-id.json");
  writeFileSync(p2, JSON.stringify(missingScopeId));
  assert.throws(() => readWorkflowTrustProjectionEnvelope(p2), /scope\.(kind|id)/);
});

test("readWorkflowTrustProjectionEnvelope rejects a non-matching (process-projection-shaped) file", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-trust-envelope-"));
  const processPath = join(dir, "process.json");
  writeFileSync(processPath, JSON.stringify({
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-07-20T12:00:00Z",
    scope: DEFAULT_TRUST_SCOPE,
    producer: { id: "flow-agents-process", product: "flow-agents" },
    processes: [],
  }));
  assert.throws(() => readWorkflowTrustProjectionEnvelope(processPath), /not a workflow-trust projection envelope/);
  assert.equal(isWorkflowTrustProjectionEnvelope(JSON.parse(require("node:fs").readFileSync(processPath, "utf8"))), false);
});

// ── AC: idempotency + read-only ─────────────────────────────────────────────

test("bridgeWorkflowTrustProjection is read-only over the envelope file and idempotent across passes", async () => {
  const projectionRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-"));
  const producerDir = join(projectionRoot, "flow-agents-trust");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(trustEnvelope(checkoutBannerTrust)));

  const discovery = discoverWorkflowTrustProjections(projectionRoot);
  assert.equal(discovery.envelopePaths.length, 1);

  const sink = new InMemorySink({ sinkId: "workflow-trust-bridge-test" });
  const sentIds = new Set<string>();

  const first = await bridgeWorkflowTrustProjection(envelopePath, sink, { allowedRoot: discovery.allowedRoot }, sentIds);
  assert.equal(first.events, 4); // process + gate + claim + evidence
  assert.equal(first.accepted, 4);
  assert.equal(first.duplicates, 0);
  assert.equal(first.failed, 0);
  assert.deepEqual(first.warnings, []);

  const second = await bridgeWorkflowTrustProjection(envelopePath, sink, { allowedRoot: discovery.allowedRoot }, sentIds);
  assert.equal(second.accepted, 0);
  assert.equal(second.duplicates, 4);
  assert.equal(sink.records.length, 4);

  const state = buildCurrentOperatingState([{ relativePath: "workflow-trust-bridge.jsonl", events: sink.records }]);
  assert.equal(state.processes.length, 1);
  assert.equal(state.gates.length, 1);
});

test("changed evidence (report content advances) re-derives NEW ids on the next pass -- not treated as a duplicate", async () => {
  const projectionRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-advance-"));
  const producerDir = join(projectionRoot, "flow-agents-trust");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(trustEnvelope(checkoutBannerTrust)));

  const sink = new InMemorySink({ sinkId: "workflow-trust-bridge-advance-test" });
  const sentIds = new Set<string>();
  const first = await bridgeWorkflowTrustProjection(envelopePath, sink, {}, sentIds);
  assert.equal(first.accepted, 4);

  const advancedReport = trustReport("checkout-banner", { generatedAt: "2026-07-21T09:00:00Z" });
  (advancedReport as any).claims[0].status = "disputed";
  const advancedEntry = trustEntry("checkout-banner", { payload: advancedReport });
  writeFileSync(envelopePath, JSON.stringify(trustEnvelope(advancedEntry)));

  const second = await bridgeWorkflowTrustProjection(envelopePath, sink, {}, sentIds);
  // The process, gate, and claim events all embed the whole/claim-level report
  // content in their digest, so the advanced report (new generatedAt + a
  // disputed claim status) re-derives NEW ids for all three. The evidence
  // item itself did not change, so its event re-derives the SAME id and is
  // correctly deduped as a duplicate -- proving the content-addressing is
  // scoped to what actually changed, not a blanket re-accept of everything.
  assert.equal(second.duplicates, 1);
  assert.equal(second.accepted, 3);

  const state = buildCurrentOperatingState([{ relativePath: "workflow-trust-bridge-advance.jsonl", events: sink.records }]);
  assert.equal(state.processes.length, 1);
  assert.equal((state.claims[0] as any).status, "disputed");
});

// ── AC: scope-collision distinctness ────────────────────────────────────────

test("two different scopes with the SAME workflow task_slug fold into TWO DISTINCT processes and gates", () => {
  const scopeA = { kind: "repo", id: "repo-a" };
  const scopeB = { kind: "repo", id: "repo-b" };
  const entryA = trustEntry("demo");
  const entryB = trustEntry("demo");

  const { events: eventsA } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(entryA, "2026-07-20T12:00:00Z", scopeA));
  const { events: eventsB } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(entryB, "2026-07-20T12:00:00Z", scopeB));

  const state = buildCurrentOperatingState([{ relativePath: "two-scopes.jsonl", events: [...eventsA, ...eventsB] }]);
  assert.equal(state.processes.length, 2);
  assert.equal(state.gates.length, 2);
  const processIds = state.processes.map((process: any) => process.id).sort();
  assert.deepEqual(processIds, [qualifiedWorkflowId("demo", scopeA), qualifiedWorkflowId("demo", scopeB)].sort());
});

// ── console#254 core acceptance: process-bridge + trust-bridge JOIN ────────

test("process-bridge and trust-bridge output for the SAME workflow slug folds into ONE process, with its gate carrying evidenceRefs", () => {
  const processEntry = {
    id: "process.workflow.checkout-banner.a1b2c3d4",
    family: "workflow",
    nonAuthority: true,
    subjectRef: { product: "flow-agents", kind: "workflow", id: "checkout-banner", label: "checkout-banner" },
    sourceRef: { product: "flow-agents", kind: "workflow-state", id: "checkout-banner", label: "checkout-banner/state.json" },
    summary: "return to implement and replace failing evidence attempt 1/3",
    status: "review_pending",
    blockedReason: "an independent review is required and has not yet recorded a verdict (trust.bundle carries an unresolved live critique)",
    extensions: {
      "flow-agents": {
        task_slug: "checkout-banner",
        workflow_status: "verifying",
        phase: "verify",
        next_action_status: "continue",
        has_unresolved_critique: true,
        updated_at: "2026-07-20T11:55:00Z",
        source_path: "checkout-banner/state.json",
      },
    },
  };
  const processEnvelope = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-07-20T12:00:00Z",
    scope: DEFAULT_TRUST_SCOPE,
    producer: { id: "flow-agents-process", product: "flow-agents" },
    derivedFrom: {
      mode: "direct_snapshot",
      eventHistory: "unavailable",
      directSnapshot: {
        id: "flow-agents-process:repo:flow-agents",
        emittedAt: "2026-07-20T12:00:00Z",
        producer: { id: "flow-agents-process", product: "flow-agents" },
        reason: "workflow-process projection is derived from local workflow state/handoff sidecars",
        sourceRef: { product: "flow-agents", kind: "workflow-process", id: ".kontourai/flow-agents/*/state.json", label: "Local workflow state sidecars" },
      },
    },
    processes: [processEntry],
  };

  // Byte-identical subjectRef between the two independently-authored producer
  // envelopes (console#254's join precondition).
  assert.deepEqual(processEntry.subjectRef, checkoutBannerTrust.subjectRef);

  const { events: processEvents } = translateWorkflowProcessProjectionEnvelope(processEnvelope);
  const { events: trustEvents } = translateWorkflowTrustProjectionEnvelope(trustEnvelope(checkoutBannerTrust));

  const state = buildCurrentOperatingState([{ relativePath: "process-and-trust.jsonl", events: [...processEvents, ...trustEvents] }]);

  // ONE process, not two.
  assert.equal(state.processes.length, 1);
  const process = state.processes[0] as any;
  assert.equal(process.id, qualifiedWorkflowId("checkout-banner"));
  // The process bridge's OWN status/blockedReason survive untouched -- the
  // trust bridge's process.progressed event never competes for them.
  assert.equal(process.status, "review_pending");
  assert.equal(process.blockedReason, processEntry.blockedReason);
  // The trust bridge's report lands on the SAME process card.
  assert.deepEqual(process.trustReport, checkoutBannerTrust.payload);

  // ONE gate, pointing back at that SAME process, carrying evidenceRefs.
  assert.equal(state.gates.length, 1);
  const gate = state.gates[0] as any;
  assert.equal(gate.processRef.id, process.id);
  assert.equal(gate.evidenceRefs.length, 1);
  assert.equal(gate.expectationRefs.length, 1);

  // The claims/evidence planes are populated too.
  assert.equal(state.claims.length, 1);
  assert.equal(state.evidence.length, 1);
});

// ── TOCTOU containment recheck (mirrors workflow-process-bridge.ts) ────────

test("bridgeWorkflowTrustProjection rejects an envelope whose producer directory was swapped for an external symlink after discovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-trust-toctou-"));
  const producerDir = join(root, "flow-agents-trust");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(trustEnvelope(checkoutBannerTrust)));

  const discovery = discoverWorkflowTrustProjections(root);
  assert.equal(discovery.envelopePaths.length, 1);

  const outsideRoot = mkdtempSync(join(tmpdir(), "workflow-trust-toctou-outside-"));
  const outsideProducerDir = join(outsideRoot, "flow-agents-trust");
  mkdirSync(outsideProducerDir, { recursive: true });
  writeFileSync(join(outsideProducerDir, "repo-flow-agents.json"), JSON.stringify(trustEnvelope(trustEntry("pricing-audit"))));

  renameSync(producerDir, join(root, "flow-agents-trust-original"));
  symlinkSync(outsideProducerDir, producerDir, "dir");

  const sink = new InMemorySink({ sinkId: "toctou-test" });
  await assert.rejects(
    bridgeWorkflowTrustProjection(discovery.envelopePaths[0], sink, { allowedRoot: discovery.allowedRoot }, new Set<string>()),
    /escapes the allowed projection root/,
  );
  assert.equal(sink.records.length, 0, "the escaping envelope must never reach the sink");
});

// ── Discovery ────────────────────────────────────────────────────────────

test("discoverWorkflowTrustProjections finds envelope files under <root>/<producer>/*.json", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-trust-discovery-"));
  const producerDir = join(root, "flow-agents-trust");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(trustEnvelope(checkoutBannerTrust)));

  const discovery = discoverWorkflowTrustProjections(root);
  assert.deepEqual(discovery.envelopePaths, [realpathSync(envelopePath)]);
});

test("discoverWorkflowTrustProjections returns nothing for a root that does not exist", () => {
  const discovery = discoverWorkflowTrustProjections(join(tmpdir(), "workflow-trust-discovery-missing-does-not-exist"));
  assert.deepEqual(discovery.envelopePaths, []);
});

// ── CLI bin ─────────────────────────────────────────────────────────────

test("kontour-trust-bridge CLI discovers the default projection root and bridges into a live hub", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-cli-"));
  const producerDir = join(projectRoot, ".kontourai", "console", "projections", "flow-agents-trust");
  mkdirSync(producerDir, { recursive: true });
  writeFileSync(join(producerDir, "repo-flow-agents.json"), JSON.stringify(trustEnvelope(checkoutBannerTrust)));

  const kontourRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-cli-hub-"));
  const app = createConsoleHubServer({ rootDir: kontourRoot, kontourRoot, port: 0 });
  await new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
  const address = app.server.address() as { port: number };

  try {
    const cliPath = join(__dirname, "..", "bin", "kontour-trust-bridge.ts");
    const { stdout } = await execFileAsync(process.execPath, [
      "--import", tsxLoader, cliPath, "--no-local", "--hub", `http://127.0.0.1:${address.port}`,
    ], { cwd: projectRoot });
    assert.match(stdout, /repo-flow-agents\.json: 4 events \(4 accepted, 0 duplicate, 0 failed\)/);

    const state = await fetch(`http://127.0.0.1:${address.port}/state`).then((response: any) => response.json());
    const bridgedProcess = (state.processes || []).find((item: any) => item.id === qualifiedWorkflowId("checkout-banner"));
    assert.ok(bridgedProcess, "bridged process should appear in the hub's OperatingState");
    assert.ok(bridgedProcess.trustReport, "bridged process should carry the trust report");
  } finally {
    await new Promise((resolve: any) => app.close(resolve));
  }
});

test("kontour-trust-bridge CLI reports no projections under an empty default root", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-cli-empty-"));
  const cliPath = join(__dirname, "..", "bin", "kontour-trust-bridge.ts");
  const { stdout } = await execFileAsync(process.execPath, ["--import", tsxLoader, cliPath], { cwd: projectRoot });

  assert.match(stdout, /no workflow-trust projections under .*\.kontourai\/console\/projections/);
});

test("kontour-trust-bridge CLI prints a warning for a malformed sibling entry and still bridges the valid one", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-cli-warn-"));
  const producerDir = join(projectRoot, ".kontourai", "console", "projections", "flow-agents-trust");
  mkdirSync(producerDir, { recursive: true });
  const malformed: any = { ...checkoutBannerTrust, id: "trust.workflow.malformed.9999", subjectRef: undefined };
  const validEntry = trustEntry("pricing-audit");
  writeFileSync(join(producerDir, "repo-flow-agents.json"), JSON.stringify(trustEnvelope([malformed, validEntry])));

  const kontourRoot = mkdtempSync(join(tmpdir(), "workflow-trust-bridge-cli-warn-hub-"));
  const app = createConsoleHubServer({ rootDir: kontourRoot, kontourRoot, port: 0 });
  await new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
  const address = app.server.address() as { port: number };

  try {
    const cliPath = join(__dirname, "..", "bin", "kontour-trust-bridge.ts");
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "--import", tsxLoader, cliPath, "--no-local", "--hub", `http://127.0.0.1:${address.port}`,
    ], { cwd: projectRoot });
    assert.match(stderr, /warning: repo-flow-agents\.json: trusts\[0\] \(trust\.workflow\.malformed\.9999\)\.subjectRef must be a \{product,kind,id\} ref/);
    assert.match(stdout, /repo-flow-agents\.json: 4 events \(4 accepted, 0 duplicate, 0 failed\)/);
  } finally {
    await new Promise((resolve: any) => app.close(resolve));
  }
});
