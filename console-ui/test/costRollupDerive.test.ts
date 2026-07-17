import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveCostRollup } from "../src/sections/telemetry/costRollupDerive";
import type { ConsoleTelemetryTurnCost, ConsoleTelemetryTurnCostSummary } from "../src/serverApiTypes";

function turn(opts: Partial<ConsoleTelemetryTurnCost> & { turnId: string }): ConsoleTelemetryTurnCost {
  return {
    sessionId: "s1",
    model: "claude-opus-4-8",
    toolCount: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    ...opts
  };
}

function summary(turns: ConsoleTelemetryTurnCost[], turnCount?: number): ConsoleTelemetryTurnCostSummary {
  return {
    turns,
    turnCount: turnCount ?? turns.length,
    totalEstimatedCostUsd: turns.reduce((s, t) => s + t.estimatedCostUsd, 0)
  };
}

test("deriveCostRollup rolls turns up by session and by model, cost desc", () => {
  const view = deriveCostRollup(
    summary([
      turn({ turnId: "t1", sessionId: "s1", model: "opus", totalTokens: 100, estimatedCostUsd: 0.2 }),
      turn({ turnId: "t2", sessionId: "s1", model: "sonnet", totalTokens: 50, estimatedCostUsd: 0.05 }),
      turn({ turnId: "t3", sessionId: "s2", model: "opus", totalTokens: 400, estimatedCostUsd: 0.9 })
    ])
  );
  // by session: s2 ($0.9) before s1 ($0.25)
  assert.deepEqual(view.bySession.map((r) => r.key), ["s2", "s1"]);
  const s1 = view.bySession.find((r) => r.key === "s1")!;
  assert.equal(s1.turnCount, 2);
  assert.equal(s1.totalTokens, 150);
  assert.equal(Math.round(s1.estimatedCostUsd * 100) / 100, 0.25);
  // by model: opus ($1.1) before sonnet ($0.05)
  assert.deepEqual(view.byModel.map((r) => r.key), ["opus", "sonnet"]);
  assert.equal(view.byModel[0].turnCount, 2);
  assert.equal(view.hasTurns, true);
});

test("deriveCostRollup labels missing session/model instead of dropping the turn", () => {
  const view = deriveCostRollup(
    summary([turn({ turnId: "t1", sessionId: "", model: undefined, estimatedCostUsd: 0.1 })])
  );
  assert.equal(view.bySession[0].key, "unknown session");
  assert.equal(view.byModel[0].key, "unknown model");
});

test("deriveCostRollup flags a capped basis when detail rows are fewer than turnCount", () => {
  const view = deriveCostRollup(summary([turn({ turnId: "t1", estimatedCostUsd: 0.1 })], 500));
  assert.equal(view.capped, true, "1 detail row but 500 total turns → capped");
  const full = deriveCostRollup(summary([turn({ turnId: "t1", estimatedCostUsd: 0.1 })], 1));
  assert.equal(full.capped, false);
});

test("deriveCostRollup respects per-table limits", () => {
  const turns = Array.from({ length: 10 }, (_u, i) =>
    turn({ turnId: `t${i}`, sessionId: `s${i}`, model: `m${i}`, estimatedCostUsd: i + 1 })
  );
  const view = deriveCostRollup(summary(turns), { sessionLimit: 3, modelLimit: 2 });
  assert.equal(view.bySession.length, 3);
  assert.equal(view.byModel.length, 2);
  // Highest cost first (i=9 → $10).
  assert.equal(view.bySession[0].key, "s9");
});

test("deriveCostRollup tolerates a missing summary — honest empty", () => {
  const view = deriveCostRollup(undefined);
  assert.deepEqual(view.bySession, []);
  assert.deepEqual(view.byModel, []);
  assert.equal(view.hasTurns, false);
  assert.equal(view.capped, false);
});
