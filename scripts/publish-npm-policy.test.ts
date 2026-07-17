import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflowDirectory = path.join(__dirname, "..", ".github", "workflows");
const workflowPath = path.join(workflowDirectory, "publish-npm.yml");
const releaseWorkflowPath = path.join(__dirname, "..", ".github", "workflows", "release-please.yml");
const resolverPath = path.join(__dirname, "resolve-release-target.sh");

test("primary npm publish path fails closed and confirms the released version", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const primary = workflow.slice(
    workflow.indexOf("- name: Check Published Version"),
    workflow.indexOf("- name: Publish console-telemetry"),
  );

  assert.match(primary, /npm view "\$\{PACKAGE_NAME\}" versions --json/);
  assert.match(primary, /grep -Fq "E404"/);
  assert.match(primary, /grep -Eq "\(is not in this registry\|Not found\)"/);
  assert.match(primary, /npm publish --workspace "\$\{PACKAGE_WORKSPACE\}" --access public --provenance/);
  assert.match(primary, /Confirmed \$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\} on npm/);
  assert.match(primary, /could not be confirmed on npm/);

  assert.doesNotMatch(primary, /elif npm publish/);
  assert.doesNotMatch(primary, /::warning::Could not publish/);
  assert.doesNotMatch(primary, /npm bootstrap required/);
});

test("Core is a first-class release and CLI publication waits for its exact public dependency", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /target_tag:/);
  assert.match(workflow, /resolve-release-target\.sh/);
  assert.match(workflow, /Verify CLI Core Dependency Is Public/);
  assert.match(workflow, /node --import tsx scripts\/verify-cli-core-release\.ts/);
});

test("tag ancestry is checked against an authoritative main ref with complete history", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const ancestry = workflow.slice(
    workflow.indexOf("  gate:"),
    workflow.indexOf("  verify:"),
  );
  const resolver = await readFile(resolverPath, "utf8");

  assert.match(resolver, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(resolver, /TARGET_SHA=\$\(git rev-parse "refs\/tags\/\$\{TARGET_TAG\}\^\{commit\}"\)/);
  assert.match(resolver, /git merge-base --is-ancestor "\$\{TARGET_SHA\}" refs\/remotes\/origin\/main/);
  assert.doesNotMatch(resolver, /GITHUB_SHA|FETCH_HEAD/);
  assert.match(ancestry, /permissions:\n      contents: read/);
});

test("current workflow definition requires an explicit immutable target tag", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const invocation = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("permissions:"));

  assert.match(invocation, /workflow_call:[\s\S]*target_tag:[\s\S]*required: true/);
  assert.doesNotMatch(invocation, /workflow_dispatch:/);
  assert.doesNotMatch(invocation, /push:/);
  assert.match(workflow, /Verify Current Main Workflow Definition/);
  assert.match(workflow, /if \[ "\$\{GITHUB_REF\}" != "refs\/heads\/main" \]/);
  assert.match(workflow, /ref: \$\{\{ needs\.gate\.outputs\.target_sha \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.target_tag \}\}/);
});

test("automatic releases and retries share one trusted-publisher workflow identity", async () => {
  const [publisher, release] = await Promise.all([
    readFile(workflowPath, "utf8"),
    readFile(releaseWorkflowPath, "utf8"),
  ]);
  const publisherInvocation = publisher.slice(publisher.indexOf("on:"), publisher.indexOf("permissions:"));
  const releaseInvocation = release.slice(release.indexOf("on:"), release.indexOf("permissions:"));
  const retry = release.slice(release.indexOf("  retry-publish:"), release.indexOf("  publish-core:"));

  assert.doesNotMatch(publisherInvocation, /workflow_dispatch:/);
  assert.match(releaseInvocation, /workflow_dispatch:[\s\S]*target_tag:[\s\S]*required: false/);
  assert.match(release, /release-please:\n    if: github\.event_name == 'push' \|\| inputs\.target_tag == ''/);
  assert.match(retry, /if: github\.event_name == 'workflow_dispatch' && inputs\.target_tag != ''/);
  assert.match(retry, /uses: \.\/\.github\/workflows\/publish-npm\.yml/);
  assert.match(retry, /target_tag: \$\{\{ inputs\.target_tag \}\}/);
  assert.match(retry, /permissions:\n      contents: read\n      id-token: write/);
  assert.match(publisher, /publish:\n    needs: \[gate, verify\][\s\S]*permissions:\n      contents: read\n      id-token: write/);

  const callers: string[] = [];
  for (const name of await readdir(workflowDirectory)) {
    if (!/\.ya?ml$/.test(name) || name === "publish-npm.yml") continue;
    const candidate = await readFile(path.join(workflowDirectory, name), "utf8");
    if (candidate.includes("uses: ./.github/workflows/publish-npm.yml")) callers.push(name);
  }
  assert.deepEqual(callers, ["release-please.yml"], "release-please.yml must be the only caller identity for npm publishing");
});

