// Rebuildable economics projection (console #117, ADR 0003 call 3).
//
// Mirrors `createOperatingStateProjection`'s `{ apply, materialize }` shape: fold
// each per-run economics record as it arrives; `materialize()` renders the
// read-models (cost/day rollup, caught-defects, funnel) and `materializeValue()`
// the value comparison. The projection is DERIVED and DROP-AND-REBUILDABLE — it
// retains the raw records so a re-projection is a full replay (call 3).
//
// The record is the AUTHORITATIVE flow-agents #349 shape (snake_case, nested):
// `run_id`, `at`, `task_slug`, `cost.estimated_cost_usd`, `phases[]`,
// `iterations.{count,route_backs}`, `defects.{findings_by_severity,caught_false_completions,...}`.
//
// SPLIT (per #349 base vs #350 harness):
//   • Cost / caught-defects / funnel rollups run over ALL records.
//   • The VALUE matrix groups ONLY over records that carry the OPTIONAL #350
//     experiment tags `model_tier` + `kit_condition`; a base record without them
//     shows in the rollups but not the value matrix.
//
// HONESTY RULE (call 4): `acceptance_label`, when present, is read VERBATIM from the
// record (the independent kontourai/evals oracle's verdict). This projection NEVER
// inspects a kit gate, a critique, or any Console-side signal to decide acceptance.
// `isAccepted()` below is the single, deliberately trivial reader of that field.

import type {
  ConsoleEconomicsRecord,
  EconomicsCaughtDefects,
  EconomicsFindingsBySeverity,
  EconomicsFunnel,
  EconomicsRollup,
  EconomicsTaskDayRollup,
  ValueCell,
  ValueComparison
} from "./types";

/** Bucket name for cost/tasks with no phase / task attribution (never zeros — R2). */
const UNATTRIBUTED = "unattributed";

export interface EconomicsProjection {
  apply(record: ConsoleEconomicsRecord): void;
  /** Cost / caught-defects / funnel rollups for `GET /api/economics`. */
  materialize(tenantId: string): EconomicsRollup;
  /** The `(model_tier, kit_condition)` value comparison for `GET /api/economics/value`. */
  materializeValue(tenantId: string): ValueComparison;
  count(): number;
}

/**
 * The ONE place acceptance is read. A verbatim read of the oracle-authored
 * `acceptance_label`; it must never grow into a derivation from kit signals.
 */
function isAccepted(record: ConsoleEconomicsRecord): boolean {
  return record.acceptance_label === "accepted";
}

/** True only for records carrying the optional #350 experiment tags. */
function isTagged(record: ConsoleEconomicsRecord): boolean {
  return record.model_tier !== undefined && record.kit_condition !== undefined;
}

export function createEconomicsProjection(): EconomicsProjection {
  // Retain raw records so materialize() is a pure replay and the projection is
  // fully rebuildable (call 3). Dedup on run_id so a re-POST of the same run does
  // not double-count.
  const records: ConsoleEconomicsRecord[] = [];
  const seenRuns = new Set<string>();

  function apply(record: ConsoleEconomicsRecord): void {
    if (!record || typeof record !== "object") return;
    if (record.run_id && seenRuns.has(record.run_id)) return;
    if (record.run_id) seenRuns.add(record.run_id);
    records.push(record);
  }

  function materialize(tenantId: string): EconomicsRollup {
    return {
      generatedAt: new Date().toISOString(),
      tenantId,
      runCount: records.length,
      cost: costRollup(records),
      caughtDefects: caughtDefectsRollup(records),
      funnel: funnelRollup(records)
    };
  }

  function materializeValue(tenantId: string): ValueComparison {
    return buildValueComparison(records, tenantId);
  }

  return { apply, materialize, materializeValue, count: () => records.length };
}

