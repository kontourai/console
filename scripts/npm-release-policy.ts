export interface ReleaseSelection { workspace: string; manifest: string; tagPrefix: string }

export function selectRelease(tag: string): ReleaseSelection {
  if (/^cli-v/.test(tag)) return { workspace: "@kontourai/cli", manifest: "cli/package.json", tagPrefix: "cli-v" };
  if (/^console-core-v/.test(tag)) return { workspace: "@kontourai/console-core", manifest: "console-core/package.json", tagPrefix: "console-core-v" };
  if (/^console-server-v/.test(tag)) return { workspace: "@kontourai/console-server", manifest: "console-server/package.json", tagPrefix: "console-server-v" };
  if (/^v/.test(tag)) return { workspace: ".", manifest: "package.json", tagPrefix: "v" };
  throw new Error(`Unsupported release tag ${tag}`);
}

export function assertTagVersion(tag: string, prefix: string, version: unknown): void {
  if (typeof version !== "string" || `${prefix}${version}` !== tag) throw new Error(`Tag ${tag} does not match package version ${prefix}${String(version)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// console#264: `npm view <pkg>@<exact-semver> --json` is not shape-stable
// across npm versions. The publish workflow installs `npm@latest` (required
// for OIDC trusted publishing — see publish-npm.yml), and that npm wraps the
// single-version manifest in a one-element array (empirically confirmed:
// npm 12.0.1 returns `[ { version, exports, versions: [...], ... } ]` for an
// exact-version query, where the bundled npm this repo used to run against
// returned the bare manifest object). Some npm/registry combinations may
// also return a full packument (`{ versions: { "<version>": {...} }, ... }`)
// rather than a single resolved manifest. Normalize all three shapes to the
// bare exact-version manifest object before policy assertions run, so the
// gate is robust to npm CLI drift instead of failing closed on shape alone.
export function resolveCoreRegistryManifest(spec: unknown, raw: unknown): unknown {
  if (Array.isArray(raw)) {
    if (raw.length !== 1) throw new Error(`Core registry metadata array must contain exactly one entry, got ${raw.length}`);
    return resolveCoreRegistryManifest(spec, raw[0]);
  }
  if (isPlainObject(raw) && isPlainObject(raw.versions) && typeof spec === "string" && Object.prototype.hasOwnProperty.call(raw.versions, spec)) {
    // Full packument shape: `.versions` maps every published version string to
    // its own manifest. Extract the exact version being verified.
    return raw.versions[spec];
  }
  return raw;
}

export function assertExactCoreMetadata(spec: unknown, metadata: unknown): void {
  if (typeof spec !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) throw new Error(`CLI Core dependency must be exact semver, got ${String(spec)}`);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Core registry metadata must be an object");
  const item = metadata as { version?: unknown; exports?: unknown };
  if (item.version !== spec) throw new Error(`Required Core ${spec} is not registry-visible`);
  if (!item.exports || typeof item.exports !== "object" || Array.isArray(item.exports)) throw new Error("Core registry metadata is missing exports");
  const exports = item.exports as Record<string, unknown>;
  if (!exports["./product-capability-descriptor"] || !exports["./product-capability-descriptor/node"])
    throw new Error("Core registry metadata is missing required descriptor exports");
  // console#232/C5's standalone runner (`@kontourai/cli`) loads
  // "@kontourai/console-core/intent-binding" at its own module-load time. A
  // released CLI must never be paired with a published Core that lacks it
  // (2026-07-20 security review, finding 4).
  if (!exports["./intent-binding"])
    throw new Error("Core registry metadata is missing the required intent-binding export");
}

if (require.main === module) {
  const [command, tag] = process.argv.slice(2);
  if (command !== "select" || !tag) throw new Error("Usage: npm-release-policy.ts select <tag>");
  const selected = selectRelease(tag);
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  require("node:fs").appendFileSync(output, `workspace=${selected.workspace}\nmanifest=${selected.manifest}\ntag_prefix=${selected.tagPrefix}\n`);
}
