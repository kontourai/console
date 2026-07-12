export interface ReleaseSelection { workspace: string; manifest: string; tagPrefix: string }

export function selectRelease(tag: string): ReleaseSelection {
  if (/^cli-v/.test(tag)) return { workspace: "@kontourai/cli", manifest: "cli/package.json", tagPrefix: "cli-v" };
  if (/^console-core-v/.test(tag)) return { workspace: "@kontourai/console-core", manifest: "console-core/package.json", tagPrefix: "console-core-v" };
  if (/^v/.test(tag)) return { workspace: ".", manifest: "package.json", tagPrefix: "v" };
  throw new Error(`Unsupported release tag ${tag}`);
}

export function assertTagVersion(tag: string, prefix: string, version: unknown): void {
  if (typeof version !== "string" || `${prefix}${version}` !== tag) throw new Error(`Tag ${tag} does not match package version ${prefix}${String(version)}`);
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
}

if (require.main === module) {
  const [command, tag] = process.argv.slice(2);
  if (command !== "select" || !tag) throw new Error("Usage: npm-release-policy.ts select <tag>");
  const selected = selectRelease(tag);
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  require("node:fs").appendFileSync(output, `workspace=${selected.workspace}\nmanifest=${selected.manifest}\ntag_prefix=${selected.tagPrefix}\n`);
}
