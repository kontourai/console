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

test("deriveBoard counts distinct live agents per card by subjectId === work-item id", () => {
  const board = deriveBoard(state({
    processes: [proc({ id: "item-1", currentStep: "execute" }), proc({ id: "item-2", currentStep: "execute" })],
    actors: [
      { id: "1", actor: "sessA", subjectId: "item-1" },
      { id: "2", actor: "sessB", subjectId: "item-1" }, // a subagent on the same item
      { id: "3", actor: "sessA", subjectId: "item-1" }, // duplicate actor → still 2 distinct
      { id: "4", actor: "sessC", subjectId: "item-2" }
    ] as OperatingState["actors"]
  }));
  const cards = board.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.id === "item-1")?.liveAgentCount, 2, "two distinct actors, dedup applied");
  assert.equal(cards.find((c) => c.id === "item-2")?.liveAgentCount, 1);
  // header total counts only agents on shown cards
  assert.equal(board.liveAgentTotal, 3);
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
  assert.equal(board.liveAgentTotal, 0);
  assert.ok(board.columns.every((c) => c.cards.length === 0));
});
