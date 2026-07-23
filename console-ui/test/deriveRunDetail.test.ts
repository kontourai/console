import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleGate, ConsoleProcess, OperatingState, Pipeline, TimelineItem } from "@kontourai/console-core";
import { deriveRunDetail, RUN_TIMELINE_LIMIT } from "../src/sections/board/deriveRunDetail";
import { classifyActivity } from "../src/sections/workers/derive";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
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

test("deriveRunDetail: stages mark completed/current/pending around the process's currentStep", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", currentStep: "execute" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["backlog", "planning", "in-flight", "verify", "done"]);
  assert.deepEqual(detail!.stages.map((s) => s.state), ["completed", "completed", "current", "pending", "pending"]);
});

test("deriveRunDetail: a done/terminal-status run marks every earlier stage completed and 'done' current", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", status: "released" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.state), ["completed", "completed", "completed", "completed", "current"]);
});

test("deriveRunDetail: an unknown/absent currentStep falls to backlog-current, never crashes", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.state), ["current", "pending", "pending", "pending", "pending"]);
});

test("deriveRunDetail: a planning-step run has one completed stage (backlog) before its current one", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1", currentStep: "plan" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.state), ["completed", "current", "pending", "pending", "pending"]);
});

// ── stage derivation (real flow topology, when state.pipeline owns this run) ─

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

test("deriveRunDetail: a matching state.pipeline (same runId as the process) supplies real per-step stages", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc" })],
      pipeline: pipeline({
        runId: "run-abc",
        stages: [
          { id: "plan", label: "plan", order: 0, status: "passed", gates: [] },
          { id: "build", label: "build", order: 1, status: "current", gates: [] },
          { id: "verify", label: "verify", order: 2, status: "pending", gates: [] },
        ],
      }),
    }),
    "run-abc",
    NOW
  );
  assert.ok(detail);
  assert.deepEqual(detail!.stages.map((s) => s.id), ["plan", "build", "verify"]);
  assert.deepEqual(detail!.stages.map((s) => s.state), ["completed", "current", "pending"]);
});

test("deriveRunDetail: a state.pipeline for a DIFFERENT run falls back to the board vocabulary, never attributed", () => {
  const detail = deriveRunDetail(
    state({
      processes: [proc({ id: "run-abc", currentStep: "execute" })],
      pipeline: pipeline({ runId: "run-other", stages: [{ id: "plan", label: "plan", order: 0, status: "current", gates: [] }] }),
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

// ── sourceOfTruthRefs (defensive, speculative field) ─────────────────────────

test("deriveRunDetail: sourceOfTruthRefs is empty when the process carries none", () => {
  const detail = deriveRunDetail(state({ processes: [proc({ id: "run-1" })] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.sourceOfTruthRefs, []);
});

test("deriveRunDetail: sourceOfTruthRefs renders entries with a real URL, skips entries without one", () => {
  const withRefs = {
    id: "run-1",
    sourceOfTruthRefs: [
      { label: "Work item", url: "https://example.test/work/123" },
      { id: "no-url-here" },
      "not even an object",
    ],
  } as unknown as ConsoleProcess;
  const detail = deriveRunDetail(state({ processes: [withRefs] }), "run-1", NOW);
  assert.ok(detail);
  assert.deepEqual(detail!.sourceOfTruthRefs, [{ label: "Work item", url: "https://example.test/work/123" }]);
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
