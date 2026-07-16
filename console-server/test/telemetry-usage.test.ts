import { test } from "node:test";
import assert from "node:assert/strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

import { createTelemetryStore, parseProductRoots } from "../src/console-foundation/telemetry";
import { getRegistry, setRegistry } from "@kontourai/telemetry";
import type { TelemetrySummary } from "../src/console-foundation/types";

// --- helpers ---------------------------------------------------------------

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-usage-"));
}

interface ModelTokens {
  model: string;
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
}

let evtCounter = 0;

/** Build a `session.usage` telemetry record with a usage block + by_model. */
function usageRecord(opts: {
  sessionId: string;
  project: string;
  agent: string;
  runtime: string;
  byModel: ModelTokens[];
  pricingVersion?: string;
  taskSlug?: string;
}): Record<string, unknown> {
  const sum = (k: keyof ModelTokens) => opts.byModel.reduce((s, m) => s + (Number(m[k]) || 0), 0);
  return {
    schema_version: "0.3.0",
    timestamp: String(1781200000000 + evtCounter * 1000),
    session_id: opts.sessionId,
    event_id: `evt-${evtCounter++}`,
    event_type: "session.usage",
    agent: { name: opts.agent, runtime: opts.runtime, version: "x" },
    hook: { event_name: "usage", model: "" },
    context: { cwd: `/work/${opts.project}` },
    ...(opts.taskSlug ? { task_slug: opts.taskSlug } : {}),
    usage: {
      model: opts.byModel[0]?.model,
      duration_s: 1,
      input_tokens: sum("input"),
      output_tokens: sum("output"),
      cache_creation_input_tokens: sum("cacheCreation"),
      cache_read_input_tokens: sum("cacheRead"),
      estimated_cost_usd: 999, // intentionally wrong; server must RECOMPUTE
      pricing_version: opts.pricingVersion ?? "2026-06-28",
      by_model: opts.byModel.map((m) => ({
        model: m.model,
        input_tokens: m.input ?? 0,
        output_tokens: m.output ?? 0,
        cache_creation_input_tokens: m.cacheCreation ?? 0,
        cache_read_input_tokens: m.cacheRead ?? 0
      }))
    }
  };
}

function plainRecord(eventType: string, sessionId: string): Record<string, unknown> {
  return {
    schema_version: "0.3.0",
    timestamp: String(1781200000000 + evtCounter * 1000),
    session_id: sessionId,
    event_id: `evt-${evtCounter++}`,
    event_type: eventType,
    agent: { name: "dev", runtime: "claude-code", version: "x" },
    tool: { name: "Bash", normalized_name: "execute_bash" }
  };
}

async function summarizeFromJsonl(records: Array<Record<string, unknown>>): Promise<TelemetrySummary> {
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

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// --- tests -----------------------------------------------------------------

test("usage totals: sums tokens and RECOMPUTES cost (ignores emitted estimate)", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "projA", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }] }),
    usageRecord({ sessionId: "s2", project: "projA", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] }),
    usageRecord({ sessionId: "s3", project: "projB", agent: "reviewer", runtime: "strands",
      byModel: [{ model: "claude-fable-5", output: 100 }] })
  ]);
  const u = summary.totals.usage;
  assert.equal(u.inputTokens, 1000);
  assert.equal(u.outputTokens, 3100);
  assert.equal(u.cacheReadInputTokens, 500000);
  assert.equal(u.totalTokens, 1000 + 3100 + 0 + 500000);
  // opus: (1000*5 + 2000*25 + 500000*5*0.1)/1e6 = 0.305 ; opus2: 1000*25/1e6 = 0.025 ; fable: 100*50/1e6 = 0.005
  assert.equal(u.estimatedCostUsd, round6(0.305 + 0.025 + 0.005));
});

test("usageByModel breakdown aggregates per model, sorted by cost desc", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "projA", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }] }),
    usageRecord({ sessionId: "s2", project: "projA", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] }),
    usageRecord({ sessionId: "s3", project: "projB", agent: "reviewer", runtime: "strands",
      byModel: [{ model: "claude-fable-5", output: 100 }] })
  ]);
  const byModel = summary.analytics.usageByModel;
  assert.deepEqual(byModel.map((b) => b.key), ["claude-opus-4-8", "claude-fable-5"]);
  assert.equal(byModel[0].estimatedCostUsd, round6(0.33));
  assert.equal(byModel[1].estimatedCostUsd, round6(0.005));
});

