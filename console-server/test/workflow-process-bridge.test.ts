const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFile } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, renameSync, realpathSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");
const {
  bridgeWorkflowProcessProjection,
  buildCurrentOperatingState,
  discoverWorkflowProcessProjections,
  InMemorySink,
  isWorkflowProcessProjectionEnvelope,
  readWorkflowProcessProjectionEnvelope,
  translateWorkflowProcessProjectionEnvelope,
} = require("../src/console-foundation");
const { createConsoleHubServer } = require("../src/console-foundation/console-hub-server");

const execFileAsync = promisify(execFile);
const tsxLoader = require.resolve("tsx");

// Fixture envelopes below are hand-built to mirror flow-agents' REAL producer
// output field-for-field (src/lib/workflow-process-projection.ts,
// `buildWorkflowProcessProjection`/`mapProcessSource`/
// `deriveConsoleProcessBlockedReason`, flow-agents#778) -- console does not
// depend on flow-agents (its package.json `exports` map does not publish this
// shape on a stable subpath; see workflow-process-bridge.ts's module doc
// comment), so this is the "generate one matching the producer" option the
// acceptance criteria calls out. The `blockedReason` values below are computed
// the SAME way flow-agents' own `deriveConsoleProcessBlockedReason` derives
// them, not invented ad hoc:
//   - blocked: handoff.json blockers, joined with "; ".
//   - needs_input: next_action.summary (next_action.status === "needs_user").
//   - review_pending: the fixed sentence flow-agents emits when a live
//     trust.bundle critique is unresolved (no free-text reason field exists
//     for it upstream).

const DEFAULT_SCOPE = { kind: "repo", id: "flow-agents" };
const DEFAULT_PRODUCER = { id: "flow-agents-process", product: "flow-agents" };

function envelope(processEntries: Record<string, unknown> | Record<string, unknown>[], generatedAt = "2026-07-20T12:00:00Z", scope = DEFAULT_SCOPE, producer = DEFAULT_PRODUCER) {
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
        id: "flow-agents-process:repo:flow-agents",
        emittedAt: generatedAt,
        producer,
        reason: "workflow-process projection is derived from local workflow state/handoff sidecars and trust.bundle critique state; Console event history is unavailable",
        sourceRef: {
          product: "flow-agents",
          kind: "workflow-process",
          id: ".kontourai/flow-agents/*/state.json",
          label: "Local workflow state sidecars",
        },
      },
    },
    processes: Array.isArray(processEntries) ? processEntries : [processEntries],
  };
}

/** Mirrors `qualifiedSubjectId` in workflow-process-bridge.ts: `<producer.product>:<scope.kind>:<scope.id>:<entry.id>` (console#239 review finding 1). */
function qualifiedProcessId(entryId: string, scope = DEFAULT_SCOPE, producerProduct = DEFAULT_PRODUCER.product) {
  return `${producerProduct}:${scope.kind}:${scope.id}:${entryId}`;
}

const blockedEntry = {
  id: "process.workflow.checkout-banner.a1b2c3d4",
  family: "workflow",
  nonAuthority: true,
  subjectRef: { product: "flow-agents", kind: "workflow", id: "checkout-banner", label: "checkout-banner" },
  sourceRef: { product: "flow-agents", kind: "workflow-state", id: "checkout-banner", label: "checkout-banner/state.json" },
  summary: "engineer needs to confirm pricing precision before continuing",
  status: "blocked",
  blockedReason: "Waiting on design sign-off; Needs API contract confirmation",
  extensions: {
    "flow-agents": {
      task_slug: "checkout-banner",
      workflow_status: "blocked",
      phase: "implement",
      next_action_status: "blocked",
      updated_at: "2026-07-20T11:55:00Z",
      source_path: "checkout-banner/state.json",
    },
  },
};

const needsInputEntry = {
  id: "process.workflow.pricing-audit.e5f6a7b8",
  family: "workflow",
  nonAuthority: true,
  subjectRef: { product: "flow-agents", kind: "workflow", id: "pricing-audit", label: "pricing-audit" },
  sourceRef: { product: "flow-agents", kind: "workflow-state", id: "pricing-audit", label: "pricing-audit/state.json" },
  summary: "Confirm whether legacy discount codes should still be honored.",
  status: "needs_input",
  blockedReason: "Confirm whether legacy discount codes should still be honored.",
  extensions: {
    "flow-agents": {
      task_slug: "pricing-audit",
      workflow_status: "needs_decision",
      phase: "plan",
      next_action_status: "needs_user",
      updated_at: "2026-07-20T11:50:00Z",
      source_path: "pricing-audit/state.json",
    },
  },
};

