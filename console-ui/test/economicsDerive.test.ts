import assert from "node:assert/strict";
import test from "node:test";
import {
  cellLabel,
  formatPct,
  formatUsd,
  hasHeadline,
  hasTaggedRuns,
  isEmptyEconomics,
  taskTotals,
  taskTrend,
  tasksInRollup,
  verdictLabel
} from "../src/sections/economics/derive";
import type { ConsoleEconomicsRollup, ConsoleValueComparison } from "../src/serverApiTypes";

function rollup(partial: Partial<ConsoleEconomicsRollup> = {}): ConsoleEconomicsRollup {
  return {
    generatedAt: "2026-07-01T00:00:00Z",
    tenantId: "t",
    runCount: 0,
    cost: [],
    caughtDefects: { defectsCaught: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, caughtFalseCompletions: 0, gateFires: 0 },
    funnel: { runs: 0, totalIterations: 0, totalRouteBacks: 0, firstPassRate: 0, humanWaitS: 0 },
    ...partial
  };
}

test("formatUsd renders 2dp; null/undefined/NaN → n/a", () => {
  assert.equal(formatUsd(0.4), "$0.40");
  assert.equal(formatUsd(null), "n/a");
  assert.equal(formatUsd(undefined), "n/a");
});

test("formatPct rounds a fraction to a whole percent", () => {
  assert.equal(formatPct(1), "100%");
  assert.equal(formatPct(0.5), "50%");
  assert.equal(formatPct(null), "n/a");
});

test("isEmptyEconomics: null or zero runs are empty", () => {
  assert.equal(isEmptyEconomics(null), true);
  assert.equal(isEmptyEconomics(rollup({ runCount: 0 })), true);
  assert.equal(isEmptyEconomics(rollup({ runCount: 2 })), false);
});

test("tasksInRollup returns distinct task_slugs in first-seen order", () => {
  const r = rollup({
    runCount: 3,
    cost: [
      { taskSlug: "builder", day: "2026-07-01", runs: 1, totalCostUsd: 0.1, costByPhase: {}, defectsCaught: 1, caughtFalseCompletions: 0 },
      { taskSlug: "knowledge", day: "2026-07-01", runs: 1, totalCostUsd: 0.2, costByPhase: {}, defectsCaught: 0, caughtFalseCompletions: 0 },
      { taskSlug: "builder", day: "2026-07-02", runs: 1, totalCostUsd: 0.3, costByPhase: {}, defectsCaught: 2, caughtFalseCompletions: 0 }
    ]
  });
  assert.deepEqual(tasksInRollup(r), ["builder", "knowledge"]);
});

test("taskTrend filters to one task_slug and sorts by day; taskTotals sums cost + defects", () => {
  const r = rollup({
    runCount: 3,
    cost: [
      { taskSlug: "builder", day: "2026-07-02", runs: 1, totalCostUsd: 0.3, costByPhase: {}, defectsCaught: 2, caughtFalseCompletions: 0 },
      { taskSlug: "builder", day: "2026-07-01", runs: 2, totalCostUsd: 0.1, costByPhase: {}, defectsCaught: 1, caughtFalseCompletions: 0 },
      { taskSlug: "knowledge", day: "2026-07-01", runs: 1, totalCostUsd: 0.9, costByPhase: {}, defectsCaught: 5, caughtFalseCompletions: 0 }
    ]
  });
  assert.deepEqual(taskTrend(r, "builder").map((row) => row.day), ["2026-07-01", "2026-07-02"]);
  const totals = taskTotals(r);
  const builder = totals.find((t) => t.taskSlug === "builder")!;
  assert.equal(builder.runs, 3);
  assert.equal(builder.totalCostUsd, 0.4);
  assert.equal(builder.defectsCaught, 3);
});

function comparison(partial: Partial<ConsoleValueComparison> = {}, headline: Partial<ConsoleValueComparison["headline"]> = {}): ConsoleValueComparison {
  return {
    generatedAt: "2026-07-01T00:00:00Z",
    tenantId: "t",
    taggedRunCount: 0,
    cells: [],
    headline: { smallPlusKit: null, largeBare: null, verdict: "unknown", ratio: null, ...headline },
    ...partial
  };
}

test("verdictLabel maps each verdict to copy; hasHeadline needs both cells + ratio", () => {
  assert.match(verdictLabel(comparison({}, { verdict: "exceeds" })), /beats/);
  assert.match(verdictLabel(comparison({}, { verdict: "meets" })), /matches/);
  assert.match(verdictLabel(comparison({}, { verdict: "below" })), /trails/);
  assert.match(verdictLabel(comparison({}, { verdict: "unknown" })), /not enough/);
  assert.match(verdictLabel(null), /not enough/);

  const cell = { model_tier: "small", kit_condition: "+kit", runs: 2, acceptanceRate: 1, iterationsToAccept: 2, defectsCaught: 6, dollarsPerAcceptable: 0.4 };
  const large = { ...cell, model_tier: "large", kit_condition: "bare", dollarsPerAcceptable: 2.8 };
  assert.equal(hasHeadline(comparison({}, { smallPlusKit: cell, largeBare: large, ratio: 7, verdict: "exceeds" })), true);
  assert.equal(hasHeadline(comparison({}, { smallPlusKit: cell, largeBare: null })), false);
  assert.equal(cellLabel(cell), "small · +kit");
});

test("hasTaggedRuns: true only when tagged (harness) records exist", () => {
  assert.equal(hasTaggedRuns(null), false);
  assert.equal(hasTaggedRuns(comparison({ taggedRunCount: 0, cells: [] })), false);
  assert.equal(hasTaggedRuns(comparison({ taggedRunCount: 3 })), true);
  const cell = { model_tier: "small", kit_condition: "+kit", runs: 1, acceptanceRate: 1, iterationsToAccept: 1, defectsCaught: 0, dollarsPerAcceptable: 1 };
  assert.equal(hasTaggedRuns(comparison({ taggedRunCount: 1, cells: [cell] })), true);
});
