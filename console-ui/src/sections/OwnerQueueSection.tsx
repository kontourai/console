import React, { useMemo, type ReactNode } from "react";
import type { OperatingState } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import {
  deriveOwnerQueue,
  QUEUE_ABSENCE_STRINGS,
  QUEUE_ACTION_LABELS,
  QUEUE_SECTION_TITLES,
  PULSE_SEGMENT_LABELS,
  FEED_STRIP_TITLE,
  RECEIPT_SLOT_LABELS,
  type AcceptItem,
  type DecideItem,
  type FeedChip,
  type OwnerQueue,
  type RiskItem,
} from "./queue/derive";
import { formatAge } from "./environment/derive";

// The owner-verb queue (console#273) — the default surface's first screenful.
// The owner's job is a three-way switch — accept / intervene / dig — in 90
// seconds: one computed pulse line, then DECIDE (blocked on you), ACCEPT
// (deliverables, risk-sorted), RISKS STANDING (every accepted gap as one
// aging row), then the data-feed strip. The fleet content renders below;
// the board stays one click deep (its own tab), never deleted.
//
// Copy discipline (each rule earned by a prototype reviewer catching the
// violation — see queue/derive.ts): authored level-one strings ≤10 words;
// producer text relayed verbatim; every quantity names its producing
// instrument in the DOM (title/aria, precedent: ProvenanceFootnote.tsx); a
// value with no producing feed renders its absence, never a placeholder.

export type OwnerQueueTarget = "board" | "operate" | "telemetry";

interface OwnerQueueSectionProps {
  state: OperatingState;
  telemetry: ConsoleTelemetryResponse | null;
  onOpen: (target: OwnerQueueTarget, anchor?: string) => void;
  /** Fixed reference clock (epoch ms) for deterministic derivation/rendering in tests. */
  now?: number;
}

const COUNT_INSTRUMENTS = {
  decide:
    "Counted from operating-state processes in the waiting-on-you bucket (needs_input / review_pending / blocked / paused / waiting — console#229 vocabulary via workers/derive.ts classifyFleetBucket)",
  accept: "Counted from operating-state processes with a successful terminal status (workers/derive.ts archive vocabulary)",
  risks: "Counted from transparencyGaps in the Surface trust reports folded by the workflow-trust bridge (console#254)",
} as const;

const RISKS_FEED_ABSENT_INSTRUMENT =
  "No Surface trust reports are folded into the operating state (console#254) — the risks count has no producing feed";

export function OwnerQueueSection({ state, telemetry, onOpen, now }: OwnerQueueSectionProps) {
  const clock = now ?? Date.now();
  const queue = useMemo(() => deriveOwnerQueue(state, telemetry, clock), [state, telemetry, clock]);

  return (
    <section className="ov-section owner-queue" aria-label="Owner queue">
      <PulseLine queue={queue} />

      <QueueBlock
        title={QUEUE_SECTION_TITLES.decide}
        count={queue.decide.length}
        instrument={COUNT_INSTRUMENTS.decide}
        emptyText={QUEUE_ABSENCE_STRINGS.emptyDecide}
      >
        {queue.decide.map((item) => (
          <DecideRow key={item.id} item={item} now={clock} onOpen={onOpen} />
        ))}
      </QueueBlock>

      <QueueBlock
        title={QUEUE_SECTION_TITLES.accept}
        count={queue.accept.length}
        instrument={COUNT_INSTRUMENTS.accept}
        emptyText={QUEUE_ABSENCE_STRINGS.emptyAccept}
      >
        {queue.accept.map((item) => (
          <AcceptRow key={item.id} item={item} onOpen={onOpen} />
        ))}
      </QueueBlock>

      {queue.risksFeedPresent ? (
        <QueueBlock
          title={QUEUE_SECTION_TITLES.risks}
          count={queue.risks.length}
          instrument={COUNT_INSTRUMENTS.risks}
          emptyText={QUEUE_ABSENCE_STRINGS.emptyRisks}
        >
          {queue.risks.map((item) => (
            <RiskRow key={item.key} item={item} />
          ))}
        </QueueBlock>
      ) : (
        // console#273 review MED finding 4: with ZERO folded trust reports the
        // risks count has no producing feed — render the absence (red, like
        // the feed strip), never a computed-looking 0 under a title citing
        // reports that don't exist.
        <section className="oq-block" aria-label={`${QUEUE_SECTION_TITLES.risks} (${QUEUE_ABSENCE_STRINGS.noReportsFeed})`}>
          <header className="oq-head">
            <h3 className="oq-title">{QUEUE_SECTION_TITLES.risks}</h3>
            <span className="oq-count oq-count-absent" title={RISKS_FEED_ABSENT_INSTRUMENT}>
              {QUEUE_ABSENCE_STRINGS.noReportsFeed}
            </span>
          </header>
          <p className="oq-empty oq-absent">{QUEUE_ABSENCE_STRINGS.noReportsFeed}</p>
        </section>
      )}

      <FeedStrip feeds={queue.feeds} />
    </section>
  );
}

