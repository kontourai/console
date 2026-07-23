import React, { useMemo, useState } from "react";
import type { OperatingState } from "@kontourai/console-core";
import { StatusBadge } from "@kontourai/ui/react";
import { formatRelative } from "../utils/format";
import {
  deriveFleetCards,
  deriveFleetCounts,
  partitionFleet,
  type FleetBucket,
  type FleetCard,
  type FreshnessTier,
} from "./workers/derive";

// "The fleet" (console#251) — the front door's answer to "what is every
// flow-agent worker doing right now?" Every operating-state process becomes
// exactly one card: its current step, a relative last-activity timestamp
// (every status variant — see workers/derive.ts's root-cause note for why the
// old "Needs you" triage silently dropped this for paused runs), and a
// freshness tier so a stalled worker reads distinctly from one making visible
// progress. Terminal work (complete/failed/cancelled) never crowds the main
// grid — it sinks into a collapsed Archive, counted in the header.

const BUCKET_LABEL: Record<FleetBucket, string> = {
  active: "Active",
  "waiting-on-you": "Waiting on you",
  stalled: "Stalled",
  archived: "Archived",
};

const FRESHNESS_LABEL: Record<FreshnessTier, string> = {
  fresh: "fresh",
  idle: "idle",
  stalled: "stalled",
  unknown: "no activity data",
};

export interface WorkerFleetSectionProps {
  state: OperatingState;
  /**
   * Fixed reference clock (epoch ms) for classifying freshness and rendering
   * each card's relative "updated" time deterministically — e.g. a test.
   * Defaults to the real wall clock (`Date.now()`, read fresh on every
   * render) when omitted, mirroring BoardView's `now` prop (lib/src/BoardView.tsx).
   */
  now?: number;
}

export function WorkerFleetSection({ state, now }: WorkerFleetSectionProps) {
  const clock = now ?? Date.now();
  const cards = useMemo(() => deriveFleetCards(state, clock), [state, clock]);
  const counts = useMemo(() => deriveFleetCounts(cards), [cards]);
  const grid = useMemo(() => partitionFleet(cards), [cards]);
  const [filter, setFilter] = useState<FleetBucket | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const visible = filter ? grid.main.filter((card) => card.bucket === filter) : grid.main;

  function toggleFilter(bucket: FleetBucket) {
    setFilter((current) => (current === bucket ? null : bucket));
  }

  return (
    <section className="ov-section" aria-label="Fleet">
      <header className="ov-head">
        <h2 className="ov-title">The fleet</h2>
        <span className="ov-sub">
          {cards.length} worker{cards.length === 1 ? "" : "s"} tracked
        </span>
      </header>

      <div className="wf-counts" role="group" aria-label="Fleet status filters">
        <WfCount bucket="active" count={counts.active} active={filter === "active"} onClick={() => toggleFilter("active")} />
        <WfCount bucket="waiting-on-you" count={counts.waitingOnYou} active={filter === "waiting-on-you"} onClick={() => toggleFilter("waiting-on-you")} />
        <WfCount bucket="stalled" count={counts.stalled} active={filter === "stalled"} onClick={() => toggleFilter("stalled")} />
        <button
          type="button"
          className={`wf-count wf-count-archived${archiveOpen ? " is-active" : ""}`}
          onClick={() => setArchiveOpen((open) => !open)}
          aria-expanded={archiveOpen}
          aria-controls="wf-archive"
        >
          <span className="wf-count-value">{counts.archived}</span>
          <span className="wf-count-label">{BUCKET_LABEL.archived}</span>
        </button>
      </div>

      {visible.length > 0 ? (
        <ul className="wf-grid" aria-label="Active workers">
          {visible.map((card) => (
            <WorkerCard key={card.id} card={card} now={clock} />
          ))}
        </ul>
      ) : (
        <p className="now-idle">
          {filter ? `No workers are currently ${BUCKET_LABEL[filter].toLowerCase()}.` : "No active workers — the fleet is quiet."}
        </p>
      )}

      <div id="wf-archive" className="wf-archive">
        <button type="button" className="wf-archive-toggle" onClick={() => setArchiveOpen((open) => !open)} aria-expanded={archiveOpen}>
          {archiveOpen ? "Hide archive" : "Show archive"} · {grid.archived.length} completed
        </button>
        {archiveOpen ? (
          grid.archived.length > 0 ? (
            <ul className="wf-grid wf-grid-archived" aria-label="Archived workers">
              {grid.archived.map((card) => (
                <WorkerCard key={card.id} card={card} now={clock} />
              ))}
            </ul>
          ) : (
            <p className="now-idle">Nothing archived yet.</p>
          )
        ) : null}
      </div>
    </section>
  );
}

function WfCount({
  bucket,
  count,
  active,
  onClick,
}: {
  bucket: FleetBucket;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`wf-count wf-count-${bucket}${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active}>
      <span className="wf-count-value">{count}</span>
      <span className="wf-count-label">{BUCKET_LABEL[bucket]}</span>
    </button>
  );
}

function WorkerCard({ card, now }: { card: FleetCard; now: number }) {
  const pct = typeof card.percentComplete === "number" ? Math.max(0, Math.min(100, card.percentComplete)) : null;
  return (
    <li className={`wf-card wf-card-${card.bucket}`}>
      <div className="wf-card-head">
        <span className="wf-card-title" title={card.label}>{card.label}</span>
        <StatusBadge status={card.status} />
      </div>
      {card.stepLabel ? <p className="wf-card-step">at {card.stepLabel}</p> : null}
      {card.blockedReason ? <p className="wf-card-blocked">{card.blockedReason}</p> : null}
      {pct != null ? (
        <div
          className="wf-card-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% complete`}
        >
          <span className="wf-card-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="wf-card-foot">
        <span className={`wf-freshness wf-freshness-${card.freshness}`}>{FRESHNESS_LABEL[card.freshness]}</span>
        {card.updatedAt ? (
          <time className="wf-card-time" dateTime={card.updatedAt}>{formatRelative(card.updatedAt, now)}</time>
        ) : (
          <span className="wf-card-time wf-card-time-unknown">no activity recorded</span>
        )}
      </div>
    </li>
  );
}
