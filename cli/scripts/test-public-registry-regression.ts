import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "kontour-public-regression-"));
try {
  const project = join(root, "project");
  mkdirSync(project);
  execFileSync("npm", ["init", "-y"], { cwd: project, stdio: "ignore" });
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "@kontourai/cli@0.3.0", "@kontourai/console-core@0.1.0"], {
    cwd: project, stdio: "ignore", env: { ...process.env, npm_config_cache: join(root, "cache") },
  });
  const core = JSON.parse(readFileSync(join(project, "node_modules/@kontourai/console-core/package.json"), "utf8")) as { exports: Record<string, unknown> };
  assert.equal(core.exports["./product-capability-descriptor"], undefined);
  assert.equal(core.exports["./product-capability-descriptor/node"], undefined);
  const result = spawnSync(join(project, "node_modules/.bin/kontour"), ["--help"], { cwd: project, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  assert.notEqual(result.status, 0, "known-bad public pair unexpectedly started");
  assert.match(`${result.stdout}${result.stderr}`, /ERR_PACKAGE_PATH_NOT_EXPORTED|Package subpath '.\/product-capability-descriptor'/);
  process.stdout.write("RED regression confirmed: public CLI 0.3.0 with Core 0.1.0 fails at the missing descriptor export.\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
