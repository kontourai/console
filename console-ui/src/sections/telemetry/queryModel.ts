import type { ConsoleTelemetryResponse, TelemetryQueryFilter, TelemetryQueryInput } from "../../serverApiTypes";
import { parseTelemetryRoute, serializeTelemetryRoute } from "../../utils/telemetryQuery";
import { startCase } from "./text";
import type { TelemetryFilter, TelemetryRouteState } from "./types";

export function toggleQueryFilter(query: TelemetryQueryInput, nextFilter: TelemetryFilter): TelemetryQueryInput {
  const currentFilters = query.filters || [];
  const queryFilter = { facetId: nextFilter.facetId, value: nextFilter.value };
  const existing = currentFilters.some((filter) => sameFilter(filter, queryFilter));
  const filters = existing ? currentFilters.filter((filter) => !sameFilter(filter, queryFilter)) : [...currentFilters, queryFilter];
  return { ...query, offset: 0, filters: filters.length ? filters : undefined };
}

export function removeQueryFilter(query: TelemetryQueryInput, nextFilter: TelemetryFilter): TelemetryQueryInput {
  const filters = (query.filters || []).filter((filter) => !sameFilter(filter, nextFilter));
  return { ...query, filters: filters.length ? filters : undefined, offset: 0 };
}

export function labelFilters(filters: TelemetryQueryFilter[], telemetry: ConsoleTelemetryResponse | null): TelemetryFilter[] {
  return filters.map((filter) => ({
    ...filter,
    label: telemetry?.analytics.facets.find((facet) => facet.id === filter.facetId)?.label || derivedFacetLabel(filter.facetId) || startCase(filter.facetId)
  }));
}

export function toDatetimeLocalValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export function queryString(query: TelemetryQueryInput): string {
  const serialized = serializeTelemetryRoute(query);
  const question = serialized.indexOf("?");
  return question >= 0 ? serialized.slice(question) : "";
}

export function stripFilter(query: TelemetryQueryInput, facetId: string, value: string): TelemetryQueryInput {
  const filters = (query.filters || []).filter((filter) => filter.facetId !== facetId || filter.value !== value);
  return { ...query, filters: filters.length ? filters : undefined };
}

export function openDrilldown(onOpenRoute: (route: TelemetryRouteState) => void, query: TelemetryQueryInput, facetId: string, value: string): void {
  const dimension = drilldownDimension(facetId);
  if (!dimension) return;
  onOpenRoute(parseTelemetryRoute(`/telemetry/${dimension}/${encodeURIComponent(value)}`, queryString(query)));
}

export function drilldownDimension(facetId: string): NonNullable<TelemetryRouteState["drilldown"]>["dimension"] | null {
  return facetId === "skills" || facetId === "tools" || facetId === "flows" || facetId === "projects" ? facetId : null;
}

export function sameFilter(left: TelemetryQueryFilter, right: TelemetryQueryFilter): boolean {
  return left.facetId === right.facetId && left.value === right.value;
}

export function isFilterActive(filters: TelemetryFilter[], facetId: string, value: string): boolean {
  return filters.some((filter) => filter.facetId === facetId && filter.value === value);
}

function derivedFacetLabel(facetId: string): string | null {
  if (facetId === "cwd") return "Project directories";
  if (facetId === "sessions") return "Sessions";
  if (facetId === "outcomes") return "Outcomes";
  return null;
}
