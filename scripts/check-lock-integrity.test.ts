import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveLockIntegrityBaseRef } from "./check-lock-integrity";

const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => ![
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH",
].includes(key)));

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: gitEnvironment, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("detached checkout without origin/main accepts an explicit fetched base commit", () => {
  const root = mkdtempSync(join(tmpdir(), "lock-integrity-base-"));
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "fixture@example.test");
    git(root, "config", "user.name", "Fixture");
    writeFileSync(join(root, "package-lock.json"), '{"packages":{}}\n');
    git(root, "add", "package-lock.json");
    git(root, "commit", "-m", "base");
    const base = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, "package-lock.json"), '{"packages":{"":{"version":"1.0.0"}}}\n');
    git(root, "add", "package-lock.json");
    git(root, "commit", "-m", "head");
    git(root, "checkout", "--detach", "HEAD");
    assert.throws(() => git(root, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"));
    const runGit = (args: string[]) => git(root, ...args);
    assert.equal(resolveLockIntegrityBaseRef({ explicitBaseRef: base, git: runGit }), base);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing explicit and fallback base authority fails closed", () => {
  const root = mkdtempSync(join(tmpdir(), "lock-integrity-no-base-"));
  try {
    git(root, "init", "-b", "detached-fixture");
    writeFileSync(join(root, "package-lock.json"), '{"packages":{}}\n');
    const runGit = (args: string[]) => git(root, ...args);
    assert.throws(
      () => resolveLockIntegrityBaseRef({ git: runGit }),
      /base authority is unavailable; set KONTOUR_LOCK_INTEGRITY_BASE_REF/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The real entry point resolves the repository from its own location, so each case copies the
// unmodified script into a fixture repository whose origin/main holds the base lockfile.
const checkScript = resolve(__dirname, "check-lock-integrity.ts");
const repositoryRoot = resolve(__dirname, "..");
const uiPath = "node_modules/@kontourai/ui";
const baseUi = {
  version: "1.1.0",
  resolved: "https://registry.npmjs.org/@kontourai/ui/-/ui-1.1.0.tgz",
  integrity: "sha512-31x7g1P8RZ16ke/uhYdY2LKnDcihc8v+3kI1m2XyutTSKmowB6io/3n4T+dVqydDrrgDgIC0NqjmWof8mt9Yhw==",
  license: "Apache-2.0",
  engines: { node: ">=22" },
  peerDependencies: { react: "^19.0.0" },
};
const bumpedUi = {
  ...baseUi,
  version: "1.20.1",
  resolved: "https://registry.npmjs.org/@kontourai/ui/-/ui-1.20.1.tgz",
  integrity: "sha512-V3GHhEKMclbZ7dnw3kFgatCbuQIK1q3wjTLObfVxQB8pb3yOmdTtkZof0RZ3Qi6IVHQZ37EOIg6Lj65cgWFEJQ==",
};
const tamperedIntegrity = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

function lockfile(ui: Record<string, unknown>): string {
  return `${JSON.stringify({
    name: "console",
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "console", version: "0.0.0", workspaces: ["console-ui"] },
      "console-ui": { name: "@kontourai/console-ui", version: "0.0.0", dependencies: { "@kontourai/ui": "^1.1.0" } },
      "node_modules/@kontourai/console-ui": { resolved: "console-ui", link: true },
      [uiPath]: ui,
    },
  }, null, 2)}\n`;
}

function runCheck(currentUi: Record<string, unknown>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), "lock-integrity-entry-"));
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "fixture@example.test");
    git(root, "config", "user.name", "Fixture");
    writeFileSync(join(root, "package-lock.json"), lockfile(baseUi));
    git(root, "add", "package-lock.json");
    git(root, "commit", "-m", "base");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(root, "package-lock.json"), lockfile(currentUi));
    mkdirSync(join(root, "scripts"));
    copyFileSync(checkScript, join(root, "scripts", "check-lock-integrity.ts"));
    const env = { ...gitEnvironment };
    delete env.KONTOUR_LOCK_INTEGRITY_BASE_REF;
    // cwd stays in this repository so `--import tsx` resolves from its node_modules.
    const result = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts", "check-lock-integrity.ts")], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("entry point: an unchanged lockfile passes", () => {
  const result = runCheck(baseUi);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /integrity metadata is preserved/);
});

test("entry point: a version bump with the new registry integrity and resolved passes", () => {
  const result = runCheck(bumpedUi);
  assert.equal(result.status, 0, result.output);
});

test("entry point: a tampered integrity on an unchanged version fails", () => {
  const result = runCheck({ ...baseUi, integrity: tamperedIntegrity });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/@kontourai\/ui changed base integrity metadata/);
});

test("entry point: a resolved on a different host fails even with a version bump", () => {
  const result = runCheck({ ...bumpedUi, resolved: "https://registry.npmjs.org.attacker.example/@kontourai/ui/-/ui-1.20.1.tgz" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/@kontourai\/ui changed base resolved registry origin on a version bump/);
});

test("entry point: a tampered resolved on an unchanged version fails", () => {
  const result = runCheck({ ...baseUi, resolved: "https://registry.npmjs.org/@kontourai/ui/-/ui-1.20.1.tgz" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/@kontourai\/ui changed base resolved metadata/);
});

test("entry point: a version bump may not drop integrity or weaken its algorithm", () => {
  const { integrity: _dropped, ...withoutIntegrity } = bumpedUi;
  const dropped = runCheck(withoutIntegrity);
  assert.equal(dropped.status, 1, dropped.output);
  assert.match(dropped.output, /node_modules\/@kontourai\/ui changed base integrity metadata/);
  const weakened = runCheck({ ...bumpedUi, integrity: "sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=" });
  assert.equal(weakened.status, 1, weakened.output);
  assert.match(weakened.output, /node_modules\/@kontourai\/ui weakened base integrity algorithm on a version bump/);
});

test("entry point: a version bump still may not change platform or optionality metadata", () => {
  const result = runCheck({ ...bumpedUi, optional: true });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /node_modules\/@kontourai\/ui changed base optional metadata/);
});
