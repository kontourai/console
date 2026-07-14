import { Empty } from "@kontourai/ui/react";
import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { formatUsd, formatCompact, formatRelative } from "../../utils/format";
import {
  deriveActivity,
  deriveTurnCost,
  activityAltText,
  knownActionClass
} from "./activityCostDerive";

/**
 * #181 lead section: "what am I doing, on what, at what cost?" — activity by
 * action class + per-turn cost, from the #180 read-model projections. Leads the
 * Telemetry page above the provenance detail. Honest empty states when the
 * enriched tool-event stream hasn't produced the data yet.
 */
export function TelemetryActivityCost({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const analytics = telemetry?.analytics;
  const { totalActions, barSegments, legend } = deriveActivity(analytics?.actionClasses ?? []);
  const { turnCount, totalCost, avgPerTurn, topTurns } = deriveTurnCost(analytics?.costPerTurn);

  return (
    <div className="telemetry-lead">
      <section className="telemetry-lead-panel" aria-label="Activity by action class">
        <p className="section-label">Activity</p>
        {totalActions > 0 ? (
          <>
            <div className="activity-bar" role="img" aria-label={activityAltText(legend, totalActions)}>
              {barSegments.map((entry) => (
                <span
                  key={entry.actionClass}
                  className={`activity-seg activity-${knownActionClass(entry.actionClass)}`}
                  style={{ width: `${(entry.count / totalActions) * 100}%` }}
                  title={`${entry.label}: ${entry.count}`}
                />
              ))}
            </div>
            <ul className="activity-legend">
              {legend.map((entry) => (
                <li key={entry.actionClass}>
                  <span className={`activity-dot activity-${knownActionClass(entry.actionClass)}`} aria-hidden="true" />
                  <span className="activity-legend-label">{entry.label}</span>
                  <span className="activity-legend-count">{formatCompact(entry.count)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty label="No tool activity yet — actions appear as agents run and emit tool events." />
        )}
      </section>

      <section className="telemetry-lead-panel" aria-label="Cost per turn">
        <p className="section-label">Cost per turn</p>
        {turnCount > 0 ? (
          <>
            <dl className="telemetry-lead-metrics">
              <div>
                <dt>est. cost</dt>
                <dd>{formatUsd(totalCost)}</dd>
              </div>
              <div>
                <dt>turns</dt>
                <dd>{turnCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>avg / turn</dt>
                <dd>{formatUsd(avgPerTurn)}</dd>
              </div>
            </dl>
            {topTurns.length > 0 ? (
              <ul className="turn-list" aria-label="Recent turns by cost">
                {topTurns.map((turn) => (
                  <li key={turn.turnId} className="turn-row">
                    <span className="turn-model" title={turn.model || "unknown model"}>{turn.model || "unknown"}</span>
                    <span className="turn-cost">{formatUsd(turn.estimatedCostUsd)}</span>
                    <span className="turn-tools">{turn.toolCount} {turn.toolCount === 1 ? "tool" : "tools"}</span>
                    <span className="turn-time">{formatRelative(turn.startedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Empty label="No priced turns yet — per-turn cost lands once enriched tool events arrive (flow-agents #568)." />
        )}
      </section>
    </div>
  );
}
