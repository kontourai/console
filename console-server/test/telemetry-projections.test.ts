import { test } from "node:test";
import assert from "node:assert/strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

import { createTelemetryStore, classifyActionClass, costPerTurn } from "../src/console-foundation/telemetry";
import type { TelemetrySummary, TelemetryRecordSummary } from "../src/console-foundation/types";

/** Minimal TelemetryRecordSummary for direct (pure) costPerTurn tests. */
function summaryRecord(opts: Partial<TelemetryRecordSummary> & { eventId: string; sessionId: string }): TelemetryRecordSummary {
  return {
    sourceId: "test",
    sourceKind: "runtime",
    eventType: "tool.invoke",
    ...opts
  } as TelemetryRecordSummary;
}

// --- helpers ---------------------------------------------------------------

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-projections-"));
}

let evtCounter = 0;

interface TurnUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreation?: number;
  cacheRead?: number;
  estimatedCostUsd?: number;
}

/** Build a tool-event record (tool.invoke / tool.result) carrying the #568
 *  per-event usage snapshot for its turn. */
function toolEventRecord(opts: {
  sessionId: string;
  turnId?: string;
  eventType: "tool.invoke" | "tool.result";
  toolName: string;
  usage?: TurnUsage;
  observedAt?: number;
}): Record<string, unknown> {
  evtCounter += 1;
  const record: Record<string, unknown> = {
    schema_version: "0.3.0",
    timestamp: String(opts.observedAt ?? 1781200000000 + evtCounter * 1000),
    session_id: opts.sessionId,
    event_id: `evt-${evtCounter}`,
    event_type: opts.eventType,
    agent: { name: "claude-code", runtime: "claude-code", version: "3.11.0" },
    hook: { event_name: opts.eventType === "tool.invoke" ? "PreToolUse" : "PostToolUse", turn_id: opts.turnId },
    tool: { name: opts.toolName, normalized_name: opts.toolName }
  };
  if (opts.usage) {
    record.usage = {
      model: opts.usage.model,
      input_tokens: opts.usage.inputTokens ?? null,
      output_tokens: opts.usage.outputTokens ?? null,
      cache_creation_input_tokens: opts.usage.cacheCreation ?? null,
      cache_read_input_tokens: opts.usage.cacheRead ?? null,
      estimated_cost_usd: opts.usage.estimatedCostUsd ?? null,
      pricing_version: "2026-06-28"
    };
  }
  return record;
}

async function summarize(records: Record<string, unknown>[]): Promise<TelemetrySummary> {
  const rootDir = tempDir();
  const telemetryRoot = path.join(rootDir, ".telemetry");
  fs.mkdirSync(telemetryRoot, { recursive: true });
  fs.writeFileSync(
    path.join(telemetryRoot, "full.jsonl"),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8"
  );
  const store = createTelemetryStore({ rootDir, telemetryRoot, telemetryStorageAdapter: "local-jsonl" });
  return store.summarize();
}

// --- classifyActionClass (pure) --------------------------------------------

test("classifyActionClass maps normalized + raw tool names across integrations", () => {
  // edit
  for (const t of ["fs_write", "Edit", "Write", "apply_patch", "MultiEdit", "NotebookEdit"]) {
    assert.equal(classifyActionClass(t), "edit", `${t} → edit`);
  }
  // read
  for (const t of ["fs_read", "Read", "cat"]) {
    assert.equal(classifyActionClass(t), "read", `${t} → read`);
  }
  // search
  for (const t of ["Grep", "Glob", "ripgrep", "fs_search", "find"]) {
    assert.equal(classifyActionClass(t), "search", `${t} → search`);
  }
  // web
  for (const t of ["WebFetch", "WebSearch", "fetch"]) {
    assert.equal(classifyActionClass(t), "web", `${t} → web`);
  }
  // delegate
  for (const t of ["use_subagent", "Task", "Agent", "spawn_agent", "InvokeSubagents"]) {
    assert.equal(classifyActionClass(t), "delegate", `${t} → delegate`);
  }
  // execute
  for (const t of ["execute_bash", "Bash", "shell"]) {
    assert.equal(classifyActionClass(t), "execute", `${t} → execute`);
  }
});

test("classifyActionClass returns 'other' for unknown/empty, never guesses", () => {
  assert.equal(classifyActionClass(undefined), "other");
  assert.equal(classifyActionClass(""), "other");
  assert.equal(classifyActionClass("   "), "other");
  assert.equal(classifyActionClass("SomeFutureTool"), "other");
});