test("usageBy{project,agent,runtime} breakdowns group record-level usage", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "projA", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }] }),
    usageRecord({ sessionId: "s2", project: "projA", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] }),
    usageRecord({ sessionId: "s3", project: "projB", agent: "reviewer", runtime: "strands",
      byModel: [{ model: "claude-fable-5", output: 100 }] })
  ]);
  const cost = (rows: Array<{ key: string; estimatedCostUsd: number }>, key: string) =>
    rows.find((r) => r.key === key)?.estimatedCostUsd;
  assert.equal(cost(summary.analytics.usageByProject, "projA"), round6(0.33));
  assert.equal(cost(summary.analytics.usageByProject, "projB"), round6(0.005));
  assert.equal(cost(summary.analytics.usageByAgent, "dev"), round6(0.33));
  assert.equal(cost(summary.analytics.usageByAgent, "reviewer"), round6(0.005));
  assert.equal(cost(summary.analytics.usageByRuntime, "claude-code"), round6(0.33));
  assert.equal(cost(summary.analytics.usageByRuntime, "strands"), round6(0.005));
});

test("usageByTaskSlug groups cost by Builder work-item; task-less records are excluded, not shown as an 'unknown' row (#178/#179)", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "p", agent: "dev", runtime: "claude-code", taskSlug: "console-board-177",
      byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }] }),
    usageRecord({ sessionId: "s2", project: "p", agent: "dev", runtime: "claude-code", taskSlug: "console-board-177",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] }),
    usageRecord({ sessionId: "s3", project: "p", agent: "dev", runtime: "claude-code", taskSlug: "flow-agents-568",
      byModel: [{ model: "claude-fable-5", output: 100 }] }),
    // a regular (non-Builder) session with no work item — carries real cost but
    // no attribution; it must NOT surface as a phantom "unknown" work-item row.
    usageRecord({ sessionId: "s4", project: "p", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-fable-5", output: 100 }] })
  ]);
  const rows = summary.analytics.usageByTaskSlug;
  const cost = (key: string) => rows.find((r) => r.key === key)?.estimatedCostUsd;
  // two records for board-177 sum; each work item is its own row
  assert.equal(cost("console-board-177"), round6(0.33));
  assert.ok((cost("flow-agents-568") ?? 0) > 0, "second work item priced independently");
  assert.equal(rows.find((r) => r.key === "console-board-177")?.label, "console-board-177");
  // The task-less record's cost is never bucketed into an "unknown" work item:
  // absence of a slug means "not Builder work" (N/A), not "unlabeled". Only the
  // two genuinely-attributed work items appear.
  assert.ok(!rows.some((r) => r.key === "unknown"), "no 'unknown' work-item row for task-less records");
  assert.equal(rows.length, 2, "exactly the two attributed work items, nothing else");
});

test("usageByTaskSlug is empty (panel hidden) when no record carries a task_slug — even with cost present (#178 honesty guard)", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "p", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }] }),
    usageRecord({ sessionId: "s2", project: "p", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-fable-5", output: 100 }] })
  ]);
  // Cost-bearing records exist, but none is Builder work. The read-model must be
  // empty so the "Cost by work-item" panel stays hidden until attribution lands,
  // rather than rendering a single "unknown = 100%" row that restates the totals.
  assert.equal(summary.analytics.usageByTaskSlug.length, 0, "no attribution → empty breakdown → hidden panel");
});

test("summarizeRuntimeRecord populates taskSlug from a top-level task_slug, absent when not emitted", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "p", agent: "dev", runtime: "claude-code", taskSlug: "my-work-item",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] }),
    usageRecord({ sessionId: "s2", project: "p", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] })
  ]);
  const withSlug = summary.records.find((r) => r.sessionId === "s1");
  const withoutSlug = summary.records.find((r) => r.sessionId === "s2");
  assert.equal(withSlug?.taskSlug, "my-work-item");
  assert.equal(withoutSlug?.taskSlug, undefined, "no task_slug emitted → taskSlug undefined, not fabricated");
});

