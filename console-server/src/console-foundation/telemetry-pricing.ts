// telemetry-pricing.ts — thin re-export of the shared pricing contract.
//
// The pricing registry + cost math now live in the single-source package
// @kontourai/console-telemetry (versioned registry, local-file / remote-URL /
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
} from "@kontourai/console-telemetry";

export type { PricingRegistry, ModelRate, TokenCounts } from "@kontourai/console-telemetry";
