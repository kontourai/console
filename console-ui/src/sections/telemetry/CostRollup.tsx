import { Empty } from "@kontourai/ui/react";
import type { ConsoleTelemetryResponse } from "../../serverApiTypes";
import { formatCompact, formatUsd } from "../../utils/format";
import { deriveCostRollup, type CostRollupRow } from "./costRollupDerive";

/**
 * #181 Piece C: cost rolled up per session and per model from the per-turn cost
 * projection. Client-side derive over the (server-capped) turn detail. Honest
 * empty state until priced turns exist; discloses when the basis is capped.
 */
export function TelemetryCostRollup({ telemetry }: { telemetry: ConsoleTelemetryResponse | null }) {
  const { bySession, byModel, hasTurns, capped } = deriveCostRollup(telemetry?.analytics?.costPerTurn);

  return (
    <section className="telemetry-panel" aria-label="Cost rollup">
      <p className="section-label">Cost rollup</p>
      {hasTurns ? (
        <>
          <div className="cost-rollup-grid">
            <CostRollupTable caption="Top sessions by cost" keyLabel="Session" rows={bySession} />
            <CostRollupTable caption="Cost by model" keyLabel="Model" rows={byModel} />
          </div>
          {capped ? (
            <p className="cost-rollup-note">Rolled up over the most recent priced turns (per-turn detail is capped server-side).</p>
          ) : null}
        </>
      ) : (
        <Empty label="No priced turns to roll up yet — per-session and per-model cost lands once enriched tool events carry usage (flow-agents #568)." />
      )}
    </section>
  );
}

function CostRollupTable({ caption, keyLabel, rows }: { caption: string; keyLabel: string; rows: CostRollupRow[] }) {
  return (
    <table className="cost-rollup">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{keyLabel}</th>
          <th scope="col" className="cr-num">Turns</th>
          <th scope="col" className="cr-num">Tokens</th>
          <th scope="col" className="cr-num">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className="cr-key" title={row.key}>{row.key}</th>
            <td className="cr-num">{row.turnCount.toLocaleString()}</td>
            <td className="cr-num">{formatCompact(row.totalTokens)}</td>
            <td className="cr-num">{formatUsd(row.estimatedCostUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
