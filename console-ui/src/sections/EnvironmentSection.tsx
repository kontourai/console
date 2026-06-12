import { useMemo } from "react";
import type { OperatingState } from "@kontourai/console-core";
import { Badge, Empty, Metric, Panel } from "@kontourai/console-kit/react";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import { formatTime } from "../utils/format";
import {
  deriveActivityBuckets,
  deriveAttentionItems,
  deriveHealthCounts,
  deriveTopWorkloads,
} from "./environment/derive";

export interface EnvironmentSectionProps {
  state: OperatingState;
  telemetry: ConsoleTelemetryResponse | null;
  liveStatus: string;
  lastLiveAt?: string | null;
}

export function EnvironmentSection({ state, telemetry, liveStatus, lastLiveAt }: EnvironmentSectionProps) {
  const health = useMemo(() => deriveHealthCounts(state), [state]);
  const attention = useMemo(() => deriveAttentionItems(state, telemetry), [state, telemetry]);
  const activity = useMemo(
    () => deriveActivityBuckets(telemetry?.records || []),
    [telemetry],
  );
  const workloads = useMemo(() => deriveTopWorkloads(telemetry), [telemetry]);

  return (
    <section className="environment-section" aria-label="Environment">
      <div className="section-head">
        <div>
          <p className="section-label">Environment</p>
          <h2>Operational roll-up</h2>
        </div>
        <p className="receipt">
          {liveStatus} / {lastLiveAt ? `live ${formatTime(lastLiveAt)}` : telemetry?.generatedAt ? `refreshed ${formatTime(telemetry.generatedAt)}` : "waiting"}
        </p>
      </div>

      {/* Health band */}
      <div className="env-health-band" aria-label="Health counts">
        <HealthGroup label="Processes">
          <Metric label="active" value={health.activeProcesses} />
        </HealthGroup>
        <HealthGroup label="Gates">
          <Metric label="passed" value={health.gatesPassed} />
          <Metric label="blocked" value={health.gatesBlocked} />
        </HealthGroup>
        <HealthGroup label="Claims">
          <Metric label="ok" value={health.claimsOk} />
          <Metric label="at-risk" value={health.claimsAtRisk} />
          <Metric label="stale" value={health.claimsStale} />
        </HealthGroup>
        <HealthGroup label="Inquiries">
          <Metric label="open" value={health.openInquiries} />
        </HealthGroup>
        <HealthGroup label="Telemetry">
          <Metric label="records" value={telemetry?.totals.recordCount ?? 0} />
          <Metric label="sessions" value={telemetry?.totals.sessionCount ?? 0} />
        </HealthGroup>
      </div>

      {/* Main grid */}
      <div className="env-main-grid">
        {/* Needs attention */}
        <Panel title="Needs attention" count={attention.length}>
          <div className="stack">
            {attention.map((item) => (
              <article className="data-row" key={`${item.kind}:${item.id}`}>
                <div className="row-title">
                  <strong>{item.label}</strong>
                  <Badge value={attentionKindLabel(item.kind)} />
                </div>
                <p>{item.detail}</p>
              </article>
            ))}
            {!attention.length ? <Empty label="All clear for now." /> : null}
          </div>
        </Panel>

        {/* Activity sparkline */}
        <Panel title="Activity" count={telemetry?.totals.recordCount ?? 0}>
          <ActivitySparkline buckets={activity} />
          <div className="env-activity-legend">
            <span>last hour · {activity.reduce((sum, b) => sum + b.count, 0).toLocaleString()} events in window</span>
            {!telemetry ? <span className="env-activity-no-data">no telemetry yet</span> : null}
          </div>
        </Panel>
      </div>

      {/* Top workloads */}
      <div className="env-workloads-grid">
        <WorkloadPanel title="Top projects" entries={workloads.projects} emptyLabel="No project data yet" />
        <WorkloadPanel title="Top tools" entries={workloads.tools} emptyLabel="No tool data yet" />
        <WorkloadPanel title="Top agents" entries={workloads.agents} emptyLabel="No agent data yet" />
      </div>
    </section>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function HealthGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="env-health-group">
      <p className="section-label">{label}</p>
      <div className="env-health-metrics">
        {children}
      </div>
    </div>
  );
}

function ActivitySparkline({ buckets }: { buckets: Array<{ label: string; count: number }> }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="env-sparkline" aria-label="Event activity over last hour" role="img">
      {buckets.map((bucket) => (
        <div
          key={bucket.label}
          className="env-sparkline-bar"
          style={{ "--bar-h": `${Math.max(2, Math.round((bucket.count / max) * 100))}%` } as React.CSSProperties}
          title={`${new Date(bucket.label).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${bucket.count}`}
          aria-label={`${bucket.count} events`}
        />
      ))}
    </div>
  );
}

function WorkloadPanel({ title, entries, emptyLabel }: {
  title: string;
  entries: Array<{ name: string; count: number }>;
  emptyLabel: string;
}) {
  const max = Math.max(...entries.map((e) => e.count), 1);
  return (
    <Panel title={title} count={entries.length}>
      <div className="stack">
        {entries.map((entry) => (
          <div className="env-workload-row" key={entry.name}>
            <div className="env-workload-label">
              <span>{entry.name}</span>
              <strong>{entry.count.toLocaleString()}</strong>
            </div>
            <div className="env-workload-bar-track">
              <div
                className="env-workload-bar-fill"
                style={{ inlineSize: `${Math.max(4, Math.round((entry.count / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
        {!entries.length ? <Empty label={emptyLabel} /> : null}
      </div>
    </Panel>
  );
}

function attentionKindLabel(kind: string): string {
  switch (kind) {
    case "blocked-gate": return "blocked";
    case "stale-claim": return "stale";
    case "long-running-process": return "long-running";
    case "quiet-source": return "quiet";
    default: return kind;
  }
}
