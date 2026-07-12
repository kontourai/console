import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "publish-npm.yml");
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
  assert.match(invocation, /workflow_dispatch:[\s\S]*target_tag:[\s\S]*required: true/);
  assert.doesNotMatch(invocation, /push:/);
  assert.match(workflow, /Verify Current Main Workflow Definition/);
  assert.match(workflow, /if \[ "\$\{GITHUB_REF\}" != "refs\/heads\/main" \]/);
  assert.match(workflow, /ref: \$\{\{ needs\.gate\.outputs\.target_sha \}\}/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\.target_tag \}\}/);
});

test("exact tag resolution rejects an identically named branch and a removed tag", () => {
  const root = mkdtempSync(path.join(tmpdir(), "console-release-target-"));
  const remote = path.join(root, "remote.git");
  const source = path.join(root, "source");
  const checkout = path.join(root, "checkout");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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
    execFileSync("bash", [resolverPath, "v1.2.3"], { cwd: checkout, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.match(require("node:fs").readFileSync(output, "utf8"), /^target_sha=[0-9a-f]{40}$/m);

    git(source, "push", "origin", ":refs/tags/v1.2.3");
    git(source, "branch", "v1.2.3"); git(source, "push", "origin", "refs/heads/v1.2.3");
    git(checkout, "tag", "-d", "v1.2.3"); git(checkout, "checkout", "main");
    const rejected = spawnSync("bash", [resolverPath, "v1.2.3"], { cwd: checkout, encoding: "utf8" });
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
  assert.match(workflow, /if: startsWith\(inputs\.target_tag, 'cli-v'\)/);
  assert.match(workflow, /if: startsWith\(inputs\.target_tag, 'v'\)/);
  assert.doesNotMatch(workflow, /startsWith\(github\.ref/);
  assert.doesNotMatch(workflow, /GITHUB_REF_NAME/);
});
