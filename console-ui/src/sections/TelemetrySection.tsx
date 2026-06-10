import { Empty } from "@kontourai/console-kit/react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ConsoleTelemetryResponse, TelemetryQueryFilter, TelemetryQueryInput, TelemetryQueryPreset } from "../serverApiTypes";
import { formatTime } from "../utils/format";
import { isTelemetryQueryInput, normalizeTelemetryQuery, parseTelemetryRoute, serializeTelemetryRoute, type TelemetryRouteState } from "../utils/telemetryQuery";

interface TelemetrySectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  error: string | null;
  query: TelemetryQueryInput;
  drilldown?: TelemetryRouteState["drilldown"];
  onQueryChange(query: TelemetryQueryInput): void;
  onOpenRoute(route: TelemetryRouteState): void;
  liveStatus: string;
  lastLiveAt?: string | null;
}

interface TelemetryFilter extends TelemetryQueryFilter {
  facetId: string;
  label: string;
  value: string;
}

interface TelemetryQueryControlState {
  query: TelemetryQueryInput;
  searchDraft: string;
  fromDraft: string;
  toDraft: string;
  setSearchDraft(value: string): void;
  setFromDraft(value: string): void;
  setToDraft(value: string): void;
  onQueryChange(query: TelemetryQueryInput): void;
}

interface SavedTelemetryPreset {
  version: 1;
  name: string;
  query: TelemetryQueryInput;
  createdAt: string;
  updatedAt: string;
}

const SAVED_PRESETS_KEY = "kontour.console.telemetry.presets.v1";
const MAX_SAVED_PRESETS = 12;
const MAX_PRESET_NAME_LENGTH = 48;

export function TelemetrySection({ telemetry, error, query, drilldown, onQueryChange, onOpenRoute, liveStatus, lastLiveAt }: TelemetrySectionProps) {
  const allEvents = telemetry?.records || [];
  const filters = useMemo(() => labelFilters(query.filters || [], telemetry), [query.filters, telemetry]);
  const facets = useMemo(() => telemetryFacets(telemetry, allEvents), [telemetry, allEvents]);
  const pagination = telemetry?.pagination;
  const matchedCount = pagination?.matchedCount ?? pagination?.totalMatchedCount ?? pagination?.totalCount ?? allEvents.length;
  const returnedCount = pagination?.returnedCount ?? allEvents.length;
  const actions = useTelemetryQueryActions(query, onQueryChange, pagination);

  const canPageForward = Boolean(pagination?.hasMore || typeof pagination?.nextOffset === "number");
  const canPageBack = (pagination?.offset ?? query.offset ?? 0) > 0;

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

      <TelemetryQueryControls
        query={query}
        controls={actions.controls}
      />
      <TelemetrySavedPresets query={query} onQueryChange={onQueryChange} />
      {drilldown ? <TelemetryDrilldownHeader drilldown={drilldown} onOpenRoute={onOpenRoute} query={query} /> : null}
      <TelemetryTotals telemetry={telemetry} />
      <TelemetryFilterBar
        filters={filters}
        shownCount={returnedCount}
        totalCount={matchedCount}
        query={query}
        onRemove={actions.removeFilter}
        onClear={actions.clearQuery}
        drilldown={drilldown}
        onOpenRoute={onOpenRoute}
      />
      <TelemetryGrid
        telemetry={telemetry}
        facets={facets}
        filters={filters}
        onToggleFilter={actions.toggleFilter}
        onOpenRoute={onOpenRoute}
        query={query}
      />
      <RecentTelemetryEvents
        events={allEvents}
        totalEvents={matchedCount}
        canPageBack={canPageBack}
        canPageForward={canPageForward}
        onPreviousPage={actions.previousPage}
        onNextPage={actions.nextPage}
      />
      <TelemetryWarnings telemetry={telemetry} />
    </section>
  );
}

