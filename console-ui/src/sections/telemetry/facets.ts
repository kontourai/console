import type { ConsoleTelemetryResponse } from "../../serverApiTypes";

export function topEntries(values: Record<string, number>, limit: number): Array<[string, number]> {
  return Object.entries(values)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

export function countBy<T>(values: T[], field: keyof T): Record<string, number> {
  return values.reduce((counts: Record<string, number>, value) => {
    const key = typeof value[field] === "string" && value[field] ? String(value[field]) : "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function facetById(telemetry: ConsoleTelemetryResponse | null, id: string) {
  return telemetry?.analytics.facets.find((facet) => facet.id === id);
}

export function telemetryFacets(telemetry: ConsoleTelemetryResponse | null, events: ConsoleTelemetryResponse["records"]) {
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

function countByOutcome(events: ConsoleTelemetryResponse["records"]): Record<string, number> {
  return events.reduce((counts: Record<string, number>, event) => {
    const key = event.outcome || event.status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
