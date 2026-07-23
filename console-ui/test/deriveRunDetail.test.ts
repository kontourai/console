import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleGate, ConsoleProcess, OperatingState, Pipeline, PipelineStage, TimelineItem } from "@kontourai/console-core";
import { deriveRunDetail, RUN_TIMELINE_LIMIT } from "../src/sections/board/deriveRunDetail";
import { classifyActivity } from "../src/sections/workers/derive";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
}

function stage(s: Partial<PipelineStage> & { id: string; order: number; status: PipelineStage["status"] }): PipelineStage {
  return { label: s.id, gates: [], ...s };
}

function pipeline(overrides: Partial<Pipeline> & { runId: string }): Pipeline {
  return {
    runLabel: "",
    runStatus: "running",
    edges: [],
    currentStageId: null,
    stages: [],
    ...overrides,
  };
}

// ── run not found ────────────────────────────────────────────────────────────

test("deriveRunDetail: an id absent from state.processes is null, never fabricated", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", label: "Real run" })] }), "run-does-not-exist", NOW);
  assert.equal(detail, null);
});

test("deriveRunDetail: undefined/null state never crashes, still an honest null", () => {
  assert.equal(deriveRunDetail(undefined, "run-1", NOW), null);
  assert.equal(deriveRunDetail(null, "run-1", NOW), null);
});

// ── stage derivation (board-vocabulary fallback) ────────────────────────────
// console#253 review finding 2: classifyBoardStage only answers "which
// column is this run in NOW" — no gate evidence backs "which earlier stages
// completed". Predecessors of a non-terminal or failure-terminal run's
// current stage must read as the neutral "earlier", never a green-checked
// "completed"; only a genuine SUCCESS-terminal run gets "completed"
// predecessors.

test("deriveRunDetail: a non-terminal run's earlier stages are 'earlier' (neutral), never fabricated 'completed'", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", currentStep: "execute" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["earlier", "earlier", "current", "pending", "pending"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, false, true, false, false]);
});

test("deriveRunDetail: a success-terminal run (released) green-checks every earlier stage AND its own — the one defensible 'completed' inference", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", status: "released" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["completed", "completed", "completed", "completed", "completed"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, false, false, false, true]);
});

// Probe-confirmed (console#253 review finding 2): previously showed
// Backlog/Planning/In-flight as "completed" for this exact fixture.
test("deriveRunDetail: a failed run's earlier stages stay 'earlier' (not completed); its classified stage reads 'failed', never the in-progress 'current' badge", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", status: "failed", currentStep: "verify" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["earlier", "earlier", "earlier", "failed", "pending"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, false, false, true, false]);
});

// Probe-confirmed (console#253 review finding 2): previously showed every
// stage before Done as "completed" for a bare cancelled status.
test("deriveRunDetail: a cancelled run (no currentStep, lands in Done via classifyBoardStage) keeps predecessors 'earlier', not green-checked", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", status: "cancelled" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["earlier", "earlier", "earlier", "earlier", "failed"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, false, false, false, true]);
});

test("deriveRunDetail: an abandoned run is treated as failure-terminal too (terminal status wins over a lingering step, per classifyBoardStage) — predecessors 'earlier', classified 'done' stage 'failed'", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", status: "abandoned", currentStep: "plan" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["earlier", "earlier", "earlier", "earlier", "failed"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, false, false, false, true]);
});

test("deriveRunDetail: an unknown/absent currentStep falls to backlog-current, never crashes", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["current", "pending", "pending", "pending", "pending"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [true, false, false, false, false]);
});

test("deriveRunDetail: a planning-step run has exactly one 'earlier' stage (backlog) before its current one", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", currentStep: "plan" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["earlier", "current", "pending", "pending", "pending"]);
});

// ── stage derivation (real flow topology, when state.pipeline owns this run) ─

test("deriveRunDetail: a matching state.pipeline (same runId as the process) supplies real per-step stages", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        stages: [
          stage({ id: "plan", order: 0, status: "passed" }),
          stage({ id: "build", order: 1, status: "current" }),
          stage({ id: "verify", order: 2, status: "pending" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["plan", "build", "verify"]);
  assert.deepEqual(detail!.stages.map((s) => s.outcome), ["completed", "current", "pending"]);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, true, false]);
});

