import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Manifest } from "release-please";
import { PullRequestBody } from "release-please/build/src/util/pull-request-body";
import type { PullRequest } from "release-please/build/src/pull-request";
import type { Scm } from "release-please/build/src/scm";
import { parse as parseYaml } from "yaml";
import { createMissingComponentReleases, releaseOutputs, runComponentReleases, selectComponentReleases } from "./create-component-releases";

const source = join(__dirname, "fixtures/release-245");
const pr: PullRequest = JSON.parse(readFileSync(join(source, "pull-request.json"), "utf8"));
const expected = [
  { path: ".", tag: "v2.9.0", version: "2.9.0", sha: pr.sha },
  { path: "console-core", tag: "console-core-v0.4.0", version: "0.4.0", sha: pr.sha },
  { path: "console-server", tag: "console-server-v1.1.0", version: "1.1.0", sha: pr.sha },
  { path: "console-ui", tag: "console-ui-v0.3.0", version: "0.3.0", sha: pr.sha },
];

function fixture(options: { tagged?: string[]; wrongTag?: string; request?: PullRequest } = {}) {
  const writes: Array<{ tag: string; sha: string; forceTag: boolean | undefined }> = [];
  const labels: string[] = [];
  const reads: Array<{ file: string; ref: string }> = [];
  const existing = options.tagged ?? [];
  const api = {
    repository: { owner: "kontourai", repo: "console", defaultBranch: "main" },
    async getFileJson(file: string, ref: string) {
      reads.push({ file, ref });
      return JSON.parse(readFileSync(join(source, file), "utf8"));
    },
    async getFileContentsOnBranch(file: string, ref: string) {
      reads.push({ file, ref });
      return { parsedContent: readFileSync(join(source, file), "utf8") };
    },
    async *pullRequestIterator(branch: string, state: string, limit: number, includeFiles: boolean) {
      assert.deepEqual([branch, state, limit, includeFiles], ["main", "MERGED", 200, false]);
      yield options.request ?? pr;
    },
    async *tagIterator() { for (const name of existing) yield { name, sha: name === options.wrongTag ? "a".repeat(40) : pr.sha! }; },
    async *releaseIterator() { for (const tagName of existing) yield { tagName, sha: pr.sha! }; },
    async createRelease(release: { tag: { toString(): string }; sha: string }, opts: { forceTag?: boolean }) {
      const tagName = release.tag.toString();
      writes.push({ tag: tagName, sha: release.sha, forceTag: opts.forceTag });
      return { id: writes.length, tagName, sha: release.sha, url: `https://example.test/releases/${tagName}` };
    },
    async removeIssueLabels() { labels.push("remove-pending"); },
    async addIssueLabels() { labels.push("add-tagged"); },
  };
  return { api: api as unknown as Scm, writes, labels, reads };
}

test("actual merged PR245 parses four sections but upstream full buildReleases loses Core/UI after HTML roundtrip", async () => {
  assert.equal(PullRequestBody.parse(pr.body)!.releaseData.length, 4);
  const { api } = fixture();
  const upstream = await Manifest.fromManifest(api, "main");
  const actual = await upstream.buildReleases();
  assert.deepEqual(actual.map(r => r.tag.toString()), ["v2.9.0", "console-server-v1.1.0"]);
  assert.ok(actual.every(r => r.sha === pr.sha));
});

test("original merged body selects all four exact tags, versions and immutable source identities", async () => {
  const { api, reads } = fixture();
  const releases = await selectComponentReleases(api, pr);
  assert.deepEqual(releases.map(r => ({ path: r.path, tag: r.tag.toString(), version: r.tag.version.toString(), sha: r.sha })), expected);
  assert.ok(reads.length > 4);
  assert.ok(reads.every(r => r.ref === pr.sha), "mutable main and PR308 versions must not supply release contents");
  assert.match(releases[1].notes, /surface-trust-panel/);
});

test("normal creation emits real four-component outputs and updates labels only after successful creation", async () => {
  const f = fixture(); const ancestry: string[] = [];
  const releases = await runComponentReleases(f.api, sha => { ancestry.push(sha); });
  assert.deepEqual(ancestry, [pr.sha]);
  assert.deepEqual(f.writes.map(r => r.tag), expected.map(r => r.tag));
  assert.ok(f.writes.every(r => r.sha === pr.sha && r.forceTag === false));
  assert.deepEqual(f.labels, ["remove-pending", "add-tagged"]);
  const output = releaseOutputs(releases);
  assert.equal(output.releases_created, true);
  assert.deepEqual(JSON.parse(output.paths_released as string), expected.map(r => r.path));
  for (const item of expected) {
    const prefix = item.path === "." ? "" : `${item.path}--`;
    assert.equal(output[`${prefix}release_created`], true);
    assert.equal(output[`${prefix}tag_name`], item.tag);
    assert.equal(output[`${prefix}version`], item.version);
    assert.equal(output[`${prefix}sha`], item.sha);
  }
});

