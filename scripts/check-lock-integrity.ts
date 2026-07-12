import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Lockfile = { packages: Record<string, Record<string, unknown>> };
type Git = (args: string[]) => string;

const repositoryRoot = resolve(__dirname, "..");

function repositoryGit(root: string): Git {
  return (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function resolveLockIntegrityBaseRef(options: { explicitBaseRef?: string; git: Git }): string {
  const explicit = options.explicitBaseRef?.trim();
  const candidates = explicit ? [explicit] : ["refs/remotes/origin/main"];
  for (const candidate of candidates) {
    try {
      options.git(["rev-parse", "--verify", `${candidate}^{commit}`]);
      options.git(["show", `${candidate}:package-lock.json`]);
      return candidate;
    } catch {
      // The next candidate, when present, must independently prove its authority.
    }
  }
  if (explicit) throw new Error(`explicit lock-integrity base ref is unavailable or lacks package-lock.json: ${explicit}`);
  throw new Error("lock-integrity base authority is unavailable; set KONTOUR_LOCK_INTEGRITY_BASE_REF to a fetched base commit SHA/ref");
}

export function validateLockIntegrity(current: Lockfile, base: Lockfile): void {
  const sensitive = ["libc", "os", "cpu", "optional", "devOptional", "integrity", "resolved"];
  for (const [path, prior] of Object.entries(base.packages)) {
    const next = current.packages[path];
    if (!next) continue;
    for (const key of sensitive) assert.deepEqual(next[key], prior[key], `${path} changed base ${key} metadata`);
  }
}

export function checkLockIntegrity(root = repositoryRoot, explicitBaseRef = process.env.KONTOUR_LOCK_INTEGRITY_BASE_REF): void {
  const git = repositoryGit(root);
  const baseRef = resolveLockIntegrityBaseRef({ explicitBaseRef, git });
  const current = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")) as Lockfile;
  const base = JSON.parse(git(["show", `${baseRef}:package-lock.json`])) as Lockfile;
  validateLockIntegrity(current, base);
}

if (require.main === module) {
  try {
    checkLockIntegrity();
    process.stdout.write("Existing lock platform, optionality, resolution, and integrity metadata is preserved.\n");
  } catch (error) {
    process.stderr.write(`LOCK_INTEGRITY_CHECK_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