test("deriveRunDetail: a state.pipeline for a DIFFERENT run falls back to the board vocabulary, never attributed", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc", currentStep: "execute" })],
      pipeline: pipeline({ runId: "run-other", stages: [stage({ id: "plan", order: 0, status: "current" })] }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
});

test("deriveRunDetail: a malformed state.pipeline (no stages array) is tolerated, falls back safely", () => {
  const detail = deriveRunDetail(
    state({ processes: [proc({ id: "run-abc" })], pipeline: { runId: "run-abc" } as unknown as Pipeline }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
});

// ── console#253 review finding 1: currentStageId is authoritative for
// position, independent of that stage's own status (blocked/failed) ────────

test("deriveRunDetail: pipeline currentStageId marks the current POSITION even when that stage's own status is 'blocked' (probe case)", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        currentStageId: "build",
        stages: [
          stage({ id: "plan", order: 0, status: "passed" }),
          stage({ id: "build", order: 1, status: "blocked" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  const byId = Object.fromEntries(detail!.stages.map((s) => [s.id, s]));
  assert.equal(byId.plan.outcome, "completed");
  assert.equal(byId.plan.current, false);
  assert.equal(byId.build.outcome, "blocked");
  assert.equal(byId.build.current, true);
  assert.equal(detail!.stages.filter((s) => s.current).length, 1);
});

test("deriveRunDetail: a failed (route-back) stage can also be the run's current position", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        currentStageId: "build",
        stages: [
          stage({ id: "plan", order: 0, status: "passed" }),
          stage({ id: "build", order: 1, status: "failed" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  const build = detail!.stages.find((s) => s.id === "build")!;
  assert.equal(build.outcome, "failed");
  assert.equal(build.current, true);
});

test("deriveRunDetail: an unmatched currentStageId falls back to whichever stage's own status is literally 'current'", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        currentStageId: "does-not-exist",
        stages: [
          stage({ id: "plan", order: 0, status: "passed" }),
          stage({ id: "build", order: 1, status: "current" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.equal(detail!.stages.find((s) => s.id === "build")!.current, true);
  assert.equal(detail!.stages.filter((s) => s.current).length, 1);
});

test("deriveRunDetail: no resolvable position (no currentStageId match, no stage literally 'current') marks no stage current — never a fabricated position", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        currentStageId: null,
        stages: [
          stage({ id: "plan", order: 0, status: "passed" }),
          stage({ id: "build", order: 1, status: "passed" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.current), [false, false]);
});

// ── console#253 review finding 3: structural validation of pipeline stages ──

test("deriveRunDetail: a null entry in state.pipeline.stages is rejected wholesale — falls back, never crashes", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: {
        runId: "run-abc",
        runLabel: "",
        runStatus: "running",
        edges: [],
        currentStageId: null,
        stages: [stage({ id: "plan", order: 0, status: "passed" }), null],
      } as unknown as Pipeline,
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
});

test("deriveRunDetail: a stage missing its id is rejected wholesale — falls back, no partial adoption", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: {
        runId: "run-abc",
        runLabel: "",
        runStatus: "running",
        edges: [],
        currentStageId: null,
        stages: [{ label: "plan", order: 0, status: "passed", gates: [] }],
      } as unknown as Pipeline,
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
});

test("deriveRunDetail: duplicate stage ids are rejected wholesale — never an ambiguous topology / duplicate React key", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        stages: [
          stage({ id: "plan", order: 0, status: "passed" }),
          stage({ id: "plan", order: 1, status: "current" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
});

// ── console#253 review finding 4: a stale pipeline snapshot must not
// override the process's own fresher currentStep for the CURRENT marker ────

test("deriveRunDetail: when the pipeline's currentStageId contradicts the process's own currentStep, the process wins the position — topology/outcomes unchanged", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc", currentStep: "build" })],
      pipeline: pipeline({
        runId: "run-abc",
        currentStageId: "plan",
        stages: [
          stage({ id: "plan", order: 0, status: "current" }),
          stage({ id: "build", order: 1, status: "pending" }),
          stage({ id: "verify", order: 2, status: "passed" }),
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  const byId = Object.fromEntries(detail!.stages.map((s) => [s.id, s]));
  // Position moved to the process's fresher currentStep...
  assert.equal(byId.build.current, true);
  assert.equal(byId.plan.current, false);
  assert.equal(byId.verify.current, false);
  // ...while each stage's own outcome still reads exactly what the snapshot
  // reported (topology/outcomes are NOT touched by the position override).
  assert.equal(byId.plan.outcome, "current");
  assert.equal(byId.build.outcome, "pending");
  assert.equal(byId.verify.outcome, "completed");
});

test("deriveRunDetail: when the process's currentStep does not name any of the pipeline's own stages, the snapshot's position is kept (no override)", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc", currentStep: "some-other-phase-not-in-this-pipeline" })],
      pipeline: pipeline({
        runId: "run-abc",
        currentStageId: "plan",
        stages: [stage({ id: "plan", order: 0, status: "current" }), stage({ id: "build", order: 1, status: "pending" })],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.equal(detail!.stages.find((s) => s.id === "plan")!.current, true);
});

// ── gate history ─────────────────────────────────────────────────────────────

function gate(g: Partial<ConsoleGate> & { id: string }): ConsoleGate {
  return g as ConsoleGate;
}

test("deriveRunDetail: gate history includes only gates whose processRef targets this run", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-1" })],
      gates: [
        gate({ id: "g1", status: "passed", processRef: { id: "run-1" }, updatedAt: "2026-07-20T11:00:00.000Z" }),
        gate({ id: "g2", status: "waiting", processRef: { id: "run-other" }, updatedAt: "2026-07-20T11:30:00.000Z" }),
      ],
    }),
    "run-1",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.gates.map((g) => g.id), ["g1"]);
});

test("deriveRunDetail: gate history is ordered most-recently-updated first, undated entries sink to the bottom", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-1" })],
      gates: [
        gate({ id: "old", status: "passed", processRef: { id: "run-1" }, updatedAt: "2026-07-20T10:00:00.000Z" }),
        gate({ id: "new", status: "waiting", processRef: { id: "run-1" }, updatedAt: "2026-07-20T11:00:00.000Z" }),
        gate({ id: "undated", status: "routed_back", processRef: { id: "run-1" } }),
      ],
    }),
    "run-1",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.gates.map((g) => g.id), ["new", "old", "undated"]);
});

test("deriveRunDetail: each gate entry carries a real /gate/:id href, not a fake handler", () => {
  const detail = deriveRunDetail(
    state({ processes: [proc({ id: "run-1" })], gates: [gate({ id: "gate-authority", status: "blocked", processRef: { id: "run-1" } })] }),
    "run-1",
    NOW
  );
  assert.ok(detail);
  assert.equal(detail!.gates[0].href, "/gate/gate-authority");
});

// ── console#253 review finding 5: product/kind-qualified refs must agree
// with the process's own sourceRef — an id-only match is not enough once a
// ref makes a stronger (product/kind-qualified) claim ───────────────────────

test("deriveRunDetail: a gate ref carrying a DIFFERENT product than the process's sourceRef is excluded, even though the id matches (collision probe)", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-x", sourceRef: { product: "flow", kind: "run", id: "run-x" } })],
      gates: [gate({ id: "g1", status: "passed", processRef: { product: "other", kind: "thing", id: "run-x" } })],
    }),
    "run-x",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.gates, []);
});

