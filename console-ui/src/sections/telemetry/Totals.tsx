import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { facetById } from "./facets";

export function TelemetryTotals({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const toolInvocations = telemetry?.totals.eventTypeCounts["tool.invoke"] || 0;
  const delegations = telemetry?.totals.eventTypeCounts["agent.delegate"] || 0;
  const projectCount = facetById(telemetry, "projects")?.counts.length || 0;
  const usage = telemetry?.totals.usage;
  const byModel = telemetry?.analytics.usageByModel ?? [];
  return (
    <div>
      <div className="telemetry-metrics" aria-label="Telemetry totals">
        <TelemetryMetric label="records" value={telemetry?.totals.recordCount ?? 0} />
        <TelemetryMetric label="sessions" value={telemetry?.totals.sessionCount ?? 0} />
        <TelemetryMetric label="projects" value={projectCount} />
        <TelemetryMetric label="tools" value={toolInvocations} />
        <TelemetryMetric label="delegations" value={delegations} />
        <TelemetryMetric label="est. cost" value={formatUsd(usage?.estimatedCostUsd ?? 0)} />
        <TelemetryMetric label="tokens" value={formatTokens(usage?.totalTokens ?? 0)} />
        <TelemetryMetric label="cache read" value={formatTokens(usage?.cacheReadInputTokens ?? 0)} />
      </div>
      {byModel.length > 0 && (
        <div className="telemetry-usage-by-model" aria-label="Cost by model">
          <h4>Cost by model</h4>
          <table>
            <thead>
              <tr>
                <th>model</th>
                <th>est. cost</th>
                <th>output</th>
                <th>cache read</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{formatUsd(row.estimatedCostUsd)}</td>
                  <td>{formatTokens(row.outputTokens)}</td>
                  <td>{formatTokens(row.cacheReadInputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TelemetryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{typeof value === "number" ? value.toLocaleString() : value}</dd>
    </div>
  );
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