/** Build a tool.invoke/tool.result event carrying the #568 per-turn usage
 *  SNAPSHOT (flat usage, no by_model), as the emitter now stamps onto every
 *  tool event of a turn. */
function toolUsageEvent(opts: {
  sessionId: string;
  turnId: string;
  eventType: "tool.invoke" | "tool.result";
  model: string;
  input?: number;
  output?: number;
  cacheRead?: number;
}): Record<string, unknown> {
  return {
    schema_version: "0.3.0",
    timestamp: String(1781200000000 + evtCounter * 1000),
    session_id: opts.sessionId,
    event_id: `evt-${evtCounter++}`,
    event_type: opts.eventType,
    agent: { name: "dev", runtime: "claude-code", version: "x" },
    hook: { event_name: opts.eventType === "tool.invoke" ? "PreToolUse" : "PostToolUse", turn_id: opts.turnId },
    context: { cwd: "/work/projA" },
    tool: { name: "Edit", normalized_name: "fs_write" },
    usage: {
      model: opts.model,
      input_tokens: opts.input ?? 0,
      output_tokens: opts.output ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: opts.cacheRead ?? 0,
      pricing_version: "2026-06-28"
    }
  };
}

test("per-event tool usage snapshots do not inflate usageTotals / dimension breakdowns (#568 overcount fix)", async () => {
  // One authoritative session.usage record + a turn of 3 tool calls (3 invoke +
  // 3 result = 6 events), each carrying the SAME turn snapshot. Summing the tool
  // events would inflate the total to 7× the true cost; they must be excluded
  // (session.usage is authoritative). Cost is token-derived, so the expected
  // value is read from a session-only baseline rather than hardcoded.
  const sessionRecord = usageRecord({
    sessionId: "s1", project: "projA", agent: "dev", runtime: "claude-code",
    byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }]
  });
  const baseline = await summarizeFromJsonl([sessionRecord]);
  const expected = baseline.totals.usage.estimatedCostUsd;
  assert.ok(expected > 0, "sanity: the session priced to a non-zero cost");

  const toolTurn: Record<string, unknown>[] = [];
  for (let i = 0; i < 3; i += 1) {
    toolTurn.push(toolUsageEvent({ sessionId: "s1", turnId: "t1", eventType: "tool.invoke", model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }));
    toolTurn.push(toolUsageEvent({ sessionId: "s1", turnId: "t1", eventType: "tool.result", model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }));
  }
  const summary = await summarizeFromJsonl([sessionRecord, ...toolTurn]);

  // Totals + dimension breakdown reflect only the authoritative session.usage
  // cost — the 6 tool events add nothing.
  assert.equal(summary.totals.usage.estimatedCostUsd, expected, "usageTotals excludes per-event snapshots");
  const projA = summary.analytics.usageByProject.find((r) => r.key === "projA");
  assert.equal(projA?.estimatedCostUsd, expected, "usageByProject excludes per-event snapshots");

  // The tool-event turn cost is not lost — it surfaces (de-duplicated) in the
  // costPerTurn projection: one turn, priced from the same tokens as the session.
  assert.equal(summary.analytics.costPerTurn.turnCount, 1);
  assert.equal(summary.analytics.costPerTurn.totalEstimatedCostUsd, expected, "costPerTurn shows the turn once");
});

