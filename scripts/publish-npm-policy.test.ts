import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const workflowPath = path.join(__dirname, "..", ".github", "workflows", "publish-npm.yml");

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
  assert.match(workflow, /- 'console-core-v\*'/);
  assert.match(workflow, /npm-release-policy\.ts select/);
  assert.match(workflow, /Verify CLI Core Dependency Is Public/);
  assert.match(workflow, /node --import tsx scripts\/verify-cli-core-release\.ts/);
});

test("tag ancestry is checked against an authoritative main ref with complete history", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const ancestry = workflow.slice(
    workflow.indexOf("- name: Verify Tagged Commit Is On Main"),
    workflow.indexOf("- name: Check Published Version"),
  );

  assert.match(ancestry, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(ancestry, /git merge-base --is-ancestor "\$\{GITHUB_SHA\}" "refs\/remotes\/origin\/main"/);
  assert.doesNotMatch(ancestry, /--depth=1/);
  assert.doesNotMatch(ancestry, /FETCH_HEAD/);
});
