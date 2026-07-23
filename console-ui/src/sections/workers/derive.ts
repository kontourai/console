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
 *
 * console#251 review (round 2): a garbage/invalid `updatedAt` must never be
 * silently treated as "fresh"/"active" (there's nothing to disprove staleness
 * with), and a clearly-future `updatedAt` (clock skew beyond a small
 * tolerance) must never be silently treated as fresh either — see
 * `classifyActivity` below, the single source both `classifyFreshness` and
 * `classifyFleetBucket` now read from.
 */

import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import { deriveSourceRefs, type SourceRef } from "../../utils/sourceRefs";

// ── Freshness thresholds ─────────────────────────────────────────────────────

/** A card updated within this window reads as "fresh" — visible progress. */
export const FRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * A card not updated within this window reads as "stalled" — no visible
 * progress, distinct from a merely "idle" gap between FRESH_THRESHOLD_MS and
 * this value.
 */
export const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * A `updatedAt` this far (or less) in the future is treated as ordinary clock
 * skew between the producer and the reader — clamped to "just now"/fresh.
 * Anything further in the future is not clock skew, it's a garbage or
 * mis-stamped timestamp, and must never be silently classified as fresh.
 */
export const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export type FreshnessTier = "fresh" | "idle" | "stalled" | "unknown";

/** How a card should render its `updatedAt`, decided alongside freshness so the
 *  two can never disagree (e.g. "unknown" freshness rendering a relative time). */
export type ActivityDisplay = "relative" | "raw" | "none";

export interface ActivitySignal {
  freshness: FreshnessTier;
  display: ActivityDisplay;
}

/**
 * The single source of truth for turning a raw `updatedAt` + reference clock
 * into (a) a freshness tier and (b) how it's safe to render:
 * - missing or unparsable → `unknown` / `none` (no timestamp to show at all —
 *   never a `<time dateTime="...">` built from a garbage string).
 * - clearly in the future (beyond FUTURE_SKEW_TOLERANCE_MS) → `unknown` /
 *   `raw` (a valid, parsable timestamp, but relative math on it would lie —
 *   "in -3 days" reads as nonsense, so the raw ISO value is shown instead).
 * - within tolerance of "now" (including small future clock skew) → `fresh`
 *   / `relative`.
 * - otherwise bucketed by age into `idle` / `stalled`, both `relative`.
 */
export function classifyActivity(updatedAt: string | undefined, now: number = Date.now()): ActivitySignal {
  if (!updatedAt) return { freshness: "unknown", display: "none" };
  const then = Date.parse(updatedAt);
  if (Number.isNaN(then)) return { freshness: "unknown", display: "none" };
  const age = now - then;
  if (age < -FUTURE_SKEW_TOLERANCE_MS) return { freshness: "unknown", display: "raw" };
  if (age < FRESH_THRESHOLD_MS) return { freshness: "fresh", display: "relative" };
  if (age < STALL_THRESHOLD_MS) return { freshness: "idle", display: "relative" };
  return { freshness: "stalled", display: "relative" };
}

/**
 * Classify a card's freshness purely from `now - updatedAt`. `unknown` when
 * there is no (or an unparsable, or a clearly-future) timestamp to honestly
 * judge freshness by — never fabricated as "fresh" just because there's
 * nothing to disprove it. Thin wrapper over `classifyActivity`.
 */
export function classifyFreshness(updatedAt: string | undefined, now: number = Date.now()): FreshnessTier {
  return classifyActivity(updatedAt, now).freshness;
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
 * - everything else is bucketed by freshness: only a genuinely fresh/idle
 *   timestamp counts as "active" — a stalled OR unknown (missing/unparsable/
 *   clearly-future) timestamp is exactly as inconclusive as a stalled one and
 *   is treated the same, conservative way. A card must never be silently
 *   folded into "active" just because there's no data to disprove it
 *   (console#251 review finding 2).
 */
export function classifyFleetBucket(process: ConsoleProcess, now: number = Date.now()): FleetBucket {
  const status = (process.status || "").toLowerCase();
  if (ARCHIVED_STATUSES.has(status)) return "archived";
  if (WAITING_ON_YOU_STATUSES.has(status)) return "waiting-on-you";
  const freshness = classifyFreshness(process.updatedAt, now);
  return freshness === "fresh" || freshness === "idle" ? "active" : "stalled";
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
  /** How the card should render `updatedAt` — see `classifyActivity`. */
  display: ActivityDisplay;
  /**
   * Source-of-truth link-outs (console#256), deterministically ordered — see
   * `deriveSourceRefs` (utils/sourceRefs.ts). The fleet card renders only the
   * `work-item` chip (compact, one line); the full set is available here for
   * any future card surface that wants more.
   */
  sourceRefs: SourceRef[];
}

export function deriveFleetCard(process: ConsoleProcess, now: number = Date.now()): FleetCard {
  const activity = classifyActivity(process.updatedAt, now);
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
    freshness: activity.freshness,
    display: activity.display,
    sourceRefs: deriveSourceRefs(process),
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

/**
 * Epoch ms for a card's `updatedAt`, or `null` when missing/unparsable.
 * `Date.parse` (not lexical string compare) so recency sorting is correct
 * across sub-second-precision and UTC-offset ISO variants — see `byRecency`.
 */
function recencyMs(card: FleetCard): number | null {
  if (!card.updatedAt) return null;
  const ms = Date.parse(card.updatedAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Most-recently-updated first, by numeric epoch value — NOT `localeCompare`
 * on the raw ISO string, which sorts lexically and silently mis-orders
 * sub-second-precision timestamps (`"...:00.500Z"` behind `"...:00Z"`) and
 * differing UTC-offset forms (console#251 review finding 1). Undated AND
 * unparsable cards sink to the bottom together, in their original relative
 * order — never a fabricated recency.
 */
function byRecency(a: FleetCard, b: FleetCard): number {
  const aMs = recencyMs(a);
  const bMs = recencyMs(b);
  if (aMs == null && bMs == null) return 0;
  if (aMs == null) return 1;
  if (bMs == null) return -1;
  return bMs - aMs;
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