test("actual component outputs feed all four workflow publishers with Core-first ordering", async () => {
  const releases = await runComponentReleases(fixture().api, () => {});
  const output = releaseOutputs(releases);
  const workflow = parseYaml(readFileSync(join(__dirname, "../.github/workflows/release-please.yml"), "utf8"));
  const exposed: Record<string, string | boolean> = {};
  for (const [alias, expression] of Object.entries(workflow.jobs["release-please"].outputs)) {
    const match = String(expression).match(/steps\.components\.outputs(?:\.([a-z_]+)|\['([^']+)'\])/);
    assert.ok(match, `output ${alias} must come from actual component creation`);
    exposed[alias] = output[match[1] ?? match[2]];
  }
  for (const [job, alias, tag] of [
    ["publish-core", "core", "console-core-v0.4.0"],
    ["publish-console", "console", "v2.9.0"],
    ["publish-server", "server", "console-server-v1.1.0"],
    ["publish-console-ui", "ui", "console-ui-v0.3.0"],
  ]) {
    const publisher = workflow.jobs[job];
    assert.equal(exposed[`${alias}_release_created`], true);
    assert.equal(exposed[`${alias}_tag_name`], tag);
    assert.equal(publisher.with.target_tag, `\u0024{{ needs.release-please.outputs.${alias}_tag_name }}`);
    assert.equal(publisher.uses, "./.github/workflows/publish-npm.yml");
    if (alias !== "core") {
      assert.ok(publisher.needs.includes("publish-core"));
      assert.match(publisher.if, /needs\.publish-core\.result == 'success'/);
      assert.match(publisher.if, /needs\.publish-core\.result == 'skipped'/);
    }
  }
  const generator = workflow.jobs["release-please"].steps.find((step: { id?: string }) => step.id === "release");
  assert.equal(generator.with["skip-github-release"], true, "upstream action must not run the lossy creation path");
});

test("explicit tagged-PR recovery creates only Core0.4/UI0.3, preserving existing root/Server and labels", async () => {
  const f = fixture({ tagged: [expected[0].tag, expected[2].tag], request: { ...pr, labels: ["autorelease: tagged"] } });
  const releases = await runComponentReleases(f.api, () => {}, { pr: 245, sha: pr.sha! });
  assert.deepEqual(f.writes.map(r => r.tag), ["console-core-v0.4.0", "console-ui-v0.3.0"]);
  assert.deepEqual(f.labels, []);
  const outputs = releaseOutputs(releases);
  assert.equal(outputs["console-core--tag_name"], "console-core-v0.4.0");
  assert.equal(outputs["console-ui--tag_name"], "console-ui-v0.3.0");
  assert.equal(outputs.release_created, undefined);
  assert.equal(outputs["console-server--release_created"], undefined);
});

test("already completed recovery is idempotent, without creation or publisher outputs", async () => {
  const f = fixture({ tagged: expected.map(r => r.tag) });
  assert.deepEqual(await runComponentReleases(f.api, () => {}, { pr: 245, sha: pr.sha! }), []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(releaseOutputs([]), { releases_created: false, paths_released: "[]" });
});

test("wrong existing immutable tag source refuses all writes before filling missing components", async () => {
  const f = fixture({ tagged: [expected[0].tag], wrongTag: expected[0].tag });
  await assert.rejects(createMissingComponentReleases(f.api, await selectComponentReleases(f.api, pr)), /existing v2.9.0 source must match/);
  assert.deepEqual(f.writes, []);
});

test("recovery rejects wrong requested source, missing PR and non-ancestor source without writes", async () => {
  for (const recovery of [{ pr: 245, sha: "a".repeat(40) }, { pr: 999, sha: pr.sha! }]) {
    const f = fixture(); await assert.rejects(runComponentReleases(f.api, () => {}, recovery)); assert.deepEqual(f.writes, []);
  }
  const f = fixture();
  await assert.rejects(runComponentReleases(f.api, () => { throw new Error("not main ancestor"); }), /not main ancestor/);
  assert.deepEqual(f.writes, []);
});

test("immutable manifest disagreement and undeclared body components fail closed", async () => {
  const f = fixture();
  const wrongVersion = { ...pr, body: pr.body.replace('console-core: 0.4.0', 'console-core: 0.5.0') };
  await assert.rejects(selectComponentReleases(f.api, wrongVersion), /immutable manifest/);
  const unknown = { ...pr, body: pr.body.replace('console-ui: 0.3.0', 'unknown-component: 0.3.0') };
  await assert.rejects(selectComponentReleases(f.api, unknown), /every declared component/);
  assert.deepEqual(f.writes, []);
});
