import type { TelemetryQueryInput } from "../../serverApiTypes";
import { parseTelemetryRoute } from "../../utils/telemetryQuery";
import { queryString, stripFilter } from "./queryModel";
import type { TelemetryFilter, TelemetryRouteState } from "./types";

export function TelemetryFilterBar({
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
