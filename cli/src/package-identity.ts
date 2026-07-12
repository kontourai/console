import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_PACKAGE_MANIFEST_BYTES = 1024 * 1024;

export interface CliPackageIdentity {
  readonly name: "@kontourai/cli";
  readonly version: string;
}

export function parseCliPackageIdentity(value: unknown): CliPackageIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("KONTOUR_CLI_PACKAGE_IDENTITY_INVALID: package manifest must be an object.");
  const manifest = value as Record<string, unknown>;
  if (manifest.name !== "@kontourai/cli") throw new Error("KONTOUR_CLI_PACKAGE_IDENTITY_INVALID: expected @kontourai/cli package manifest.");
  const versionMatch = typeof manifest.version === "string" ? EXACT_SEMVER.exec(manifest.version) : null;
  const invalidPrerelease = versionMatch?.[4]?.split(".").some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0"));
  if (!versionMatch || invalidPrerelease) throw new Error("KONTOUR_CLI_PACKAGE_IDENTITY_INVALID: package version must be exact semantic version.");
  return Object.freeze({ name: "@kontourai/cli", version: versionMatch[0] });
}

export function readCliPackageIdentityFile(manifestPath: string): CliPackageIdentity {
  if (typeof constants.O_NOFOLLOW !== "number") throw new Error("KONTOUR_CLI_PACKAGE_IDENTITY_INVALID: this platform cannot securely open the package manifest without following links.");
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(manifestPath, flags);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("package manifest is not a regular file");
    if (before.size > BigInt(MAX_PACKAGE_MANIFEST_BYTES)) throw new Error(`package manifest exceeds ${MAX_PACKAGE_MANIFEST_BYTES} bytes`);
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("package manifest changed or ended during read");
      offset += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error("package manifest changed during read");
    return parseCliPackageIdentity(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("KONTOUR_CLI_PACKAGE_IDENTITY_INVALID:")) throw error;
    throw new Error(`KONTOUR_CLI_PACKAGE_IDENTITY_INVALID: cannot securely read ${manifestPath}.`, { cause: error });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export const CLI_PACKAGE_IDENTITY = readCliPackageIdentityFile(resolve(__dirname, "../package.json"));
export const CLI_PACKAGE_VERSION = CLI_PACKAGE_IDENTITY.version;
