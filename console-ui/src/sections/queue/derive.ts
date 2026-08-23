/**
 * Pure derivations for the owner-verb queue (console#273) — the default
 * surface's DECIDE / ACCEPT / RISKS STANDING sections plus the data-feed
 * strip. No React, no side effects: unit-testable read-model projections in
 * the pattern of sections/environment/derive.ts and sections/workers/derive.ts.
 *
 * PROJECTION OVER EXISTING STATE, NOT NEW CONTRACT WORK (the issue's framing):
 * - DECIDE reads the existing `needs_input`/`review_pending`/`blockedReason`
 *   process vocabulary (console#229, console-core/operating-state.ts) via the
 *   fleet's own waiting-on-you bucket (`classifyFleetBucket`, workers/derive.ts)
 *   — never a second classification of the same statuses.
 * - RISKS STANDING reads `transparencyGaps` from the Surface trust report
 *   folded by console#254's workflow-trust bridge (utils/trustReport.ts's
 *   verbatim narrowing); aging renders from the gap's own `createdAt`
 *   (coordinates with console#247's aging semantics).
 * - The feed strip extends the existing quiet-source triage
 *   (environment/derive.ts's `isSourceQuiet`) into wired-vs-missing chips —
 *   not a parallel mechanism.
 *
 * COPY RULES (each an acceptance criterion, console#273):
 * - every authored level-one string is ≤ 10 words (enforced by a test over
 *   `QUEUE_LEVEL_ONE_STRINGS`);
 * - no uncomputed quantities, ever — a count with no producing feed is
 *   `null` here and rendered as an explicit absence, never a placeholder 0;
 * - every quantity's producing instrument is named alongside it (the
 *   `instrument` fields below land in the DOM as title/aria text, precedent:
 *   sections/telemetry/ProvenanceFootnote.tsx naming its sources).
 */

import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { classifyFleetBucket } from "../workers/derive";
import { formatAge, isSourceQuiet } from "../environment/derive";
import { collectTrustReports } from "../../utils/trustReport";

// ── Authored level-one strings (word-budget-tested) ──────────────────────────

/**
 * The one ≤10-word question per parked status — owner vocabulary, each
 * completing "…so you should ___". Keyed on the console#229 process statuses
 * the waiting-on-you bucket admits (workers/derive.ts's
 * WAITING_ON_YOU_STATUSES); an unlisted producer status gets the fallback.
 */
export const DECIDE_QUESTIONS: Record<string, string> = {
  needs_input: "Answer what this run is waiting on",
  review_pending: "Review the output waiting on you",
  blocked: "Clear what is blocking this run",
  paused: "Resume or close this paused run",
  waiting: "Record evidence or sign off to continue",
};

export const DECIDE_QUESTION_FALLBACK = "Decide how this run moves forward";

export const QUEUE_SECTION_TITLES = {
  decide: "Decide",
  accept: "Accept",
  risks: "Risks standing",
} as const;

export const QUEUE_ACTION_LABELS = {
  open: "Open",
  receipt: "Receipt",
} as const;

export const RECEIPT_SLOT_LABELS = ["What changes", "Why", "If approved", "If wrong"] as const;

export const QUEUE_ABSENCE_STRINGS = {
  noProducerRecord: "No producer record.",
  noTrustReport: "no trust report",
  noTimestamp: "no timestamp recorded",
  emptyDecide: "Nothing waiting on you.",
  emptyAccept: "Nothing ready to accept.",
  emptyRisks: "No standing risks recorded.",
  noState: "No operating state received yet.",
  /** The risks FEED itself is absent (zero folded trust reports) — rendered red instead of a computed-looking 0. */
  noReportsFeed: "no trust reports feed",
} as const;

export const PULSE_SEGMENT_LABELS = {
  decide: "to decide",
  accept: "to accept",
  risks: "risks standing",
} as const;

export const FEED_STRIP_TITLE = "Data feeds";

/**
 * Every authored level-one string the queue renders, aggregated for the
 * word-budget test (console#273 acceptance: a test over queue-row strings
 * enforces the ≤10-word budget). Producer-authored text (labels,
 * blockedReason, gap messages) is relayed verbatim and is NOT subject to the
 * budget — Console does not edit producer copy.
 */