const reviewPendingEntry = {
  id: "process.workflow.rate-limit-fix.c9d0e1f2",
  family: "workflow",
  nonAuthority: true,
  subjectRef: { product: "flow-agents", kind: "workflow", id: "rate-limit-fix", label: "rate-limit-fix" },
  sourceRef: { product: "flow-agents", kind: "workflow-state", id: "rate-limit-fix", label: "rate-limit-fix/state.json" },
  summary: "return to implement and replace failing evidence attempt 1/3",
  status: "review_pending",
  blockedReason: "an independent review is required and has not yet recorded a verdict (trust.bundle carries an unresolved live critique)",
  extensions: {
    "flow-agents": {
      task_slug: "rate-limit-fix",
      workflow_status: "verifying",
      phase: "verify",
      next_action_status: "continue",
      has_unresolved_critique: true,
      updated_at: "2026-07-20T11:45:00Z",
      source_path: "rate-limit-fix/state.json",
    },
  },
};

// ── AC1/AC2: the fold, not just envelope shape ─────────────────────────────

test("blocked workflow-process projection entry folds into OperatingState via buildCurrentOperatingState with status + blockedReason", () => {
  const { events, warnings } = translateWorkflowProcessProjectionEnvelope(envelope(blockedEntry));
  assert.deepEqual(warnings, []);
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-process.jsonl", events }]);

  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].id, qualifiedProcessId(blockedEntry.id));
  assert.equal(state.processes[0].status, "blocked");
  assert.equal(state.processes[0].blockedReason, blockedEntry.blockedReason);
});

test("needs_input workflow-process projection entry folds into OperatingState via buildCurrentOperatingState with status + blockedReason", () => {
  const { events } = translateWorkflowProcessProjectionEnvelope(envelope(needsInputEntry));
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-process.jsonl", events }]);

  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].id, qualifiedProcessId(needsInputEntry.id));
  assert.equal(state.processes[0].status, "needs_input");
  assert.equal(state.processes[0].blockedReason, needsInputEntry.blockedReason);
});

test("review_pending workflow-process projection entry folds into OperatingState via buildCurrentOperatingState with status + blockedReason", () => {
  const { events } = translateWorkflowProcessProjectionEnvelope(envelope(reviewPendingEntry));
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-process.jsonl", events }]);

  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].id, qualifiedProcessId(reviewPendingEntry.id));
  assert.equal(state.processes[0].status, "review_pending");
  assert.equal(state.processes[0].blockedReason, reviewPendingEntry.blockedReason);
});

test("a single envelope with all three interactive-session entries folds into three distinct board processes", () => {
  const { events } = translateWorkflowProcessProjectionEnvelope(envelope([blockedEntry, needsInputEntry, reviewPendingEntry]));
  const state = buildCurrentOperatingState([{ relativePath: "inline-workflow-process.jsonl", events }]);

  assert.equal(state.processes.length, 3);
  const byId = new Map<string, any>(state.processes.map((process: any) => [process.id, process]));
  assert.equal(byId.get(qualifiedProcessId(blockedEntry.id)).status, "blocked");
  assert.equal(byId.get(qualifiedProcessId(needsInputEntry.id)).status, "needs_input");
  assert.equal(byId.get(qualifiedProcessId(reviewPendingEntry.id)).status, "review_pending");
});

// ── console#239 acceptance: board COLUMN grouping, not just status string ──