test("usageByModel excludes a per-event tool snapshot even if it carries by_model (#209 defense-in-depth)", async () => {
  // The emitter emits FLAT usage (no by_model) on tool events today, so this
  // guards a hypothetical future symmetric enrichment: a tool.invoke carrying a
  // by_model array must not double-count against the authoritative session.usage.
  const sessionRecord = usageRecord({
    sessionId: "s1", project: "projA", agent: "dev", runtime: "claude-code",
    byModel: [{ model: "claude-opus-4-8", input: 1000, output: 2000, cacheRead: 500000 }]
  });
  const baseline = await summarizeFromJsonl([sessionRecord]);
  const expected = baseline.analytics.usageByModel.find((m) => m.key === "claude-opus-4-8")?.estimatedCostUsd;
  assert.ok(expected && expected > 0, "sanity: session priced a non-zero model cost");

  // A tool event hand-stamped with by_model (not what the emitter does today).
  const toolWithByModel: Record<string, unknown> = {
    schema_version: "0.3.0",
    timestamp: String(1781200099000),
    session_id: "s1",
    event_id: "evt-bymodel-1",
    event_type: "tool.invoke",
    agent: { name: "dev", runtime: "claude-code", version: "x" },
    hook: { event_name: "PreToolUse", turn_id: "t1" },
    context: { cwd: "/work/projA" },
    tool: { name: "Edit", normalized_name: "fs_write" },
    usage: {
      model: "claude-opus-4-8",
      // Flat top-level tokens are required for parseRecordUsage to reach the
      // by_model branch (it early-returns when no flat tokens are present).
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 500000,
      by_model: [
        { model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 500000 }
      ],
      pricing_version: "2026-06-28"
    }
  };
  const summary = await summarizeFromJsonl([sessionRecord, toolWithByModel]);
  const opus = summary.analytics.usageByModel.find((m) => m.key === "claude-opus-4-8");
  assert.equal(opus?.estimatedCostUsd, expected, "per-event by_model snapshot excluded — model cost not doubled");
});

test("non-usage records contribute zero; no phantom breakdown rows", async () => {
  const summary = await summarizeFromJsonl([
    plainRecord("tool.invoke", "s1"),
    plainRecord("turn.user", "s1")
  ]);
  assert.equal(summary.totals.usage.estimatedCostUsd, 0);
  assert.equal(summary.totals.usage.totalTokens, 0);
  assert.equal(summary.analytics.usageByModel.length, 0);
  assert.equal(summary.analytics.usageByProject.length, 0);
});

test("cache-read-dominated, billion-scale tokens cost correctly (no float drift)", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "big", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", input: 200000, output: 1600000, cacheCreation: 9000000, cacheRead: 1000000000 }] })
  ]);
  // (200000*5 + 1600000*25 + 9000000*5*1.25 + 1000000000*5*0.1)/1e6
  const expected = round6((200000 * 5 + 1600000 * 25 + 9000000 * 5 * 1.25 + 1000000000 * 5 * 0.1) / 1_000_000);
  assert.equal(summary.totals.usage.estimatedCostUsd, expected);
  assert.equal(summary.totals.usage.cacheReadInputTokens, 1000000000);
});

test("multi-model session: per-model split priced independently", async () => {
  const summary = await summarizeFromJsonl([
    usageRecord({ sessionId: "s1", project: "mix", agent: "dev", runtime: "claude-code", byModel: [
      { model: "claude-opus-4-8", output: 1000 },
      { model: "claude-haiku-4-5", output: 1000 }
    ] })
  ]);
  const byModel = summary.analytics.usageByModel;
  const opus = byModel.find((b) => b.key === "claude-opus-4-8")!;
  const haiku = byModel.find((b) => b.key === "claude-haiku-4-5")!;
  assert.equal(opus.estimatedCostUsd, round6(1000 * 25 / 1_000_000)); // 0.025
  assert.equal(haiku.estimatedCostUsd, round6(1000 * 5 / 1_000_000)); // 0.005
  // session totals = both models combined
  assert.equal(summary.totals.usage.estimatedCostUsd, round6(0.025 + 0.005));
});

test("version-aware recompute: stamped pricing_version selects that version's rates", async () => {
  const original = JSON.parse(JSON.stringify(getRegistry()));
  try {
    setRegistry({
      current_version: "2026-06-28",
      versions: {
        "2026-06-28": original.versions[original.current_version],
        "2099-01-01": {
          cache_multipliers: { write_5m: 1.25, write_1h: 2.0, read: 0.1 },
          models: { "claude-opus-4-8": { input: 99, output: 99 } },
          default: { input: 99, output: 99 },
          zero_cost_models: ["<synthetic>"]
        }
      }
    });
    const current = await summarizeFromJsonl([
      usageRecord({ sessionId: "s1", project: "p", agent: "dev", runtime: "claude-code",
        pricingVersion: "2026-06-28",
        byModel: [{ model: "claude-opus-4-8", output: 1_000_000 }] })
    ]);
    const future = await summarizeFromJsonl([
      usageRecord({ sessionId: "s2", project: "p", agent: "dev", runtime: "claude-code",
        pricingVersion: "2099-01-01",
        byModel: [{ model: "claude-opus-4-8", output: 1_000_000 }] })
    ]);
    assert.equal(current.totals.usage.estimatedCostUsd, 25); // 1M output * $25/1M @ 2026 rates
    assert.equal(future.totals.usage.estimatedCostUsd, 99); // same tokens, $99/1M @ future rates
  } finally {
    setRegistry(original);
  }
});