// ── Cost rollup: cost per task_slug per day, with the paired defect counts on ──
//     the same row (R5 — never a cost-only surface). Per-phase from the top-level
//     `phases[]`; an `unattributed` bucket when a record has no phase context (R2).
function costRollup(records: ConsoleEconomicsRecord[]): EconomicsTaskDayRollup[] {
  const byTaskDay = new Map<string, EconomicsTaskDayRollup>();
  for (const record of records) {
    const taskSlug = record.task_slug || UNATTRIBUTED;
    const day = utcDay(record.at);
    const key = `${taskSlug}\t${day}`;
    let row = byTaskDay.get(key);
    if (!row) {
      row = { taskSlug, day, runs: 0, totalCostUsd: 0, costByPhase: {}, defectsCaught: 0, caughtFalseCompletions: 0 };
      byTaskDay.set(key, row);
    }
    const usd = numberOr(record.cost?.estimated_cost_usd, 0);
    row.runs += 1;
    row.totalCostUsd = round4(row.totalCostUsd + usd);
    row.defectsCaught += findingsTotal(record);
    row.caughtFalseCompletions += numberOr(record.defects?.caught_false_completions, 0);
    addPhases(row.costByPhase, record.phases, usd);
  }
  return [...byTaskDay.values()].sort((a, b) =>
    a.taskSlug === b.taskSlug ? a.day.localeCompare(b.day) : a.taskSlug.localeCompare(b.taskSlug));
}

/** Attribute a run's cost across `phases[]`, or to `unattributed` when absent. */
function addPhases(into: Record<string, number>, phases: ConsoleEconomicsRecord["phases"], totalUsd: number): void {
  const entries = Array.isArray(phases) ? phases : [];
  if (entries.length === 0) {
    into[UNATTRIBUTED] = round4((into[UNATTRIBUTED] || 0) + totalUsd);
    return;
  }
  for (const entry of entries) {
    const phase = entry && typeof entry.phase === "string" && entry.phase ? entry.phase : UNATTRIBUTED;
    into[phase] = round4((into[phase] || 0) + numberOr(entry?.estimated_cost_usd, 0));
  }
}

function caughtDefectsRollup(records: ConsoleEconomicsRecord[]): EconomicsCaughtDefects {
  const bySeverity: EconomicsFindingsBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  let caughtFalseCompletions = 0;
  let gateFires = 0;
  for (const record of records) {
    const sev = record.defects?.findings_by_severity;
    bySeverity.critical += numberOr(sev?.critical, 0);
    bySeverity.high += numberOr(sev?.high, 0);
    bySeverity.medium += numberOr(sev?.medium, 0);
    bySeverity.low += numberOr(sev?.low, 0);
    caughtFalseCompletions += numberOr(record.defects?.caught_false_completions, 0);
    gateFires += numberOr(record.defects?.gate_fires, 0);
  }
  return {
    defectsCaught: bySeverity.critical + bySeverity.high + bySeverity.medium + bySeverity.low,
    bySeverity,
    caughtFalseCompletions,
    gateFires
  };
}

function funnelRollup(records: ConsoleEconomicsRecord[]): EconomicsFunnel {
  let totalIterations = 0;
  let totalRouteBacks = 0;
  let firstPassRuns = 0;
  let humanWaitS = 0;
  for (const record of records) {
    const count = numberOr(record.iterations?.count, 0);
    const routeBacks = numberOr(record.iterations?.route_backs, 0);
    totalIterations += count;
    totalRouteBacks += routeBacks;
    humanWaitS += numberOr(record.time?.human_wait_s, 0);
    // First-pass = a single iteration with no route-back loop. (Base #349 records
    // carry no acceptance verdict, so first-pass is a loop-structure signal, not
    // an oracle signal — it must never depend on kit gates.)
    if (count <= 1 && routeBacks === 0) firstPassRuns += 1;
  }
  const runs = records.length;
  return {
    runs,
    totalIterations,
    totalRouteBacks,
    firstPassRate: runs === 0 ? 0 : round4(firstPassRuns / runs),
    humanWaitS
  };
}

