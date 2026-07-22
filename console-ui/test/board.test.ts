import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyBoardStage, deriveBoard, runIdFromProcessId, BOARD_STAGES, BOARD_STAGE_LABEL } from "../lib/src/board";
import type { OperatingState, ConsoleProcess } from "@kontourai/console-core";

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
}

test("classifyBoardStage maps flow status/step onto the five stages", () => {
  assert.equal(classifyBoardStage(proc({ id: "a", status: "released" })), "done");
  assert.equal(classifyBoardStage(proc({ id: "b", status: "complete" })), "done");
  assert.equal(classifyBoardStage(proc({ id: "c", currentStep: "verify" })), "verify");
  assert.equal(classifyBoardStage(proc({ id: "d", currentStep: { id: "review-work", label: "Review Work" } })), "verify");
  assert.equal(classifyBoardStage(proc({ id: "e", currentStep: "execute" })), "in-flight");
  assert.equal(classifyBoardStage(proc({ id: "f", currentStep: "plan" })), "planning");
  assert.equal(classifyBoardStage(proc({ id: "g", currentStep: "design-probe" })), "planning");
  // unknown/empty falls to backlog
  assert.equal(classifyBoardStage(proc({ id: "h" })), "backlog");
  assert.equal(classifyBoardStage(proc({ id: "i", status: "queued" })), "backlog");
});

test("classifyBoardStage: terminal status wins over a lingering step string", () => {
  // A closed item still tagged with an 'execute' step is Done, not In flight.
  assert.equal(classifyBoardStage(proc({ id: "z", status: "closed", currentStep: "execute" })), "done");
});

test("classifyBoardStage: step drives the stage even when status is the generic 'running' (M1)", () => {
  // flow-bridge stamps EVERY non-terminal step status:"running". Stage must come
  // from the step, so a run at the plan step is Planning, not In flight.
  assert.equal(classifyBoardStage(proc({ id: "a", status: "running", currentStep: "plan" })), "planning");
  assert.equal(classifyBoardStage(proc({ id: "b", status: "running", currentStep: { id: "design-probe", label: "design-probe" } })), "planning");
  assert.equal(classifyBoardStage(proc({ id: "c", status: "running", currentStep: "execute" })), "in-flight");
  assert.equal(classifyBoardStage(proc({ id: "d", status: "running", currentStep: "verify" })), "verify");
});

test("classifyBoardStage: release/publish steps are In flight, not Backlog (M2)", () => {
  assert.equal(classifyBoardStage(proc({ id: "a", status: "running", currentStep: "release" })), "in-flight");
  assert.equal(classifyBoardStage(proc({ id: "b", status: "running", currentStep: { id: "builder.publish", label: "publish" } })), "in-flight");
  // but a terminal 'released' STATUS is Done
  assert.equal(classifyBoardStage(proc({ id: "c", status: "released" })), "done");
});

test("classifyBoardStage: status-only fallback when there is no step", () => {
  assert.equal(classifyBoardStage(proc({ id: "a", status: "running" })), "in-flight");
  assert.equal(classifyBoardStage(proc({ id: "b", status: "in-review" })), "verify");
  assert.equal(classifyBoardStage(proc({ id: "c", status: "queued" })), "backlog");
});

// console#229 (review MEDIUM): interactive-session states with no step string
// must land somewhere sane, not Backlog (unstarted) — they're active work
// stalled on a human. needs_input previously fell through every pattern to
// Backlog; this locks in the fix. review_pending already landed on Verify
// (its "review" substring matches VERIFY_STEP, checked before the in-flight
// status fallback) — asserted here too so that pairing stays intentional.
test("classifyBoardStage: interactive-session statuses with no step land in an active stage, never Backlog", () => {
  assert.equal(classifyBoardStage(proc({ id: "a", status: "needs_input" })), "in-flight");
  assert.equal(classifyBoardStage(proc({ id: "b", status: "review_pending" })), "verify");
});

test("deriveBoard groups every process into exactly one stage column, most-advanced honored", () => {
  const board = deriveBoard(state({
    processes: [
      proc({ id: "p1", label: "Backlog item" }),
      proc({ id: "p2", label: "Planning item", currentStep: "plan" }),
      proc({ id: "p3", label: "Build item", currentStep: "execute" }),
      proc({ id: "p4", label: "Verify item", currentStep: "verify" }),
      proc({ id: "p5", label: "Done item", status: "done" })
    ]
  }));
  assert.deepEqual(board.columns.map((c) => c.stage), BOARD_STAGES);
  assert.deepEqual(board.columns.map((c) => c.cards.length), [1, 1, 1, 1, 1]);
  assert.equal(board.totalCards, 5);
});

test("runIdFromProcessId strips the run- prefix to recover the projection key (#178)", () => {
  assert.equal(runIdFromProcessId("run-kontourai-flow-agents-568"), "kontourai-flow-agents-568");
  assert.equal(runIdFromProcessId("run-abc123"), "abc123");
  // no prefix → used as-is (non-flow-bridge producer)
  assert.equal(runIdFromProcessId("bare-id"), "bare-id");
  // only the leading prefix is stripped
  assert.equal(runIdFromProcessId("run-run-x"), "run-x");
});

