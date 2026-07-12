import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(__dirname, "../..");
const legacyBin = path.join(workspaceRoot, "console-server/bin/kontour.ts");

function runLegacy(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", legacyBin, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }
  });
}

test("legacy Console help preserves kontour serve and names its suite-router migration", () => {
  for (const args of [["--help"], ["serve", "--help"]]) {
    const result = runLegacy(...args);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Usage: kontour serve /m);
    assert.match(result.stderr, /install @kontourai\/cli/);
    assert.match(result.stderr, /`kontour console serve`/);
    assert.match(result.stderr, /will not be removed before Console 3\.0/);
  }
});
