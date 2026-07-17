import { test } from "node:test";
import assert from "node:assert/strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

import { createTelemetryStore, classifyActionClass, costPerTurn, toolReliability, activityTimeline } from "../src/console-foundation/telemetry";
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
  durationMs?: number | null;
  outcome?: "pass" | "fail" | "ambiguous";
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
    tool: {
      name: opts.toolName,
      normalized_name: opts.toolName,
      ...(opts.durationMs !== undefined ? { duration_ms: opts.durationMs } : {}),
      ...(opts.outcome !== undefined ? { outcome: opts.outcome } : {})
    }
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

test("costPerTurn scopes by event type — a session.usage record with a turnId cannot hijack a turn (#209)", () => {
  // Hypothetical future/foreign emitter stamps a turnId onto a session-level
  // usage record whose tokens span the WHOLE session. Grouping by turnId alone
  // would let it win isMoreCompleteSnapshot and misattribute the entire session
  // cost onto turn t1. The event-type guard must exclude it.
  const toolSnapshot = summaryRecord({
    eventId: "tool-e1",
    sessionId: "s1",
    turnId: "t1",
    eventType: "tool.invoke",
    model: "claude-opus-4-8",
    inputTokens: 10,
    outputTokens: 20,
    estimatedCostUsd: 0.02
  });
  const sessionUsage = summaryRecord({
    eventId: "sess-e1",
    sessionId: "s1",
    turnId: "t1",
    eventType: "session.usage",
    model: "claude-opus-4-8",
    inputTokens: 100_000,
    outputTokens: 200_000,
    estimatedCostUsd: 9.99
  });
  const result = costPerTurn([toolSnapshot, sessionUsage]);
  assert.equal(result.turnCount, 1);
  assert.equal(result.turns[0].estimatedCostUsd, 0.02, "session-level record excluded — turn keeps the tool snapshot's cost");
  assert.equal(result.turns[0].inputTokens, 10, "canonical is the tool snapshot, not the whole-session record");
  assert.equal(result.totalEstimatedCostUsd, 0.02, "whole-session cost is NOT folded into the turn total");
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


// --- toolReliability (#181 Piece A) -----------------------------------------

/** Minimal tool.result summary record for direct (pure) toolReliability tests. */
function resultRecord(opts: {
  eventId: string;
  toolName: string;
  durationMs?: number;
  outcome?: "pass" | "fail" | "ambiguous";
  sessionId?: string;
}): TelemetryRecordSummary {
  return {
    sourceId: "test",
    sourceKind: "runtime",
    eventType: "tool.result",
    sessionId: opts.sessionId ?? "s1",
    eventId: opts.eventId,
    toolName: opts.toolName,
    toolDurationMs: opts.durationMs,
    toolOutcome: opts.outcome
  } as TelemetryRecordSummary;
}

test("toolReliability computes p50/p95 via nearest-rank over non-null durations", () => {
  const records = [10, 20, 30, 40, 50].map((d, i) =>
    resultRecord({ eventId: `e${i}`, toolName: "Bash", durationMs: d, outcome: "pass" })
  );
  // A result with no duration must not skew the percentiles (excluded), but still counts.
  records.push(resultRecord({ eventId: "e5", toolName: "Bash", outcome: "pass" }));
  const { tools } = toolReliability(records);
  assert.equal(tools.length, 1);
  const bash = tools[0];
  assert.equal(bash.toolName, "Bash");
  assert.equal(bash.actionClass, "execute");
  assert.equal(bash.count, 6, "all results counted, timed or not");
  assert.equal(bash.p50DurationMs, 30, "nearest-rank p50 of 5 samples → 3rd value");
  assert.equal(bash.p95DurationMs, 50, "nearest-rank p95 of 5 samples → 5th value");
});

test("toolReliability failure rate excludes ambiguous from the denominator", () => {
  // 3 pass, 1 fail, 6 ambiguous → failureRate = 1/(3+1) = 0.25, NOT 1/10.
  const records = [
    ...Array.from({ length: 3 }, (_u, i) => resultRecord({ eventId: `p${i}`, toolName: "Edit", outcome: "pass" })),
    resultRecord({ eventId: "f0", toolName: "Edit", outcome: "fail" }),
    ...Array.from({ length: 6 }, (_u, i) => resultRecord({ eventId: `a${i}`, toolName: "Edit", outcome: "ambiguous" }))
  ];
  const edit = toolReliability(records).tools[0];
  assert.equal(edit.passCount, 3);
  assert.equal(edit.failCount, 1);
  assert.equal(edit.ambiguousCount, 6);
  assert.equal(edit.failureRate, 0.25, "1/(pass+fail); ambiguous never in the denominator");
  assert.equal(edit.count, 10);
});

test("toolReliability reports failureRate 0 and null percentiles when no timed/outcome'd result", () => {
  const only = toolReliability([resultRecord({ eventId: "e0", toolName: "Read" })]).tools[0];
  assert.equal(only.count, 1);
  assert.equal(only.failureRate, 0, "no pass-or-fail result → honest 0, not NaN");
  assert.equal(only.p50DurationMs, null);
  assert.equal(only.p95DurationMs, null);
});

test("toolReliability on empty input yields no tools", () => {
  assert.deepEqual(toolReliability([]), { tools: [] });
});

test("toolReliability only aggregates tool.result, never tool.invoke", () => {
  const invoke = {
    sourceId: "test", sourceKind: "runtime", eventType: "tool.invoke",
    sessionId: "s1", eventId: "i0", toolName: "Bash", toolDurationMs: 999, toolOutcome: "fail"
  } as TelemetryRecordSummary;
  const result = resultRecord({ eventId: "r0", toolName: "Bash", durationMs: 5, outcome: "pass" });
  const { tools } = toolReliability([invoke, result]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].count, 1, "the invoke is ignored; only the result aggregates");
  assert.equal(tools[0].failCount, 0);
  assert.equal(tools[0].p50DurationMs, 5);
});

test("toolReliability is prototype-pollution safe for attacker-supplied tool names", () => {
  const records = ["constructor", "__proto__", "hasOwnProperty"].map((name, i) =>
    resultRecord({ eventId: `e${i}`, toolName: name, outcome: "fail" })
  );
  const { tools } = toolReliability(records);
  // Each poisoned name is an ordinary Map key → its own row, classed "other".
  assert.equal(tools.length, 3);
  for (const t of tools) {
    assert.equal(t.actionClass, "other", `${t.toolName} → other`);
    assert.equal(typeof t.toolName, "string");
    assert.equal(t.failCount, 1);
  }
});

test("toolReliability surfaces on buildAnalytics from the enriched tool.result stream", async () => {
  const summary = await summarize([
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Bash" }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.result", toolName: "Bash", durationMs: 120, outcome: "pass" }),
    toolEventRecord({ sessionId: "s1", turnId: "t2", eventType: "tool.result", toolName: "Bash", durationMs: 480, outcome: "fail" })
  ]);
  const tools = summary.analytics.toolReliability.tools;
  assert.equal(tools.length, 1);
  assert.equal(tools[0].count, 2);
  assert.equal(tools[0].passCount, 1);
  assert.equal(tools[0].failCount, 1);
  assert.equal(tools[0].failureRate, 0.5);
  assert.equal(tools[0].p50DurationMs, 120);
});

