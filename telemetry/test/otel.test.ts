import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toOtelGenAIAttributes,
  fromOtelGenAIAttributes,
  GEN_AI_SYSTEM,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_USAGE_INPUT_TOKENS,
  KONTOUR_CACHE_READ_TOKENS
} from "../src/otel";
import type { CanonicalUsage } from "../src/types";

test("toOtelGenAIAttributes emits stable GenAI attrs + cache/cost extensions", () => {
  const usage: CanonicalUsage = {
    model: "claude-opus-4-8",
    inputTokens: 100,
    outputTokens: 200,
    cacheReadInputTokens: 50000,
    cacheCreationInputTokens: 0,
    estimatedCostUsd: 0.0385,
    pricingVersion: "2026-06-28"
  };
  const attrs = toOtelGenAIAttributes(usage, "claude-code");
  assert.equal(attrs[GEN_AI_SYSTEM], "claude-code");
  assert.equal(attrs[GEN_AI_REQUEST_MODEL], "claude-opus-4-8");
  assert.equal(attrs[GEN_AI_USAGE_INPUT_TOKENS], 100);
  assert.equal(attrs[KONTOUR_CACHE_READ_TOKENS], 50000);
});

test("round-trips canonical usage through OTel attributes", () => {
  const usage: CanonicalUsage = {
    model: "claude-haiku-4-5",
    inputTokens: 10,
    outputTokens: 20,
    cacheReadInputTokens: 30,
    cacheCreationInputTokens: 40,
    estimatedCostUsd: 1.23,
    pricingVersion: "2026-06-28"
  };
  const back = fromOtelGenAIAttributes(toOtelGenAIAttributes(usage, "strands"));
  assert.equal(back.model, "claude-haiku-4-5");
  assert.equal(back.inputTokens, 10);
  assert.equal(back.outputTokens, 20);
  assert.equal(back.cacheReadInputTokens, 30);
  assert.equal(back.cacheCreationInputTokens, 40);
  assert.equal(back.estimatedCostUsd, 1.23);
  assert.equal(back.pricingVersion, "2026-06-28");
});