test("blocked/needs_input/review_pending fold into the CORRECT board column via deriveBoard (console#239 review finding 5 -- test gap)", async () => {
  // Dynamic import (not a new package dependency): @kontourai/console-ui is a
  // sibling npm workspace hoisted into the shared node_modules by this
  // monorepo's workspace install, and tsx transpiles its TS source on the fly
  // -- no build step required, no new dependency edge added to either
  // package.json. This is test-only wiring proving the FULL pipeline (bridge
  // translate -> server fold -> UI board classification), not a source import.
  const { deriveBoard } = await import("../../console-ui/lib/src/board.js");
  const { events } = translateWorkflowProcessProjectionEnvelope(envelope([blockedEntry, needsInputEntry, reviewPendingEntry]));
  const state = buildCurrentOperatingState([{ relativePath: "board-grouping.jsonl", events }]);

  const board = deriveBoard(state as any);
  const stageOf = (entryId: string) => {
    for (const column of board.columns) {
      if (column.cards.some((card: any) => card.id === qualifiedProcessId(entryId))) return column.stage;
    }
    return undefined;
  };

  // blockedEntry's phase ("implement") is IN_FLIGHT_STEP: a blocked interactive
  // session mid-implementation is active work, not an unstarted Backlog item.
  assert.equal(stageOf(blockedEntry.id), "in-flight");
  // needsInputEntry's phase ("plan") is PLANNING_STEP.
  assert.equal(stageOf(needsInputEntry.id), "planning");
  // reviewPendingEntry's phase ("verify") is VERIFY_STEP.
  assert.equal(stageOf(reviewPendingEntry.id), "verify");

  // Regression guard for the review's specific concern: if currentStep/phase
  // were ever dropped from the fold, blockedEntry's status alone ("blocked")
  // matches none of deriveBoard's status-only fallback regexes, and it would
  // silently land in Backlog instead of In flight -- with the status/
  // blockedReason assertions elsewhere in this file still green.
  const backlogColumn = board.columns.find((column: any) => column.stage === "backlog");
  assert.ok(backlogColumn, "board should always have a backlog column");
  for (const card of backlogColumn!.cards) {
    assert.notEqual(card.id, qualifiedProcessId(blockedEntry.id));
  }
});

// ── console#239 review finding 1: scope-qualified identity ────────────────

test("review finding 1: two different scopes with the SAME producer-derived entry id fold into TWO DISTINCT board processes, not one", () => {
  const scopeA = { kind: "repo", id: "repo-a" };
  const scopeB = { kind: "repo", id: "repo-b" };
  const envelopeA = envelope(blockedEntry, "2026-07-20T12:00:00Z", scopeA);
  const envelopeB = envelope({ ...needsInputEntry, id: blockedEntry.id }, "2026-07-20T12:00:00Z", scopeB);

  // SAME entry.id in both scopes -- mirrors the producer's own id derivation,
  // which is scope-independent (deterministicProcessId keys ONLY off
  // relative-source-path + task-slug, flow-agents src/lib/workflow-process-projection.ts:634-645).
  assert.equal(envelopeA.processes[0].id, envelopeB.processes[0].id);

  const { events: eventsA } = translateWorkflowProcessProjectionEnvelope(envelopeA);
  const { events: eventsB } = translateWorkflowProcessProjectionEnvelope(envelopeB);
  assert.notEqual(eventsA[0].subject.id, eventsB[0].subject.id);
  assert.notEqual(eventsA[0].id, eventsB[0].id);
  assert.equal(eventsA[0].subject.id, qualifiedProcessId(blockedEntry.id, scopeA));
  assert.equal(eventsB[0].subject.id, qualifiedProcessId(blockedEntry.id, scopeB));

  const state = buildCurrentOperatingState([{ relativePath: "two-scopes.jsonl", events: [...eventsA, ...eventsB] }]);
  assert.equal(state.processes.length, 2);
  const byId = new Map<string, any>(state.processes.map((process: any) => [process.id, process]));
  assert.equal(byId.get(qualifiedProcessId(blockedEntry.id, scopeA)).status, "blocked");
  assert.equal(byId.get(qualifiedProcessId(blockedEntry.id, scopeB)).status, "needs_input");
});

// ── console#239 review finding 2: canonical, occurredAt-inclusive digest ──

