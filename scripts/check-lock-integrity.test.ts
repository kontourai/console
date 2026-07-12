import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
