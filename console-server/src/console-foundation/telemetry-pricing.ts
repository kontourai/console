// telemetry-pricing.ts — versioned pricing registry loader + cost recompute.
//
// Single source of truth: the registry (flow-agents/scripts/telemetry/pricing.json).
// This module never hand-maintains rates; it loads the registry from, in order:
//   1. local file   TELEMETRY_PRICING_FILE / FLOW_AGENTS_PRICING_FILE (sync, at init)
//   2. remote URL   TELEMETRY_PRICING_URL  / FLOW_AGENTS_PRICING_URL  (async refresh)
//   3. bundled      pricing.snapshot.json  (generated copy, offline fallback)
//
// Tokens are the source of truth; cost is derived here. Each session.usage event
// stamps the pricing_version in effect when it ran, so cost is reproducible
// (default) and recompute-able against any other version.

const fs = require("node:fs");
const path = require("node:path");

export interface ModelRate {
  input: number;
  output: number;
}

export interface PricingVersionBlock {
  cache_multipliers: { write_5m: number; write_1h: number; read: number };
  models: Record<string, ModelRate>;
  default: ModelRate;
  zero_cost_models: string[];
}

export interface PricingRegistry {
  current_version: string;
  versions: Record<string, PricingVersionBlock>;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

const FALLBACK_REGISTRY: PricingRegistry = {
  current_version: "fallback",
  versions: {
    fallback: {
      cache_multipliers: { write_5m: 1.25, write_1h: 2.0, read: 0.1 },
      models: {},
      default: { input: 5.0, output: 25.0 },
      zero_cost_models: ["<synthetic>", "synthetic", "unknown", ""]
    }
  }
};

function isRegistry(value: unknown): value is PricingRegistry {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as PricingRegistry).current_version === "string" &&
      (value as PricingRegistry).versions &&
      typeof (value as PricingRegistry).versions === "object"
  );
}

function loadRegistrySync(): PricingRegistry {
  const envPath = process.env.TELEMETRY_PRICING_FILE || process.env.FLOW_AGENTS_PRICING_FILE;
  if (envPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(envPath, "utf8"));
      if (isRegistry(parsed)) return parsed;
    } catch {
      // fall through to bundled
    }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, "pricing.snapshot.json"), "utf8"));
    if (isRegistry(parsed)) return parsed;
  } catch {
    // fall through to inline fallback
  }
  return FALLBACK_REGISTRY;
}

let REGISTRY: PricingRegistry = loadRegistrySync();

/** Refresh the in-memory registry from a remote URL (call at server boot / on an interval). */
export async function refreshPricingFromUrl(
  url: string | undefined = process.env.TELEMETRY_PRICING_URL || process.env.FLOW_AGENTS_PRICING_URL
): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const parsed = await res.json();
    if (isRegistry(parsed)) {
      REGISTRY = parsed;
      return true;
    }
  } catch {
    // keep the current registry on any failure
  }
  return false;
}

export function getRegistry(): PricingRegistry {
  return REGISTRY;
}

export function currentPricingVersion(): string {
  return REGISTRY.current_version;
}

function versionBlock(version?: string): PricingVersionBlock {
  const versions = REGISTRY.versions || {};
  return versions[version || REGISTRY.current_version] || versions[REGISTRY.current_version] || FALLBACK_REGISTRY.versions.fallback;
}

/**
 * Estimated USD cost for a single model's token counts, priced against the given
 * registry version (defaults to current). Cache writes assume the 5m TTL tier.
 */
export function costForModel(model: string | undefined, tokens: TokenCounts, version?: string): number {
  const block = versionBlock(version);
  const key = (model || "").trim();
  if (block.zero_cost_models.includes(key)) return 0;
  const rate = block.models[key] || block.default;
  const cm = block.cache_multipliers;
  const cost =
    (tokens.inputTokens * rate.input +
      tokens.outputTokens * rate.output +
      tokens.cacheCreationInputTokens * rate.input * cm.write_5m +
      tokens.cacheReadInputTokens * rate.input * cm.read) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
