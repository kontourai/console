import { Empty } from "@kontourai/ui/react";
import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { knownActionClass } from "./activityCostDerive";
import {
  deriveToolReliability,
  failureBarWidth,
  failureTone,
  formatFailureRate,
  formatLatencyMs
} from "./toolReliabilityDerive";

/**
 * #181 Piece A (flagship): per-tool latency + failure/outcome reliability, from
 * the enriched tool.result stream (flow-agents #580). Failure rate excludes
 * `ambiguous` results (reported separately) so it never over- or under-states.
 * Honest empty state until outcomes/latencies arrive.
 */
export function TelemetryToolReliability({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const { rows, hasSignal } = deriveToolReliability(telemetry?.analytics?.toolReliability);

  return (
    <section className="telemetry-panel" aria-label="Tool reliability">
      <p className="section-label">Tool reliability</p>
      {hasSignal ? (
        <table className="tool-reliability">
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col" className="tr-num">Calls</th>
              <th scope="col" className="tr-num">p50</th>
              <th scope="col" className="tr-num">p95</th>
              <th scope="col" className="tr-fail-head">Failure rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <tr key={tool.toolName}>
                <th scope="row" className="tr-tool">
                  <span className={`activity-dot activity-${knownActionClass(tool.actionClass)}`} aria-hidden="true" />
                  <span className="tr-tool-name" title={tool.toolName}>{tool.toolName}</span>
                </th>
                <td className="tr-num">{tool.count.toLocaleString()}</td>
                <td className="tr-num">{formatLatencyMs(tool.p50DurationMs)}</td>
                <td className="tr-num">{formatLatencyMs(tool.p95DurationMs)}</td>
                <td className="tr-fail">
                  <span className={`tr-fail-bar tr-fail-${failureTone(tool.failureRate)}`}>
                    <span className="tr-fail-fill" style={{ width: `${failureBarWidth(tool.failureRate)}%` }} />
                  </span>
                  <span className="tr-fail-val">{formatFailureRate(tool.failureRate)}</span>
                  {tool.ambiguousCount > 0 ? (
                    <span className="tr-ambiguous" title="Results that were neither a clear pass nor fail — excluded from the failure rate">
                      {tool.ambiguousCount.toLocaleString()} amb.
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty label="No tool outcomes or latencies yet — per-tool reliability lands once enriched tool.result events arrive (flow-agents #580)." />
      )}
    </section>
  );
}
