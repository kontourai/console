import { Empty } from "@kontourai/console-kit/react";
import type { ConsoleTelemetryResponse, TelemetryQueryInput } from "../../serverApiTypes";
import { drilldownDimension, isFilterActive, openDrilldown } from "./queryModel";
import { TelemetryPanel } from "./Panel";
import type { TelemetryFilter, TelemetryRouteState } from "./types";

export function TelemetryGrid({
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
        {!items.length ? <Empty label="No items in this window." /> : null}
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
        {!sources.length ? <Empty label="No telemetry sources observed." /> : null}
      </div>
    </TelemetryPanel>
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
      {!entries.length ? <Empty label="No data in this window." /> : null}
    </div>
  );
}