test("review finding 2a: delimiter-ambiguous content produces DISTINCT event ids and distinct folded state (no pipe-join collision)", () => {
  const entryX = {
    ...blockedEntry,
    blockedReason: "a|blocked",
    extensions: { "flow-agents": { ...blockedEntry.extensions["flow-agents"], phase: "p" } },
  };
  const entryY = {
    ...blockedEntry,
    blockedReason: "a",
    extensions: { "flow-agents": { ...blockedEntry.extensions["flow-agents"], phase: "blocked|p" } },
  };

  const { events: eventsX } = translateWorkflowProcessProjectionEnvelope(envelope(entryX));
  const { events: eventsY } = translateWorkflowProcessProjectionEnvelope(envelope(entryY));
  assert.notEqual(eventsX[0].id, eventsY[0].id);

  const stateX = buildCurrentOperatingState([{ relativePath: "x.jsonl", events: eventsX }]);
  const stateY = buildCurrentOperatingState([{ relativePath: "y.jsonl", events: eventsY }]);
  assert.equal(stateX.processes[0].blockedReason, "a|blocked");
  assert.equal(stateX.processes[0].currentStep, "p");
  assert.equal(stateY.processes[0].blockedReason, "a");
  assert.equal(stateY.processes[0].currentStep, "blocked|p");
});

test("review finding 2b: an unchanged status/reason/phase with a LATER updated_at still advances the fold (not treated as a duplicate)", async () => {
  const projectionRoot = mkdtempSync(join(tmpdir(), "workflow-process-updated-at-"));
  const producerDir = join(projectionRoot, "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");

  writeFileSync(envelopePath, JSON.stringify(envelope(blockedEntry, "2026-07-20T12:00:00Z")));
  const sink = new InMemorySink({ sinkId: "updated-at-test" });
  const sentIds = new Set<string>();
  const first = await bridgeWorkflowProcessProjection(envelopePath, sink, {}, sentIds);
  assert.equal(first.accepted, 1);

  // Same status/blockedReason/phase -- ONLY updated_at moved forward two days
  // (still-blocked session, re-confirmed; the board should reflect the LATEST
  // timestamp, not silently discard the re-poll as a duplicate).
  const laterEntry = {
    ...blockedEntry,
    extensions: { "flow-agents": { ...blockedEntry.extensions["flow-agents"], updated_at: "2026-07-22T12:00:00Z" } },
  };
  writeFileSync(envelopePath, JSON.stringify(envelope(laterEntry, "2026-07-22T12:05:00Z")));
  const second = await bridgeWorkflowProcessProjection(envelopePath, sink, {}, sentIds);
  assert.equal(second.duplicates, 0, "a real updated_at advance must NOT be treated as a duplicate");
  assert.equal(second.accepted, 1);
  assert.notEqual(sink.records[0].id, sink.records[1].id);

  const state = buildCurrentOperatingState([{ relativePath: "updated-at.jsonl", events: sink.records }]);
  assert.equal(state.processes.length, 1, "still ONE process (upsert by subject id), not two");
  assert.equal(state.processes[0].status, "blocked");
  assert.equal(state.processes[0].updatedAt, "2026-07-22T12:00:00Z");
});

// ── console#239 review finding 3: fail-safe validation ─────────────────────

test("review finding 3: an entry with a non-string status/blockedReason is skipped, valid siblings still deliver", () => {
  const malformed: any = { ...blockedEntry, id: "process.workflow.malformed-status.99998888", status: 42, blockedReason: 99 };
  const { events, warnings } = translateWorkflowProcessProjectionEnvelope(envelope([malformed, needsInputEntry]));

  assert.equal(events.length, 1);
  assert.equal(events[0].subject.id, qualifiedProcessId(needsInputEntry.id));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /status must be a non-empty string/);

  // The valid sibling still folds correctly onto the board -- a malformed
  // entry must never drop the whole batch (console#239 review finding 3).
  const state = buildCurrentOperatingState([{ relativePath: "malformed.jsonl", events }]);
  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].status, "needs_input");
  // No process was folded with a missing/non-string status (the concrete
  // probe: {status: 42} previously copied straight into payload.after and
  // replay silently produced a statusless process the board classified as
  // Backlog).
  assert.equal(state.processes.some((process: any) => typeof process.status !== "string"), false);
});

test("review finding 3: a non-object / missing-field entry in processes[] is skipped without throwing, valid entries still deliver", () => {
  const missingSubjectRef: any = { ...blockedEntry, id: "process.workflow.missing-subject-ref.aaaa1111", subjectRef: undefined };
  const { events, warnings } = translateWorkflowProcessProjectionEnvelope(envelope([null as any, "not-an-entry" as any, missingSubjectRef, blockedEntry]));

  assert.equal(events.length, 1);
  assert.equal(events[0].subject.id, qualifiedProcessId(blockedEntry.id));
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /must be an object/);
  assert.match(warnings[1], /must be an object/);
  assert.match(warnings[2], /subjectRef/);
});

