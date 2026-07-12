import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertExactCoreMetadata } from "./npm-release-policy";

const root = resolve(__dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "cli/package.json"), "utf8")) as { dependencies?: Record<string, unknown> };
const spec = manifest.dependencies?.["@kontourai/console-core"];
if (typeof spec !== "string") throw new Error("CLI manifest is missing Core dependency");
const output = execFileSync("npm", ["view", `@kontourai/console-core@${spec}`, "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
assertExactCoreMetadata(spec, JSON.parse(output));
process.stdout.write(`Confirmed compatible @kontourai/console-core@${spec} on npm before CLI publication.\n`);
