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
