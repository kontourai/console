import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const checker = join(__dirname, "check-content-boundary.ts");
// Resolved here because the child runs from a temp repo with no node_modules.
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;

// Built by concatenation so this file does not trip the gate it tests.
const macHome = "/" + "Users" + "/somebody/dev/project";
const linuxHome = "/" + "home" + "/somebody/dev/project";
const placeholderHome = "/" + "home" + "/me/dev/project";

function runCheckerInRepo(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), "content-boundary-"));
  try {
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    git("init", "-q");
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(repo, name), content);
    }
    git("add", ".");
    // The checker scans the git repo at its cwd, so run it from the fixture repo.
    return spawnSync(process.execPath, ["--import", tsxLoader, checker], {
      cwd: repo,
      encoding: "utf8",
    });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("content boundary rejects a tracked macOS home directory path", () => {
  const result = runCheckerInRepo({ "spec.ts": `const cwd = "${macHome}";\n` });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /spec\.ts:1 machine-specific absolute home directory path/);
});

test("content boundary rejects a tracked Linux home directory path", () => {
  const result = runCheckerInRepo({ "script.ts": `\nimport("${linuxHome}/index.mjs");\n` });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /script\.ts:2 machine-specific absolute home directory path/);
});

test("content boundary allows placeholder home paths used by path-parsing fixtures", () => {
  const result = runCheckerInRepo({ "fixture.ts": `parse("${placeholderHome}");\n` });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Content boundary check passed\./);
});
