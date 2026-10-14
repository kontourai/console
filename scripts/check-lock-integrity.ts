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

// Reviewed transitions that the rules above would otherwise reject. Each entry names one
// lock path and the exact base -> next value, in one direction. Every other field on that path is
// still checked. An entry stays live after its transition reaches the base: it admits the same
// change again only if the base first returns to the entry's from value.

type Optionality = "optional" | "devOptional";
type OptionalityRecomputation = { path: string; key: Optionality; from: true | undefined; to: true | undefined };

// npm 11 recomputes these flags on any install against this base. An untouched origin/main gives the
// same set with `npm install --package-lock-only`. None of them changes a version, tarball or hash.
export const reviewedOptionalityRecomputations: readonly OptionalityRecomputation[] = [
  { path: "node_modules/@types/react", key: "devOptional", from: true, to: undefined },
  { path: "node_modules/@types/react-dom", key: "devOptional", from: true, to: undefined },
  { path: "node_modules/csstype", key: "devOptional", from: true, to: undefined },
  { path: "node_modules/tslib", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/typescript", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/agent-base", key: "optional", from: true, to: undefined },
  { path: "node_modules/agent-base", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/http-proxy-agent", key: "optional", from: true, to: undefined },
  { path: "node_modules/http-proxy-agent", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/https-proxy-agent", key: "optional", from: true, to: undefined },
  { path: "node_modules/https-proxy-agent", key: "devOptional", from: undefined, to: true },
  // Adding @kontourai/veritas 1.11.2 also reaches these through a dev dependency, so they are no
  // longer optional-only.
  { path: "node_modules/iconv-lite", key: "optional", from: true, to: undefined },
  { path: "node_modules/iconv-lite", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/ip-address", key: "optional", from: true, to: undefined },
  { path: "node_modules/ip-address", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/negotiator", key: "optional", from: true, to: undefined },
  { path: "node_modules/negotiator", key: "devOptional", from: undefined, to: true },
  { path: "node_modules/safer-buffer", key: "optional", from: true, to: undefined },
  { path: "node_modules/safer-buffer", key: "devOptional", from: undefined, to: true },
];

// A registry version is spliced into the expected tarball URL, so it must not carry path or query text.
const plainSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type LinkToRegistry = { path: string; linkResolved: string; tarballPrefix: string };

// A sibling-checkout link replaced by the published package (console#292). A link entry has no
// version or integrity, so the version-bump rule cannot apply to it.
export const reviewedLinkToRegistry: readonly LinkToRegistry[] = [
  {
    path: "node_modules/@kontourai/survey",
    linkResolved: "../survey",
    tarballPrefix: "https://registry.npmjs.org/@kontourai/survey/-/survey-",
  },
];

function isReviewedRecomputation(path: string, key: string, prior: unknown, next: unknown): boolean {
  return reviewedOptionalityRecomputations.some(
    (entry) => entry.path === path && entry.key === key && entry.from === prior && entry.to === next,
  );
}

function reviewedLinkFor(path: string, prior: Record<string, unknown>): LinkToRegistry | undefined {
  const entry = reviewedLinkToRegistry.find((candidate) => candidate.path === path);
  if (!entry || prior.link !== true || prior.resolved !== entry.linkResolved || prior.integrity !== undefined) return undefined;
  return entry;
}

function assertLinkToRegistryResolution(path: string, next: Record<string, unknown>, entry: LinkToRegistry): void {
  assert.equal(next.link, undefined, `${path} must stop being a link to move to the registry`);
  assert.equal(typeof next.version, "string", `${path} registry entry has no version`);
  assert.match(next.version as string, plainSemver, `${path} registry version is not a plain semver version`);
  assert.equal(next.resolved, `${entry.tarballPrefix}${next.version as string}.tgz`, `${path} changed base resolved metadata`);
  assert.ok(
    typeof next.integrity === "string" && strongestIntegrity(next.integrity) === integrityStrength.sha512,
    `${path} registry entry needs sha512 integrity`,
  );
}

export function validateLockIntegrity(current: Lockfile, base: Lockfile): void {
  for (const [path, prior] of Object.entries(base.packages)) {
    const next = current.packages[path];
    if (!next) continue;
    for (const key of platformAndOptionality) {
      if (isReviewedRecomputation(path, key, prior[key], next[key])) continue;
      assert.deepEqual(next[key], prior[key], `${path} changed base ${key} metadata`);
    }
    const reviewedLink = reviewedLinkFor(path, prior);
    if (reviewedLink) {
      assertLinkToRegistryResolution(path, next, reviewedLink);
    } else if (versionChanged(next, prior)) {
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
    process.stdout.write("Existing lock platform, optionality, resolution, and integrity metadata is preserved; resolution changes only with a same-origin version bump or a reviewed transition.\n");
  } catch (error) {
    process.stderr.write(`LOCK_INTEGRITY_CHECK_FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