test("classifyActionClass is prototype-pollution safe for attacker-supplied tool names", () => {
  // A plain-object lookup would return an inherited built-in for these keys and
  // defeat the fallback. The Map-based lookup must yield "other".
  for (const key of ["constructor", "__proto__", "prototype", "hasOwnProperty", "toString", "valueOf"]) {
    assert.equal(classifyActionClass(key), "other", `${key} → other`);
    assert.equal(classifyActionClass(key.toUpperCase()), "other", `${key.toUpperCase()} → other`);
  }
});

test("actionTaxonomy survives a poisoned tool name without throwing (self-DoS regression)", async () => {
  // Two tool.invoke events tied in count — one named "constructor" — used to
  // throw `localeCompare is not a function` inside buildAnalytics → summarize().
  const summary = await summarize([
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "constructor" }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Edit" })
  ]);
  const classes = summary.analytics.actionClasses;
  // The poisoned name classifies to "other"; every emitted class is a valid,
  // serializable string (no Function/prototype leaked into the read model).
  const valid = new Set(["edit", "read", "search", "execute", "web", "delegate", "other"]);
  for (const entry of classes) {
    assert.ok(valid.has(entry.actionClass), `actionClass ${String(entry.actionClass)} is a valid class`);
    assert.equal(typeof entry.label, "string");
  }
  const other = classes.find((c) => c.actionClass === "other");
  assert.equal(other?.count, 1);
});

// --- actionTaxonomy (integration) ------------------------------------------

test("actionTaxonomy counts tool.invoke actions only, not paired tool.result", async () => {
  const summary = await summarize([
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Edit" }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.result", toolName: "Edit" }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Bash" }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.result", toolName: "Bash" }),
    toolEventRecord({ sessionId: "s2", turnId: "t2", eventType: "tool.invoke", toolName: "Grep" })
  ]);
  const classes = Object.fromEntries(summary.analytics.actionClasses.map((c) => [c.actionClass, c]));
  // Each invoke counted once; results ignored.
  assert.equal(classes.edit.count, 1);
  assert.equal(classes.execute.count, 1);
  assert.equal(classes.search.count, 1);
  assert.equal(classes.search.sessionCount, 1);
  // edit action only happened in s1.
  assert.equal(classes.edit.sessionCount, 1);
});

// --- costPerTurn (integration) — the correctness crux -----------------------

// The console recomputes estimatedCostUsd authoritatively from tokens + pricing
// (the emitted cost is not trusted), so these tests derive the expected per-turn
// cost from the per-record recomputed value rather than hardcoding a price. The
// invariant under test is the DE-DUP: a turn is counted once, not once per event.
function recordCostForTurn(summary: TelemetrySummary, turnId: string): number {
  const record = summary.records.find((r) => r.turnId === turnId && typeof r.estimatedCostUsd === "number");
  assert.ok(record, `expected a priced record for turn ${turnId}`);
  return record!.estimatedCostUsd as number;
}

test("costPerTurn attributes a turn's cost ONCE despite the snapshot on every event", async () => {
  const usage: TurnUsage = { model: "claude-opus-4-8", inputTokens: 2, outputTokens: 1483, cacheRead: 233430 };
  // One turn with 3 tool calls → 3 invoke + 3 result = 6 events, all carrying
  // the SAME usage snapshot. A naive per-event sum would report 6× the cost.
  const records = [] as Record<string, unknown>[];
  for (let i = 0; i < 3; i += 1) {
    records.push(toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Edit", usage }));
    records.push(toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.result", toolName: "Edit", usage }));
  }
  const summary = await summarize(records);
  const perEventCost = recordCostForTurn(summary, "t1");
  assert.ok(perEventCost > 0, "sanity: the turn priced to a non-zero cost");
  const cpt = summary.analytics.costPerTurn;
  assert.equal(cpt.turnCount, 1);
  assert.equal(cpt.turns[0].estimatedCostUsd, perEventCost, "turn cost is one snapshot, not the 6× sum");
  assert.equal(cpt.turns[0].toolCount, 3, "3 tool.invoke actions in the turn");
  assert.equal(cpt.turns[0].cacheReadInputTokens, 233430);
  assert.equal(cpt.turns[0].model, "claude-opus-4-8");
  assert.equal(cpt.totalEstimatedCostUsd, perEventCost);
});

test("costPerTurn totals sum distinct turns, each once", async () => {
  const t1Usage: TurnUsage = { model: "claude-opus-4-8", inputTokens: 100, outputTokens: 200 };
  const t2Usage: TurnUsage = { model: "claude-opus-4-8", inputTokens: 500, outputTokens: 900 };
  const summary = await summarize([
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Edit", usage: t1Usage }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.result", toolName: "Edit", usage: t1Usage }),
    toolEventRecord({ sessionId: "s1", turnId: "t2", eventType: "tool.invoke", toolName: "Bash", usage: t2Usage })
  ]);
  const c1 = recordCostForTurn(summary, "t1");
  const c2 = recordCostForTurn(summary, "t2");
  const cpt = summary.analytics.costPerTurn;
  assert.equal(cpt.turnCount, 2);
  assert.equal(cpt.totalEstimatedCostUsd, Math.round((c1 + c2) * 1_000_000) / 1_000_000);
});

