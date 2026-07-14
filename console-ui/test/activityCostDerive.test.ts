import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveActivity,
  deriveTurnCost,
  activityAltText,
  knownActionClass,
  ACTION_ORDER
} from "../src/sections/telemetry/activityCostDerive";
import type {
  ConsoleTelemetryActionClassSummary,
  ConsoleTelemetryTurnCostSummary
} from "../src/serverApiTypes";

function ac(actionClass: string, count: number): ConsoleTelemetryActionClassSummary {
  return { actionClass: actionClass as ConsoleTelemetryActionClassSummary["actionClass"], label: actionClass, count, sessionCount: 1 };
}

test("deriveActivity totals actions and orders bar vs legend independently", () => {
  const classes = [ac("execute", 5), ac("edit", 20), ac("search", 12)];
  const { totalActions, barSegments, legend } = deriveActivity(classes);
  assert.equal(totalActions, 37);
  // bar follows ACTION_ORDER (edit, search, …, execute)
  assert.deepEqual(barSegments.map((s) => s.actionClass), ["edit", "search", "execute"]);
  // legend follows count desc
  assert.deepEqual(legend.map((s) => s.actionClass), ["edit", "search", "execute"]);
  assert.deepEqual(legend.map((s) => s.count), [20, 12, 5]);
});

test("deriveActivity is pure — does not mutate the input array order", () => {
  const classes = [ac("execute", 5), ac("edit", 20)];
  const before = classes.map((c) => c.actionClass);
  deriveActivity(classes);
  assert.deepEqual(classes.map((c) => c.actionClass), before);
});

test("deriveActivity on empty input yields zero total, empty lists", () => {
  const { totalActions, barSegments, legend } = deriveActivity([]);
  assert.equal(totalActions, 0);
  assert.equal(barSegments.length, 0);
  assert.equal(legend.length, 0);
});

test("knownActionClass coerces an unrecognized class to 'other' (sorts last in the bar)", () => {
  assert.equal(knownActionClass("edit"), "edit");
  assert.equal(knownActionClass("some-future-class"), "other");
  const { barSegments } = deriveActivity([ac("wormhole", 99), ac("edit", 1)]);
  // unknown 'wormhole' → order index past the end → placed after 'edit'
  assert.equal(barSegments[barSegments.length - 1].actionClass, "wormhole");
  assert.equal(knownActionClass(barSegments[barSegments.length - 1].actionClass), "other");
});

test("deriveTurnCost computes avg per turn and caps the detail list", () => {
  const summary: ConsoleTelemetryTurnCostSummary = {
    turnCount: 4,
    totalEstimatedCostUsd: 1.0,
    turns: Array.from({ length: 12 }, (_unused, i) => ({
      turnId: `t${i}`,
      sessionId: "s1",
      model: "m",
      toolCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0.25
    }))
  };
  const { turnCount, totalCost, avgPerTurn, topTurns } = deriveTurnCost(summary);
  assert.equal(turnCount, 4);
  assert.equal(totalCost, 1.0);
  assert.equal(avgPerTurn, 0.25);
  assert.equal(topTurns.length, 8, "detail list limited to 8");
});

test("deriveTurnCost tolerates missing summary — no division by zero", () => {
  const { turnCount, totalCost, avgPerTurn, topTurns } = deriveTurnCost(undefined);
  assert.equal(turnCount, 0);
  assert.equal(totalCost, 0);
  assert.equal(avgPerTurn, 0);
  assert.deepEqual(topTurns, []);
});

test("activityAltText summarizes top classes and flags truncation", () => {
  assert.equal(activityAltText([], 0), "No tool activity");
  const many = ACTION_ORDER.map((c, i) => ac(c, (i + 1) * 10)); // 7 classes
  const text = activityAltText([...many].sort((a, b) => b.count - a.count), many.reduce((s, c) => s + c.count, 0));
  assert.match(text, /Activity by action class:/);
  assert.match(text, /\+3 more/, "7 classes, top 4 shown → +3 more");
});
