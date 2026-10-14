import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveLockIntegrityBaseRef, reviewedLinkToRegistry, reviewedOptionalityRecomputations } from "./check-lock-integrity";

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

type Packages = Record<string, Record<string, unknown>>;

function lockfile(ui: Record<string, unknown>, extra: Packages = {}): string {
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
      ...extra,
    },
  }, null, 2)}\n`;
}

function runCheck(currentUi: Record<string, unknown>): { status: number | null; output: string } {
  return runCheckLocks(lockfile(baseUi), lockfile(currentUi));
}

function runCheckLocks(baseLock: string, currentLock: string): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), "lock-integrity-entry-"));
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "fixture@example.test");
    git(root, "config", "user.name", "Fixture");
    writeFileSync(join(root, "package-lock.json"), baseLock);
    git(root, "add", "package-lock.json");
    git(root, "commit", "-m", "base");
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(root, "package-lock.json"), currentLock);
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

// Reviewed transitions. Fixtures copy the shape npm wrote for these paths on the base lock.
const surveyPath = "node_modules/@kontourai/survey";
const linkedSurvey = { resolved: "../survey", link: true };
const publishedSurvey = {
  version: "8.2.0",
  resolved: "https://registry.npmjs.org/@kontourai/survey/-/survey-8.2.0.tgz",
  integrity: "sha512-7bDjdLKxR38POHumHzQXRS7nu6Ftu0nbwpCsnkEvOYL/xd8i8np94x+V3ftsd8tt4ZvNjbhdlf1tjZzFu8QfVQ==",
  dev: true,
  license: "Apache-2.0",
};

function runSurveyCheck(current: Record<string, unknown>, path = surveyPath, base: Record<string, unknown> = linkedSurvey) {
  return runCheckLocks(lockfile(baseUi, { [path]: base }), lockfile(baseUi, { [path]: current }));
}

test("entry point: the reviewed survey link may move to its published registry tarball", () => {
  const result = runSurveyCheck(publishedSurvey);
  assert.equal(result.status, 0, result.output);
});

test("entry point: the reviewed survey link may not move to another host", () => {
  const result = runSurveyCheck({ ...publishedSurvey, resolved: "https://registry.npmjs.org.attacker.example/@kontourai/survey/-/survey-8.2.0.tgz" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/@kontourai\/survey changed base resolved metadata/);
});

test("entry point: the reviewed survey link needs sha512 integrity on the registry entry", () => {
  const { integrity: _dropped, ...withoutIntegrity } = publishedSurvey;
  const dropped = runSurveyCheck(withoutIntegrity);
  assert.equal(dropped.status, 1, dropped.output);
  assert.match(dropped.output, /node_modules\/@kontourai\/survey registry entry needs sha512 integrity/);
  const weakened = runSurveyCheck({ ...publishedSurvey, integrity: "sha1-2jmj7l5rSw0yVb/vlWAYkK/YBwk=" });
  assert.equal(weakened.status, 1, weakened.output);
  assert.match(weakened.output, /node_modules\/@kontourai\/survey registry entry needs sha512 integrity/);
});

test("entry point: the reviewed survey path may not swap its link for another one", () => {
  const result = runSurveyCheck({ resolved: "../elsewhere", link: true });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /node_modules\/@kontourai\/survey must stop being a link/);
});

test("entry point: an unreviewed link still may not move to the registry", () => {
  const otherPath = "node_modules/@kontourai/other";
  const result = runSurveyCheck(
    { ...publishedSurvey, resolved: "https://registry.npmjs.org/@kontourai/other/-/other-8.2.0.tgz" },
    otherPath,
    { resolved: "../other", link: true },
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/@kontourai\/other changed base integrity metadata/);
});

const optionalityBase: Packages = {
  "node_modules/@types/react": {
    version: "19.2.17",
    resolved: "https://registry.npmjs.org/@types/react/-/react-19.2.17.tgz",
    integrity: "sha512-MXfmqaVPEVgkBT/aY0aGCkRWWtByiYQXo3xdQ8r5RzuFrPiRn8Gar2tQdXSUQ2GKV3bkXckek89V8wQBY2Q/Aw==",
    dev: true,
    license: "MIT",
    devOptional: true,
  },
  "node_modules/agent-base": {
    version: "7.1.4",
    resolved: "https://registry.npmjs.org/agent-base/-/agent-base-7.1.4.tgz",
    integrity: "sha512-MnA+YT8fwfJPgBx3m60MNqakm30XOkyIoH1y6huTQvC0PwZG7ki8NacLBcrPbNoo8vEZy7Jpuk7+jMO+CUovTQ==",
    license: "MIT",
    optional: true,
  },
  "node_modules/typescript": {
    version: "6.0.3",
    resolved: "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
    integrity: "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
    license: "Apache-2.0",
  },
};

function recomputed(overrides: Packages): Packages {
  return Object.fromEntries(Object.entries(optionalityBase).map(([path, entry]) => [path, overrides[path] ?? entry]));
}

const { devOptional: _reactDevOptional, ...reactWithoutDevOptional } = optionalityBase["node_modules/@types/react"];
const { optional: _agentOptional, ...agentWithoutOptional } = optionalityBase["node_modules/agent-base"];
const npmRecomputed = recomputed({
  "node_modules/@types/react": reactWithoutDevOptional,
  "node_modules/agent-base": { ...agentWithoutOptional, devOptional: true },
  "node_modules/typescript": { ...optionalityBase["node_modules/typescript"], devOptional: true },
});

test("entry point: the reviewed npm optionality recomputations pass", () => {
  const result = runCheckLocks(lockfile(baseUi, optionalityBase), lockfile(baseUi, npmRecomputed));
  assert.equal(result.status, 0, result.output);
});

test("entry point: a reviewed optionality recomputation is one-directional", () => {
  const base = recomputed({ "node_modules/typescript": { ...optionalityBase["node_modules/typescript"], devOptional: true } });
  const result = runCheckLocks(lockfile(baseUi, base), lockfile(baseUi, optionalityBase));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/typescript changed base devOptional metadata/);
});

test("entry point: a reviewed path still may not change an unlisted flag", () => {
  const current = recomputed({ "node_modules/typescript": { ...optionalityBase["node_modules/typescript"], optional: true } });
  const result = runCheckLocks(lockfile(baseUi, optionalityBase), lockfile(baseUi, current));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /LOCK_INTEGRITY_CHECK_FAILED: node_modules\/typescript changed base optional metadata/);
});

test("the reviewed transition lists stay exactly as reviewed", () => {
  assert.deepEqual(reviewedLinkToRegistry, [
    { path: "node_modules/@kontourai/survey", linkResolved: "../survey", tarballPrefix: "https://registry.npmjs.org/@kontourai/survey/-/survey-" },
  ]);
  assert.deepEqual(reviewedOptionalityRecomputations.map(({ path, key, from, to }) => `${path} ${key} ${String(from)}->${String(to)}`), [
    "node_modules/@types/react devOptional true->undefined",
    "node_modules/@types/react-dom devOptional true->undefined",
    "node_modules/csstype devOptional true->undefined",
    "node_modules/tslib devOptional undefined->true",
    "node_modules/typescript devOptional undefined->true",
    "node_modules/agent-base optional true->undefined",
    "node_modules/agent-base devOptional undefined->true",
    "node_modules/http-proxy-agent optional true->undefined",
    "node_modules/http-proxy-agent devOptional undefined->true",
    "node_modules/https-proxy-agent optional true->undefined",
    "node_modules/https-proxy-agent devOptional undefined->true",
  ]);
});
