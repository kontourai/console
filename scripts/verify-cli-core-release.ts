import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertExactCoreMetadata } from "./npm-release-policy";

const root = resolve(__dirname, "..");
// Any package that pins @kontourai/console-core exactly (CLI, console-server)
// runs this anti-drift gate. The manifest defaults to the CLI for backward
// compatibility; the publish workflow passes the resolved target manifest.
const manifestPath = process.env.PACKAGE_MANIFEST ?? "cli/package.json";
const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8")) as { dependencies?: Record<string, unknown> };
const spec = manifest.dependencies?.["@kontourai/console-core"];
if (typeof spec !== "string") throw new Error(`${manifestPath} is missing Core dependency`);
const output = execFileSync("npm", ["view", `@kontourai/console-core@${spec}`, "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
assertExactCoreMetadata(spec, JSON.parse(output));
process.stdout.write(`Confirmed compatible @kontourai/console-core@${spec} on npm before ${manifestPath} publication.\n`);
