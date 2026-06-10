import type { TelemetryQueryFilter, TelemetryQueryInput, TelemetryQueryPreset, TelemetrySortDirection } from "../serverApiTypes";

export const DEFAULT_TELEMETRY_QUERY: TelemetryQueryInput = { preset: "live", limit: 24, sort: "desc" };

export type TelemetryDrilldownDimension = "skills" | "tools" | "flows" | "projects";

export interface TelemetryRouteState {
  path: string;
  query: TelemetryQueryInput;
  drilldown?: {
    dimension: TelemetryDrilldownDimension;
    value: string;
  };
}

const DRILLDOWN_DIMENSIONS = new Set<TelemetryDrilldownDimension>(["skills", "tools", "flows", "projects"]);
const PRESETS = new Set<TelemetryQueryPreset>(["live", "15m", "24h", "7d", "custom"]);
const SORTS = new Set<TelemetrySortDirection>(["asc", "desc"]);

export function parseTelemetryRoute(pathname: string, search: string): TelemetryRouteState {
  const drilldown = parseDrilldown(pathname);
  return {
    path: drilldown ? `/telemetry/${drilldown.dimension}/${encodeURIComponent(drilldown.value)}` : "/telemetry",
    query: withDrilldownFilter(parseTelemetryQuery(new URLSearchParams(search)), drilldown),
    drilldown
  };
}

