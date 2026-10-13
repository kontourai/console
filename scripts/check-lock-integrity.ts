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

const platformAndOptionality = ["libc", "os", "cpu", "optional", "devOptional"] as const;
const resolution = ["integrity", "resolved"] as const;
const integrityStrength: Record<string, number> = { sha1: 1, sha256: 2, sha384: 3, sha512: 4 };

function versionChanged(next: Record<string, unknown>, prior: Record<string, unknown>): boolean {
  return typeof prior.version === "string" && typeof next.version === "string" && next.version !== prior.version;
}

function httpsOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    // Non-special schemes (git+ssh:, file:) report origin "null"; only an https registry origin is comparable.
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function strongestIntegrity(value: string): number {
  const ranks = value.trim().split(/\s+/).map((entry) => integrityStrength[entry.split("-", 1)[0]] ?? 0);
  return Math.max(0, ...ranks);
}

// A version bump of a path already on the base legitimately changes its tarball URL and hash. It may
// not move the tarball to another registry origin, drop either field, or weaken the hash algorithm.
function assertVersionBumpResolution(path: string, next: Record<string, unknown>, prior: Record<string, unknown>): void {
  for (const key of resolution) {
    assert.equal(typeof next[key], typeof prior[key], `${path} changed base ${key} metadata`);
  }
  if (typeof prior.resolved === "string") {
    const priorOrigin = httpsOrigin(prior.resolved);
    const nextOrigin = httpsOrigin(next.resolved as string);
    if (priorOrigin === undefined) {
      assert.equal(next.resolved, prior.resolved, `${path} changed base resolved metadata`);
    } else {
      assert.equal(nextOrigin, priorOrigin, `${path} changed base resolved registry origin on a version bump`);
    }
  }
  if (typeof prior.integrity === "string") {
    const nextIntegrity = next.integrity as string;
    assert.ok(
      strongestIntegrity(nextIntegrity) > 0 && strongestIntegrity(nextIntegrity) >= strongestIntegrity(prior.integrity),
      `${path} weakened base integrity algorithm on a version bump`,
    );
  }
}

export function validateLockIntegrity(current: Lockfile, base: Lockfile): void {
  for (const [path, prior] of Object.entries(base.packages)) {
    const next = current.packages[path];
    if (!next) continue;
    for (const key of platformAndOptionality) assert.deepEqual(next[key], prior[key], `${path} changed base ${key} metadata`);
    if (versionChanged(next, prior)) {
      assertVersionBumpResolution(path, next, prior);
    } else {
      for (const key of resolution) assert.deepEqual(next[key], prior[key], `${path} changed base ${key} metadata`);
    }
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
    process.stdout.write("Existing lock platform, optionality, resolution, and integrity metadata is preserved; resolution changes only with a same-origin version bump.\n");
  } catch (error) {
    process.stderr.write(`LOCK_INTEGRITY_CHECK_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
