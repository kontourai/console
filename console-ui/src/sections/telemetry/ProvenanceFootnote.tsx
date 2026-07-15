import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { formatCompact } from "../../utils/format";
import { deriveProvenance, isProvenanceEmpty } from "./provenance";

/**
 * #181: provenance footnote. What used to be the Telemetry page's hero — the
 * "Observed inputs" Sources panel and the raw runtime event-type mix — now sits
 * at the foot of the page as collapsible metadata. It answers "where did this
 * data come from?", not "what am I doing?", so it reads as a footnote, not a lead.
 */
export function TelemetryProvenanceFootnote({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const summary = deriveProvenance(telemetry?.sources, telemetry?.totals.eventTypeCounts);
  if (isProvenanceEmpty(summary)) return null;

  return (
    <details className="telemetry-provenance">
      <summary>
        <span className="section-label">Provenance</span>
        <span className="telemetry-provenance-summary">
          {summary.sourceCount} source{summary.sourceCount === 1 ? "" : "s"} ·{" "}
          {formatCompact(summary.totalRecords)} record{summary.totalRecords === 1 ? "" : "s"}
        </span>
      </summary>

      <div className="telemetry-provenance-body">
        {summary.sources.length ? (
          <ul className="telemetry-provenance-sources">
            {summary.sources.map((source) => (
              <li key={source.id}>
                <span className="telemetry-provenance-source-id">{source.id}</span>
                <span className="telemetry-provenance-source-meta">
                  {[source.kind, source.status].filter(Boolean).join(" / ") || "source"}
                </span>
                <span className="telemetry-provenance-source-path" title={source.path || undefined}>
                  {source.path || "no path reported"}
                </span>
                <span className="telemetry-provenance-source-count">{formatCompact(source.recordCount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {summary.eventTypes.length ? (
          <div className="telemetry-provenance-events" aria-label="Runtime event-type mix">
            <span className="telemetry-provenance-events-label">event types</span>
            <ul>
              {summary.eventTypes.map((entry) => (
                <li key={entry.type}>
                  <code>{entry.type}</code>
                  <span>{formatCompact(entry.count)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}
