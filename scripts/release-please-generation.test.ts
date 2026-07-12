import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalGitHub } = require("release-please/build/src/local-github.js") as typeof import("release-please/build/src/local-github.js");
const { Manifest } = require("release-please/build/src/manifest.js") as typeof import("release-please/build/src/manifest.js");

type Baseline = { root: string; cli: string; core: string; server: string };
const repositoryRoot = join(__dirname, "..");
const releaseConfig = readFileSync(join(repositoryRoot, "release-please-config.json"), "utf8");
const loadedManifest = JSON.parse(readFileSync(join(repositoryRoot, ".release-please-manifest.json"), "utf8")) as Record<string, string>;
const loadedPackages = {
  root: JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as { version: string },
  cli: JSON.parse(readFileSync(join(repositoryRoot, "cli/package.json"), "utf8")) as { version: string },
  core: JSON.parse(readFileSync(join(repositoryRoot, "console-core/package.json"), "utf8")) as { version: string },
  server: JSON.parse(readFileSync(join(repositoryRoot, "console-server/package.json"), "utf8")) as { version: string },
};
const loadedBaseline: Baseline = { root: loadedManifest["."], cli: loadedManifest.cli, core: loadedManifest["console-core"], server: loadedPackages.server.version };
assert.deepEqual(loadedBaseline, { root: loadedPackages.root.version, cli: loadedPackages.cli.version, core: loadedPackages.core.version, server: loadedPackages.server.version });

function parts(version: string): [number, number, number] {
  const parsed = version.split(".").map(Number);
  assert.equal(parsed.length, 3, `fixture baseline must be stable semver: ${version}`);
  assert.ok(parsed.every(Number.isSafeInteger), `fixture baseline must be stable semver: ${version}`);
  return parsed as [number, number, number];
}
function patchVersion(version: string): string { const [major, minor, patch] = parts(version); return `${major}.${minor}.${patch + 1}`; }
function featureVersion(version: string): string { const [major, minor] = parts(version); return `${major}.${minor + 1}.0`; }
function breakingVersion(version: string): string { const [major] = parts(version); return `${major + 1}.0.0`; }
function candidateFor(baseline: Baseline): Baseline {
  return { root: patchVersion(baseline.root), cli: patchVersion(baseline.cli), core: featureVersion(baseline.core), server: baseline.server };
}

const isolatedMarker = "KONTOUR_RELEASE_PLEASE_FIXTURE_ISOLATED";
const isolatedKeys = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH", "NODE_TEST_CONTEXT"]);
function isolatedEnvironment(): NodeJS.ProcessEnv { return Object.fromEntries(Object.entries(process.env).filter(([key]) => !isolatedKeys.has(key))); }
function git(root: string, ...args: string[]): string { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function put(root: string, path: string, value: unknown): void { const target = join(root, path); mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); }