function useTelemetryQueryActions(
  query: TelemetryQueryInput,
  onQueryChange: (query: TelemetryQueryInput) => void,
  pagination: ConsoleTelemetryResponse["pagination"] | undefined
) {
  const [searchDraft, setSearchDraft] = useState(query.q || "");
  const [fromDraft, setFromDraft] = useState(toDatetimeLocalValue(query.from));
  const [toDraft, setToDraft] = useState(toDatetimeLocalValue(query.to));
  useEffect(() => setSearchDraft(query.q || ""), [query.q]);
  useEffect(() => setFromDraft(toDatetimeLocalValue(query.from)), [query.from]);
  useEffect(() => setToDraft(toDatetimeLocalValue(query.to)), [query.to]);
  return {
    controls: { searchDraft, fromDraft, toDraft, setSearchDraft, setFromDraft, setToDraft, onQueryChange, query },
    toggleFilter: (filter: TelemetryFilter) => onQueryChange(toggleQueryFilter(query, filter)),
    removeFilter: (filter: TelemetryFilter) => onQueryChange(removeQueryFilter(query, filter)),
    clearQuery: () => {
      setSearchDraft("");
      setFromDraft("");
      setToDraft("");
      onQueryChange({ preset: "live", limit: query.limit || 24, sort: query.sort || "desc" });
    },
    nextPage: () => {
      if (typeof pagination?.nextOffset === "number") onQueryChange({ ...query, offset: pagination.nextOffset });
    },
    previousPage: () => {
      const limit = pagination?.limit || pagination?.pageSize || query.limit || 24;
      const currentOffset = pagination?.offset ?? query.offset ?? 0;
      onQueryChange({ ...query, offset: Math.max(0, currentOffset - limit) });
    }
  };
}

