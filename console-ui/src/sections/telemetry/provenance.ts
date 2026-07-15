import type { ConsoleTelemetrySourceSummary } from "../../serverApiTypes";

/**
 * #181 provenance demotion: the Telemetry page leads with activity + cost, and
 * the ingestion mechanics that used to headline it — the "Observed inputs"
 * Sources hero and the raw runtime event-type counts — collapse into a single
 * low-emphasis footnote. This module derives that footnote's data so the view is
 * a thin render and the folding logic is unit-testable.
 */

export interface ProvenanceSource {
  id: string;
  kind?: string;
  status?: string;
  path?: string;
  recordCount: number;
}

export interface ProvenanceEventType {
  type: string;
  count: number;
}

export interface ProvenanceSummary {
  sourceCount: number;
  totalRecords: number;
  sources: ProvenanceSource[];
  /** Raw runtime event-type mix, demoted here from a featured facet panel. */
  eventTypes: ProvenanceEventType[];
}

const MAX_SOURCES = 12;
const MAX_EVENT_TYPES = 8;

/** Fold sources + raw event-type counts into the demoted provenance footnote. */
export function deriveProvenance(
  sources: ConsoleTelemetrySourceSummary[] | undefined,
  eventTypeCounts: Record<string, number> | undefined
): ProvenanceSummary {
  const safeSources = Array.isArray(sources) ? sources : [];
  const ranked = [...safeSources]
    .sort((a, b) => (b.recordCount || 0) - (a.recordCount || 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_SOURCES)
    .map((source) => ({
      id: source.id,
      kind: source.kind,
      status: source.status,
      path: source.path,
      recordCount: source.recordCount || 0
    }));

  const eventTypes = Object.entries(eventTypeCounts || {})
    .filter(([type, count]) => Boolean(type) && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_EVENT_TYPES)
    .map(([type, count]) => ({ type, count }));

  return {
    sourceCount: safeSources.length,
    totalRecords: safeSources.reduce((sum, source) => sum + (source.recordCount || 0), 0),
    sources: ranked,
    eventTypes
  };
}

/** True when there is no provenance to show — drives the honest empty state. */
export function isProvenanceEmpty(summary: ProvenanceSummary): boolean {
  return summary.sources.length === 0 && summary.eventTypes.length === 0;
}
