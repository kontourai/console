import { Empty } from "@kontourai/console-kit/react";
import type { ReactNode } from "react";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import { formatTime } from "../utils/format";

interface TelemetrySectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  error: string | null;
  liveStatus: string;
  lastLiveAt?: string | null;
}

export function TelemetrySection({ telemetry, error, liveStatus, lastLiveAt }: TelemetrySectionProps) {
  const recentEvents = (telemetry?.records || []).slice(0, 12);

  return (
    <section className="telemetry-section" aria-label="Telemetry">
      <div className="section-head">
        <div>
          <p className="section-label">Telemetry</p>
          <h2>Runtime and workflow usage</h2>
        </div>
        <p className="receipt">
          {liveStatus} / {lastLiveAt ? `live ${formatTime(lastLiveAt)}` : telemetry?.generatedAt ? `refreshed ${formatTime(telemetry.generatedAt)}` : "waiting"}
        </p>
      </div>

      {error ? <div className="notice telemetry-notice">{error}</div> : null}

      <TelemetryTotals telemetry={telemetry} />
      <TelemetryGrid telemetry={telemetry} recentEvents={recentEvents} />
      <RecentTelemetryEvents events={recentEvents} />
      <TelemetryWarnings telemetry={telemetry} />
    </section>
  );
}

