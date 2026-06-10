import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { facetById } from "./facets";

export function TelemetryTotals({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
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

function TelemetryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value.toLocaleString()}</dd>
    </div>
  );
}