export const QUEUE_LEVEL_ONE_STRINGS: string[] = [
  ...Object.values(DECIDE_QUESTIONS),
  DECIDE_QUESTION_FALLBACK,
  ...Object.values(QUEUE_SECTION_TITLES),
  ...Object.values(QUEUE_ACTION_LABELS),
  ...RECEIPT_SLOT_LABELS,
  ...Object.values(QUEUE_ABSENCE_STRINGS),
  ...Object.values(PULSE_SEGMENT_LABELS),
  FEED_STRIP_TITLE,
];

// ── DECIDE ───────────────────────────────────────────────────────────────────

export interface DecideItem {
  id: string;
  /** Producer-side label, verbatim. */
  label: string;
  /** The authored ≤10-word level-one question. */
  question: string;
  status: string;
  /** Producer-side blocked reason (console#229), verbatim — the receipt's "Why". */
  reason?: string;
  updatedAt?: string;
}

export function deriveDecideItems(input: OperatingState | null | undefined, now: number = Date.now()): DecideItem[] {
  const state: OperatingState = input ?? ({} as OperatingState);
  return (state.processes || [])
    .filter((process) => classifyFleetBucket(process, now) === "waiting-on-you")
    .map((process) => {
      const status = (process.status || "").toLowerCase();
      return {
        id: process.id,
        label: process.label || process.id,
        question: DECIDE_QUESTIONS[status] || DECIDE_QUESTION_FALLBACK,
        status: process.status || "unknown",
        reason: process.blockedReason,
        updatedAt: process.updatedAt,
      };
    });
}

// ── ACCEPT ───────────────────────────────────────────────────────────────────

/**
 * Successful terminal statuses — the subset of workers/derive.ts's
 * ARCHIVED_STATUSES that reads as "a deliverable you could accept" (failed/
 * cancelled work is terminal but not acceptable; it stays in the fleet's
 * archive, not this queue).
 */
const ACCEPTABLE_STATUSES = new Set([
  "complete",
  "completed",
  "done",
  "delivered",
  "shipped",
  "released",
  "merged",
]);

export interface AcceptItem {
  id: string;
  label: string;
  status: string;
  updatedAt?: string;
  /**
   * Standing transparency gaps in this process's own folded trust report —
   * the computed risk badge. `null` when the process carries NO trust report:
   * there is no producing feed for the number, so the UI renders that absence
   * (never a placeholder 0, console#273's no-uncomputed-quantities rule).
   */
  gapCount: number | null;
}

function processGapCount(process: ConsoleProcess): number | null {
  const reports = collectTrustReports({ processes: [process] } as OperatingState);
  if (reports.length === 0) return null;
  return reports.reduce((total, report) => total + report.transparencyGaps.length, 0);
}

export function deriveAcceptItems(input: OperatingState | null | undefined): AcceptItem[] {
  const state: OperatingState = input ?? ({} as OperatingState);
  const items = (state.processes || [])
    .filter((process) => ACCEPTABLE_STATUSES.has((process.status || "").toLowerCase()))
    .map((process) => ({
      id: process.id,
      label: process.label || process.id,
      status: process.status || "unknown",
      updatedAt: process.updatedAt,
      gapCount: processGapCount(process),
    }));
  // Risk-sorted: unverifiable first (no trust report = nothing disproves
  // risk), then most standing gaps first.
  return items.sort((a, b) => {
    if (a.gapCount === null && b.gapCount === null) return 0;
    if (a.gapCount === null) return -1;
    if (b.gapCount === null) return 1;
    return b.gapCount - a.gapCount;
  });
}

// ── RISKS STANDING ───────────────────────────────────────────────────────────

export interface RiskItem {
  key: string;
  /** Producer-authored gap text, verbatim (Surface `TransparencyGap.message`). */
  message?: string;
  type?: string;
  severity?: string;
  claimId?: string;
  createdAt?: string;
  /** Age string computed from `createdAt`, or null when the producer recorded no timestamp (rendered as an explicit absence). */
  age: string | null;
}

