import { Empty } from "@kontourai/console-kit/react";
import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { formatTime } from "../../utils/format";
import { isSensitiveTelemetryKey, redactTelemetryValue } from "./redaction";

export function RecentTelemetryEvents({
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