export function serializeTelemetryRoute(query: TelemetryQueryInput, drilldown?: TelemetryRouteState["drilldown"]): string {
  const path = drilldown ? `/telemetry/${drilldown.dimension}/${encodeURIComponent(drilldown.value)}` : "/telemetry";
  const params = serializeTelemetryQuery(stripDrilldownFilter(normalizeTelemetryQuery(query), drilldown));
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function parseTelemetryQuery(params: URLSearchParams): TelemetryQueryInput {
  const query: TelemetryQueryInput = { ...DEFAULT_TELEMETRY_QUERY };
  const preset = params.get("preset");
  const sort = params.get("sort");
  const limit = parseInteger(params.get("limit"), 1, 100);
  const offset = parseInteger(params.get("offset"), 0, 100000);
  if (preset && PRESETS.has(preset as TelemetryQueryPreset)) query.preset = preset as TelemetryQueryPreset;
  if (sort && SORTS.has(sort as TelemetrySortDirection)) query.sort = sort as TelemetrySortDirection;
  if (limit !== undefined) query.limit = limit;
  if (offset !== undefined) query.offset = offset;
  const q = params.get("q")?.trim();
  if (q) query.q = q.slice(0, 200);
  const from = parseIso(params.get("from"));
  const to = parseIso(params.get("to"));
  if (from) query.from = from;
  if (to) query.to = to;
  const filters = parseFilters(params.getAll("filter"));
  if (filters.length) query.filters = filters;
  return normalizeTelemetryQuery(query);
}

export function serializeTelemetryQuery(query: TelemetryQueryInput): URLSearchParams {
  const normalized = normalizeTelemetryQuery(query);
  const params = new URLSearchParams();
  if (normalized.preset && normalized.preset !== DEFAULT_TELEMETRY_QUERY.preset) params.set("preset", normalized.preset);
  if (normalized.from) params.set("from", normalized.from);
  if (normalized.to) params.set("to", normalized.to);
  if (normalized.q) params.set("q", normalized.q);
  for (const filter of normalized.filters || []) params.append("filter", `${filter.facetId}:${filter.value}`);
  if (normalized.limit !== DEFAULT_TELEMETRY_QUERY.limit) params.set("limit", String(normalized.limit));
  if (normalized.offset && normalized.offset > 0) params.set("offset", String(normalized.offset));
  if (normalized.sort && normalized.sort !== DEFAULT_TELEMETRY_QUERY.sort) params.set("sort", normalized.sort);
  return params;
}

export function normalizeTelemetryQuery(query: TelemetryQueryInput): TelemetryQueryInput {
  const hasExplicitRange = Boolean(query.from || query.to);
  const preset = hasExplicitRange ? "custom" : query.preset && PRESETS.has(query.preset) ? query.preset : DEFAULT_TELEMETRY_QUERY.preset;
  const normalized: TelemetryQueryInput = {
    preset,
    limit: boundedNumber(query.limit, 1, 100) ?? DEFAULT_TELEMETRY_QUERY.limit,
    sort: query.sort && SORTS.has(query.sort) ? query.sort : DEFAULT_TELEMETRY_QUERY.sort
  };
  if (preset === "custom") {
    normalized.from = parseIso(query.from);
    normalized.to = parseIso(query.to);
  }
  const q = query.q?.trim();
  if (q) normalized.q = q.slice(0, 200);
  const offset = boundedNumber(query.offset, 0, 100000);
  if (offset) normalized.offset = offset;
  const filters = dedupeFilters(query.filters || []);
  if (filters.length) normalized.filters = filters;
  return normalized;
}

export function withDrilldownFilter(query: TelemetryQueryInput, drilldown?: TelemetryRouteState["drilldown"]): TelemetryQueryInput {
  if (!drilldown) return normalizeTelemetryQuery(query);
  const normalized = normalizeTelemetryQuery(query);
  const filters = stripDrilldownFilter(normalized, drilldown).filters || [];
  return normalizeTelemetryQuery({
    ...normalized,
    filters: [{ facetId: drilldown.dimension, value: drilldown.value }, ...filters]
  });
}

function stripDrilldownFilter(query: TelemetryQueryInput, drilldown?: TelemetryRouteState["drilldown"]): TelemetryQueryInput {
  if (!drilldown) return query;
  const filters = (query.filters || []).filter((filter) => filter.facetId !== drilldown.dimension || filter.value !== drilldown.value);
  return { ...query, filters: filters.length ? filters : undefined };
}

function parseDrilldown(pathname: string): TelemetryRouteState["drilldown"] | undefined {
  const match = pathname.match(/^\/telemetry\/([^/]+)\/(.+)$/);
  if (!match) return undefined;
  const dimension = match[1] as TelemetryDrilldownDimension;
  if (!DRILLDOWN_DIMENSIONS.has(dimension)) return undefined;
  try {
    const value = decodeURIComponent(match[2]);
    return value ? { dimension, value } : undefined;
  } catch {
    return undefined;
  }
}

function parseFilters(values: string[]): TelemetryQueryFilter[] {
  return dedupeFilters(values.flatMap((value) => {
    const separator = value.indexOf(":");
    if (separator <= 0) return [];
    const facetId = value.slice(0, separator).trim();
    const filterValue = value.slice(separator + 1).trim();
    if (!facetId || !filterValue || facetId.length > 120 || filterValue.length > 120) return [];
    return [{ facetId, value: filterValue }];
  }));
}

export function isTelemetryQueryInput(value: unknown): value is TelemetryQueryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const query = value as TelemetryQueryInput;
  if (query.preset !== undefined && !PRESETS.has(query.preset)) return false;
  if (query.sort !== undefined && !SORTS.has(query.sort)) return false;
  if (query.q !== undefined && typeof query.q !== "string") return false;
  if (query.from !== undefined && typeof query.from !== "string") return false;
  if (query.to !== undefined && typeof query.to !== "string") return false;
  if (query.limit !== undefined && boundedNumber(query.limit, 1, 100) === undefined) return false;
  if (query.offset !== undefined && boundedNumber(query.offset, 0, 100000) === undefined) return false;
  if (query.filters !== undefined) {
    if (!Array.isArray(query.filters)) return false;
    for (const filter of query.filters) {
      if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
      const candidate = filter as TelemetryQueryFilter;
      if (typeof candidate.facetId !== "string" || typeof candidate.value !== "string") return false;
      if (!candidate.facetId || !candidate.value || candidate.facetId.length > 120 || candidate.value.length > 120) return false;
    }
  }
  return true;
}

function dedupeFilters(filters: TelemetryQueryFilter[]): TelemetryQueryFilter[] {
  const seen = new Set<string>();
  return filters.filter((filter) => {
    if (!filter.facetId || !filter.value) return false;
    const key = `${filter.facetId}:${filter.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 25);
}

function parseIso(value?: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function parseInteger(value: string | null, min: number, max: number): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return boundedNumber(Number(value), min, max);
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return undefined;
  return value;
}
