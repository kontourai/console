import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  negotiateProductCapabilityDescriptors,
  validateProductCapabilityDescriptor,
  type LocalProductPackageCandidate,
  type ProductCapabilityDescriptor,
  type ProductCapabilityDiagnostic,
} from "@kontourai/console-core/product-capability-descriptor";
import { resolveLocalProductExecutable } from "@kontourai/console-core/product-capability-descriptor/node";
import { compatibilityCatalog, type CatalogProductId, type DescriptorSource } from "./catalog";
import type { ProductRootOption } from "./command-line";
import { missingProductRemediation } from "./install-policy";

export const PRODUCT_DESCRIPTOR_ASSET = "product-capability-descriptor.json";

export interface DiscoveredProduct {
  readonly productId: CatalogProductId;
  readonly descriptor: ProductCapabilityDescriptor;
  readonly descriptorSource: DescriptorSource;
  readonly packageVersion: string | null;
  readonly candidate?: LocalProductPackageCandidate;
  readonly diagnostics: readonly ProductCapabilityDiagnostic[];
}

function malformed(productId: CatalogProductId, message: string): ProductCapabilityDiagnostic {
  return { code: "DESCRIPTOR_MALFORMED", severity: "error", productId, message };
}

function inertBins(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value === "string") return { kontour: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 32 || entries.some(([key, path]) => key.length > 128 || typeof path !== "string" || path.length > 4096)) return undefined;
  return Object.fromEntries(entries) as Readonly<Record<string, string>>;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8");
  if (text.length > 1024 * 1024) throw new Error("oversize");
  return JSON.parse(text) as unknown;
}

/** Inspect only caller-supplied roots. Invalid product descriptors fail closed. */
export async function discoverProducts(roots: readonly ProductRootOption[]): Promise<readonly DiscoveredProduct[]> {
  const rootById = new Map(roots.map((root) => [root.productId, root]));
  const products: DiscoveredProduct[] = [];
  for (const entry of compatibilityCatalog) {
    const productId = entry.descriptor.product.id as CatalogProductId;
    const explicit = rootById.get(productId);
    let descriptor = entry.descriptor;
    let descriptorSource: DescriptorSource = "compatibility-catalog";
    let candidate: LocalProductPackageCandidate | undefined;
    let packageVersion: string | null = null;
    const diagnostics: ProductCapabilityDiagnostic[] = [];
    if (explicit) {
      let manifest: unknown;
      try { manifest = await readJson(join(explicit.root, "package.json")); }
      catch { diagnostics.push(malformed(productId, "The explicit product package manifest is missing or malformed.")); }
      if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
        const record = manifest as Record<string, unknown>;
        const bins = inertBins(record.bin);
        if (record.name !== entry.descriptor.product.packageName || typeof record.version !== "string" || record.version.length > 128 || !bins) {
          diagnostics.push(malformed(productId, "The explicit product package identity or bin map is malformed."));
        } else {
          packageVersion = record.version;
          candidate = { root: explicit.root, packageName: record.name, bins };
        }
      }

      try {
        const owned = await readJson(join(explicit.root, PRODUCT_DESCRIPTOR_ASSET));
        // Presence establishes provenance even when validation fails. Keeping
        // this source prevents callers from presenting the catalog as fallback.
        descriptorSource = "product-package";
        const validated = validateProductCapabilityDescriptor(owned);
        if (!validated.ok) diagnostics.push(...validated.diagnostics);
        else if (validated.descriptor.product.id !== productId || validated.descriptor.product.packageName !== entry.descriptor.product.packageName) {
          diagnostics.push(malformed(productId, "The product-owned descriptor identity does not match the explicit product root."));
        } else {
          const negotiated = negotiateProductCapabilityDescriptors([validated.descriptor]);
          if (!negotiated.ok) diagnostics.push(...negotiated.diagnostics);
          else descriptor = negotiated.descriptors[0];
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          descriptorSource = "product-package";
          diagnostics.push(malformed(productId, "The product-owned descriptor asset is malformed."));
        }
      }
    }
    products.push({ productId, descriptor, descriptorSource, packageVersion, candidate, diagnostics });
  }
  return products;
}

export interface ResolvedDiscoveredExecutable {
  readonly executablePath: string;
  readonly argvPrefix: readonly string[];
}

export type DiscoveredExecutableResolution =
  | { readonly ok: true; readonly value: ResolvedDiscoveredExecutable }
  | { readonly ok: false; readonly diagnostics: readonly ProductCapabilityDiagnostic[] };

export async function resolveDiscoveredExecutable(product: DiscoveredProduct, executableId: string): Promise<DiscoveredExecutableResolution> {
  if (product.diagnostics.length > 0) return { ok: false, diagnostics: product.diagnostics };
  if (!product.candidate) {
    const executable = product.descriptor.executables.find((item) => item.id === executableId);
    const remediation = missingProductRemediation(
      product.productId,
      product.descriptor.product.packageName,
      executable?.packageBin ?? product.productId,
    );
    return { ok: false, diagnostics: [{
      code: "DESCRIPTOR_EXECUTABLE_MISSING",
      severity: "error",
      productId: product.productId,
      message: `The product is unavailable from an explicit local root. Install locally with '${remediation.localInstall}' or explicitly run '${remediation.oneShot} …'.`,
    }] };
  }
  const result = await resolveLocalProductExecutable(product.descriptor, executableId, [product.candidate]);
  return result.ok ? { ok: true, value: result.value } : { ok: false, diagnostics: result.diagnostics };
}