function TelemetrySavedPresets({ query, onQueryChange }: { query: TelemetryQueryInput; onQueryChange(query: TelemetryQueryInput): void }) {
  const [presets, setPresets] = useState<SavedTelemetryPreset[]>(loadSavedPresets);
  const [name, setName] = useState("");
  function persist(nextPresets: SavedTelemetryPreset[]) {
    setPresets(nextPresets);
    try {
      window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(nextPresets));
    } catch {
      // Storage can be unavailable in private/browser-restricted contexts; keep the in-memory preset list usable.
    }
  }
  function saveCurrent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
    if (!trimmed) return;
    const now = new Date().toISOString();
    const existing = presets.find((preset) => preset.name.toLowerCase() === trimmed.toLowerCase());
    const nextPreset: SavedTelemetryPreset = {
      version: 1,
      name: trimmed,
      query: normalizeTelemetryQuery(query),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    persist([nextPreset, ...presets.filter((preset) => preset.name.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_SAVED_PRESETS));
    setName("");
  }
  return (
    <div className="telemetry-saved-presets" aria-label="Saved telemetry presets">
      <form onSubmit={saveCurrent}>
        <label htmlFor="telemetry-preset-name">Preset</label>
        <input id="telemetry-preset-name" value={name} maxLength={MAX_PRESET_NAME_LENGTH} onChange={(event) => setName(event.target.value)} />
        <button type="submit">Save</button>
      </form>
      <div className="telemetry-preset-list">
        {presets.map((preset) => (
          <span key={preset.name}>
            <button type="button" onClick={() => onQueryChange(normalizeTelemetryQuery(preset.query))}>{preset.name}</button>
            <button type="button" aria-label={`Delete preset ${preset.name}`} onClick={() => persist(presets.filter((item) => item.name !== preset.name))}>Delete</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function loadSavedPresets(): SavedTelemetryPreset[] {
  try {
    const raw = window.localStorage.getItem(SAVED_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedPreset).slice(0, MAX_SAVED_PRESETS);
  } catch {
    return [];
  }
}

function isSavedPreset(value: unknown): value is SavedTelemetryPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<SavedTelemetryPreset>;
  return preset.version === 1
    && typeof preset.name === "string"
    && preset.name.length > 0
    && preset.name.length <= MAX_PRESET_NAME_LENGTH
    && typeof preset.createdAt === "string"
    && typeof preset.updatedAt === "string"
    && isTelemetryQueryInput(preset.query);
}

function TelemetryDrilldownHeader({
  drilldown,
  query,
  onOpenRoute
}: {
  drilldown: NonNullable<TelemetryRouteState["drilldown"]>;
  query: TelemetryQueryInput;
  onOpenRoute(route: TelemetryRouteState): void;
}) {
  return (
    <div className="telemetry-drilldown" aria-label="Telemetry drilldown">
      <div>
        <span>{startCase(drilldown.dimension)}</span>
        <strong>{drilldown.value}</strong>
      </div>
      <button type="button" onClick={() => onOpenRoute(parseTelemetryRoute("/telemetry", queryString(stripFilter(query, drilldown.dimension, drilldown.value))))}>All telemetry</button>
    </div>
  );
}

function TelemetryQueryControls({
  query,
  controls
}: {
  query: TelemetryQueryInput;
  controls: TelemetryQueryControlState;
}) {
  return (
    <div className="telemetry-query-controls" aria-label="Telemetry query controls">
      <TelemetryPresetButtons query={query} controls={controls} />
      <TelemetryCustomRange controls={controls} />
      <TelemetrySearch controls={controls} />
    </div>
  );
}

function TelemetryPresetButtons({ query, controls }: { query: TelemetryQueryInput; controls: TelemetryQueryControlState }) {
  const presets: Array<{ id: TelemetryQueryPreset; label: string }> = [
    { id: "live", label: "Realtime" },
    { id: "15m", label: "Last 15m" },
    { id: "24h", label: "24h" },
    { id: "7d", label: "7d" },
  ];
  return (
    <div className="segmented-control" aria-label="Time window">
      {presets.map((preset) => (
        <button type="button" key={preset.id} className={query.preset === preset.id ? "active" : ""} aria-pressed={query.preset === preset.id} onClick={() => applyPreset(controls, preset.id)}>
          {preset.label}
        </button>
      ))}
    </div>
  );
}

function TelemetryCustomRange({ controls }: { controls: TelemetryQueryControlState }) {
  return (
    <form className="telemetry-custom-range" onSubmit={(event) => submitCustomRange(event, controls)}>
      <label>From<input type="datetime-local" value={controls.fromDraft} onChange={(event) => controls.setFromDraft(event.target.value)} /></label>
      <label>To<input type="datetime-local" value={controls.toDraft} onChange={(event) => controls.setToDraft(event.target.value)} /></label>
      <button type="submit" aria-pressed={controls.query.preset === "custom"}>Custom</button>
    </form>
  );
}

function TelemetrySearch({ controls }: { controls: TelemetryQueryControlState }) {
  return (
    <form className="telemetry-search" onSubmit={(event) => submitSearch(event, controls)}>
      <label htmlFor="telemetry-search">Search</label>
      <input id="telemetry-search" value={controls.searchDraft} onChange={(event) => controls.setSearchDraft(event.target.value)} />
      <button type="submit">Apply</button>
    </form>
  );
}

function applyPreset(controls: TelemetryQueryControlState, preset: TelemetryQueryPreset): void {
  const next: TelemetryQueryInput = { ...controls.query, preset, offset: 0 };
  if (preset !== "custom") {
    next.from = undefined;
    next.to = undefined;
    controls.setFromDraft("");
    controls.setToDraft("");
  }
  controls.onQueryChange(next);
}

function submitSearch(event: FormEvent<HTMLFormElement>, controls: TelemetryQueryControlState): void {
  event.preventDefault();
  controls.onQueryChange({ ...controls.query, q: controls.searchDraft.trim() || undefined, offset: 0 });
}

function submitCustomRange(event: FormEvent<HTMLFormElement>, controls: TelemetryQueryControlState): void {
  event.preventDefault();
  controls.onQueryChange({
    ...controls.query,
    preset: "custom",
    from: controls.fromDraft ? new Date(controls.fromDraft).toISOString() : undefined,
    to: controls.toDraft ? new Date(controls.toDraft).toISOString() : undefined,
    offset: 0
  });
}

function toggleQueryFilter(query: TelemetryQueryInput, nextFilter: TelemetryFilter): TelemetryQueryInput {
  const currentFilters = query.filters || [];
  const queryFilter = { facetId: nextFilter.facetId, value: nextFilter.value };
  const existing = currentFilters.some((filter) => sameFilter(filter, queryFilter));
  const filters = existing ? currentFilters.filter((filter) => !sameFilter(filter, queryFilter)) : [...currentFilters, queryFilter];
  return { ...query, offset: 0, filters: filters.length ? filters : undefined };
}

function removeQueryFilter(query: TelemetryQueryInput, nextFilter: TelemetryFilter): TelemetryQueryInput {
  const filters = (query.filters || []).filter((filter) => !sameFilter(filter, nextFilter));
  return { ...query, filters: filters.length ? filters : undefined, offset: 0 };
}

function labelFilters(filters: TelemetryQueryFilter[], telemetry: ConsoleTelemetryResponse | null): TelemetryFilter[] {
  return filters.map((filter) => ({
    ...filter,
    label: telemetry?.analytics.facets.find((facet) => facet.id === filter.facetId)?.label || derivedFacetLabel(filter.facetId) || startCase(filter.facetId)
  }));
}

function derivedFacetLabel(facetId: string): string | null {
  if (facetId === "cwd") return "Project directories";
  if (facetId === "sessions") return "Sessions";
  if (facetId === "outcomes") return "Outcomes";
  return null;
}

function startCase(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toDatetimeLocalValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
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
  query,
  onRemove,
  onClear,
  drilldown,
  onOpenRoute
}: {
  filters: TelemetryFilter[];
  shownCount: number;
  totalCount: number;
  query: TelemetryQueryInput;
  onRemove(filter: TelemetryFilter): void;
  onClear(): void;
  drilldown?: TelemetryRouteState["drilldown"];
  onOpenRoute(route: TelemetryRouteState): void;
}) {
  const hasQuery = Boolean((query.filters || []).length || query.q || query.from || query.to || query.preset !== "live" || (query.offset || 0) > 0);
  return (
    <div className="telemetry-filter-bar" aria-label="Telemetry filters">
      <div>
        <strong>{shownCount.toLocaleString()}</strong>
        <span> of {totalCount.toLocaleString()} server-matched events shown</span>
      </div>
      <div className="telemetry-filter-actions">
        {query.q ? <button type="button" onClick={() => onClear()} aria-label={`Clear search ${query.q}`}>Search: {query.q}</button> : null}
        {filters.map((filter) => (
          <button
            type="button"
            key={`${filter.facetId}:${filter.value}`}
            onClick={() => {
              if (drilldown && filter.facetId === drilldown.dimension && filter.value === drilldown.value) {
                onOpenRoute(parseTelemetryRoute("/telemetry", queryString(stripFilter(query, drilldown.dimension, drilldown.value))));
              } else {
                onRemove(filter);
              }
            }}
            aria-label={`Remove ${filter.label} filter ${filter.value}`}
          >
            {filter.label}: {filter.value}
          </button>
        ))}
        {hasQuery ? <button type="button" onClick={onClear}>Clear</button> : null}
      </div>
    </div>
  );
}

function TelemetryGrid({
  telemetry,
  facets,
  filters,
  onToggleFilter,
  onOpenRoute,
  query
}: {
  telemetry: ConsoleTelemetryResponse | null;
  facets: ConsoleTelemetryResponse["analytics"]["facets"];
  filters: TelemetryFilter[];
  onToggleFilter(filter: TelemetryFilter): void;
  onOpenRoute(route: TelemetryRouteState): void;
  query: TelemetryQueryInput;
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
          <BarList facet={facet} filters={filters} onToggleFilter={onToggleFilter} onOpenRoute={onOpenRoute} query={query} />
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
                    <span className="dimension-actions" key={item.name}>
                      <button
                        type="button"
                        className={isFilterActive(filters, facet.id, item.name) ? "active" : ""}
                        aria-pressed={isFilterActive(filters, facet.id, item.name)}
                        onClick={() => onToggleFilter({ facetId: facet.id, label: facet.label, value: item.name })}
                      >
                        {item.name} {item.count}
                      </button>
                      {drilldownDimension(facet.id) ? (
                        <button type="button" aria-label={`Open ${facet.label} drilldown ${item.name}`} onClick={() => openDrilldown(onOpenRoute, query, facet.id, item.name)}>Open</button>
                      ) : null}
                    </span>
                  ))}
                  {!facet.counts.length ? "none" : null}
                </span>
              </div>
            ))}
          </div>
        </TelemetryPanel>
      ) : null}
      {(telemetry?.analytics.flows || []).map((flow) => <TelemetryFlowPanel flow={flow} key={flow.id} query={query} onOpenRoute={onOpenRoute} />)}
    </div>
  );
}

