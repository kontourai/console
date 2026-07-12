import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { LocalGitHub } = require("release-please/build/src/local-github.js") as typeof import("release-please/build/src/local-github.js");
const { Manifest } = require("release-please/build/src/manifest.js") as typeof import("release-please/build/src/manifest.js");

const repositoryRoot = join(__dirname, "..");
const releaseConfig = readFileSync(join(repositoryRoot, "release-please-config.json"), "utf8");
const releaseManifest = readFileSync(join(repositoryRoot, ".release-please-manifest.json"), "utf8");
const releasedVersions = JSON.parse(releaseManifest) as Record<string, string>;
const rootVersion = releasedVersions["."];
const cliVersion = releasedVersions.cli;
const coreVersion = releasedVersions["console-core"];
function patchVersion(version: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}
const isolatedMarker = "KONTOUR_RELEASE_PLEASE_FIXTURE_ISOLATED";
const repositoryGitEnvironment = new Set([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH",
  // Node's test runner otherwise treats the subprocess as a recursive shard and skips this file.
  "NODE_TEST_CONTEXT",
]);

function isolatedEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !repositoryGitEnvironment.has(key)));
}

function git(root: string, ...args: string[]): string { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function put(root: string, path: string, value: unknown): void { const target = join(root, path); mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n"); }

async function buildFixture(includeCoreRelease: boolean) {
  const root = mkdtempSync(join(tmpdir(), "release-please-manifest-"));
  try {
    git(root, "init", "-b", "main"); git(root, "config", "user.email", "fixture@example.test"); git(root, "config", "user.name", "Fixture");
    put(root, "package.json", { name: "@kontourai/console", version: rootVersion, workspaces: ["cli", "console-core", "console-server"], dependencies: { "@kontourai/console-core": coreVersion } });
    put(root, "cli/package.json", { name: "@kontourai/cli", version: cliVersion, dependencies: { "@kontourai/console-core": coreVersion } });
    put(root, "console-core/package.json", { name: "@kontourai/console-core", version: coreVersion });
    put(root, "console-server/package.json", { name: "@kontourai/console", version: "0.1.0", dependencies: { "@kontourai/console-core": coreVersion } });
    put(root, "package-lock.json", { name: "@kontourai/console", version: rootVersion, lockfileVersion: 3, packages: { "": { name: "@kontourai/console", version: rootVersion, dependencies: { "@kontourai/console-core": coreVersion } }, cli: { name: "@kontourai/cli", version: cliVersion, dependencies: { "@kontourai/console-core": coreVersion } }, "console-core": { name: "@kontourai/console-core", version: coreVersion }, "console-server": { name: "@kontourai/console", version: "0.1.0", dependencies: { "@kontourai/console-core": coreVersion } } } });
    put(root, ".release-please-manifest.json", releaseManifest);
    put(root, "release-please-config.json", releaseConfig);
    put(root, "CHANGELOG.md", "# Changelog\n"); put(root, "cli/CHANGELOG.md", "# Changelog\n"); put(root, "console-core/CHANGELOG.md", "# Changelog\n");
    git(root, "add", "."); git(root, "commit", "-m", "feat(console-core)!: historical release content"); const baseline = git(root, "rev-parse", "HEAD");
    put(root, "release-boundary.txt", "release history is supplied by the fixture provider\n"); git(root, "add", "."); git(root, "commit", "-m", "chore: configure release boundary");
    put(root, "console-core/descriptor.txt", "published descriptor surface\n"); git(root, "add", "."); git(root, "commit", "-m", "feat(console-core): publish descriptor package subpaths");

    const releases = [
      { id: 1, tagName: `v${rootVersion}`, sha: baseline, url: "https://example.test/releases/console" },
      { id: 2, tagName: `cli-v${cliVersion}`, sha: baseline, url: "https://example.test/releases/cli" },
      ...(includeCoreRelease ? [{ id: 3, tagName: `console-core-v${coreVersion}`, sha: baseline, url: "https://example.test/releases/core" }] : []),
    ];
    const releaseIterator = async function* () { yield* releases; };
    const empty = async function* () { /* no pull requests in fixture provider state */ };
    const api = { repository: { owner: "fixture", repo: "console", defaultBranch: "main" }, releaseIterator, pullRequestIterator: empty };
    const github = new LocalGitHub(api.repository, api as never, root, {});
    const manifest = await Manifest.fromManifest(github, "main");
    const prs = await manifest.buildPullRequests();
    const updates = new Map<string, string>();
    if (prs.length === 1) {
      for (const update of prs[0].updates) {
        let source: string | undefined = update.cachedFileContents?.parsedContent;
        if (!source) {
          try { source = (await github.getFileContentsOnBranch(update.path, "main")).parsedContent; }
          catch { continue; }
        }
        updates.set(update.path, update.updater.updateContent(source));
      }
    }
    return { prs, updates, fixtureTags: git(root, "tag", "--list") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function registerFixtureTests(): void {
test("configured Manifest and node-workspace compute Core and dependent CLI release PR", async () => {
    const { prs, updates, fixtureTags } = await buildFixture(true);
    assert.equal(fixtureTags, "", "the synthetic clone must not inherit ambient repository tags");
    assert.equal(prs.length, 1);
    const data = prs[0].body.releaseData.map((item: { component?: string; version?: { toString(): string } }) => [item.component, item.version?.toString()]);
    assert.ok(data.some(([component, version]) => component === "console-core" && version === "0.2.0"), JSON.stringify(data));
    assert.ok(data.some(([component, version]) => component === "cli" && version === "0.3.1"), JSON.stringify(data));
    const nextRootVersion = patchVersion(rootVersion);
    assert.ok(data.some(([component, version]) => component === "" && version === nextRootVersion), JSON.stringify(data));
    const cli = JSON.parse(updates.get("cli/package.json")!); const rootPackage = JSON.parse(updates.get("package.json")!); const server = JSON.parse(updates.get("console-server/package.json")!); const lock = JSON.parse(updates.get("package-lock.json")!); const versions = JSON.parse(updates.get(".release-please-manifest.json")!);
    assert.equal(cli.version, "0.3.1"); assert.equal(cli.dependencies["@kontourai/console-core"], "0.2.0");
    assert.equal(lock.packages.cli.dependencies["@kontourai/console-core"], "0.2.0"); assert.equal(lock.packages["console-core"].version, "0.2.0");
    assert.equal(rootPackage.version, nextRootVersion); assert.equal(rootPackage.dependencies["@kontourai/console-core"], "0.2.0"); assert.equal(server.dependencies["@kontourai/console-core"], "0.2.0");
    assert.equal(lock.packages[""].dependencies["@kontourai/console-core"], "0.2.0"); assert.equal(lock.packages.consoleServer?.version, undefined); assert.equal(lock.packages["console-server"].dependencies["@kontourai/console-core"], "0.2.0");
    assert.deepEqual(versions, { ".": nextRootVersion, cli: "0.3.1", "console-core": "0.2.0" });
    assert.match(updates.get("console-core/CHANGELOG.md")!, /0\.2\.0/); assert.match(updates.get("cli/CHANGELOG.md")!, /0\.3\.1/);
});

test("Core release boundary is supplied explicitly rather than inferred from ambient tags", async () => {
  const { prs, fixtureTags } = await buildFixture(false);
  assert.equal(fixtureTags, "", "the negative control must also have no local tags");
  assert.equal(prs.length, 1);
  const core = prs[0].body.releaseData.find((item: { component?: string }) => item.component === "console-core");
  assert.equal(core?.version?.toString(), "1.0.0", "without the explicit Core release, historical breaking work leaks into the candidate window");
});
}

if (process.env[isolatedMarker] === "1") {
  registerFixtureTests();
} else {
  test("Release Please generation fixture is isolated from the invoking repository", () => {
    execFileSync(process.execPath, ["--import", "tsx", "--test", __filename], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...isolatedEnvironment(), [isolatedMarker]: "1" },
      timeout: 30_000,
    });
  });
}