/**
 * One pulse line — computed, never asserted: every number is a count over a
 * named feed, and when no operating state has arrived at all the line says
 * so instead of rendering zeros that pretend to be computed. (The upstream
 * pulse RECORD is kontourai/flow-agents#1266; until that feed reaches the
 * console fold, the pulse is the queue's own reconciled counts — the same
 * numbers the section badges carry, from the same instruments.)
 */
function PulseLine({ queue }: { queue: OwnerQueue }) {
  if (queue.stateAbsent) {
    return <p className="oq-pulse oq-pulse-absent">{QUEUE_ABSENCE_STRINGS.noState}</p>;
  }
  return (
    <p className="oq-pulse" aria-label="Pulse">
      <span className="oq-pulse-seg" title={COUNT_INSTRUMENTS.decide}>
        <b>{queue.decide.length}</b> {PULSE_SEGMENT_LABELS.decide}
      </span>
      <span className="oq-pulse-dot" aria-hidden="true">·</span>
      <span className="oq-pulse-seg" title={COUNT_INSTRUMENTS.accept}>
        <b>{queue.accept.length}</b> {PULSE_SEGMENT_LABELS.accept}
      </span>
      <span className="oq-pulse-dot" aria-hidden="true">·</span>
      {queue.risksFeedPresent ? (
        <span className="oq-pulse-seg" title={COUNT_INSTRUMENTS.risks}>
          <b>{queue.risks.length}</b> {PULSE_SEGMENT_LABELS.risks}
        </span>
      ) : (
        // console#273 review MED finding 4: no reports feed ⇒ the pulse's
        // risks segment renders the absence, never a computed-looking 0.
        <span className="oq-pulse-seg oq-absent" title={RISKS_FEED_ABSENT_INSTRUMENT}>
          {PULSE_SEGMENT_LABELS.risks}: {QUEUE_ABSENCE_STRINGS.noReportsFeed}
        </span>
      )}
    </p>
  );
}

function QueueBlock({
  title,
  count,
  instrument,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  instrument: string;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="oq-block" aria-label={`${title} (${count})`}>
      <header className="oq-head">
        <h3 className="oq-title">{title}</h3>
        <span className="oq-count" title={instrument} aria-label={`${count} items — ${instrument}`}>
          {count}
        </span>
      </header>
      {count > 0 ? <div className="oq-rows">{children}</div> : <p className="oq-empty">{emptyText}</p>}
    </section>
  );
}

