// pricing.ts — versioned pricing registry loader + cost recompute.
//
// Single source of truth for cost math. Resolution (init, synchronous):
//   1. local file  TELEMETRY_PRICING_FILE / FLOW_AGENTS_PRICING_FILE
//   2. bundled     DEFAULT_REGISTRY
// Remote (TELEMETRY_PRICING_URL) is applied via async refreshPricingFromUrl()
// — call it at server boot / on an interval. Tokens are the source of truth;
// cost is derived here against an explicit version (defaults to current), so a
// session priced at emit can be reproduced or recomputed against any version.

const fs = require("node:fs");

import type { PricingRegistry, PricingVersionBlock, TokenCounts } from "./types";
import { DEFAULT_REGISTRY } from "./default-registry";

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
  return DEFAULT_REGISTRY;
}

let REGISTRY: PricingRegistry = loadRegistrySync();

/** Replace the in-memory registry from a remote URL (single live source). */
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
    // keep current registry on any failure
  }
  return false;
}

/** Replace the in-memory registry directly (e.g. console syncing from flow-agents). */
export function setRegistry(registry: PricingRegistry): boolean {
  if (!isRegistry(registry)) return false;
  REGISTRY = registry;
  return true;
}

export function getRegistry(): PricingRegistry {
  return REGISTRY;
}

export function currentPricingVersion(): string {
  return REGISTRY.current_version;
}

export function listPricingVersions(): string[] {
  return Object.keys(REGISTRY.versions || {});
}

function versionBlock(version?: string): PricingVersionBlock {
  const versions = REGISTRY.versions || {};
  return (
    versions[version || REGISTRY.current_version] ||
    versions[REGISTRY.current_version] ||
    DEFAULT_REGISTRY.versions[DEFAULT_REGISTRY.current_version]
  );
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Estimated USD cost for one model's token counts, priced against the given
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
  return round6(cost);
}
