import { test } from "node:test";
import assert from "node:assert/strict";
import { costForModel, currentPricingVersion, listPricingVersions, getRegistry } from "../src/pricing";

test("current version + listing reflect the bundled registry", () => {
  assert.equal(currentPricingVersion(), "2026-06-28");
  assert.deepEqual(listPricingVersions(), ["2026-06-28"]);
  assert.ok(getRegistry().versions["2026-06-28"].models["claude-opus-4-8"]);
});

test("costForModel: opus tokens incl. cache read", () => {
  const cost = costForModel("claude-opus-4-8", {
    inputTokens: 1000,
    outputTokens: 2000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 500000
  });
  // 1000*5/1e6 + 2000*25/1e6 + 500000*5/1e6*0.1 = 0.005 + 0.05 + 0.25
  assert.equal(cost, 0.305);
});

test("costForModel: zero-cost + unknown models", () => {
  const z = costForModel("<synthetic>", { inputTokens: 9, outputTokens: 9, cacheCreationInputTokens: 9, cacheReadInputTokens: 9 });
  assert.equal(z, 0);
  // unknown model falls back to default rate (5/25), so it is non-zero
  const u = costForModel("totally-made-up", { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  assert.equal(u, 5);
});

test("costForModel: unknown version falls back to current", () => {
  const cost = costForModel(
    "claude-haiku-4-5",
    { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    "1999-01-01"
  );
  assert.equal(cost, 1); // haiku input $1/1M at current version
});