function DecideRow({
  item,
  now,
  onOpen,
}: {
  item: DecideItem;
  now: number;
  onOpen: OwnerQueueSectionProps["onOpen"];
}) {
  const waitingMs = item.updatedAt ? now - Date.parse(item.updatedAt) : NaN;
  const waitingAge = Number.isNaN(waitingMs) ? null : formatAge(waitingMs);
  return (
    <article className="oq-row oq-row-decide">
      <div className="oq-row-main">
        <p className="oq-question">{item.question}</p>
        <p className="oq-row-label">{item.label}</p>
      </div>
      {waitingAge ? (
        <span className="oq-age" title={`Computed from this process's own updatedAt (${item.updatedAt})`}>
          {waitingAge}
        </span>
      ) : null}
      <div className="oq-row-actions">
        <button type="button" className="oq-btn primary" onClick={() => onOpen("board", item.id)}>
          {QUEUE_ACTION_LABELS.open}
        </button>
        {/* The receipt behind a click: What changes / Why / If approved / If
            wrong. Only "Why" has a producing feed today (the console#229
            blockedReason, relayed verbatim); the other slots render their
            absence honestly rather than synthesized prose. */}
        <details className="oq-receipt">
          <summary>{QUEUE_ACTION_LABELS.receipt}</summary>
          <dl className="oq-receipt-body">
            {RECEIPT_SLOT_LABELS.map((slot) => (
              <div key={slot}>
                <dt>{slot}</dt>
                <dd className={slot === "Why" && item.reason ? "" : "oq-absent"}>
                  {slot === "Why" && item.reason ? item.reason : QUEUE_ABSENCE_STRINGS.noProducerRecord}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </article>
  );
}

function AcceptRow({ item, onOpen }: { item: AcceptItem; onOpen: OwnerQueueSectionProps["onOpen"] }) {
  return (
    <article className="oq-row oq-row-accept">
      <div className="oq-row-main">
        <p className="oq-row-label">{item.label}</p>
        <p className="oq-row-status">{item.status}</p>
      </div>
      {item.gapCount !== null ? (
        <span
          className={`oq-badge${item.gapCount > 0 ? " oq-badge-risk" : ""}`}
          title="Counted from transparencyGaps in this process's folded Surface trust report (console#254)"
        >
          {item.gapCount} gaps standing
        </span>
      ) : (
        // No trust report = no producing feed for a risk number. The absence
        // renders (red), never a placeholder 0.
        <span className="oq-badge oq-badge-absent" title="This process carries no folded Surface trust report — the risk count has no producing feed">
          {QUEUE_ABSENCE_STRINGS.noTrustReport}
        </span>
      )}
      <div className="oq-row-actions">
        <button type="button" className="oq-btn" onClick={() => onOpen("board", item.id)}>
          {QUEUE_ACTION_LABELS.open}
        </button>
      </div>
    </article>
  );
}

function RiskRow({ item }: { item: RiskItem }) {
  return (
    <article className="oq-row oq-row-risk">
      <div className="oq-row-main">
        {/* Producer-authored gap text, verbatim — disclosure as structure, not adjectives. */}
        <p className="oq-row-label">{item.message || "Gap recorded without message text."}</p>
        <p className="oq-row-status">
          {[item.type, item.severity].filter(Boolean).join(" · ") || null}
          {item.claimId ? <code className="oq-claim">{item.claimId}</code> : null}
        </p>
      </div>
      {item.age ? (
        <span className="oq-age" title={`Computed from this gap's own createdAt (${item.createdAt})`}>
          standing {item.age}
        </span>
      ) : (
        <span className="oq-age oq-absent" title="The producer recorded no createdAt on this gap — age has no producing feed">
          {QUEUE_ABSENCE_STRINGS.noTimestamp}
        </span>
      )}
    </article>
  );
}

/**
 * The data-feed strip: wired vs quiet vs missing, absence rendered in red —
 * an extension of the existing quiet-source triage (environment/derive.ts),
 * not a parallel mechanism.
 */
function FeedStrip({ feeds }: { feeds: FeedChip[] }) {
  return (
    <div className="oq-feeds" role="list" aria-label={FEED_STRIP_TITLE}>
      <span className="oq-feeds-label">{FEED_STRIP_TITLE}</span>
      {feeds.map((feed) => (
        <span
          key={feed.id}
          role="listitem"
          className={`oq-feed oq-feed-${feed.state}`}
          title={`${feed.instrument}${feed.detail ? ` — ${feed.detail}` : ""}`}
        >
          <span className="oq-feed-dot" aria-hidden="true" />
          {feed.label}
          <span className="oq-feed-state">{feed.state}</span>
        </span>
      ))}
    </div>
  );
}
