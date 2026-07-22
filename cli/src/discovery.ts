import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve, sep } from "node:path";
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
  readonly candidateSource?: "explicit-product-root" | "installed-package";
  readonly compatiblePackageVersion: string;
  readonly diagnostics: readonly ProductCapabilityDiagnostic[];
}

function malformed(productId: CatalogProductId, message: string): ProductCapabilityDiagnostic {
  return { code: "DESCRIPTOR_MALFORMED", severity: "error", productId, message };
}

/**
 * Parse a package manifest's `bin` field into a bounded, closed map.
 * Exported (also used by `./standalone-runner`, console#232/C5's TOCTOU and
 * forged-candidate hardening — see the 2026-07-20 security review) so both
 * modules derive candidate identity from the SAME bounded parser instead of
 * trusting caller-supplied `bins`/`packageName` metadata.
 */
export function inertBins(value: unknown): Readonly<Record<string, string>> | undefined {
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

/**
 * Read a JSON file that must resolve to a real, non-symlinked file strictly
 * beneath `root`. Exported for `./standalone-runner`'s own manifest reads
 * (see `inertBins` above) — the same containment discipline this module
 * already applies to a product's own `package.json`.
 */
export async function readBoundJson(root: string, name: string): Promise<unknown> {
  const path = join(root, name);
  const status = await lstat(path);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("unsafe package metadata");
  const canonical = await realpath(path);
  const rel = relative(root, canonical);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || resolve(path) !== canonical) throw new Error("unsafe package metadata");
  return readJson(canonical);
}

export interface ProductDiscoveryOptions {
  /** Absolute file used as the normal Node package-resolution anchor. */
  readonly resolutionBase?: string;
}

type InstalledRootResult = { readonly root: string } | { readonly diagnostic: string } | undefined;

async function installedModulesRoot(resolutionBase: string): Promise<string | undefined> {
  let directory: string;
  try { directory = await realpath(dirname(resolve(resolutionBase))); }
  catch { return undefined; }
  const filesystemRoot = parse(directory).root;
  while (directory !== filesystemRoot) {
    const scope = dirname(directory);
    const modules = dirname(scope);
    if (basename(directory) === "cli" && basename(scope) === "@kontourai" && basename(modules) === "node_modules") {
      try {
        const [cliStatus, canonicalCli, canonicalModules, manifest] = await Promise.all([
          lstat(directory), realpath(directory), realpath(modules), readBoundJson(directory, "package.json"),
        ]);
        if (!cliStatus.isDirectory() || cliStatus.isSymbolicLink() || canonicalCli !== resolve(directory) || canonicalModules !== resolve(modules)) return undefined;
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || (manifest as Record<string, unknown>).name !== "@kontourai/cli") return undefined;
        return canonicalModules;
      } catch { return undefined; }
    }
    directory = dirname(directory);
  }
  return undefined;
}

async function resolvedInstalledPackageRoot(packageName: string, resolutionBase: string): Promise<InstalledRootResult> {
  const modules = await installedModulesRoot(resolutionBase);
  if (!modules) return undefined;
  const lexicalRoot = join(modules, ...packageName.split("/"));
  try {
    const status = await lstat(lexicalRoot);
    if (!status.isDirectory() || status.isSymbolicLink()) return { diagnostic: "The installed product package root is not a canonical package directory." };
    const canonicalRoot = await realpath(lexicalRoot);
    if (canonicalRoot !== resolve(lexicalRoot)) return { diagnostic: "The installed product package root escapes the CLI installation graph." };
    await readBoundJson(canonicalRoot, "package.json");
    return { root: canonicalRoot };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { diagnostic: "The installed product package manifest is not a canonical package file." };
  }
}

/** Resolve explicit roots first, then sibling packages from the installed CLI graph. */
export async function discoverProducts(
  roots: readonly ProductRootOption[],
  options: ProductDiscoveryOptions = {},
): Promise<readonly DiscoveredProduct[]> {
  const rootById = new Map(roots.map((root) => [root.productId, root]));
  const products: DiscoveredProduct[] = [];
  for (const entry of compatibilityCatalog) {
    const productId = entry.descriptor.product.id as CatalogProductId;
    const explicit = rootById.get(productId);
    const installed = explicit ? undefined : await resolvedInstalledPackageRoot(
      entry.descriptor.product.packageName,
      options.resolutionBase ?? __filename,
    );
    let packageRoot: string | undefined;
    if (explicit) {
      try { packageRoot = await realpath(explicit.root); }
      catch { packageRoot = explicit.root; }
    } else if (installed && "root" in installed) packageRoot = installed.root;
    let descriptor = entry.descriptor;
    let descriptorSource: DescriptorSource = "compatibility-catalog";
    let candidate: LocalProductPackageCandidate | undefined;
    const candidateSource = explicit ? "explicit-product-root" as const : packageRoot ? "installed-package" as const : undefined;
    let packageVersion: string | null = null;
    const diagnostics: ProductCapabilityDiagnostic[] = [];
    if (installed && "diagnostic" in installed) diagnostics.push(malformed(productId, installed.diagnostic));
    if (packageRoot) {
      let manifest: unknown;
      try { manifest = await readBoundJson(packageRoot, "package.json"); }
      catch { diagnostics.push(malformed(productId, `${explicit ? "The explicit" : "The installed"} product package manifest is missing or malformed.`)); }
      if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
        const record = manifest as Record<string, unknown>;
        const bins = inertBins(record.bin);
        if (record.name !== entry.descriptor.product.packageName || typeof record.version !== "string" || record.version.length > 128 || !bins) {
          diagnostics.push(malformed(productId, "The explicit product package identity or bin map is malformed."));
        } else {
          packageVersion = record.version;
          candidate = { root: packageRoot, packageName: record.name, bins };
          if (record.version !== entry.packageVersion) diagnostics.push(malformed(productId, `Expected ${record.name}@${entry.packageVersion}.`));
        }
      }

      try {
        const owned = await readBoundJson(packageRoot, PRODUCT_DESCRIPTOR_ASSET);
        // Presence establishes provenance even when validation fails. Keeping
        // this source prevents callers from presenting the catalog as fallback.
        descriptorSource = "product-package";
        const validated = validateProductCapabilityDescriptor(owned);
        if (!validated.ok) diagnostics.push(...validated.diagnostics);
        else if (validated.descriptor.product.id !== productId || validated.descriptor.product.packageName !== entry.descriptor.product.packageName) {
          diagnostics.push(malformed(productId, "The product-owned descriptor identity does not match the resolved product package."));
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
    products.push({ productId, descriptor, descriptorSource, packageVersion, candidate, candidateSource, compatiblePackageVersion: entry.packageVersion, diagnostics });
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
      product.compatiblePackageVersion,
    );
    return { ok: false, diagnostics: [{
      code: "DESCRIPTOR_EXECUTABLE_MISSING",
      severity: "error",
      productId: product.productId,
      message: `The product package is unavailable. Install locally with '${remediation.localInstall}' or explicitly run '${remediation.oneShot} …'.`,
    }] };
  }
  const result = await resolveLocalProductExecutable(product.descriptor, executableId, [product.candidate]);
  return result.ok ? { ok: true, value: result.value } : { ok: false, diagnostics: result.diagnostics };
}
