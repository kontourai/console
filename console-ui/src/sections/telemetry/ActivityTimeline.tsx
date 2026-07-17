import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty } from "@kontourai/ui/react";
import type { ConsoleTelemetryActionClass, ConsoleTelemetryResponse } from "../../serverApiTypes";
import { ACTION_ORDER } from "./activityCostDerive";
import { deriveActivityTimeline } from "./activityTimelineDerive";

// Recharts needs concrete color strings (SVG fill), so — like CostSection — these
// approximate the activity palette with the default teal theme's token hexes.
// They are chosen distinct per class (edit/read share a hue in the lead bar's CSS
// palette, which would be ambiguous in a stacked chart) so adjacent stack
// segments stay legible. Under a non-default theme they no longer track the CSS
// palette exactly — a known cosmetic limitation, consistent with CostSection.
const CLASS_COLOR: Record<ConsoleTelemetryActionClass, string> = {
  edit: "#5ce0c6",
  search: "#7aa2ff",
  read: "#34d399",
  execute: "#f3b14b",
  web: "#c084fc",
  delegate: "#f472b6",
  other: "#72869b"
};

const CLASS_LABEL: Record<ConsoleTelemetryActionClass, string> = {
  edit: "Edit",
  read: "Read",
  search: "Search",
  execute: "Execute",
  web: "Web",
  delegate: "Delegate",
  other: "Other"
};

const AXIS = { faint: "#72869b", line: "rgba(150,180,210,0.18)", panel: "#16202d", text: "#eef3f8", muted: "#aebccb" };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

/**
 * #181 Piece B: activity (tool.invoke) over time, bucketed hourly and split by
 * action class into a stacked bar. Honest empty state until activity exists.
 */
export function TelemetryActivityTimeline({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const { points, totalActions, windowLabel } = deriveActivityTimeline(telemetry?.analytics?.activityTimeline);
  const reduceMotion = prefersReducedMotion();

  return (
    <section className="telemetry-panel" aria-label="Activity over time">
      <p className="section-label">Activity over time</p>
      {totalActions > 0 ? (
        <div className="activity-timeline-chart">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="t" tick={{ fill: AXIS.faint, fontSize: 10 }} tickLine={false} axisLine={{ stroke: AXIS.line }} interval="preserveStartEnd" minTickGap={28} />
              <YAxis hide domain={[0, "dataMax + 1"]} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: "rgba(150,180,210,0.08)" }}
                contentStyle={{ background: AXIS.panel, border: `1px solid ${AXIS.line}`, borderRadius: 8, color: AXIS.text, fontSize: 12 }}
                labelStyle={{ color: AXIS.muted }}
              />
              {ACTION_ORDER.map((cls, index) => (
                <Bar
                  key={cls}
                  dataKey={cls}
                  name={CLASS_LABEL[cls]}
                  stackId="activity"
                  fill={CLASS_COLOR[cls]}
                  radius={index === ACTION_ORDER.length - 1 ? [2, 2, 0, 0] : undefined}
                  isAnimationActive={!reduceMotion}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <ul className="activity-legend" aria-hidden="true">
            {ACTION_ORDER.map((cls) => (
              <li key={cls}>
                <span className="activity-dot" style={{ background: CLASS_COLOR[cls] }} />
                <span className="activity-legend-label">{CLASS_LABEL[cls]}</span>
              </li>
            ))}
          </ul>
          <p className="activity-timeline-note">{windowLabel}</p>
        </div>
      ) : (
        <Empty label="No activity to chart yet — the timeline fills as agents run and emit tool events." />
      )}
    </section>
  );
}
