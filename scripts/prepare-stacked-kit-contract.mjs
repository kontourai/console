import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageRoot = "node_modules/@kontourai/flow-agents";
const contract = `${packageRoot}/build/src/kit-observability-contract.js`;
const conformance = `${packageRoot}/build/src/kit-observability-conformance.js`;

if (existsSync(contract) && existsSync(conformance)) process.exit(0);
if (!existsSync(`${packageRoot}/package.json`)) {
  // Production installs may omit the root-only stacked dev dependency. The
  // Console Server peer is optional until an operator enables Kit hosting.
  console.log("Pinned Flow Agents development package is absent; skipping stacked Kit contract preparation.");
  process.exit(0);
}

const result = spawnSync("npm", ["run", "build", "--prefix", packageRoot, "--silent"], {
  stdio: "inherit",
  shell: false,
});
if (result.status !== 0 || !existsSync(contract) || !existsSync(conformance)) {
  console.error("Pinned Flow Agents commit did not produce the public Kit observability package subpaths.");
  process.exit(result.status || 1);
}