test("costPerTurn picks ONE canonical snapshot per turn — internally consistent, order-invariant", () => {
  // A turn whose snapshot diverges mid-turn (e.g. model fallback): a cheap early
  // snapshot on model-x, a larger later snapshot on model-y. The row must report
  // ONE real snapshot atomically (model matches its own tokens+cost), never a
  // field-by-field composite, and must not depend on record order.
  const early = summaryRecord({
    eventId: "e1", sessionId: "s1", turnId: "t1", model: "model-x",
    inputTokens: 10, outputTokens: 0, estimatedCostUsd: 0.01, observedAt: "2026-07-14T00:00:00.000Z"
  });
  const late = summaryRecord({
    eventId: "e2", sessionId: "s1", turnId: "t1", model: "model-y",
    inputTokens: 500, outputTokens: 0, estimatedCostUsd: 0.015, observedAt: "2026-07-14T00:00:01.000Z"
  });

  const forward = costPerTurn([early, late]);
  const reversed = costPerTurn([late, early]);
  assert.deepEqual(forward, reversed, "output is independent of record order (pure)");

  const row = forward.turns[0];
  // The larger snapshot (model-y, 500 tokens, $0.015) is canonical, taken whole.
  assert.equal(row.model, "model-y");
  assert.equal(row.inputTokens, 500);
  assert.equal(row.estimatedCostUsd, 0.015);
  // Never the Frankenstein combination model-x @ 500 tokens.
  assert.notEqual(row.model, "model-x");
});

test("costPerTurn excludes cost of records with no turnId from the total (turn-scoped)", () => {
  const priced = summaryRecord({ eventId: "e1", sessionId: "s1", inputTokens: 100, estimatedCostUsd: 0.5 }); // no turnId
  const inTurn = summaryRecord({ eventId: "e2", sessionId: "s1", turnId: "t1", inputTokens: 10, estimatedCostUsd: 0.02 });
  const result = costPerTurn([priced, inTurn]);
  assert.equal(result.turnCount, 1, "only the turn-attributed record forms a turn");
  assert.equal(result.turns[0].turnId, "t1");
  assert.equal(result.totalEstimatedCostUsd, 0.02, "turnId-less cost is excluded, not folded in");
});

test("costPerTurn caps the detail list but keeps turnCount + total exact over all turns", async () => {
  const usage: TurnUsage = { model: "claude-opus-4-8", inputTokens: 10, outputTokens: 20 };
  const records: Record<string, unknown>[] = [];
  const TURNS = 250; // exceeds MAX_COST_PER_TURN_ROWS (200)
  for (let i = 0; i < TURNS; i += 1) {
    records.push(toolEventRecord({ sessionId: "s1", turnId: `t${i}`, eventType: "tool.invoke", toolName: "Edit", usage, observedAt: 1781200000000 + i * 1000 }));
  }
  const summary = await summarize(records);
  const cpt = summary.analytics.costPerTurn;
  const perTurn = recordCostForTurn(summary, "t0");
  assert.equal(cpt.turnCount, TURNS, "turnCount reflects every turn");
  assert.equal(cpt.turns.length, 200, "detail list capped at MAX_COST_PER_TURN_ROWS");
  assert.equal(cpt.totalEstimatedCostUsd, Math.round(perTurn * TURNS * 1_000_000) / 1_000_000, "total sums all turns, not just the capped list");
});

test("costPerTurn skips records without a turnId and tolerates missing usage", async () => {
  const summary = await summarize([
    // no turn_id → excluded from per-turn cost
    toolEventRecord({ sessionId: "s1", eventType: "tool.invoke", toolName: "Read" }),
    // turn present but no usage snapshot → zero-cost turn, still counted
    toolEventRecord({ sessionId: "s1", turnId: "t9", eventType: "tool.invoke", toolName: "Read" })
  ]);
  const cpt = summary.analytics.costPerTurn;
  assert.equal(cpt.turnCount, 1);
  assert.equal(cpt.turns[0].turnId, "t9");
  assert.equal(cpt.turns[0].estimatedCostUsd, 0);
  assert.equal(cpt.totalEstimatedCostUsd, 0);
});