test("exact tag fixture sanitizes inherited Git state and rejects a branch replacing a removed tag", () => {
  const root = mkdtempSync(path.join(tmpdir(), "console-release-target-"));
  const remote = path.join(root, "remote.git");
  const source = path.join(root, "source");
  const checkout = path.join(root, "checkout");
  const hostileEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_DIR: path.join(root, "caller.git"),
    GIT_WORK_TREE: path.join(root, "caller-worktree"),
    GIT_PREFIX: "caller-prefix/",
    GIT_INDEX_FILE: path.join(root, "caller-index"),
    GIT_OBJECT_DIRECTORY: path.join(root, "caller-objects"),
  };
  const childEnvironment = Object.fromEntries(Object.entries(hostileEnvironment).filter(([key]) => !key.startsWith("GIT_")));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: childEnvironment }).trim();
  try {
    mkdirSync(source);
    git(root, "init", "--bare", remote);
    git(source, "init", "-b", "main");
    git(source, "config", "user.email", "fixture@example.test");
    git(source, "config", "user.name", "Fixture");
    writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "@kontourai/console", version: "1.2.3" }));
    git(source, "add", "."); git(source, "commit", "-m", "release");
    git(source, "remote", "add", "origin", remote); git(source, "push", "-u", "origin", "main");
    git(source, "tag", "v1.2.3"); git(source, "push", "origin", "refs/tags/v1.2.3");
    git(root, "clone", "--branch", "main", remote, checkout);
    const output = path.join(root, "output");
    execFileSync("bash", [resolverPath, "v1.2.3"], { cwd: checkout, env: { ...childEnvironment, GITHUB_OUTPUT: output } });
    assert.match(require("node:fs").readFileSync(output, "utf8"), /^target_sha=[0-9a-f]{40}$/m);

    git(source, "push", "origin", ":refs/tags/v1.2.3");
    git(source, "branch", "v1.2.3"); git(source, "push", "origin", "refs/heads/v1.2.3");
    git(checkout, "tag", "-d", "v1.2.3"); git(checkout, "checkout", "main");
    const rejected = spawnSync("bash", [resolverPath, "v1.2.3"], { cwd: checkout, encoding: "utf8", env: childEnvironment });
    assert.notEqual(rejected.status, 0, "a same-named branch must not replace a missing exact tag");
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, /target_sha=/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("publish retries queue by immutable target and never cancel in progress", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const concurrency = workflow.slice(workflow.indexOf("concurrency:"), workflow.indexOf("jobs:"));

  assert.match(concurrency, /group: publish-npm-\$\{\{ inputs\.target_tag \}\}/);
  assert.match(concurrency, /cancel-in-progress: false/);
});

test("target-tag authority is used for package-specific release gates", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /TARGET_TAG: \$\{\{ inputs\.target_tag \}\}/);
  // The anti-drift "Verify … Core Dependency Is Public" gate must fire for BOTH
  // exact-core-pinned packages — cli AND console-server — and must pass the
  // resolved manifest so it checks the RIGHT package's core pin. Pinning the
  // full condition (not just a `cli-v` substring) means dropping the
  // console-server branch or the manifest env — which would let a console-server
  // release publish against an unverified core pin (#70) — fails this test.
  assert.match(workflow, /if: startsWith\(inputs\.target_tag, 'cli-v'\) \|\| startsWith\(inputs\.target_tag, 'console-server-v'\)/);
  assert.match(workflow, /PACKAGE_MANIFEST: \$\{\{ needs\.gate\.outputs\.manifest \}\}/);
  assert.match(workflow, /if: startsWith\(inputs\.target_tag, 'v'\)/);
  assert.doesNotMatch(workflow, /startsWith\(github\.ref/);
  assert.doesNotMatch(workflow, /GITHUB_REF_NAME/);
});