function TelemetryFlowPanel({
  flow,
  query,
  onOpenRoute
}: {
  flow: ConsoleTelemetryResponse["analytics"]["flows"][number];
  query: TelemetryQueryInput;
  onOpenRoute(route: TelemetryRouteState): void;
}) {
  const items = flow.items;
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
        {items.slice(0, 5).map((item) => (
          <div className="data-row" key={item.slug}>
            <div className="row-title">
              <strong>{item.slug}</strong>
              <span>{item.status || "status"}</span>
            </div>
            <p>{item.title || item.updatedAt || "No descriptor title field."}</p>
            {item.details?.length ? <TelemetryFlowDetails details={item.details} /> : null}
          </div>
        ))}
        <button type="button" className="telemetry-open-drilldown" onClick={() => openDrilldown(onOpenRoute, query, "flows", flow.id)}>Open flow</button>
        {!items.length ? <Empty label="No flow items returned." /> : null}
      </div>
    </TelemetryPanel>
  );
}

function TelemetryFlowDetails({ details }: { details: NonNullable<ConsoleTelemetryResponse["analytics"]["flows"][number]["items"][number]["details"]> }) {
  return (
    <dl className="telemetry-flow-details">
      {details.map((detail) => (
        <div key={`${detail.label}:${detail.value}`}>
          <dt>{detail.label}</dt>
          <dd>{detail.value}</dd>
        </div>
      ))}
    </dl>
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

function RecentTelemetryEvents({
  events,
  totalEvents,
  canPageBack,
  canPageForward,
  onPreviousPage,
  onNextPage
}: {
  events: ConsoleTelemetryResponse["records"];
  totalEvents: number;
  canPageBack: boolean;
  canPageForward: boolean;
  onPreviousPage(): void;
  onNextPage(): void;
}) {
  return (
    <div className="telemetry-section telemetry-recent">
      <div className="section-head">
        <div>
          <p className="section-label">Recent Runtime Events</p>
          <h2>Latest accepted telemetry</h2>
        </div>
        <p className="receipt">{events.length.toLocaleString()} visible / {totalEvents.toLocaleString()} matched</p>
      </div>
      <div className="telemetry-page-actions" aria-label="Telemetry pagination">
        <button type="button" onClick={onPreviousPage} disabled={!canPageBack}>Previous page</button>
        <button type="button" onClick={onNextPage} disabled={!canPageForward}>Next page</button>
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
  onToggleFilter,
  onOpenRoute,
  query
}: {
  facet: ConsoleTelemetryResponse["analytics"]["facets"][number];
  filters: TelemetryFilter[];
  onToggleFilter(filter: TelemetryFilter): void;
  onOpenRoute(route: TelemetryRouteState): void;
  query: TelemetryQueryInput;
}) {
  const entries = facet.counts.map((item) => [item.name, item.count] as [string, number]);
  const max = Math.max(...entries.map(([, count]) => count), 1);
  return (
    <div className="bar-list">
      {entries.map(([label, count]) => (
        <div className="bar-row-wrap" key={label}>
          <button
            type="button"
            className={isFilterActive(filters, facet.id, label) ? "bar-row active" : "bar-row"}
            aria-pressed={isFilterActive(filters, facet.id, label)}
            onClick={() => onToggleFilter({ facetId: facet.id, label: facet.label, value: label })}
          >
            <div>
              <span>{label}</span>
              <strong>{count.toLocaleString()}</strong>
            </div>
            <i style={{ inlineSize: `${Math.max(4, (count / max) * 100)}%` }} />
          </button>
          {drilldownDimension(facet.id) ? (
            <button type="button" className="bar-drilldown" aria-label={`Open ${facet.label} drilldown ${label}`} onClick={() => openDrilldown(onOpenRoute, query, facet.id, label)}>Open</button>
          ) : null}
        </div>
      ))}
      {!entries.length ? <Empty label="No counts available." /> : null}
    </div>
  );
}

function openDrilldown(onOpenRoute: (route: TelemetryRouteState) => void, query: TelemetryQueryInput, facetId: string, value: string): void {
  const dimension = drilldownDimension(facetId);
  if (!dimension) return;
  onOpenRoute(parseTelemetryRoute(`/telemetry/${dimension}/${encodeURIComponent(value)}`, queryString(query)));
}

function drilldownDimension(facetId: string): NonNullable<TelemetryRouteState["drilldown"]>["dimension"] | null {
  return facetId === "skills" || facetId === "tools" || facetId === "flows" || facetId === "projects" ? facetId : null;
}

function queryString(query: TelemetryQueryInput): string {
  const serialized = serializeTelemetryRoute(query);
  const question = serialized.indexOf("?");
  return question >= 0 ? serialized.slice(question) : "";
}

function stripFilter(query: TelemetryQueryInput, facetId: string, value: string): TelemetryQueryInput {
  const filters = (query.filters || []).filter((filter) => filter.facetId !== facetId || filter.value !== value);
  return { ...query, filters: filters.length ? filters : undefined };
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

function sameFilter(left: TelemetryQueryFilter, right: TelemetryQueryFilter): boolean {
  return left.facetId === right.facetId && left.value === right.value;
}

function isFilterActive(filters: TelemetryFilter[], facetId: string, value: string): boolean {
  return filters.some((filter) => filter.facetId === facetId && filter.value === value);
}

function countByOutcome(events: ConsoleTelemetryResponse["records"]): Record<string, number> {
  return events.reduce((counts: Record<string, number>, event) => {
    const key = event.outcome || event.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
