/**
 * Pure derivations for the Economics dashboard. No React, no side effects —
 * unit-testable read-model shaping over the ConsoleEconomicsRollup /
 * ConsoleValueComparison responses (console #117).
 *
 * HONESTY (ADR 0003 call 4): this module NEVER computes acceptance. Every
 * acceptance-derived number here originates from the server projection, whose
 * sole input is the oracle-authored `acceptance_label`. The UI formats; it does
 * not judge.
 */

import type {
  ConsoleEconomicsTaskDayRollup,
  ConsoleEconomicsRollup,
  ConsoleEconomicsDelegationRollup,
  ConsoleEconomicsRoleModelRollup,
  ConsoleValueCell,
  ConsoleValueComparison
} from "../../serverApiTypes";

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

export function formatPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "n/a";
  return `${Math.round(fraction * 100)}%`;
}

/** True when the projection has recorded no economics runs yet (empty state). */
export function isEmptyEconomics(rollup: ConsoleEconomicsRollup | null): boolean {
  return !rollup || rollup.runCount === 0;
}

/** Distinct task_slugs present in the cost rollup, in first-seen order. */
export function tasksInRollup(rollup: ConsoleEconomicsRollup | null): string[] {
  if (!rollup) return [];
  const seen: string[] = [];
  for (const row of rollup.cost) if (!seen.includes(row.taskSlug)) seen.push(row.taskSlug);
  return seen;
}

/** Cost rows for one task_slug, ascending by day — the per-task trend line. */
export function taskTrend(rollup: ConsoleEconomicsRollup | null, taskSlug: string): ConsoleEconomicsTaskDayRollup[] {
  if (!rollup) return [];
  return rollup.cost.filter((row) => row.taskSlug === taskSlug).slice().sort((a, b) => a.day.localeCompare(b.day));
}

export interface TaskTotals {
  taskSlug: string;
  runs: number;
  totalCostUsd: number;
  defectsCaught: number;
}

/** Per-task totals across all days — the paired cost+defect summary (R5). */
export function taskTotals(rollup: ConsoleEconomicsRollup | null): TaskTotals[] {
  if (!rollup) return [];
  const byTask = new Map<string, TaskTotals>();
  for (const row of rollup.cost) {
    let t = byTask.get(row.taskSlug);
    if (!t) { t = { taskSlug: row.taskSlug, runs: 0, totalCostUsd: 0, defectsCaught: 0 }; byTask.set(row.taskSlug, t); }
    t.runs += row.runs;
    t.totalCostUsd = Math.round((t.totalCostUsd + row.totalCostUsd) * 100) / 100;
    t.defectsCaught += row.defectsCaught;
  }
  return [...byTask.values()];
}

/** Human-readable verdict copy for the value headline. */
export function verdictLabel(comparison: ConsoleValueComparison | null): string {
  const verdict = comparison?.headline.verdict;
  switch (verdict) {
    case "exceeds": return "small + kit beats large — bare";
    case "meets": return "small + kit matches large — bare";
    case "below": return "small + kit trails large — bare";
    default: return "not enough matched runs yet";
  }
}

/** A stable label for a value cell, e.g. "small · +kit". */
export function cellLabel(cell: ConsoleValueCell): string {
  return `${cell.model_tier} · ${cell.kit_condition}`;
}

/** True when both headline cells exist and a ratio was computed. */
export function hasHeadline(comparison: ConsoleValueComparison | null): boolean {
  return Boolean(comparison?.headline.smallPlusKit && comparison?.headline.largeBare && comparison?.headline.ratio);
}

/**
 * True when at least one record carried the optional #350 experiment tags
 * (model_tier + kit_condition). The value matrix is meaningful only for tagged
 * (harness) records; base #349 records populate the cost/defects/funnel views
 * but not this one.
 */
export function hasTaggedRuns(comparison: ConsoleValueComparison | null): boolean {
  return Boolean(comparison && (comparison.taggedRunCount > 0 || comparison.cells.length > 0));
}

// ── Delegation efficiency derivations (flow-agents #415) ───────────────────────
// HONESTY: these NEVER recompute acceptance or cost — they format server numbers
// and gate the rendering on `signals`. costUsd is a MODEL-GRANULARITY PROXY;
// `unavailable` is already excluded from acceptanceRate by the projection.

/** True when the projection has recorded no delegation runs yet (empty state). */
export function isEmptyDelegations(rollup: ConsoleEconomicsDelegationRollup | null): boolean {
  return !rollup || rollup.runCount === 0 || rollup.perRoleModel.length === 0;
}

/**
 * True when this harness cannot measure delegation outcomes at all — the panel
 * must say "outcome not measurable on this harness" instead of a misleading 0%
 * acceptance (honesty rule 3). `none`/`n/a` mean no measurable outcomes exist.
 */
export function outcomeNotMeasurable(rollup: ConsoleEconomicsDelegationRollup | null): boolean {
  if (!rollup) return false;
  const sig = rollup.signals.perDelegationOutcome;
  return (sig === "none" || sig === "n/a") && rollup.coverage.measurable === 0;
}

/**
 * True when per-delegation token isolation is unavailable (false on every runtime
 * today) — the cost column carries the "model-granularity (proxy)" label.
 */
export function costIsProxy(rollup: ConsoleEconomicsDelegationRollup | null): boolean {
  return !rollup || rollup.signals.perDelegationTokens !== true;
}

/** Fraction of all delegations that had a measurable (non-`unavailable`) outcome;
 *  null when there are no delegations at all (never a fake 0). */
export function outcomeCoverageRate(rollup: ConsoleEconomicsDelegationRollup | null): number | null {
  if (!rollup) return null;
  const { measurable, unavailable } = rollup.coverage;
  const total = measurable + unavailable;
  return total === 0 ? null : measurable / total;
}

/** (role, model) rollups sorted by role then model — the delegation table order. */
export function roleModelRows(rollup: ConsoleEconomicsDelegationRollup | null): ConsoleEconomicsRoleModelRollup[] {
  if (!rollup) return [];
  return rollup.perRoleModel.slice().sort((a, b) =>
    a.role === b.role ? a.model.localeCompare(b.model) : a.role.localeCompare(b.role));
}

/** Bare model names shared by more than one (role, model) group — the cost proxy's
 *  inherent imprecision (a model's cost is attributed whole to each sharing group). */
export function sharedModels(rollup: ConsoleEconomicsDelegationRollup | null): string[] {
  if (!rollup) return [];
  const rolesByModel = new Map<string, Set<string>>();
  for (const row of rollup.perRoleModel) {
    if (!rolesByModel.has(row.model)) rolesByModel.set(row.model, new Set());
    rolesByModel.get(row.model)!.add(row.role);
  }
  return [...rolesByModel.entries()].filter(([, roles]) => roles.size > 1).map(([model]) => model).sort();
}

/** A compact "3 accepted · 1 rework · 2 unavailable" summary of one group's outcomes. */
export function outcomeSummary(row: ConsoleEconomicsRoleModelRollup): string {
  const parts: string[] = [];
  if (row.acceptedCount) parts.push(`${row.acceptedCount} accepted`);
  if (row.reworkCount) parts.push(`${row.reworkCount} rework`);
  if (row.divergedCount) parts.push(`${row.divergedCount} diverged`);
  if (row.failedCount) parts.push(`${row.failedCount} failed`);
  if (row.unavailableCount) parts.push(`${row.unavailableCount} unavailable`);
  return parts.length ? parts.join(" · ") : "no outcomes";
}
