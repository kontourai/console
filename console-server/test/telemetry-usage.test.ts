import { test } from "node:test";
import assert from "node:assert/strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

import { createTelemetryStore } from "../src/console-foundation/telemetry";
import { getRegistry, setRegistry } from "@kontourai/console-telemetry";
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
