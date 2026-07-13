import {
  negotiateProductCapabilityDescriptors,
  type ProductCapabilityDescriptor,
} from "@kontourai/console-core/product-capability-descriptor";

import consoleDescriptor from "../descriptors/console.json";
import flowAgentsDescriptor from "../descriptors/flow-agents.json";
import flowDescriptor from "../descriptors/flow.json";

export const COMPATIBILITY_CATALOG_VERSION = "1.0.0" as const;

export type CatalogProductId = "flow-agents" | "flow" | "console";
export type DescriptorSource = "product-package" | "compatibility-catalog";

export interface CompatibilityCatalogEntry {
  readonly catalogVersion: typeof COMPATIBILITY_CATALOG_VERSION;
  readonly descriptorSource: "compatibility-catalog";
  readonly derivedFrom: string;
  readonly removalTrigger: string;
  readonly suitePrefix: readonly string[];
  readonly packageVersion: string;
  readonly descriptor: ProductCapabilityDescriptor;
}

const rawEntries = [
  {
    descriptor: flowAgentsDescriptor,
    packageVersion: "3.8.0",
    suitePrefix: ["flow", "agents"],
    derivedFrom: "Console #144 Flow Agents conformance fixture",
  },
  {
    descriptor: flowDescriptor,
    packageVersion: "3.1.4",
    suitePrefix: ["flow"],
    derivedFrom: "Console #144 Flow conformance fixture",
  },
  {
    descriptor: consoleDescriptor,
    packageVersion: "2.6.2",
    suitePrefix: ["console"],
    derivedFrom: "Console #144 Console conformance fixture",
  },
] as const;

const negotiated = negotiateProductCapabilityDescriptors(
  rawEntries.map((entry) => entry.descriptor),
);

if (!negotiated.ok) {
  const codes = negotiated.diagnostics.map((item) => item.code).join(",");
  throw new Error(`Invalid bundled compatibility catalog: ${codes}`);
}

const validatedById = new Map(
  negotiated.descriptors.map((descriptor) => [descriptor.product.id, descriptor]),
);

export const compatibilityCatalog: readonly CompatibilityCatalogEntry[] =
  Object.freeze(rawEntries.map((entry) => {
    const descriptor = validatedById.get(entry.descriptor.product.id);
    if (!descriptor) throw new Error("Bundled compatibility descriptor is missing.");
    return Object.freeze({
      catalogVersion: COMPATIBILITY_CATALOG_VERSION,
      descriptorSource: "compatibility-catalog" as const,
      derivedFrom: entry.derivedFrom,
      removalTrigger: `Remove when ${descriptor.product.packageName} ships and tests a product-owned descriptor.`,
      suitePrefix: Object.freeze([...entry.suitePrefix]),
      packageVersion: entry.packageVersion,
      descriptor,
    });
  }));