export function deriveRiskItems(input: OperatingState | null | undefined, now: number = Date.now()): RiskItem[] {
  const reports = collectTrustReports(input);
  const items: RiskItem[] = [];
  const seen = new Set<string>();
  reports.forEach((report, reportIndex) => {
    report.transparencyGaps.forEach((gap, gapIndex) => {
      const key = gap.id || `${gap.claimId ?? ""}:${gap.type ?? ""}:${gap.message ?? ""}` || `${reportIndex}:${gapIndex}`;
      if (seen.has(key)) return;
      seen.add(key);
      let age: string | null = null;
      if (gap.createdAt) {
        const created = Date.parse(gap.createdAt);
        if (!Number.isNaN(created)) age = formatAge(now - created);
      }
      items.push({
        key,
        message: gap.message,
        type: gap.type,
        severity: gap.severity,
        claimId: gap.claimId,
        createdAt: gap.createdAt,
        age,
      });
    });
  });
  return items;
}

// ── Data-feed strip ──────────────────────────────────────────────────────────

export type FeedState = "wired" | "quiet" | "missing";

export interface FeedChip {
  id: string;
  label: string;
  state: FeedState;
  /** Producer-derived detail (age/count), or undefined when nothing is computable. */
  detail?: string;
  /** The producing instrument, named in the DOM (title/aria). */
  instrument: string;
}

export function deriveFeedChips(
  input: OperatingState | null | undefined,
  telemetry: ConsoleTelemetryResponse | null,
  now: number = Date.now(),
): FeedChip[] {
  const state: OperatingState = input ?? ({} as OperatingState);
  const chips: FeedChip[] = [];

  const accepted = state.source?.acceptedEventCount;
  const stateWired = typeof accepted === "number" || Boolean(state.generatedAt);
  chips.push({
    id: "operating-state",
    label: "operating state",
    state: stateWired ? "wired" : "missing",
    detail: typeof accepted === "number" ? `${accepted} events accepted` : undefined,
    instrument: "state.source.acceptedEventCount from the hub's operating-state stream",
  });

  // Same definition MED-4's risks-feed absence uses (report-SHAPED values via
  // the narrowing, not mere attribute presence) so the chip and the risks
  // section can never disagree about whether this feed exists.
  const hasTrustReport = collectTrustReports(state).length > 0;
  chips.push({
    id: "trust-reports",
    label: "trust reports",
    state: hasTrustReport ? "wired" : "missing",
    instrument: "Surface trust reports folded by the workflow-trust bridge (console#254)",
  });

  if (!telemetry) {
    chips.push({
      id: "telemetry",
      label: "telemetry",
      state: "missing",
      instrument: "the hub's /telemetry read-model",
    });
    return chips;
  }
  for (const source of telemetry.sources) {
    const quiet = isSourceQuiet(source, now);
    let detail: string | undefined;
    if (source.lastObservedAt) {
      const age = now - new Date(source.lastObservedAt).getTime();
      if (!Number.isNaN(age)) detail = `last seen ${formatAge(age)} ago`;
    }
    chips.push({
      id: `telemetry:${source.id}`,
      label: source.id,
      state: quiet ? "quiet" : "wired",
      detail,
      instrument: `telemetry source '${source.id}' lastObservedAt (quiet-source triage, environment/derive.ts)`,
    });
  }
  return chips;
}

// ── The whole queue ──────────────────────────────────────────────────────────

export interface OwnerQueue {
  decide: DecideItem[];
  accept: AcceptItem[];
  risks: RiskItem[];
  feeds: FeedChip[];
  /** True when no operating state has arrived at all — the pulse renders that absence, never zeros pretending to be computed. */
  stateAbsent: boolean;
  /**
   * console#273 review MED finding 4: whether the risks FEED exists at all —
   * at least one report-shaped `trustReport` folded anywhere in the state.
   * With zero reports, `risks: []` is not a computed zero, it is an absent
   * feed; the section and pulse render that absence (red), never a "0" under
   * an instrument title citing reports that don't exist.
   */
  risksFeedPresent: boolean;
}

export function deriveOwnerQueue(
  state: OperatingState | null | undefined,
  telemetry: ConsoleTelemetryResponse | null,
  now: number = Date.now(),
): OwnerQueue {
  const stateAbsent = !state || (state.generatedAt == null && !(state.processes || []).length && !(state.gates || []).length && state.source == null);
  return {
    decide: deriveDecideItems(state, now),
    accept: deriveAcceptItems(state),
    risks: deriveRiskItems(state, now),
    feeds: deriveFeedChips(state, telemetry, now),
    stateAbsent,
    risksFeedPresent: collectTrustReports(state).length > 0,
  };
}