test("deriveBoard exposes a drill-down runId per card (process id minus run- prefix)", () => {
  const board = deriveBoard(state({
    processes: [proc({ id: "run-foo", currentStep: "execute" }), proc({ id: "bare", currentStep: "execute" })]
  }));
  const cards = board.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.id === "run-foo")?.runId, "foo");
  assert.equal(cards.find((c) => c.id === "bare")?.runId, "bare");
});

test("deriveBoard tallies passed/blocked gates per card via processRef", () => {
  const board = deriveBoard(state({
    processes: [proc({ id: "item-1", currentStep: "verify" })],
    gates: [
      { id: "g1", status: "passed", processRef: { id: "item-1" } },
      { id: "g2", status: "blocked", processRef: { id: "item-1" } },
      { id: "g3", status: "approved", processRef: { id: "item-1" } },
      { id: "g4", status: "passed", processRef: { id: "other" } } // different item — excluded
    ] as OperatingState["gates"]
  }));
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === "item-1");
  assert.equal(card?.gatesPassed, 2);
  assert.equal(card?.gatesBlocked, 1);
});

// Regression: console-server emits "routed_back" (underscore) for a routed-back
// gate; the blocked set formerly checked a hyphenated "route-back" no producer
// emits, so a routed-back gate was undercounted in a card's blocked tally.
test("deriveBoard counts a routed_back gate as blocked in a card's tally", () => {
  const board = deriveBoard(state({
    processes: [proc({ id: "item-1", currentStep: "verify" })],
    gates: [
      { id: "g1", status: "routed_back", processRef: { id: "item-1" } }
    ] as OperatingState["gates"]
  }));
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === "item-1");
  assert.equal(card?.gatesBlocked, 1);
});

test("deriveBoard sorts a column's cards by updatedAt desc", () => {
  const board = deriveBoard(state({
    processes: [
      proc({ id: "old", currentStep: "execute", updatedAt: "2026-07-10T00:00:00Z" }),
      proc({ id: "new", currentStep: "execute", updatedAt: "2026-07-14T00:00:00Z" }),
      proc({ id: "mid", currentStep: "execute", updatedAt: "2026-07-12T00:00:00Z" })
    ]
  }));
  const inFlight = board.columns.find((c) => c.stage === "in-flight");
  assert.deepEqual(inFlight?.cards.map((c) => c.id), ["new", "mid", "old"]);
});

test("deriveBoard on empty/undefined state yields five empty columns, zero totals", () => {
  const board = deriveBoard(undefined);
  assert.equal(board.columns.length, 5);
  assert.equal(board.totalCards, 0);
  assert.ok(board.columns.every((c) => c.cards.length === 0));
});

// #236: blockedReason carries through onto the card unchanged, so a stalled
// interactive session (needs_input/review_pending) is actionable, not a bare
// status string.
test("deriveBoard carries blockedReason through onto the card", () => {
  const board = deriveBoard(state({
    processes: [proc({ id: "p1", status: "needs_input", blockedReason: "Waiting on a design decision from the requester." })]
  }));
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === "p1");
  assert.equal(card?.blockedReason, "Waiting on a design decision from the requester.");
  assert.equal(card?.stage, "in-flight");
});

test("deriveBoard leaves blockedReason undefined when the process has none", () => {
  const board = deriveBoard(state({ processes: [proc({ id: "p1", currentStep: "execute" })] }));
  const card = board.columns.flatMap((c) => c.cards).find((c) => c.id === "p1");
  assert.equal(card?.blockedReason, undefined);
});

// #230 review (HIGH): BOARD_STAGES/BOARD_STAGE_LABEL are exported constants a
// consumer script could try to mutate in place. Frozen exported copies must
// reject that (ES modules are strict mode: a frozen-object mutation attempt
// throws a TypeError at the mutation site) AND deriveBoard must keep working
// correctly afterward — it reads separate, private, never-exported bindings,
// not the frozen public ones, so even a defeated freeze couldn't corrupt it.
test("BOARD_STAGES is frozen: external mutation attempts throw and never corrupt board derivation", () => {
  const mutable = BOARD_STAGES as unknown as string[];
  assert.throws(() => { mutable.length = 0; }, TypeError);
  assert.throws(() => { mutable.push("hacked"); }, TypeError);
  assert.throws(() => { mutable[0] = "hacked"; }, TypeError);
  assert.deepEqual(BOARD_STAGES, ["backlog", "planning", "in-flight", "verify", "done"]);

  // A mutation attempt against the exported binding must not have corrupted
  // this module's own (private) derivation state — the board still renders
  // all five stage columns correctly.
  const board = deriveBoard(state({ processes: [proc({ id: "a", currentStep: "execute" })] }));
  assert.equal(board.columns.length, 5);
  assert.deepEqual(board.columns.map((c) => c.stage), ["backlog", "planning", "in-flight", "verify", "done"]);
});

test("BOARD_STAGE_LABEL is frozen: external key mutation/deletion throws and never corrupts board derivation", () => {
  const mutable = BOARD_STAGE_LABEL as unknown as Record<string, string>;
  assert.throws(() => { mutable.backlog = "Hacked"; }, TypeError);
  assert.throws(() => { delete mutable.backlog; }, TypeError);
  assert.equal(BOARD_STAGE_LABEL.backlog, "Backlog");

  const board = deriveBoard(state({ processes: [proc({ id: "a" })] }));
  assert.equal(board.columns.find((c) => c.stage === "backlog")?.label, "Backlog");
});