test("readWorkflowProcessProjectionEnvelope rejects a structurally malformed envelope (missing producer.product / scope.id)", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-process-envelope-malformed-"));
  const missingProducerProduct = { ...envelope(blockedEntry), producer: { id: "flow-agents-process" } };
  const missingScopeId = { ...envelope(blockedEntry), scope: { kind: "repo" } };

  const p1 = join(dir, "missing-producer-product.json");
  writeFileSync(p1, JSON.stringify(missingProducerProduct));
  assert.throws(() => readWorkflowProcessProjectionEnvelope(p1), /producer\.product/);

  const p2 = join(dir, "missing-scope-id.json");
  writeFileSync(p2, JSON.stringify(missingScopeId));
  assert.throws(() => readWorkflowProcessProjectionEnvelope(p2), /scope\.(kind|id)/);
});

// ── AC3: read-only + idempotent ────────────────────────────────────────────

test("bridgeWorkflowProcessProjection is read-only over the envelope file and idempotent across passes (second pass: duplicates, no re-accept)", async () => {
  const projectionRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-"));
  const producerDir = join(projectionRoot, "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(envelope([blockedEntry, needsInputEntry])));

  const discovery = discoverWorkflowProcessProjections(projectionRoot);
  assert.equal(discovery.envelopePaths.length, 1);

  const sink = new InMemorySink({ sinkId: "workflow-process-bridge-test" });
  const sentIds = new Set<string>();

  const first = await bridgeWorkflowProcessProjection(envelopePath, sink, { allowedRoot: discovery.allowedRoot }, sentIds);
  assert.equal(first.events, 2);
  assert.equal(first.accepted, 2);
  assert.equal(first.duplicates, 0);
  assert.equal(first.failed, 0);
  assert.deepEqual(first.warnings, []);
  assert.equal(sink.records.length, 2);

  const second = await bridgeWorkflowProcessProjection(envelopePath, sink, { allowedRoot: discovery.allowedRoot }, sentIds);
  assert.equal(second.accepted, 0);
  assert.equal(second.duplicates, 2);
  // No new records delivered to the sink on the idempotent second pass.
  assert.equal(sink.records.length, 2);

  // Re-running never duplicates PROCESSES on the folded board state either.
  const state = buildCurrentOperatingState([{ relativePath: "workflow-process-bridge.jsonl", events: sink.records }]);
  assert.equal(state.processes.length, 2);
});

test("a real status transition between bridge passes yields a NEW event id and advances the folded status (not stuck on the first pass)", async () => {
  const projectionRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-transition-"));
  const producerDir = join(projectionRoot, "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");

  // Pass 1: process is blocked.
  writeFileSync(envelopePath, JSON.stringify(envelope(blockedEntry)));
  const sink = new InMemorySink({ sinkId: "workflow-process-bridge-transition-test" });
  const sentIds = new Set<string>();
  const first = await bridgeWorkflowProcessProjection(envelopePath, sink, {}, sentIds);
  assert.equal(first.accepted, 1);

  // Pass 2: the producer re-wrote the SAME envelope file -- the session resumed.
  const resumedEntry: any = { ...blockedEntry, status: "running" };
  delete resumedEntry.blockedReason;
  writeFileSync(envelopePath, JSON.stringify(envelope(resumedEntry)));
  const second = await bridgeWorkflowProcessProjection(envelopePath, sink, {}, sentIds);
  assert.equal(second.duplicates, 0);
  assert.equal(second.accepted, 1);
  assert.notEqual(sink.records[0].id, sink.records[1].id);

  const state = buildCurrentOperatingState([{ relativePath: "workflow-process-bridge.jsonl", events: sink.records }]);
  // Still ONE process (upsert by subject id), now reflecting the LATEST status,
  // and the stale blockedReason does not survive the transition out of "blocked"
  // (console#229's own retained-not-cleared contract, already enforced by
  // current-operating-state.ts's upsertProcess -- unchanged by this bridge).
  assert.equal(state.processes.length, 1);
  assert.equal(state.processes[0].status, "running");
  assert.equal(state.processes[0].blockedReason, undefined);
});

// ── console#239 review finding 4: TOCTOU containment recheck ──────────────

test("review finding 4: bridgeWorkflowProcessProjection rejects an envelope whose producer directory was swapped for an external symlink after discovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-process-toctou-"));
  const producerDir = join(root, "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(envelope(blockedEntry)));

  const discovery = discoverWorkflowProcessProjections(root);
  assert.equal(discovery.envelopePaths.length, 1);

  const outsideRoot = mkdtempSync(join(tmpdir(), "workflow-process-toctou-outside-"));
  const outsideProducerDir = join(outsideRoot, "flow-agents-process");
  mkdirSync(outsideProducerDir, { recursive: true });
  writeFileSync(join(outsideProducerDir, "repo-flow-agents.json"), JSON.stringify(envelope(needsInputEntry)));

  // Swap the producer directory for a symlink escaping the discovered root --
  // mirrors flow-bridge's own "pinned discovery boundary rejects a run
  // replaced by an external symlink" test.
  renameSync(producerDir, join(root, "flow-agents-process-original"));
  symlinkSync(outsideProducerDir, producerDir, "dir");

  const sink = new InMemorySink({ sinkId: "toctou-test" });
  await assert.rejects(
    bridgeWorkflowProcessProjection(discovery.envelopePaths[0], sink, { allowedRoot: discovery.allowedRoot }, new Set<string>()),
    /escapes the allowed projection root/,
  );
  assert.equal(sink.records.length, 0, "the escaping envelope must never reach the sink");
});

