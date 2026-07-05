import { useMemo } from "react";
import type { OperatingState, TimelineItem } from "@kontourai/console-core";
import { toneForValue } from "@kontourai/ui/react";
import { deriveProcessList } from "./environment/derive";
import { formatRelative } from "../utils/format";

// "Happening now" — the live face of the operating state: the current stage, the active work in
// flight, and a plain-language activity feed of the most recent events. Folds the old Operate view's
// StageBand + Timeline into the Overview so the operator sees "what's going on" without a tab hop.
// Reuses deriveProcessList (never forks the active-work filter); the activity feed reads state.timeline
// (the same source TimelineSection renders).

interface HappeningNowSectionProps {
  state: OperatingState;
  onOpen: () => void;
}

const MAX_FEED = 7;

function stepLabel(step: string | { id?: string; label?: string } | undefined): string | undefined {
  if (!step) return undefined;
  return typeof step === "string" ? step : step.label || step.id;
}

export function HappeningNowSection({ state, onOpen }: HappeningNowSectionProps) {
  const active = useMemo(() => deriveProcessList(state), [state]);
  const feed = useMemo(
    () => [...(state.timeline || [])].slice(-MAX_FEED).reverse(),
    [state.timeline],
  );
  const stage = state.currentStage?.trim();

  return (
    <section className="ov-section">
      <header className="ov-head">
        <h2 className="ov-title">Happening now</h2>
        <span className="ov-sub">the live flow</span>
        <span className="ov-grow" />
        <button type="button" className="ov-link" onClick={onOpen}>open the board →</button>
      </header>

      <div className="now-grid">
        {/* Active work + current stage */}
        <div className="now-panel">
          <div className="now-panel-head">Active work<span className="now-count">{active.length}</span></div>
          {stage ? <p className="now-stage">{stage}</p> : null}
          {active.length > 0 ? (
            <ul className="now-work">
              {active.slice(0, 5).map((p) => {
                const step = stepLabel(p.currentStep);
                const pct = typeof p.percentComplete === "number" ? Math.max(0, Math.min(100, p.percentComplete)) : null;
                return (
                  <li key={p.id} className="now-work-row">
                    <div className="now-work-main">
                      <span className="now-work-label">{p.label || p.id}</span>
                      {step ? <span className="now-work-step">{step}</span> : null}
                    </div>
                    {pct != null ? (
                      <div className="now-progress" title={`${pct}%`}>
                        <span className="now-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    ) : (
                      <span className={`now-work-status tone-${toneForValue(p.status || "active")}`}>{p.status || "active"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="now-idle">No active work right now — the board is quiet.</p>
          )}
        </div>

        {/* Live activity feed */}
        <div className="now-panel">
          <div className="now-panel-head">Live activity<span className="now-count">last {feed.length}</span></div>
          {feed.length > 0 ? (
            <ul className="now-feed">
              {feed.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="now-idle">Nothing has streamed yet. Events posted to the hub appear here live.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ActivityRow({ item }: { item: TimelineItem }) {
  const when = formatRelative(item.observedAt || item.occurredAt);
  const who = item.producer?.name || item.producer?.id || item.producer?.product;
  const tone = toneForValue(item.type || "event");
  return (
    <li className="feed-row">
      <span className={`feed-dot tone-${tone}`} aria-hidden="true" />
      <div className="feed-body">
        <span className="feed-title">{item.summary || item.type || "event"}</span>
        {who ? <span className="feed-who">{who}</span> : null}
      </div>
      <span className="feed-time">{when}</span>
    </li>
  );
}