test("deriveRunDetail: a gate ref with a MATCHING product/kind still joins normally", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-x", sourceRef: { product: "flow", kind: "run", id: "run-x" } })],
      gates: [gate({ id: "g1", status: "passed", processRef: { product: "flow", kind: "run", id: "run-x" } })],
    }),
    "run-x",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.gates.map((g) => g.id), ["g1"]);
});

test("deriveRunDetail: a gate ref with NO product/kind (unqualified, matching deriveBoard's own join convention) still joins on id alone", () => {
  const detail = deriveRunDetail(
    state({ processes: [proc({ id: "run-x" })], gates: [gate({ id: "g1", status: "passed", processRef: { id: "run-x" } })] }),
    "run-x",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.gates.map((g) => g.id), ["g1"]);
});

test("deriveRunDetail: a timeline item with a mismatched product is excluded from the run's timeline slice", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-x", sourceRef: { product: "flow", kind: "run", id: "run-x" } })],
      timeline: [{ id: "t1", type: "gate.opened", occurredAt: "2026-07-20T11:00:00.000Z", subjectRef: { product: "surface", kind: "claim", id: "run-x" } } as TimelineItem],
    }),
    "run-x",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.timeline, []);
});

// ── timeline filter ───────────────────────────────────────────────────────────

function timelineItem(t: Partial<TimelineItem> & { id: string }): TimelineItem {
  return t as TimelineItem;
}