test("accept() path (POSTed records) is summarized with usage too", async () => {
  const rootDir = tempDir();
  const store = createTelemetryStore({ rootDir, telemetryStorageAdapter: "local-jsonl" });
  await store.accept(
    usageRecord({ sessionId: "sA", project: "acc", agent: "dev", runtime: "claude-code",
      byModel: [{ model: "claude-opus-4-8", output: 1000 }] }) as any
  );
  const summary = await store.summarize();
  assert.equal(summary.totals.usage.estimatedCostUsd, round6(1000 * 25 / 1_000_000));
  assert.equal(summary.analytics.usageByModel[0]?.key, "claude-opus-4-8");
});

// --- CONSOLE_TELEMETRY_PRODUCT_ROOTS parsing (#64) --------------------------

test("parseProductRoots keeps well-formed productId:path entries", () => {
  const { roots, dropped } = parseProductRoots("flow:/abs/flow-agents, surface:./rel/surface");
  assert.deepEqual(roots, { flow: "/abs/flow-agents", surface: "./rel/surface" });
  assert.equal(dropped.length, 0);
});

test("parseProductRoots splits on the FIRST colon so absolute paths after it survive", () => {
  // A Windows-style or scheme-y path after the colon must not be mangled.
  const { roots } = parseProductRoots("flow:/a:b/c");
  assert.equal(roots.flow, "/a:b/c");
});

// The core #64 regression: a bare path (no "productId:" prefix) used to be
// silently dropped. It is now surfaced in `dropped` with an explanatory reason.
test("parseProductRoots reports a bare path as dropped instead of silently discarding it", () => {
  const { roots, dropped } = parseProductRoots("/home/me/dev/flow-agents");
  assert.deepEqual(roots, {});
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].entry, "/home/me/dev/flow-agents");
  assert.match(dropped[0].reason, /no ":" separator/);
});

test("parseProductRoots reports each malformed entry with a specific reason", () => {
  const { roots, dropped } = parseProductRoots(":/no/id, bad id:/x, ok:/y, empty:");
  assert.deepEqual(roots, { ok: "/y" });
  const byReason = Object.fromEntries(dropped.map((d) => [d.entry, d.reason]));
  assert.match(byReason[":/no/id"], /no product id before ":"/);
  assert.match(byReason["bad id:/x"], /invalid product id/);
  assert.match(byReason["empty:"], /empty path/);
});

// End-to-end: a dropped env entry surfaces as a summary warning so the operator
// sees WHY the telemetry panels are empty, in the console UI itself.
test("summary surfaces a warning when CONSOLE_TELEMETRY_PRODUCT_ROOTS drops an entry (#64)", async () => {
  const original = process.env.CONSOLE_TELEMETRY_PRODUCT_ROOTS;
  process.env.CONSOLE_TELEMETRY_PRODUCT_ROOTS = "/home/me/dev/flow-agents";
  try {
    const rootDir = tempDir();
    const store = createTelemetryStore({ rootDir, telemetryStorageAdapter: "local-jsonl" });
    const summary = await store.summarize();
    const warning = summary.warnings.find((w: any) => w.path === "telemetry-product-roots");
    assert.ok(warning, "expected a telemetry-product-roots warning in the summary");
    assert.match(warning!.message, /\/home\/me\/dev\/flow-agents/);
    assert.match(warning!.message, /ignored/);
  } finally {
    if (original === undefined) delete process.env.CONSOLE_TELEMETRY_PRODUCT_ROOTS;
    else process.env.CONSOLE_TELEMETRY_PRODUCT_ROOTS = original;
  }
});
