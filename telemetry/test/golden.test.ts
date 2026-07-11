import { test } from "node:test";
import assert from "node:assert/strict";
const fs = require("node:fs");
const path = require("node:path");
import { costForModel } from "../src/index";

// Cross-runtime cost golden vectors. The same JSON (by value) is asserted in the
// flow-agents bash + Python tests, so all runtimes price tokens identically.
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "golden-vectors.json"), "utf8")) as {
  pricing_version: string;
  cases: Array<{
    name: string;
    model: string;
    tokens: { input: number; output: number; cache_creation: number; cache_read: number };
    expected_cost_usd: number;
  }>;
};

for (const c of golden.cases) {
  test(`golden: ${c.name} (${c.model}) → $${c.expected_cost_usd}`, () => {
    const cost = costForModel(c.model, {
      inputTokens: c.tokens.input,
      outputTokens: c.tokens.output,
      cacheCreationInputTokens: c.tokens.cache_creation,
      cacheReadInputTokens: c.tokens.cache_read
    });
    assert.equal(cost, c.expected_cost_usd, `${c.name}: expected ${c.expected_cost_usd}, got ${cost}`);
  });
}
