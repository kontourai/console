// types.ts — canonical telemetry + pricing contract shapes.
//
// One definition consumed by the console server (ingest/aggregation) and by
// producers (flow-agents runtimes/sinks). Pricing has no industry standard, so
// this is the controlled shape; telemetry maps to OpenTelemetry GenAI semconv
// at the boundary (see otel.ts).

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface TelemetryUsageTotals extends TokenCounts {
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface TelemetryUsageBreakdown extends TelemetryUsageTotals {
  key: string;
  label: string;
}

/** The `usage` block carried by a `session.usage` telemetry event. */
export interface CanonicalUsage {
  model?: string;
  durationS?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCostUsd?: number;
  pricingVersion?: string;
  byModel?: Array<TokenCounts & { model: string; estimatedCostUsd?: number }>;
}

// --- Pricing registry (controlled shape; no cross-provider standard) ---

export interface ModelRate {
  input: number;
  output: number;
}

export interface PricingCacheMultipliers {
  write_5m: number;
  write_1h: number;
  read: number;
}

export interface PricingVersionBlock {
  effective_date?: string;
  currency?: string;
  unit?: string;
  cache_multipliers: PricingCacheMultipliers;
  models: Record<string, ModelRate>;
  default: ModelRate;
  zero_cost_models: string[];
}

export interface PricingRegistry {
  schema_version?: string;
  current_version: string;
  source?: string;
  versions: Record<string, PricingVersionBlock>;
}