test("deriveRunDetail: the timeline slice only includes items whose subjectRef targets this run", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-1" })],
      timeline: [
        timelineItem({ id: "t1", type: "process.started", occurredAt: "2026-07-20T10:00:00.000Z", subjectRef: { id: "run-1" } }),
        timelineItem({ id: "t2", type: "gate.opened", occurredAt: "2026-07-20T10:05:00.000Z", subjectRef: { id: "gate-x" } }),
      ],
    }),
    "run-1",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.timeline.map((t) => t.id), ["t1"]);
});

test("deriveRunDetail: the timeline slice is newest-first and capped at RUN_TIMELINE_LIMIT", () => {
  const items = Array.from({ length: RUN_TIMELINE_LIMIT + 5 }, (_, i) =>
    timelineItem({
      id: `t${i}`,
      occurredAt: new Date(NOW - i * 60_000).toISOString(),
      subjectRef: { id: "run-1" },
    })
  );
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1" })], timeline: items }), "run-1", NOW);
  assert.ok(detail);
  assert.equal(detail!.timeline.length, RUN_TIMELINE_LIMIT);
  assert.equal(detail!.timeline[0].id, "t0"); // most recent (least ms subtracted) first
});

// ── freshness reuse ────────────────────────────────────────────────────────────

test("deriveRunDetail: freshness/display are exactly classifyActivity's output for the process's updatedAt — reused, not re-derived", () => {
  const updatedAt = "2026-07-20T11:58:00.000Z";
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", updatedAt })] }), "run-1", NOW);
  const expected = classifyActivity(updatedAt, NOW);
  assert.ok(detail);
  assert.equal(detail!.freshness, expected.freshness);
  assert.equal(detail!.display, expected.display);
});

test("deriveRunDetail: a missing updatedAt is honestly 'unknown' freshness, never fabricated fresh", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.equal(detail!.freshness, "unknown");
  assert.equal(detail!.display, "none");
});

// ── console#256: sourceOfTruthRefs now delegates to the shared
// utils/sourceRefs.ts deriveSourceRefs (see sourceRefs.test.ts for the full
// edge-case suite: ordering, malformed entries, no-url-no-anchor, unsafe
// scheme rejection). These integration-level tests just confirm
// deriveRunDetail actually wires the process record through to it. ────────

test("deriveRunDetail: sourceOfTruthRefs is empty when the process carries none", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.sourceOfTruthRefs, []);
});

test("deriveRunDetail: sourceOfTruthRefs carries a real https URL through, and rejects an unsafe javascript: scheme (XSS probe) while still keeping its honest label", () => {
  const withRefs = {
    id: "run-1",
    sourceOfTruthRefs: [
      { kind: "work-item", id: "work-item-123", label: "Work item", url: "https://example.test/work/123" },
      { kind: "assignment-branch", id: "branch-evil", label: "evil", url: "javascript:alert(1)" },
      "not even an object",
    ],
  } as unknown as ConsoleProcess;
  const detail = deriveRunDetail(state({ processes: [withRefs] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.sourceOfTruthRefs, [
    { kind: "work-item", label: "Work item", url: "https://example.test/work/123" },
    { kind: "assignment-branch", label: "evil" },
  ]);
});

// ── run header basics ─────────────────────────────────────────────────────────

test("deriveRunDetail: carries blockedReason and percentComplete through unchanged", () => {
  const detail = deriveRunDetail(
    state({ processes: [proc({ id: "run-1", status: "needs_input", blockedReason: "Waiting on a design decision.", percentComplete: 40 })] }),
    "run-1",
    NOW
  );
  assert.ok(detail);
  assert.equal(detail!.blockedReason, "Waiting on a design decision.");
  assert.equal(detail!.percentComplete, 40);
});

test("deriveRunDetail: runId strips the run- prefix, matching board.ts's runIdFromProcessId (#178)", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-foo-123" })] }), "run-foo-123", NOW);
  assert.ok(detail);
  assert.equal(detail!.runId, "foo-123");
});
