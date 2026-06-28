// otel.ts — OpenTelemetry GenAI semantic-conventions mapping.
//
// Speak the standard at the boundary, keep the richer canonical model inside.
// Core GenAI attributes (gen_ai.system, gen_ai.request.model,
// gen_ai.usage.input_tokens/output_tokens) are stable; the broader GenAI
// semconv is still experimental (Development status) as of 2026, so we map
// conservatively. Cache tokens + cost are NOT in the standard — emitted as
// clearly-namespaced extension attributes.
// Ref: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/

import type { CanonicalUsage } from "./types";

// Stable / core GenAI attributes
export const GEN_AI_SYSTEM = "gen_ai.system";
export const GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
export const GEN_AI_RESPONSE_MODEL = "gen_ai.response.model";
export const GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
export const GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";
export const GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";

// Extension attributes (NOT in the GenAI semconv — Anthropic cache + cost).
export const KONTOUR_CACHE_READ_TOKENS = "gen_ai.usage.cache_read_input_tokens";
export const KONTOUR_CACHE_CREATION_TOKENS = "gen_ai.usage.cache_creation_input_tokens";
export const KONTOUR_COST_USD = "kontour.gen_ai.usage.cost_usd";
export const KONTOUR_PRICING_VERSION = "kontour.gen_ai.pricing_version";

export type OtelAttributes = Record<string, string | number | boolean>;

function n(v: number | undefined | null): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Map a canonical usage block to OTel GenAI attributes. `system` is the runtime
 * (e.g. "claude-code", "strands"). Cache tokens + cost ride as extension keys.
 */
export function toOtelGenAIAttributes(usage: CanonicalUsage, system?: string): OtelAttributes {
  const attrs: OtelAttributes = {};
  if (system) attrs[GEN_AI_SYSTEM] = system;
  if (usage.model) {
    attrs[GEN_AI_REQUEST_MODEL] = usage.model;
    attrs[GEN_AI_RESPONSE_MODEL] = usage.model;
  }
  attrs[GEN_AI_OPERATION_NAME] = "chat";
  attrs[GEN_AI_USAGE_INPUT_TOKENS] = n(usage.inputTokens);
  attrs[GEN_AI_USAGE_OUTPUT_TOKENS] = n(usage.outputTokens);
  attrs[KONTOUR_CACHE_READ_TOKENS] = n(usage.cacheReadInputTokens);
  attrs[KONTOUR_CACHE_CREATION_TOKENS] = n(usage.cacheCreationInputTokens);
  if (typeof usage.estimatedCostUsd === "number") attrs[KONTOUR_COST_USD] = usage.estimatedCostUsd;
  if (usage.pricingVersion) attrs[KONTOUR_PRICING_VERSION] = usage.pricingVersion;
  return attrs;
}

/** Inverse: read a canonical usage block from OTel GenAI attributes (ingest interop). */
export function fromOtelGenAIAttributes(attrs: OtelAttributes): CanonicalUsage {
  const num = (k: string): number => (typeof attrs[k] === "number" ? (attrs[k] as number) : 0);
  const str = (k: string): string | undefined => (typeof attrs[k] === "string" ? (attrs[k] as string) : undefined);
  return {
    model: str(GEN_AI_RESPONSE_MODEL) || str(GEN_AI_REQUEST_MODEL),
    inputTokens: num(GEN_AI_USAGE_INPUT_TOKENS),
    outputTokens: num(GEN_AI_USAGE_OUTPUT_TOKENS),
    cacheReadInputTokens: num(KONTOUR_CACHE_READ_TOKENS),
    cacheCreationInputTokens: num(KONTOUR_CACHE_CREATION_TOKENS),
    estimatedCostUsd: typeof attrs[KONTOUR_COST_USD] === "number" ? (attrs[KONTOUR_COST_USD] as number) : undefined,
    pricingVersion: str(KONTOUR_PRICING_VERSION)
  };
}
