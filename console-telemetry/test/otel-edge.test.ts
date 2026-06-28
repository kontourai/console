import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toOtelGenAIAttributes,
  fromOtelGenAIAttributes,
  GEN_AI_SYSTEM,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_OPERATION_NAME,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  KONTOUR_CACHE_READ_TOKENS,
  KONTOUR_CACHE_CREATION_TOKENS,
  KONTOUR_COST_USD,
  KONTOUR_PRICING_VERSION
} from "../src/index";

test("toOtel: omits system + model attrs when absent; operation is chat", () => {
  const attrs = toOtelGenAIAttributes({ inputTokens: 5, outputTokens: 7 });
  assert.equal(attrs[GEN_AI_SYSTEM], undefined);
  assert.equal(attrs[GEN_AI_REQUEST_MODEL], undefined);
  assert.equal(attrs[GEN_AI_RESPONSE_MODEL], undefined);
  assert.equal(attrs[GEN_AI_OPERATION_NAME], "chat");
  assert.equal(attrs[GEN_AI_USAGE_INPUT_TOKENS], 5);
  assert.equal(attrs[GEN_AI_USAGE_OUTPUT_TOKENS], 7);
});

test("toOtel: missing token fields default to 0 (not undefined/NaN)", () => {
  const attrs = toOtelGenAIAttributes({ model: "claude-opus-4-8" }, "claude-code");
  assert.equal(attrs[GEN_AI_USAGE_INPUT_TOKENS], 0);
  assert.equal(attrs[GEN_AI_USAGE_OUTPUT_TOKENS], 0);
  assert.equal(attrs[KONTOUR_CACHE_READ_TOKENS], 0);
  assert.equal(attrs[KONTOUR_CACHE_CREATION_TOKENS], 0);
});

test("toOtel: cost + pricing_version only emitted when present", () => {
  const without = toOtelGenAIAttributes({ model: "m", inputTokens: 1 });
  assert.equal(without[KONTOUR_COST_USD], undefined);
  assert.equal(without[KONTOUR_PRICING_VERSION], undefined);

  const withCost = toOtelGenAIAttributes({ model: "m", inputTokens: 1, estimatedCostUsd: 0, pricingVersion: "2026-06-28" });
  assert.equal(withCost[KONTOUR_COST_USD], 0); // 0 is present, not dropped
  assert.equal(withCost[KONTOUR_PRICING_VERSION], "2026-06-28");
});

test("fromOtel: missing attributes yield zeros / undefined model", () => {
  const u = fromOtelGenAIAttributes({});
  assert.equal(u.model, undefined);
  assert.equal(u.inputTokens, 0);
  assert.equal(u.outputTokens, 0);
  assert.equal(u.cacheReadInputTokens, 0);
  assert.equal(u.cacheCreationInputTokens, 0);
  assert.equal(u.estimatedCostUsd, undefined);
});

test("fromOtel: response model preferred over request model", () => {
  const u = fromOtelGenAIAttributes({
    [GEN_AI_REQUEST_MODEL]: "req-model",
    [GEN_AI_RESPONSE_MODEL]: "resp-model"
  });
  assert.equal(u.model, "resp-model");
});