// ── Value comparison: group ONLY over records carrying the optional #350 tags ──
//     `(model_tier, kit_condition)`; the headline is small+kit vs large-bare
//     (ADR 0003 call 4 / flow-agents #409). Base #349 records are excluded here.
function buildValueComparison(records: ConsoleEconomicsRecord[], tenantId: string): ValueComparison {
  interface Accum { runs: number; accepted: number; iterationsOnAccept: number; defectsCaught: number; totalCost: number; }
  const groups = new Map<string, { model_tier: string; kit_condition: string; acc: Accum }>();
  const tagged = records.filter(isTagged);

  for (const record of tagged) {
    const model_tier = String(record.model_tier);
    const kit_condition = String(record.kit_condition);
    const key = `${model_tier}\t${kit_condition}`;
    let group = groups.get(key);
    if (!group) {
      group = { model_tier, kit_condition, acc: { runs: 0, accepted: 0, iterationsOnAccept: 0, defectsCaught: 0, totalCost: 0 } };
      groups.set(key, group);
    }
    const acc = group.acc;
    acc.runs += 1;
    acc.defectsCaught += findingsTotal(record);
    acc.totalCost = round4(acc.totalCost + numberOr(record.cost?.estimated_cost_usd, 0));
    if (isAccepted(record)) {
      acc.accepted += 1;
      acc.iterationsOnAccept += numberOr(record.iterations?.count, 0);
    }
  }

  const cells: ValueCell[] = [...groups.values()]
    .map(({ model_tier, kit_condition, acc }) => toCell(model_tier, kit_condition, acc))
    .sort((a, b) => a.model_tier === b.model_tier
      ? a.kit_condition.localeCompare(b.kit_condition)
      : a.model_tier.localeCompare(b.model_tier));

  const smallPlusKit = cells.find((c) => c.model_tier === "small" && c.kit_condition === "+kit") ?? null;
  const largeBare = cells.find((c) => c.model_tier === "large" && c.kit_condition === "bare") ?? null;

  let verdict: ValueComparison["headline"]["verdict"] = "unknown";
  let ratio: number | null = null;
  if (
    smallPlusKit && largeBare &&
    smallPlusKit.dollarsPerAcceptable !== null && smallPlusKit.dollarsPerAcceptable > 0 &&
    largeBare.dollarsPerAcceptable !== null && largeBare.dollarsPerAcceptable > 0
  ) {
    // ratio > 1 ⇒ small+kit costs LESS per acceptable outcome than large-bare.
    ratio = round4(largeBare.dollarsPerAcceptable / smallPlusKit.dollarsPerAcceptable);
    if (ratio >= 1.02) verdict = "exceeds";
    else if (ratio >= 0.98) verdict = "meets";
    else verdict = "below";
  }

  return {
    generatedAt: new Date().toISOString(),
    tenantId,
    taggedRunCount: tagged.length,
    cells,
    headline: { smallPlusKit, largeBare, verdict, ratio }
  };

  function toCell(model_tier: string, kit_condition: string, acc: Accum): ValueCell {
    return {
      model_tier,
      kit_condition,
      runs: acc.runs,
      acceptanceRate: acc.runs === 0 ? 0 : round4(acc.accepted / acc.runs),
      iterationsToAccept: acc.accepted === 0 ? 0 : round4(acc.iterationsOnAccept / acc.accepted),
      defectsCaught: acc.defectsCaught,
      // $/acceptable is null (not a fake 0) when nothing was accepted — dividing
      // total cost by zero acceptances would fabricate an infinitely-good number.
      dollarsPerAcceptable: acc.accepted === 0 ? null : round4(acc.totalCost / acc.accepted)
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────
/** Total findings caught pre-merge for a record (sum of every severity). */
function findingsTotal(record: ConsoleEconomicsRecord): number {
  const sev = record.defects?.findings_by_severity;
  return numberOr(sev?.critical, 0) + numberOr(sev?.high, 0) + numberOr(sev?.medium, 0) + numberOr(sev?.low, 0);
}
/** `at` is an epoch-millis STRING (#349); fall back to the ISO parser for safety. */
function utcDay(at: string | null | undefined): string {
  if (at === null || at === undefined || at === "") return UNATTRIBUTED;
  const asEpoch = Number(at);
  const date = Number.isFinite(asEpoch) && String(asEpoch) === String(at).trim() ? new Date(asEpoch) : new Date(at);
  if (Number.isNaN(date.getTime())) return UNATTRIBUTED;
  return date.toISOString().slice(0, 10);
}
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
