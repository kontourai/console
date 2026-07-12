/** Node-only filesystem resolution for product capability descriptors. */

import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  ProductCapabilityDescriptor,
  ProductCapabilityDiagnostic,
  ProductExecutableResolutionResult,
  LocalProductPackageCandidate,
} from "./product-capability-descriptor";

const CONTROL = /[\u0000-\u001f\u007f]/;
const ENCODED_OCTET = /%[0-9a-f]{2}/i;
const WINDOWS_DRIVE = /^[a-z]:/i;

function safeRelativeExecutablePath(value: string): boolean {
  if (!value || value.length > 4096 || CONTROL.test(value) || ENCODED_OCTET.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\") || WINDOWS_DRIVE.test(value)) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function diagnostic(code: ProductCapabilityDiagnostic["code"], message: string, productId: string): ProductCapabilityDiagnostic {
  return { code, severity: "error", message, productId };
}

/** Resolve a package bin beneath explicit roots. No scan, execution, or network fallback occurs. */
export async function resolveLocalProductExecutable(
  descriptor: ProductCapabilityDescriptor,
  executableId: string,
  candidates: readonly LocalProductPackageCandidate[],
): Promise<ProductExecutableResolutionResult> {
  const declaration = descriptor.executables.find((entry) => entry.id === executableId);
  if (!declaration) {
    return { ok: false, diagnostics: [diagnostic("DESCRIPTOR_UNKNOWN_EXECUTABLE", "Requested executable is not declared.", descriptor.product.id)] };
  }
  for (const candidate of candidates) {
    if (candidate.packageName !== descriptor.product.packageName) continue;
    const bin = candidate.bins[declaration.packageBin];
    if (typeof bin !== "string") continue;
    if (!safeRelativeExecutablePath(bin)) continue;
    try {
      const root = await realpath(candidate.root);
      const target = resolve(root, bin);
      const lexical = relative(root, target);
      if (lexical.startsWith("..") || isAbsolute(lexical)) continue;
      const link = await lstat(target);
      if (!link.isFile() && !link.isSymbolicLink()) continue;
      const resolved = await realpath(target);
      const contained = relative(root, resolved);
      if (contained.startsWith("..") || isAbsolute(contained) || !(await stat(resolved)).isFile()) continue;
      return { ok: true, value: { executablePath: resolved, argvPrefix: declaration.argvPrefix ?? [] }, diagnostics: [] };
    } catch { /* A missing or unreadable candidate is simply not selected. */ }
  }
  return { ok: false, diagnostics: [diagnostic("DESCRIPTOR_EXECUTABLE_MISSING", `Executable '${declaration.packageBin}' was not found in supplied package roots.`, descriptor.product.id)] };
}
