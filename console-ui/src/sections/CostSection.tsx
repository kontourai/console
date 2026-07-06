import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import { deriveActivityBuckets } from "./environment/derive";
import { formatCompact, formatUsd } from "../utils/format";

// "What it's costing" — the telemetry view distilled to the operator's question: spend, tokens, and
// where the money goes. Leads with KPIs, a live activity trend (Recharts area chart, fed by
// deriveActivityBuckets), and a spend-by-model breakdown — instead of a flat equal-weight facet grid.

// Literal token hexes: Recharts needs concrete color strings (SVG gradient stops), so these mirror
// @kontourai/ui's --k-* palette 1:1 (default teal theme).
const C = {
  brand: "#5ce0c6",
  active: "#7aa2ff",
  faint: "#72869b",
  line: "rgba(150,180,210,0.18)",
  panel: "#16202d",
  text: "#eef3f8",
  muted: "#aebccb",
};

interface CostSectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  onOpen: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function bucketTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CostSection({ telemetry, onOpen }: CostSectionProps) {
  const usage = telemetry?.totals.usage;
  const reduceMotion = prefersReducedMotion();

  const series = useMemo(
    () => (telemetry ? deriveActivityBuckets(telemetry.records).map((b) => ({ t: bucketTime(b.label), count: b.count })) : []),
    [telemetry],
  );

  const models = useMemo(() => {
    const list = (telemetry?.analytics.usageByModel || [])
      .map((m) => ({ label: m.label || m.key, cost: m.estimatedCostUsd ?? 0, tokens: m.totalTokens ?? 0 }))
      .filter((m) => m.label)
      .sort((a, b) => b.cost - a.cost);
    const max = list.reduce((acc, m) => Math.max(acc, m.cost), 0);
    return { list, max };
  }, [telemetry]);

  const hasActivity = series.some((s) => s.count > 0);

  return (
    <section className="ov-section">
      <header className="ov-head">
        <h2 className="ov-title">What it&rsquo;s costing</h2>
        <span className="ov-sub">usage &amp; economics</span>
        <span className="ov-grow" />
        <button type="button" className="ov-link" onClick={onOpen}>break down by project →</button>
      </header>

      {/* KPI row */}
      <div className="cost-kpis">
        <CostMetric label="Est. spend" value={formatUsd(usage?.estimatedCostUsd)} />
        <CostMetric label="Total tokens" value={formatCompact(usage?.totalTokens)} detail={`${formatCompact(usage?.cacheReadInputTokens)} cache read`} />
        <CostMetric label="Sessions" value={String(telemetry?.totals.sessionCount ?? 0)} detail={`${formatCompact(telemetry?.totals.recordCount)} records`} />
        <CostMetric label="Output tokens" value={formatCompact(usage?.outputTokens)} />
      </div>

      <div className="cost-grid">
        {/* Activity trend (Recharts) */}
        <div className="cost-panel">
          <div className="cost-panel-head">Activity <span className="cost-sub">last hour</span></div>
          {hasActivity ? (
            <div className="cost-chart">
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="cost-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.brand} stopOpacity={0.42} />
                      <stop offset="100%" stopColor={C.brand} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" tick={{ fill: C.faint, fontSize: 10 }} tickLine={false} axisLine={{ stroke: C.line }} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis hide domain={[0, "dataMax + 1"]} />
                  <Tooltip
                    cursor={{ stroke: C.line }}
                    contentStyle={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, fontSize: 12 }}
                    labelStyle={{ color: C.muted }}
                    formatter={(value) => `${value} events`}
                  />
                  <Area type="monotone" dataKey="count" stroke={C.brand} strokeWidth={2} fill="url(#cost-area)" isAnimationActive={!reduceMotion} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="now-idle">No activity in the last hour.</p>
          )}
        </div>

        {/* Spend by model */}
        <div className="cost-panel">
          <div className="cost-panel-head">Spend by model <span className="cost-sub">{models.list.length} model{models.list.length === 1 ? "" : "s"}</span></div>
          {models.list.length > 0 ? (
            <ul className="cost-models">
              {models.list.slice(0, 6).map((m) => (
                <li key={m.label} className="cost-model-row">
                  <span className="cost-model-name">{m.label}</span>
                  <span className="cost-model-track"><span className="cost-model-fill" style={{ width: `${models.max > 0 ? Math.max(3, (m.cost / models.max) * 100) : 3}%` }} /></span>
                  <span className="cost-model-amt">{formatUsd(m.cost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="now-idle">No model spend recorded yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function CostMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="cost-metric">
      <span className="cost-metric-label">{label}</span>
      <span className="cost-metric-value">{value}</span>
      {detail ? <span className="cost-metric-detail">{detail}</span> : null}
    </div>
  );
}