test("readWorkflowProcessProjectionEnvelope with no allowedRoot preserves prior (unguarded) behavior for direct/programmatic callers", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-process-no-allowed-root-"));
  const envelopePath = join(dir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(envelope(blockedEntry)));
  const read = readWorkflowProcessProjectionEnvelope(envelopePath);
  assert.equal(read.processes.length, 1);
});

// ── Envelope reading / shape discrimination ────────────────────────────────

test("readWorkflowProcessProjectionEnvelope reads a real envelope file and rejects a non-matching (learning-projection-shaped) file", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-process-envelope-"));
  const processPath = join(dir, "process.json");
  writeFileSync(processPath, JSON.stringify(envelope(blockedEntry)));
  const read = readWorkflowProcessProjectionEnvelope(processPath);
  assert.equal(read.processes.length, 1);
  assert.equal(read.processes[0].id, blockedEntry.id);

  const learningPath = join(dir, "learning.json");
  writeFileSync(learningPath, JSON.stringify({
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-07-20T12:00:00Z",
    scope: { kind: "repo", id: "flow-agents" },
    producer: { id: "flow-agents-learning", product: "flow-agents" },
    learnings: [],
  }));
  assert.throws(() => readWorkflowProcessProjectionEnvelope(learningPath), /not a workflow-process projection envelope/);
  assert.equal(isWorkflowProcessProjectionEnvelope(JSON.parse(require("node:fs").readFileSync(learningPath, "utf8"))), false);
});

test("readWorkflowProcessProjectionEnvelope refuses a symlinked envelope file", () => {
  const dir = mkdtempSync(join(tmpdir(), "workflow-process-envelope-symlink-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "workflow-process-envelope-outside-"));
  const outsideFile = join(outsideDir, "outside.json");
  writeFileSync(outsideFile, JSON.stringify(envelope(blockedEntry)));
  const linkedPath = join(dir, "linked.json");
  symlinkSync(outsideFile, linkedPath);

  assert.throws(() => readWorkflowProcessProjectionEnvelope(linkedPath), /must not be a symlink/);
});

// ── Discovery ────────────────────────────────────────────────────────────

test("discoverWorkflowProcessProjections finds envelope files under <root>/<producer>/*.json", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-process-discovery-"));
  const producerDir = join(root, "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  const envelopePath = join(producerDir, "repo-flow-agents.json");
  writeFileSync(envelopePath, JSON.stringify(envelope(blockedEntry)));

  const discovery = discoverWorkflowProcessProjections(root);
  // Compared via realpath: discovery resolves the canonical path (matching
  // flow-bridge's own discoverFlowRuns convention), which on macOS differs
  // from the raw tmpdir() path (/tmp -> /private/tmp).
  assert.deepEqual(discovery.envelopePaths, [realpathSync(envelopePath)]);
});

test("discoverWorkflowProcessProjections returns nothing for a root that does not exist", () => {
  const discovery = discoverWorkflowProcessProjections(join(tmpdir(), "workflow-process-discovery-missing-does-not-exist"));
  assert.deepEqual(discovery.envelopePaths, []);
});

test("discoverWorkflowProcessProjections stays confined when a producer directory is a symlink escaping the root", () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-process-discovery-confined-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "workflow-process-discovery-outside-"));
  const outsideProducerDir = join(outsideRoot, "flow-agents-process");
  mkdirSync(outsideProducerDir, { recursive: true });
  writeFileSync(join(outsideProducerDir, "outside.json"), JSON.stringify(envelope(blockedEntry)));
  symlinkSync(outsideProducerDir, join(root, "flow-agents-process"));

  const discovery = discoverWorkflowProcessProjections(root);
  assert.deepEqual(discovery.envelopePaths, []);
});