// --- activityTimeline (#181 Piece B) ----------------------------------------

test("activityTimeline buckets tool.invoke by hour, per action class, oldest→newest", async () => {
  const hour = 3_600_000;
  const base = Date.parse("2026-07-14T00:00:00.000Z");
  const summary = await summarize([
    // hour 0: 2 edits + 1 search
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Edit", observedAt: base + 60_000 }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Write", observedAt: base + 120_000 }),
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", toolName: "Grep", observedAt: base + 180_000 }),
    // paired result must NOT be counted
    toolEventRecord({ sessionId: "s1", turnId: "t1", eventType: "tool.result", toolName: "Edit", observedAt: base + 200_000 }),
    // hour 1: 1 execute
    toolEventRecord({ sessionId: "s1", turnId: "t2", eventType: "tool.invoke", toolName: "Bash", observedAt: base + hour + 60_000 })
  ]);
  const timeline = summary.analytics.activityTimeline;
  assert.equal(timeline.bucket, "hour");
  assert.equal(timeline.buckets.length, 2);
  assert.equal(timeline.buckets[0].startedAt, new Date(base).toISOString());
  assert.equal(timeline.buckets[0].byActionClass.edit, 2);
  assert.equal(timeline.buckets[0].byActionClass.search, 1);
  assert.equal(timeline.buckets[0].total, 3, "results excluded — 3 invokes only");
  assert.equal(timeline.buckets[1].byActionClass.execute, 1);
  assert.equal(timeline.buckets[1].total, 1);
});

test("activityTimeline caps to the most-recent maxBuckets window", () => {
  const hour = 3_600_000;
  const base = Date.parse("2026-07-14T00:00:00.000Z");
  const records: TelemetryRecordSummary[] = Array.from({ length: 30 }, (_u, i) => ({
    sourceId: "test", sourceKind: "runtime", eventType: "tool.invoke",
    sessionId: "s1", eventId: `e${i}`, toolName: "Edit",
    observedAt: new Date(base + i * hour).toISOString()
  } as TelemetryRecordSummary));
  const timeline = activityTimeline(records, { maxBuckets: 24 });
  assert.equal(timeline.buckets.length, 24, "30 hourly buckets trimmed to the last 24");
  // The kept window is the most recent → starts at hour 6.
  assert.equal(timeline.buckets[0].startedAt, new Date(base + 6 * hour).toISOString());
  assert.equal(timeline.buckets[23].startedAt, new Date(base + 29 * hour).toISOString());
});

test("activityTimeline zero-fills all action classes and tolerates unparseable timestamps", () => {
  const records: TelemetryRecordSummary[] = [
    { sourceId: "test", sourceKind: "runtime", eventType: "tool.invoke", sessionId: "s1", eventId: "e0", toolName: "Edit", observedAt: "2026-07-14T00:00:00.000Z" } as TelemetryRecordSummary,
    { sourceId: "test", sourceKind: "runtime", eventType: "tool.invoke", sessionId: "s1", eventId: "e1", toolName: "Edit", observedAt: "not-a-date" } as TelemetryRecordSummary,
    { sourceId: "test", sourceKind: "runtime", eventType: "tool.invoke", sessionId: "s1", eventId: "e2", toolName: "Edit" } as TelemetryRecordSummary
  ];
  const timeline = activityTimeline(records);
  assert.equal(timeline.buckets.length, 1, "records without a parseable observedAt are dropped");
  const b = timeline.buckets[0].byActionClass;
  assert.deepEqual(Object.keys(b).sort(), ["delegate", "edit", "execute", "other", "read", "search", "web"]);
  assert.equal(b.edit, 1);
  assert.equal(b.read, 0);
});

test("activityTimeline on empty input yields an empty bucket list", () => {
  assert.deepEqual(activityTimeline([]), { bucket: "hour", buckets: [] });
});
