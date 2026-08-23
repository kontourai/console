import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertExactCoreMetadata, resolveCoreRegistryManifest } from "./npm-release-policy";

// console#264 (Route A): this script's own file may be sourced from a fixed
// current-main checkout (`publish-npm.yml` runs it via a relative path into a
// `console-main` sibling checkout) so that policy fixes made after a tag was
// cut still apply to that tag's publish. The MANIFEST DATA it verifies stays
// tag-authoritative by resolving `root` from the process's working directory
// — the caller sets `working-directory` to the immutable tag checkout — never
// from this file's own on-disk location.
const root = process.cwd();
// Any package that pins @kontourai/console-core exactly runs this
// anti-drift gate. Currently only console-server: @kontourai/cli used to
// share this pin and this exact gate before it was extracted to its own
// kontourai/cli repository, which now carries its own copy. The manifest
// defaults to console-server's for backward compatibility; the publish
// workflow passes the resolved target manifest explicitly.
const manifestPath = process.env.PACKAGE_MANIFEST ?? "console-server/package.json";
const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8")) as { dependencies?: Record<string, unknown> };
const spec = manifest.dependencies?.["@kontourai/console-core"];
if (typeof spec !== "string") throw new Error(`${manifestPath} is missing Core dependency`);
const output = execFileSync("npm", ["view", `@kontourai/console-core@${spec}`, "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
assertExactCoreMetadata(spec, resolveCoreRegistryManifest(spec, JSON.parse(output)));
process.stdout.write(`Confirmed compatible @kontourai/console-core@${spec} on npm before ${manifestPath} publication.\n`);
