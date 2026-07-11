import { test } from "node:test";
import assert from "node:assert/strict";
import {
  costForModel,
  getRegistry,
  setRegistry,
  currentPricingVersion,
  listPricingVersions,
  refreshPricingFromUrl,
  DEFAULT_REGISTRY
} from "../src/index";
import type { PricingRegistry } from "../src/index";

const ORIGINAL: PricingRegistry = JSON.parse(JSON.stringify(getRegistry()));
function restore() {
  setRegistry(JSON.parse(JSON.stringify(ORIGINAL)));
}

test("costForModel: cache write (5m tier) priced at input*1.25", () => {
  // opus input $5/1M, write_5m 1.25 → 1,000,000 cache-creation tokens = $5 * 1.25 = $6.25
  const cost = costForModel("claude-opus-4-8", {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 0
  });
  assert.equal(cost, 6.25);
});

test("costForModel: unknown model falls back to default rate", () => {
  const cost = costForModel("totally-made-up-model", {
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0
  });
  assert.equal(cost, DEFAULT_REGISTRY.versions[DEFAULT_REGISTRY.current_version].default.input);
});

test("costForModel: all zero-cost models price to 0", () => {
  for (const m of ["<synthetic>", "synthetic", "unknown", ""]) {
    const cost = costForModel(m, {
      inputTokens: 9_999_999,
      outputTokens: 9_999_999,
      cacheCreationInputTokens: 9_999_999,
      cacheReadInputTokens: 9_999_999
    });
    assert.equal(cost, 0, `expected 0 for zero-cost model "${m}"`);
  }
});

test("costForModel: explicit version selects that version's rates; unknown version → current", () => {
  try {
    setRegistry({
      current_version: "v-current",
      versions: {
        "v-current": {
          cache_multipliers: { write_5m: 1.25, write_1h: 2, read: 0.1 },
          models: { "m": { input: 1, output: 1 } },
          default: { input: 1, output: 1 },
          zero_cost_models: []
        },
        "v-old": {
          cache_multipliers: { write_5m: 1.25, write_1h: 2, read: 0.1 },
          models: { "m": { input: 10, output: 10 } },
          default: { input: 10, output: 10 },
          zero_cost_models: []
        }
      }
    });
    const tokens = { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    assert.equal(costForModel("m", tokens), 1); // current
    assert.equal(costForModel("m", tokens, "v-old"), 10); // explicit old
    assert.equal(costForModel("m", tokens, "does-not-exist"), 1); // unknown → current
  } finally {
    restore();
  }
});

test("setRegistry rejects non-registry and keeps current", () => {
  const before = currentPricingVersion();
  assert.equal(setRegistry({ nonsense: true } as unknown as PricingRegistry), false);
  assert.equal(setRegistry(null as unknown as PricingRegistry), false);
  assert.equal(currentPricingVersion(), before);
});

test("getRegistry / listPricingVersions reflect setRegistry", () => {
  try {
    setRegistry({
      current_version: "x",
      versions: { x: { cache_multipliers: { write_5m: 1, write_1h: 1, read: 1 }, models: {}, default: { input: 1, output: 1 }, zero_cost_models: [] } }
    });
    assert.equal(currentPricingVersion(), "x");
    assert.deepEqual(listPricingVersions(), ["x"]);
    assert.equal(getRegistry().current_version, "x");
  } finally {
    restore();
  }
});

test("refreshPricingFromUrl: no URL → false, registry unchanged", async () => {
  const before = currentPricingVersion();
  assert.equal(await refreshPricingFromUrl(undefined), false);
  assert.equal(currentPricingVersion(), before);
});

test("refreshPricingFromUrl: valid remote registry replaces in-memory registry", async () => {
  const realFetch = globalThis.fetch;
  try {
    const remote: PricingRegistry = {
      current_version: "remote-v",
      versions: { "remote-v": { cache_multipliers: { write_5m: 1.25, write_1h: 2, read: 0.1 }, models: { "m": { input: 7, output: 7 } }, default: { input: 7, output: 7 }, zero_cost_models: [] } }
    };
    globalThis.fetch = (async () => ({ ok: true, json: async () => remote })) as unknown as typeof fetch;
    assert.equal(await refreshPricingFromUrl("https://example/pricing"), true);
    assert.equal(currentPricingVersion(), "remote-v");
    assert.equal(costForModel("m", { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }), 7);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});

test("refreshPricingFromUrl: non-ok response and bad json → false, registry kept", async () => {
  const realFetch = globalThis.fetch;
  const before = currentPricingVersion();
  try {
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    assert.equal(await refreshPricingFromUrl("https://example/p"), false);

    globalThis.fetch = (async () => ({ ok: true, json: async () => { throw new Error("bad json"); } })) as unknown as typeof fetch;
    assert.equal(await refreshPricingFromUrl("https://example/p"), false);

    globalThis.fetch = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    assert.equal(await refreshPricingFromUrl("https://example/p"), false);

    assert.equal(currentPricingVersion(), before);
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
});
