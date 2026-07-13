import type { CatalogProductId } from "./catalog";

const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export const EXACT_VERSION_PLACEHOLDER = "<exact-semver>" as const;

export type InstallPolicyDiagnosticCode =
  | "INSTALL_POLICY_INVALID_PACKAGE"
  | "INSTALL_POLICY_EXACT_VERSION_REQUIRED"
  | "INSTALL_POLICY_CONFLICT";

export interface InstallPolicyDiagnostic {
  readonly code: InstallPolicyDiagnosticCode;
  readonly message: string;
}

export interface ExactPackageSpec {
  readonly packageName: string;
  readonly version: string;
  readonly spec: string;
}

export type ExactPackageSpecResult =
  | { readonly ok: true; readonly value: ExactPackageSpec }
  | { readonly ok: false; readonly diagnostic: InstallPolicyDiagnostic };

function diagnostic(code: InstallPolicyDiagnosticCode, message: string): ExactPackageSpecResult {
  return { ok: false, diagnostic: { code, message } };
}

/**
 * Validate an npm package request without resolving it. Only a literal package
 * name plus an exact SemVer is accepted; tags, ranges and alternate sources
 * are rejected before any caller could hand the result to a package manager.
 */
export function validateExactPackageSpec(input: string, expectedPackageName?: string): ExactPackageSpecResult {
  if (input.length === 0 || input.length > 256 || /[\u0000-\u001f\u007f\s]/.test(input)) {
    return diagnostic("INSTALL_POLICY_EXACT_VERSION_REQUIRED", "Supply one package name with one exact semantic version.");
  }
  const separator = input.lastIndexOf("@");
  const packageName = input.slice(0, separator);
  const version = input.slice(separator + 1);
  if (separator <= 0 || !PACKAGE_NAME.test(packageName)) {
    return diagnostic("INSTALL_POLICY_INVALID_PACKAGE", "The package name is not an allowed npm package identity.");
  }
  if (expectedPackageName !== undefined && packageName !== expectedPackageName) {
    return diagnostic("INSTALL_POLICY_INVALID_PACKAGE", "The package identity does not match the selected product.");
  }
  if (!EXACT_SEMVER.test(version)) {
    return diagnostic("INSTALL_POLICY_EXACT_VERSION_REQUIRED", "Use an exact semantic version; tags, ranges and external sources are not allowed.");
  }
  return { ok: true, value: { packageName, version, spec: `${packageName}@${version}` } };
}

/** Validate a future explicit-download request. This module never executes it. */
export function validateExplicitDownloadSpecs(
  inputs: readonly string[],
  expectedPackageName: string,
): ExactPackageSpecResult {
  if (inputs.length !== 1) {
    return diagnostic("INSTALL_POLICY_CONFLICT", "Supply exactly one explicit package version for the selected product.");
  }
  return validateExactPackageSpec(inputs[0], expectedPackageName);
}

export interface MissingProductRemediation {
  readonly productId: CatalogProductId;
  readonly packageName: string;
  readonly localInstall: string;
  readonly oneShot: string;
  readonly mutates: false;
}

/**
 * Produce inert, copy-paste guidance. The placeholder deliberately forces the
 * operator to choose an exact version; ordinary routing never invokes npm/npx.
 */
export function missingProductRemediation(
  productId: CatalogProductId,
  packageName: string,
  packageBin: string,
  exactVersion: string = EXACT_VERSION_PLACEHOLDER,
): MissingProductRemediation {
  if (!PACKAGE_NAME.test(packageName) || !PACKAGE_NAME.test(packageBin)) {
    throw new TypeError("Product package metadata is not safe for remediation guidance.");
  }
  if (exactVersion !== EXACT_VERSION_PLACEHOLDER && !EXACT_SEMVER.test(exactVersion)) {
    throw new TypeError("Product package version is not safe for remediation guidance.");
  }
  const spec = `${packageName}@${exactVersion}`;
  return Object.freeze({
    productId,
    packageName,
    localInstall: `npm install --save-exact ${spec}`,
    oneShot: `npm exec --yes --package=${spec} -- ${packageBin}`,
    mutates: false as const,
  });
}
