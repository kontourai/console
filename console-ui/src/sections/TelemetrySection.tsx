import { Empty } from "@kontourai/console-kit/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import { formatTime } from "../utils/format";

interface TelemetrySectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  error: string | null;
  liveStatus: string;
  lastLiveAt?: string | null;
}

interface TelemetryFilter {
  facetId: string;
  label: string;
  value: string;
}

export function TelemetrySection({ telemetry, error, liveStatus, lastLiveAt }: TelemetrySectionProps) {
  const [filters, setFilters] = useState<TelemetryFilter[]>([]);
  const allEvents = telemetry?.records || [];
  const filteredEvents = useMemo(() => allEvents.filter((event) => eventMatchesFilters(event, filters)), [allEvents, filters]);
  const recentEvents = filteredEvents.slice(0, 24);
  const facets = useMemo(() => telemetryFacets(telemetry, allEvents), [telemetry, allEvents]);

  function toggleFilter(nextFilter: TelemetryFilter) {
    setFilters((current) => {
      const existing = current.some((filter) => sameFilter(filter, nextFilter));
      return existing ? current.filter((filter) => !sameFilter(filter, nextFilter)) : [...current, nextFilter];
    });
  }

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
      <TelemetryFilterBar
        filters={filters}
        shownCount={filteredEvents.length}
        totalCount={allEvents.length}
        onRemove={toggleFilter}
        onClear={() => setFilters([])}
      />
      <TelemetryGrid
        telemetry={telemetry}
        facets={facets}
        filters={filters}
        onToggleFilter={toggleFilter}
      />
      <RecentTelemetryEvents events={recentEvents} totalEvents={filteredEvents.length} />
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

function TelemetryFilterBar({
  filters,
  shownCount,
  totalCount,
  onRemove,
  onClear
}: {
  filters: TelemetryFilter[];
  shownCount: number;
  totalCount: number;
  onRemove(filter: TelemetryFilter): void;
  onClear(): void;
}) {
  return (
    <div className="telemetry-filter-bar" aria-label="Telemetry filters">
      <div>
        <strong>{shownCount.toLocaleString()}</strong>
        <span> of {totalCount.toLocaleString()} events shown</span>
      </div>
      <div className="telemetry-filter-actions">
        {filters.map((filter) => (
          <button type="button" key={`${filter.facetId}:${filter.value}`} onClick={() => onRemove(filter)} aria-label={`Remove ${filter.label} filter ${filter.value}`}>
            {filter.label}: {filter.value}
          </button>
        ))}
        {filters.length ? <button type="button" onClick={onClear}>Clear</button> : null}
      </div>
    </div>
  );
}

function TelemetryGrid({
  telemetry,
  facets,
  filters,
  onToggleFilter
}: {
  telemetry: ConsoleTelemetryResponse | null;
  facets: ConsoleTelemetryResponse["analytics"]["facets"];
  filters: TelemetryFilter[];
  onToggleFilter(filter: TelemetryFilter): void;
}) {
  const primaryFacetIds = ["projects", "cwd", "tools", "runtimes", "models", "events"];
  const primaryFacets = primaryFacetIds
    .map((id) => facets.find((facet) => facet.id === id))
    .filter((facet): facet is NonNullable<typeof facet> => Boolean(facet));
  const secondaryFacets = facets.filter((facet) => !primaryFacetIds.includes(facet.id));
  return (
    <div className="telemetry-grid">
      <TelemetrySources sources={telemetry?.sources || []} />
      {primaryFacets.map((facet) => (
        <TelemetryPanel label={facet.id} title={facet.label} key={facet.id}>
          <BarList facet={facet} filters={filters} onToggleFilter={onToggleFilter} />
        </TelemetryPanel>
      ))}
      {secondaryFacets.length ? (
        <TelemetryPanel label="Dimensions" title="Additional breakdowns">
          <div className="dimension-stack">
            {secondaryFacets.slice(0, 6).map((facet) => (
              <div className="dimension-row" key={facet.id}>
                <strong>{facet.label}</strong>
                <span>
                  {facet.counts.slice(0, 3).map((item) => (
                    <button
                      type="button"
                      key={item.name}
                      className={isFilterActive(filters, facet.id, item.name) ? "active" : ""}
                      aria-pressed={isFilterActive(filters, facet.id, item.name)}
                      onClick={() => onToggleFilter({ facetId: facet.id, label: facet.label, value: item.name })}
                    >
                      {item.name} {item.count}
                    </button>
                  ))}
                  {!facet.counts.length ? "none" : null}
                </span>
              </div>
            ))}
          </div>
        </TelemetryPanel>
      ) : null}
      {(telemetry?.analytics.flows || []).map((flow) => <TelemetryFlowPanel flow={flow} filters={filters} key={flow.id} />)}
    </div>
  );
}

function TelemetryFlowPanel({ flow, filters }: { flow: ConsoleTelemetryResponse["analytics"]["flows"][number]; filters: TelemetryFilter[] }) {
  const items = flow.items.filter((item) => flowItemMatchesFilters(item, filters));
  return (
    <TelemetryPanel label="Flow" title={flow.label}>
      <div className="stack">
        <div className="data-row telemetry-source">
          <div className="row-title">
            <strong>{flow.id}</strong>
            <span>{filters.length ? `${items.length}/${flow.items.length}` : flow.total}</span>
          </div>
          <p>
            {filters.length
              ? `${items.length.toLocaleString()} returned descriptor item${items.length === 1 ? "" : "s"} ${items.length === 1 ? "matches" : "match"} the active filters`
              : `${flow.total.toLocaleString()} matched workflow item${flow.total === 1 ? "" : "s"}`}
          </p>
        </div>
        {items.slice(0, 5).map((item) => (
          <div className="data-row" key={item.slug}>
            <div className="row-title">
              <strong>{item.slug}</strong>
              <span>{item.status || "status"}</span>
            </div>
            <p>{item.title || item.updatedAt || "No descriptor title field."}</p>
          </div>
        ))}
        {!items.length ? <Empty label="No flow items match the active filters." /> : null}
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

function RecentTelemetryEvents({ events, totalEvents }: { events: ConsoleTelemetryResponse["records"]; totalEvents: number }) {
  return (
    <div className="telemetry-section telemetry-recent">
      <div className="section-head">
        <div>
          <p className="section-label">Recent Runtime Events</p>
          <h2>Latest accepted telemetry</h2>
        </div>
        <p className="receipt">{events.length.toLocaleString()} visible / {totalEvents.toLocaleString()} matched</p>
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
                <pre>{JSON.stringify(redactTelemetryValue(event), null, 2)}</pre>
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

function BarList({
  facet,
  filters,
  onToggleFilter
}: {
  facet: ConsoleTelemetryResponse["analytics"]["facets"][number];
  filters: TelemetryFilter[];
  onToggleFilter(filter: TelemetryFilter): void;
}) {
  const entries = facet.counts.map((item) => [item.name, item.count] as [string, number]);
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return (
    <div className="bar-list">
      {entries.map(([label, count]) => (
        <button
          type="button"
          className={isFilterActive(filters, facet.id, label) ? "bar-row active" : "bar-row"}
          key={label}
          aria-pressed={isFilterActive(filters, facet.id, label)}
          onClick={() => onToggleFilter({ facetId: facet.id, label: facet.label, value: label })}
        >
          <div>
            <span>{label}</span>
            <strong>{count.toLocaleString()}</strong>
          </div>
          <i style={{ inlineSize: `${Math.max(4, (count / max) * 100)}%` }} />
        </button>
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

function telemetryFacets(telemetry: ConsoleTelemetryResponse | null, events: ConsoleTelemetryResponse["records"]) {
  const configuredFacets = telemetry?.analytics.facets || [];
  const derivedFacets = [
    { id: "cwd", label: "Project directories", counts: topEntries(countBy(events, "cwd"), 8).map(([name, count]) => ({ name, count })) },
    { id: "sessions", label: "Sessions", counts: topEntries(countBy(events, "sessionId"), 8).map(([name, count]) => ({ name, count })) },
    { id: "outcomes", label: "Outcomes", counts: topEntries(countByOutcome(events), 8).map(([name, count]) => ({ name, count })) },
  ];
  const facets = configuredFacets.length ? configuredFacets : fallbackFacets(telemetry, events);
  const configuredIds = new Set(facets.map((facet) => facet.id));
  return [
    ...facets,
    ...derivedFacets.filter((facet) => !configuredIds.has(facet.id) && facet.counts.length),
  ];
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
    .map(([key, value]) => [key, isSensitiveTelemetryKey(key) ? "[redacted]" : value] as [string, string])
    .sort(([left], [right]) => left.localeCompare(right));
}

function sameFilter(left: TelemetryFilter, right: TelemetryFilter): boolean {
  return left.facetId === right.facetId && left.value === right.value;
}

function isFilterActive(filters: TelemetryFilter[], facetId: string, value: string): boolean {
  return filters.some((filter) => filter.facetId === facetId && filter.value === value);
}

function eventMatchesFilters(event: ConsoleTelemetryResponse["records"][number], filters: TelemetryFilter[]): boolean {
  return Object.entries(groupFiltersByFacet(filters)).every(([facetId, facetFilters]) => {
    const values = eventFacetValues(event, facetId);
    return facetFilters.some((filter) => values.includes(filter.value));
  });
}

function eventFacetValues(event: ConsoleTelemetryResponse["records"][number], facetId: string): string[] {
  const attributes = event.attributes || {};
  const valuesByFacet: Record<string, Array<string | undefined>> = {
    projects: [event.project],
    cwd: [event.cwd],
    tools: [event.toolName],
    runtimes: [event.runtime],
    agents: [event.agentName],
    models: [event.model],
    events: [event.eventType],
    outcomes: [event.outcome || event.status || "unknown"],
    hooks: [event.hookEventName],
    delegations: [event.delegationTarget],
    sessions: [event.sessionId, event.runtimeSessionId],
    sources: [event.sourceId],
    turns: [event.turnId],
  };
  return [
    ...(valuesByFacet[facetId] || []),
    attributes[facetId],
    attributes[singularizeFacetId(facetId)],
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function flowItemMatchesFilters(item: ConsoleTelemetryResponse["analytics"]["flows"][number]["items"][number], filters: TelemetryFilter[]): boolean {
  if (!filters.length) return true;
  return Object.entries(groupFiltersByFacet(filters)).every(([facetId, facetFilters]) => {
    const attributes = item.attributes || {};
    const values = [
      item.slug,
      item.title,
      item.status,
      attributes[facetId],
      attributes[singularizeFacetId(facetId)],
    ];
    return facetFilters.some((filter) => values.some((value) => value === filter.value));
  });
}

function groupFiltersByFacet(filters: TelemetryFilter[]): Record<string, TelemetryFilter[]> {
  return filters.reduce((groups: Record<string, TelemetryFilter[]>, filter) => {
    groups[filter.facetId] = [...(groups[filter.facetId] || []), filter];
    return groups;
  }, {});
}

function countByOutcome(events: ConsoleTelemetryResponse["records"]): Record<string, number> {
  return events.reduce((counts: Record<string, number>, event) => {
    const key = event.outcome || event.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function singularizeFacetId(facetId: string): string {
  if (facetId === "events") return "eventType";
  if (facetId === "tools") return "toolName";
  if (facetId === "runtimes") return "runtime";
  if (facetId === "agents") return "agentName";
  if (facetId === "projects") return "project";
  if (facetId.endsWith("s")) return facetId.slice(0, -1);
  return facetId;
}

function redactTelemetryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTelemetryValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (isSensitiveTelemetryKey(key)) return [key, "[redacted]"];
    return [key, redactTelemetryValue(nested)];
  }));
}

function isSensitiveTelemetryKey(key: string): boolean {
  return /authorization|api[-_]?key|password|secret|token/i.test(key);
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