// ── CLI bin ─────────────────────────────────────────────────────────────

test("kontour-process-bridge CLI discovers the default projection root and bridges into a live hub", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-cli-"));
  const producerDir = join(projectRoot, ".kontourai", "console", "projections", "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  writeFileSync(join(producerDir, "repo-flow-agents.json"), JSON.stringify(envelope(blockedEntry)));

  const kontourRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-cli-hub-"));
  const app = createConsoleHubServer({ rootDir: kontourRoot, kontourRoot, port: 0 });
  await new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
  const address = app.server.address() as { port: number };

  try {
    const cliPath = join(__dirname, "..", "bin", "kontour-process-bridge.ts");
    const { stdout } = await execFileAsync(process.execPath, [
      "--import", tsxLoader, cliPath, "--no-local", "--hub", `http://127.0.0.1:${address.port}`,
    ], { cwd: projectRoot });
    assert.match(stdout, /repo-flow-agents\.json: 1 events \(1 accepted, 0 duplicate, 0 failed\)/);

    const state = await fetch(`http://127.0.0.1:${address.port}/state`).then((response: any) => response.json());
    const bridgedProcess = (state.processes || []).find((item: any) => item.id === qualifiedProcessId(blockedEntry.id));
    assert.ok(bridgedProcess, "bridged process should appear in the hub's OperatingState");
    assert.equal(bridgedProcess.status, "blocked");
    assert.equal(bridgedProcess.blockedReason, blockedEntry.blockedReason);
  } finally {
    await new Promise((resolve: any) => app.close(resolve));
  }
});

test("kontour-process-bridge CLI reports no projections under an empty default root", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-cli-empty-"));
  const cliPath = join(__dirname, "..", "bin", "kontour-process-bridge.ts");
  const { stdout } = await execFileAsync(process.execPath, ["--import", tsxLoader, cliPath], { cwd: projectRoot });

  assert.match(stdout, /no workflow-process projections under .*\.kontourai\/console\/projections/);
});

test("kontour-process-bridge CLI prints a warning for a malformed sibling entry and still bridges the valid one", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-cli-warn-"));
  const producerDir = join(projectRoot, ".kontourai", "console", "projections", "flow-agents-process");
  mkdirSync(producerDir, { recursive: true });
  const malformed: any = { ...blockedEntry, id: "process.workflow.malformed-status.99998888", status: 42 };
  writeFileSync(join(producerDir, "repo-flow-agents.json"), JSON.stringify(envelope([malformed, needsInputEntry])));

  const kontourRoot = mkdtempSync(join(tmpdir(), "workflow-process-bridge-cli-warn-hub-"));
  const app = createConsoleHubServer({ rootDir: kontourRoot, kontourRoot, port: 0 });
  await new Promise((resolve: any) => app.listen({ port: 0 }, resolve));
  const address = app.server.address() as { port: number };

  try {
    const cliPath = join(__dirname, "..", "bin", "kontour-process-bridge.ts");
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "--import", tsxLoader, cliPath, "--no-local", "--hub", `http://127.0.0.1:${address.port}`,
    ], { cwd: projectRoot });
    assert.match(stderr, /warning: repo-flow-agents\.json: processes\[0\] \(process\.workflow\.malformed-status\.99998888\)\.status must be a non-empty string/);
    assert.match(stdout, /repo-flow-agents\.json: 1 events \(1 accepted, 0 duplicate, 0 failed\)/);
  } finally {
    await new Promise((resolve: any) => app.close(resolve));
  }
});
