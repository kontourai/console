import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyBoardStage, deriveBoard, BOARD_STAGES } from "../src/sections/board/board";
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