function TelemetryTotals({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const toolInvocations = telemetry?.totals.eventTypeCounts["tool.invoke"] || 0;
  const delegations = telemetry?.totals.eventTypeCounts["agent.delegate"] || 0;
  const projectCount = facetById(telemetry, "projects")?.counts.length || 0;
  return (
    <div className="telemetry-metrics" aria-label="Telemetry totals">
      <TelemetryMetric label="records" value={telemetry?.totals.recordCount ?? 0} />
      <TelemetryMetric label="sessions" value={telemetry?.totals.sessionCount ?? 0} />
      <TelemetryMetric label="projects" value={projectCount} />
      <TelemetryMetric label="tools" value={toolInvocations} />
      <TelemetryMetric label="delegations" value={delegations} />
    </div>
  );
}

function TelemetryGrid({ telemetry, recentEvents }: { telemetry: ConsoleTelemetryResponse | null; recentEvents: ConsoleTelemetryResponse["records"] }) {
  const facets = telemetry?.analytics.facets || fallbackFacets(telemetry, recentEvents);
  const primaryFacetIds = ["projects", "tools", "runtimes", "agents", "models", "events"];
  const primaryFacets = primaryFacetIds
    .map((id) => facets.find((facet) => facet.id === id))
    .filter((facet): facet is NonNullable<typeof facet> => Boolean(facet));
  const secondaryFacets = facets.filter((facet) => !primaryFacetIds.includes(facet.id));
  return (
    <div className="telemetry-grid">
      <TelemetrySources sources={telemetry?.sources || []} />
      {primaryFacets.map((facet) => (
        <TelemetryPanel label={facet.id} title={facet.label} key={facet.id}>
          <BarList entries={facet.counts.map((item) => [item.name, item.count])} />
        </TelemetryPanel>
      ))}
      {secondaryFacets.length ? (
        <TelemetryPanel label="Dimensions" title="Additional breakdowns">
          <div className="dimension-stack">
            {secondaryFacets.slice(0, 6).map((facet) => (
              <div className="dimension-row" key={facet.id}>
                <strong>{facet.label}</strong>
                <span>{facet.counts.slice(0, 3).map((item) => `${item.name} ${item.count}`).join(" / ") || "none"}</span>
              </div>
            ))}
          </div>
        </TelemetryPanel>
      ) : null}
      {(telemetry?.analytics.flows || []).map((flow) => <TelemetryFlowPanel flow={flow} key={flow.id} />)}
    </div>
  );
}

function TelemetryFlowPanel({ flow }: { flow: ConsoleTelemetryResponse["analytics"]["flows"][number] }) {
  return (
    <TelemetryPanel label="Flow" title={flow.label}>
      <div className="stack">
        <div className="data-row telemetry-source">
          <div className="row-title">
            <strong>{flow.id}</strong>
            <span>{flow.total}</span>
          </div>
          <p>{flow.total.toLocaleString()} matched workflow item{flow.total === 1 ? "" : "s"}</p>
        </div>
        {flow.items.slice(0, 5).map((item) => (
          <div className="data-row" key={item.slug}>
            <div className="row-title">
              <strong>{item.slug}</strong>
              <span>{item.status || "status"}</span>
            </div>
            <p>{item.title || item.updatedAt || "No descriptor title field."}</p>
          </div>
        ))}
      </div>
    </TelemetryPanel>
  );
}

function TelemetrySources({ sources }: { sources: ConsoleTelemetryResponse["sources"] }) {
  return (
    <TelemetryPanel label="Sources" title="Observed inputs">
      <div className="stack">
        {sources.map((source) => (
          <div className="data-row telemetry-source" key={source.id}>
            <div className="row-title">
              <strong>{source.id}</strong>
              <span>{source.recordCount}</span>
            </div>
            <p>{[source.kind, source.status].filter(Boolean).join(" / ") || "source"}</p>
            <p>{source.path || "no path reported"}</p>
          </div>
        ))}
        {!sources.length ? <Empty label="No telemetry sources found." /> : null}
      </div>
    </TelemetryPanel>
  );
}

function RecentTelemetryEvents({ events }: { events: ConsoleTelemetryResponse["records"] }) {
  return (
    <div className="telemetry-section telemetry-recent">
      <div className="section-head">
        <div>
          <p className="section-label">Recent Runtime Events</p>
          <h2>Latest accepted telemetry</h2>
        </div>
      </div>
      <div className="timeline">
        {events.map((event) => (
          <div className="timeline-row" key={`${event.sourceId}:${event.eventId}`}>
            <span>{event.eventType}</span>
            <div>
              <strong>{event.toolName || event.agentName || event.runtime || event.project || event.sourceId}</strong>
              <p>{eventSubtitle(event)}</p>
              <details className="telemetry-details">
                <summary>Details</summary>
                <dl>
                  {dimensionEntries(event).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
            <time>{event.observedAt ? formatTime(event.observedAt) : "unknown"}</time>
          </div>
        ))}
        {!events.length ? <Empty label="No runtime telemetry events yet." /> : null}
      </div>
    </div>
  );
}

function TelemetryWarnings({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  if (!telemetry?.warnings.length) return null;
  return (
    <div className="telemetry-warnings">
      {telemetry.warnings.map((warning) => <p key={`${warning.path}:${warning.message}`}>{warning.message || warning.path}</p>)}
    </div>
  );
}

function TelemetryPanel({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  return (
    <section className="telemetry-panel">
      <p className="section-label">{label}</p>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function TelemetryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value.toLocaleString()}</dd>
    </div>
  );
}

function BarList({ entries }: { entries: Array<[string, number]> }) {
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return (
    <div className="bar-list">
      {entries.map(([label, count]) => (
        <div className="bar-row" key={label}>
          <div>
            <span>{label}</span>
            <strong>{count.toLocaleString()}</strong>
          </div>
          <i style={{ inlineSize: `${Math.max(4, (count / max) * 100)}%` }} />
        </div>
      ))}
      {!entries.length ? <Empty label="No counts available." /> : null}
    </div>
  );
}

function topEntries(values: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(values)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function countBy<T>(values: T[], field: keyof T): Record<string, number> {
  return values.reduce((counts: Record<string, number>, value) => {
    const key = typeof value[field] === "string" && value[field] ? String(value[field]) : "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function facetById(telemetry: ConsoleTelemetryResponse | null, id: string) {
  return telemetry?.analytics.facets.find((facet) => facet.id === id);
}

function eventSubtitle(event: ConsoleTelemetryResponse["records"][number]): string {
  return [
    event.project,
    event.runtime,
    event.agentName,
    event.model,
    event.status || event.outcome,
    event.sessionId
  ].filter(Boolean).join(" / ") || event.sourceId;
}

function dimensionEntries(event: ConsoleTelemetryResponse["records"][number]): Array<[string, string]> {
  const base: Record<string, string | undefined> = {
    project: event.project,
    cwd: event.cwd,
    runtime: event.runtime,
    runtimeVersion: event.runtimeVersion,
    model: event.model,
    agent: event.agentName,
    tool: event.toolName,
    hook: event.hookEventName,
    outcome: event.outcome,
    status: event.status,
    session: event.sessionId,
    runtimeSession: event.runtimeSessionId,
    turn: event.turnId,
    delegation: event.delegationTarget,
    source: event.sourceId,
    path: event.path
  };
  const merged = { ...event.attributes, ...base };
  return Object.entries(merged)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
}

function fallbackFacets(telemetry: ConsoleTelemetryResponse | null, recentEvents: ConsoleTelemetryResponse["records"]) {
  return [
    { id: "projects", label: "Projects", counts: topEntries(countBy(recentEvents, "project"), 8).map(([name, count]) => ({ name, count })) },
    { id: "events", label: "Runtime event mix", counts: topEntries(telemetry?.totals.eventTypeCounts || {}, 8).map(([name, count]) => ({ name, count })) },
    { id: "tools", label: "Invocation mix", counts: topEntries(countBy(recentEvents, "toolName"), 8).map(([name, count]) => ({ name, count })) },
    { id: "runtimes", label: "Harness mix", counts: topEntries(countBy(recentEvents, "runtime"), 8).map(([name, count]) => ({ name, count })) },
    { id: "agents", label: "Agents", counts: topEntries(countBy(recentEvents, "agentName"), 8).map(([name, count]) => ({ name, count })) },
    { id: "models", label: "Models", counts: topEntries(countBy(recentEvents, "model"), 8).map(([name, count]) => ({ name, count })) }
  ];
}
