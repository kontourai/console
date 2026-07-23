import React from "react";
import { StatusBadge, Badge, Empty } from "@kontourai/ui/react";
import { formatRelative } from "../../utils/format";
import type { RunDetail, RunGateEntry, RunStageOutcome } from "./deriveRunDetail";

const FRESHNESS_LABEL: Record<RunDetail["freshness"], string> = {
  fresh: "fresh",
  idle: "idle",
  stalled: "stalled",
  unknown: "no activity data",
};

const STAGE_OUTCOME_LABEL: Record<RunStageOutcome, string> = {
  completed: "completed",
  earlier: "earlier",
  current: "current",
  blocked: "blocked",
  failed: "failed",
  pending: "pending",
};

/**
 * console#253 run drill-in body: stage strip (topology + current position),
 * gate history (clickable, the click-path #255's trust panel lands on),
 * recent timeline slice, and the run-header extras (freshness, blocked
 * reason, source-of-truth link-outs). Pure render over an already-derived
 * `RunDetail` (`deriveRunDetail.ts`) — no fetching, no local state, so SSE
 * updates flowing through `state` re-derive this view on every render with
 * no extra plumbing.
 */
export function RunDetailView({ detail, now }: { detail: RunDetail; now: number }) {
  return (
    <div className="run-detail">
      <RunHeaderExtras detail={detail} now={now} />
      <RunStageStrip detail={detail} />
      <RunGateHistory gates={detail.gates} now={now} />
      <RunTimelineSlice detail={detail} now={now} />
    </div>
  );
}

function RunHeaderExtras({ detail, now }: { detail: RunDetail; now: number }) {
  return (
    <div className="run-detail-header">
      <div className="run-detail-header-row">
        <StatusBadge status={detail.status} />
        <span className={`wf-freshness wf-freshness-${detail.freshness}`}>{FRESHNESS_LABEL[detail.freshness]}</span>
        <RunActivityTime detail={detail} now={now} />
      </div>
      {detail.blockedReason ? <p className="run-detail-blocked">{detail.blockedReason}</p> : null}
      {detail.sourceOfTruthRefs.length > 0 ? (
        <ul className="run-detail-source-refs" aria-label="Source of truth">
          {detail.sourceOfTruthRefs.map((ref) => (
            <li key={ref.url}>
              <a href={ref.url} target="_blank" rel="noopener noreferrer">
                {ref.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Render mode decided by classifyActivity (via deriveRunDetail), never
// re-derived here — mirrors WorkerFleetSection's ActivityTime.
function RunActivityTime({ detail, now }: { detail: RunDetail; now: number }) {
  if (detail.display === "relative" && detail.updatedAt) {
    return <time className="run-detail-time" dateTime={detail.updatedAt}>updated {formatRelative(detail.updatedAt, now)}</time>;
  }
  if (detail.display === "raw" && detail.updatedAt) {
    return (
      <time className="run-detail-time run-detail-time-raw" dateTime={detail.updatedAt} title="Timestamp is in the future — showing it as-is, not a relative time.">
        {detail.updatedAt}
      </time>
    );
  }
  return <span className="run-detail-time run-detail-time-unknown">no activity recorded</span>;
}

function RunStageStrip({ detail }: { detail: RunDetail }) {
  if (detail.stages.length === 0) {
    return <Empty label="No stage topology known for this run yet." />;
  }
  return (
    <ol className="run-stage-strip" aria-label="Run stages">
      {detail.stages.map((stage) => (
        <li
          key={stage.id}
          className={`run-stage run-stage-${stage.outcome}${stage.current ? " run-stage-position-current" : ""}`}
          aria-current={stage.current ? "step" : undefined}
        >
          <span className="run-stage-label">{stage.label}</span>
          <span className="run-stage-status">{STAGE_OUTCOME_LABEL[stage.outcome]}</span>
        </li>
      ))}
    </ol>
  );
}

function RunGateHistory({ gates, now }: { gates: RunGateEntry[]; now: number }) {
  return (
    <section className="run-detail-section" aria-label="Gate history">
      <p className="section-label">Gate history</p>
      {gates.length === 0 ? (
        <p className="run-detail-empty">No gates recorded for this run yet.</p>
      ) : (
        <ul className="run-gate-history">
          {gates.map((gate) => (
            <li key={gate.id} className="run-gate-entry">
              <a href={gate.href} className="run-gate-link">
                <span className="run-gate-label">{gate.label}</span>
                <Badge value={gate.status} />
                <TimeOrRaw value={gate.updatedAt} now={now} className="run-gate-time" emptyLabel="no activity recorded" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunTimelineSlice({ detail, now }: { detail: RunDetail; now: number }) {
  return (
    <section className="run-detail-section" aria-label="Run timeline">
      <p className="section-label">Recent activity</p>
      {detail.timeline.length === 0 ? (
        <p className="run-detail-empty">No recent activity recorded for this run.</p>
      ) : (
        <ul className="run-timeline-slice">
          {detail.timeline.map((item) => {
            const when = item.occurredAt || item.observedAt;
            return (
              <li key={item.id} className="run-timeline-entry">
                <strong>{item.type || "event"}</strong>
                <span>{item.summary || item.subjectRef?.label || item.subjectRef?.id || item.id}</span>
                <TimeOrRaw value={when} now={now} className="run-timeline-time" emptyLabel="no timestamp" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function isParsableTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * console#253 review finding 7: a truthy-but-invalid timestamp string (e.g.
 * a garbage `updatedAt` on a gate/timeline record — neither field goes
 * through `classifyActivity`'s own parse guard the way the header's
 * `RunActivityTime` does) must never render an invalid `<time
 * dateTime="not-a-date">` — same parse-before-render discipline as
 * `classifyActivity`. A present-but-unparsable value still renders as plain
 * text (never silently dropped, never a fabricated relative time); only a
 * genuinely missing value falls back to `emptyLabel`.
 */
function TimeOrRaw({ value, now, className, emptyLabel }: { value?: string; now: number; className: string; emptyLabel: string }) {
  if (value && isParsableTimestamp(value)) {
    return <time className={className} dateTime={value}>{formatRelative(value, now)}</time>;
  }
  if (value) {
    return <span className={`${className} run-detail-time-raw`}>{value}</span>;
  }
  return <span className={`${className} run-detail-time-unknown`}>{emptyLabel}</span>;
}
