// telemetry-pricing.ts — thin re-export of the shared pricing contract.
//
// The pricing registry + cost math now live in the single-source package
// @kontourai/telemetry (versioned registry, local-file / remote-URL /
// bundled resolution, version-aware costForModel). This shim preserves the
// existing `./telemetry-pricing` import path within console-server.
export {
  costForModel,
  refreshPricingFromUrl,
  setRegistry,
  getRegistry,
  currentPricingVersion,
  listPricingVersions,
  DEFAULT_REGISTRY
} from "@kontourai/telemetry";

export type { PricingRegistry, ModelRate, TokenCounts } from "@kontourai/telemetry";
