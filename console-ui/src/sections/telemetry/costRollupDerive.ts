import type { ConsoleTelemetryTurnCostSummary } from "../../serverApiTypes";

export interface CostRollupRow {
  /** sessionId or model — the grouping key. */
  key: string;
  turnCount: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface CostRollupView {
  bySession: CostRollupRow[];
  byModel: CostRollupRow[];
  /** True when at least one priced turn exists to roll up. */
  hasTurns: boolean;
  /** True when the per-turn detail list was capped server-side, so the rollups
   *  cover the most recent turns rather than every turn. Lets the UI disclose
   *  the partial basis honestly instead of implying a full-history rollup. */
  capped: boolean;
}

function rollup(
  turns: ConsoleTelemetryTurnCostSummary["turns"],
  keyOf: (turn: ConsoleTelemetryTurnCostSummary["turns"][number]) => string | undefined,
  fallback: string,
  limit: number
): CostRollupRow[] {
  const byKey = new Map<string, CostRollupRow>();
  for (const turn of turns) {
    const key = keyOf(turn) || fallback;
    let row = byKey.get(key);
    if (!row) {
      row = { key, turnCount: 0, totalTokens: 0, estimatedCostUsd: 0 };
      byKey.set(key, row);
    }
    row.turnCount += 1;
    row.totalTokens += turn.totalTokens ?? 0;
    row.estimatedCostUsd += turn.estimatedCostUsd ?? 0;
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function deriveCostRollup(
  costPerTurn: ConsoleTelemetryTurnCostSummary | undefined,
  { sessionLimit = 6, modelLimit = 6 }: { sessionLimit?: number; modelLimit?: number } = {}
): CostRollupView {
  const turns = costPerTurn?.turns ?? [];
  const bySession = rollup(turns, (t) => t.sessionId, "unknown session", sessionLimit);
  const byModel = rollup(turns, (t) => t.model, "unknown model", modelLimit);
  const capped = (costPerTurn?.turnCount ?? turns.length) > turns.length;
  return { bySession, byModel, hasTurns: turns.length > 0, capped };
}
