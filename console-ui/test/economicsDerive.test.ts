import assert from "node:assert/strict";
import test from "node:test";
import {
  cellLabel,
  costIsProxy,
  formatPct,
  formatUsd,
  hasHeadline,
  hasTaggedRuns,
  isEmptyDelegations,
  isEmptyEconomics,
  outcomeCoverageRate,
  outcomeNotMeasurable,
  outcomeSummary,
  roleModelRows,
  sharedModels,
  taskTotals,
  taskTrend,
  tasksInRollup,
  verdictLabel
} from "../src/sections/economics/derive";
import type {
  ConsoleEconomicsDelegationRollup,
  ConsoleEconomicsRoleModelRollup,
  ConsoleEconomicsRollup,
  ConsoleValueComparison
} from "../src/serverApiTypes";

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

// ── Delegation efficiency derive helpers (flow-agents #415) ────────────────────
function roleModel(partial: Partial<ConsoleEconomicsRoleModelRollup> = {}): ConsoleEconomicsRoleModelRollup {
  return {
    role: "delegate-design", model: "claude-opus-4-8", delegations: 1,
    reworkCount: 0, divergedCount: 0, failedCount: 0, acceptedCount: 1, unavailableCount: 0,
    acceptanceRate: 1, costUsd: 0.5, costGranularity: "model-proxy", ...partial
  };
}
function delegationRollup(partial: Partial<ConsoleEconomicsDelegationRollup> = {}): ConsoleEconomicsDelegationRollup {
  return {
    generatedAt: "2026-07-01T00:00:00Z", tenantId: "t", runCount: 1,
    perRoleModel: [roleModel()],
    coverage: { measurable: 1, unavailable: 0 },
    signals: { perDelegationTokens: false, perDelegationOutcome: "partial" },
    ...partial
  };
}

test("isEmptyDelegations: null, zero runs, or no (role,model) rows are empty", () => {
  assert.equal(isEmptyDelegations(null), true);
  assert.equal(isEmptyDelegations(delegationRollup({ runCount: 0 })), true);
  assert.equal(isEmptyDelegations(delegationRollup({ perRoleModel: [] })), true);
  assert.equal(isEmptyDelegations(delegationRollup()), false);
});

test("costIsProxy: true whenever per-delegation token isolation is unavailable (false today)", () => {
  assert.equal(costIsProxy(delegationRollup()), true); // perDelegationTokens=false
  assert.equal(costIsProxy(delegationRollup({ signals: { perDelegationTokens: true, perDelegationOutcome: "full" } })), false);
  assert.equal(costIsProxy(null), true);
});

test("outcomeNotMeasurable: true only for none/n/a signal with zero measurable coverage (not a fake 0%)", () => {
  assert.equal(outcomeNotMeasurable(delegationRollup({ signals: { perDelegationTokens: false, perDelegationOutcome: "none" }, coverage: { measurable: 0, unavailable: 3 } })), true);
  assert.equal(outcomeNotMeasurable(delegationRollup({ signals: { perDelegationTokens: false, perDelegationOutcome: "n/a" }, coverage: { measurable: 0, unavailable: 2 } })), true);
  // Some measurable outcomes exist → it IS measurable even if the signal says partial.
  assert.equal(outcomeNotMeasurable(delegationRollup({ signals: { perDelegationTokens: false, perDelegationOutcome: "partial" }, coverage: { measurable: 2, unavailable: 1 } })), false);
  assert.equal(outcomeNotMeasurable(null), false);
});

test("outcomeCoverageRate: measurable / (measurable+unavailable); null when no delegations", () => {
  assert.equal(outcomeCoverageRate(delegationRollup({ coverage: { measurable: 3, unavailable: 1 } })), 0.75);
  assert.equal(outcomeCoverageRate(delegationRollup({ coverage: { measurable: 0, unavailable: 0 } })), null);
  assert.equal(outcomeCoverageRate(null), null);
});

test("roleModelRows sorts by role then model; sharedModels flags a model used by >1 role", () => {
  const rollup = delegationRollup({
    perRoleModel: [
      roleModel({ role: "impl", model: "shared-m" }),
      roleModel({ role: "design", model: "shared-m" }),
      roleModel({ role: "design", model: "aardvark-m" })
    ]
  });
  assert.deepEqual(roleModelRows(rollup).map((r) => `${r.role}/${r.model}`), ["design/aardvark-m", "design/shared-m", "impl/shared-m"]);
  assert.deepEqual(sharedModels(rollup), ["shared-m"]); // used by design + impl
});

test("outcomeSummary lists non-zero buckets incl. unavailable distinctly (never folded into success)", () => {
  assert.equal(outcomeSummary(roleModel({ acceptedCount: 3, reworkCount: 1, unavailableCount: 2, delegations: 6 })), "3 accepted · 1 rework · 2 unavailable");
  assert.equal(outcomeSummary(roleModel({ acceptedCount: 0, reworkCount: 0, divergedCount: 0, failedCount: 0, unavailableCount: 0, delegations: 0 })), "no outcomes");
});

test("delegation rows carry acceptanceRate=null (not 0) when a group has no measurable outcomes — rendered n/a upstream", () => {
  const rollup = delegationRollup({ perRoleModel: [roleModel({ acceptedCount: 0, unavailableCount: 4, acceptanceRate: null, costUsd: null })] });
  const row = roleModelRows(rollup)[0];
  assert.equal(row.acceptanceRate, null);
  assert.equal(row.costUsd, null); // model absent from by_model → null, not a fake 0
});
