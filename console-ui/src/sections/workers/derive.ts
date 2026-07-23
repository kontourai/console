/**
 * Pure derivation for the Overview's fleet grid — one card per operating-state
 * process (a flow-agent worker run), grouped into a small set of health
 * buckets and sorted by recency. No React, no side effects: a unit-testable
 * read-model projection, mirroring the pattern in sections/environment/derive.ts
 * and lib/src/board.ts.
 *
 * console#251: the live Overview rendered every paused/long-running process as
 * an equal-weight card in a "Needs you" wall — paused-run cards (built from
 * gate records in environment/derive.ts's pausedRunDetail) never included a
 * timestamp at all, and long-running cards embedded their age as free text
 * inside a detail string rather than a first-class field, so nothing let the
 * fleet be sorted, filtered, or visually told apart by freshness. This module
 * derives fleet cards straight from the process record itself — `updatedAt`
 * is always carried through as its own field regardless of `status`, so no
 * status branch can silently omit it, and freshness is classified from that
 * one field rather than re-derived per attention-kind.
 */

import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";

// ── Freshness thresholds ─────────────────────────────────────────────────────

/** A card updated within this window reads as "fresh" — visible progress. */
export const FRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * A card not updated within this window reads as "stalled" — no visible
 * progress, distinct from a merely "idle" gap between FRESH_THRESHOLD_MS and
 * this value.
 */
export const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export type FreshnessTier = "fresh" | "idle" | "stalled" | "unknown";

/**
 * Classify a card's freshness purely from `now - updatedAt`. `unknown` when
 * there is no (or an unparsable) timestamp to judge by — never fabricated as
 * "fresh" just because there's nothing to disprove it.
 */
export function classifyFreshness(updatedAt: string | undefined, now: number = Date.now()): FreshnessTier {
  if (!updatedAt) return "unknown";
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return "unknown";
  const age = now - then;
  if (age < FRESH_THRESHOLD_MS) return "fresh";
  if (age < STALL_THRESHOLD_MS) return "idle";
  return "stalled";
}

// ── Fleet buckets ─────────────────────────────────────────────────────────────

export type FleetBucket = "active" | "waiting-on-you" | "stalled" | "archived";

/**
 * Terminal statuses: the run is done, one way or another. Mirrors the
 * DONE_STATUS set lib/src/board.ts already classifies to its "done" column,
 * plus "failed" (not a board-done status, but terminal for the fleet).
 */
const ARCHIVED_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "closed",
  "released",
  "delivered",
  "shipped",
  "merged",
  "cancelled",
  "canceled",
  "abandoned",
  "failed",
]);

/**
 * Interactive states parked on a human decision — the run cannot make
 * progress until the owner acts, regardless of how long it has been waiting.
 * `ConsoleProcessStatus` (console-core/operating-state.ts) lists "paused" and
 * "waiting" as real producer statuses alongside "blocked"/"needs_input"/
 * "review_pending".
 */
const WAITING_ON_YOU_STATUSES = new Set(["paused", "blocked", "waiting", "needs_input", "review_pending"]);

/**
 * Classify a process into exactly one fleet bucket:
 * - terminal work is archived, regardless of age;
 * - work parked on a human decision is waiting-on-you, regardless of age
 *   (an old paused run is still "waiting on you", not merely "stalled");
 * - everything else is bucketed by freshness: recently updated is active,
 *   and beyond STALL_THRESHOLD_MS with no update is stalled.
 */
export function classifyFleetBucket(process: ConsoleProcess, now: number = Date.now()): FleetBucket {
  const status = (process.status || "").toLowerCase();
  if (ARCHIVED_STATUSES.has(status)) return "archived";
  if (WAITING_ON_YOU_STATUSES.has(status)) return "waiting-on-you";
  return classifyFreshness(process.updatedAt, now) === "stalled" ? "stalled" : "active";
}

function stepLabel(step: ConsoleProcess["currentStep"]): string | undefined {
  if (!step) return undefined;
  return typeof step === "string" ? step : step.label || step.id;
}

export interface FleetCard {
  id: string;
  label: string;
  status: string;
  stepLabel?: string;
  updatedAt?: string;
  blockedReason?: string;
  percentComplete?: number;
  product?: string;
  bucket: FleetBucket;
  freshness: FreshnessTier;
}

export function deriveFleetCard(process: ConsoleProcess, now: number = Date.now()): FleetCard {
  return {
    id: process.id,
    label: process.label || process.id,
    status: process.status || "unknown",
    stepLabel: stepLabel(process.currentStep),
    // Carried through unconditionally — the #251 bug was a status-specific
    // detail-string branch that never appended this field at all.
    updatedAt: process.updatedAt,
    blockedReason: process.blockedReason,
    percentComplete: process.percentComplete,
    product: process.sourceRef?.product,
    bucket: classifyFleetBucket(process, now),
    freshness: classifyFreshness(process.updatedAt, now),
  };
}

export function deriveFleetCards(input: OperatingState | null | undefined, now: number = Date.now()): FleetCard[] {
  const state: OperatingState = input ?? ({} as OperatingState);
  return (state.processes || []).map((process) => deriveFleetCard(process, now));
}

export interface FleetCounts {
  active: number;
  waitingOnYou: number;
  stalled: number;
  archived: number;
}

export function deriveFleetCounts(cards: FleetCard[]): FleetCounts {
  const counts: FleetCounts = { active: 0, waitingOnYou: 0, stalled: 0, archived: 0 };
  for (const card of cards) {
    if (card.bucket === "active") counts.active += 1;
    else if (card.bucket === "waiting-on-you") counts.waitingOnYou += 1;
    else if (card.bucket === "stalled") counts.stalled += 1;
    else counts.archived += 1;
  }
  return counts;
}

/** Most-recently-updated first; undated cards sink to the bottom (never a fabricated recency). */
function byRecency(a: FleetCard, b: FleetCard): number {
  return (b.updatedAt || "").localeCompare(a.updatedAt || "");
}

export interface FleetGrid {
  /** Active work only: active + waiting-on-you + stalled, most-recent-first. */
  main: FleetCard[];
  /** Terminal work, most-recent-first. */
  archived: FleetCard[];
}

/**
 * Partition the fleet into the main grid (active work) and the archive
 * (terminal work), each sorted most-recent-first — completed/failed/cancelled
 * processes never crowd the main grid.
 */
export function partitionFleet(cards: FleetCard[]): FleetGrid {
  const main: FleetCard[] = [];
  const archived: FleetCard[] = [];
  for (const card of cards) {
    (card.bucket === "archived" ? archived : main).push(card);
  }
  main.sort(byRecency);
  archived.sort(byRecency);
  return { main, archived };
}