async function buildFixture(baseline: Baseline, includeCoreRelease: boolean) {
  const root = mkdtempSync(join(tmpdir(), "release-please-manifest-"));
  try {
    git(root, "init", "-b", "main"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "user.name", "Fixture");
    put(root, "package.json", { name: "@kontourai/console", version: baseline.root, workspaces: ["cli", "console-core", "console-server"], dependencies: { "@kontourai/console-core": baseline.core } });
    put(root, "cli/package.json", { name: "@kontourai/cli", version: baseline.cli, dependencies: { "@kontourai/console-core": baseline.core } });
    put(root, "console-core/package.json", { name: "@kontourai/console-core", version: baseline.core });
    put(root, "console-server/package.json", { name: "@kontourai/console-server", version: baseline.server, private: true, dependencies: { "@kontourai/console-core": baseline.core } });
    put(root, "package-lock.json", { name: "@kontourai/console", version: baseline.root, lockfileVersion: 3, packages: { "": { name: "@kontourai/console", version: baseline.root, dependencies: { "@kontourai/console-core": baseline.core } }, cli: { name: "@kontourai/cli", version: baseline.cli, dependencies: { "@kontourai/console-core": baseline.core } }, "console-core": { name: "@kontourai/console-core", version: baseline.core }, "console-server": { name: "@kontourai/console-server", version: baseline.server, dependencies: { "@kontourai/console-core": baseline.core } } } });
    put(root, ".release-please-manifest.json", { ".": baseline.root, cli: baseline.cli, "console-core": baseline.core });
    put(root, "release-please-config.json", releaseConfig);
    put(root, "CHANGELOG.md", "# Changelog\n"); put(root, "cli/CHANGELOG.md", "# Changelog\n"); put(root, "console-core/CHANGELOG.md", "# Changelog\n");
    git(root, "add", "."); git(root, "commit", "-m", "feat(console-core)!: historical release content"); const releaseSha = git(root, "rev-parse", "HEAD");
    put(root, "release-boundary.txt", "release history is supplied by the fixture provider\n"); git(root, "add", "."); git(root, "commit", "-m", "chore: configure release boundary");
    put(root, "console-core/descriptor.txt", "published descriptor surface\n"); git(root, "add", "."); git(root, "commit", "-m", "feat(console-core): publish descriptor package subpaths");
    const releases = [
      { id: 1, tagName: `v${baseline.root}`, sha: releaseSha, url: "https://example.test/releases/console" },
      { id: 2, tagName: `cli-v${baseline.cli}`, sha: releaseSha, url: "https://example.test/releases/cli" },
      ...(includeCoreRelease ? [{ id: 3, tagName: `console-core-v${baseline.core}`, sha: releaseSha, url: "https://example.test/releases/core" }] : []),
    ];
    const releaseIterator = async function* () { yield* releases; };
    const empty = async function* () { /* no pull requests in fixture provider state */ };
    const api = { repository: { owner: "fixture", repo: "console", defaultBranch: "main" }, releaseIterator, pullRequestIterator: empty };
    const github = new LocalGitHub(api.repository, api as never, root, {});
    const prs = await (await Manifest.fromManifest(github, "main")).buildPullRequests();
    const updates = new Map<string, string>();
    if (prs.length === 1) for (const update of prs[0].updates) {
      let source: string | undefined = update.cachedFileContents?.parsedContent;
      if (!source) try { source = (await github.getFileContentsOnBranch(update.path, "main")).parsedContent; } catch { continue; }
      updates.set(update.path, update.updater.updateContent(source));
    }
    return { prs, updates, fixtureTags: git(root, "tag", "--list") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function assertGeneratedCandidate(label: string, baseline: Baseline): Promise<void> {
  const expected = candidateFor(baseline);
  const { prs, updates, fixtureTags } = await buildFixture(baseline, true);
  assert.equal(fixtureTags, "", `${label}: fixture must not inherit ambient tags`);
  assert.equal(prs.length, 1);
  const data = new Map(prs[0].body.releaseData.map((item: { component?: string; version?: { toString(): string } }) => [item.component ?? "", item.version?.toString()]));
  assert.equal(data.get("console-core"), expected.core); assert.equal(data.get("cli"), expected.cli); assert.equal(data.get(""), expected.root);
  const cli = JSON.parse(updates.get("cli/package.json")!); const rootPackage = JSON.parse(updates.get("package.json")!); const server = JSON.parse(updates.get("console-server/package.json")!); const lock = JSON.parse(updates.get("package-lock.json")!); const versions = JSON.parse(updates.get(".release-please-manifest.json")!);
  assert.equal(cli.version, expected.cli); assert.equal(cli.dependencies["@kontourai/console-core"], expected.core);
  assert.equal(rootPackage.version, expected.root); assert.equal(rootPackage.dependencies["@kontourai/console-core"], expected.core); assert.equal(server.dependencies["@kontourai/console-core"], expected.core);
  assert.equal(lock.packages.cli.version, expected.cli); assert.equal(lock.packages.cli.dependencies["@kontourai/console-core"], expected.core); assert.equal(lock.packages["console-core"].version, expected.core);
  assert.equal(lock.packages[""].version, expected.root); assert.equal(lock.packages[""].dependencies["@kontourai/console-core"], expected.core); assert.equal(lock.packages["console-server"].dependencies["@kontourai/console-core"], expected.core);
  assert.equal(server.version, expected.server); assert.equal(lock.packages["console-server"].version, expected.server, "root release must not rewrite Console Server lock identity");
  assert.deepEqual(versions, { ".": expected.root, cli: expected.cli, "console-core": expected.core });
  assert.match(updates.get("console-core/CHANGELOG.md")!, new RegExp(expected.core.replaceAll(".", "\\."))); assert.match(updates.get("cli/CHANGELOG.md")!, new RegExp(expected.cli.replaceAll(".", "\\.")));
}

function registerFixtureTests(): void {
  test("actual loaded baseline generates semver-relative Core and dependent releases", () => assertGeneratedCandidate("loaded baseline", loadedBaseline));
  test("already-generated candidate baseline generates the following coherent release", () => assertGeneratedCandidate("candidate overlay", candidateFor(loadedBaseline)));
  test("missing Core boundary exposes the historical breaking commit relative to each baseline", async () => {
    for (const baseline of [loadedBaseline, candidateFor(loadedBaseline)]) {
      const { prs, fixtureTags } = await buildFixture(baseline, false);
      assert.equal(fixtureTags, ""); assert.equal(prs.length, 1);
      const core = prs[0].body.releaseData.find((item: { component?: string }) => item.component === "console-core");
      assert.equal(core?.version?.toString(), breakingVersion(baseline.core));
      assert.notEqual(core?.version?.toString(), featureVersion(baseline.core));
    }
  });
}

if (process.env[isolatedMarker] === "1") registerFixtureTests();
else test("Release Please generation fixtures are isolated from the invoking repository", () => {
  execFileSync(process.execPath, ["--import", "tsx", "--test", __filename], { cwd: repositoryRoot, encoding: "utf8", env: { ...isolatedEnvironment(), [isolatedMarker]: "1" }, timeout: 60_000 });
});
