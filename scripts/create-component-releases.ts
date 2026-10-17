import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { GitHub, Manifest } from "release-please";
import { buildStrategy } from "release-please/build/src/factory";
import { PullRequestBody } from "release-please/build/src/util/pull-request-body";
import type { PullRequest } from "release-please/build/src/pull-request";
import type { CandidateRelease, CreatedRelease } from "release-please/build/src/manifest";
import type { Scm } from "release-please/build/src/scm";

// Keep the original merged body through selection. Manifest.buildReleases()
// parses it for overflow and serializes textContent back to HTML; encoded
// custom elements then become unclosed tags which swallow later components.
// Use the same public Release Please strategies without that lossy roundtrip.
export async function selectComponentReleases(github: Scm, pr: PullRequest): Promise<CandidateRelease[]> {
  assert.match(pr.sha ?? "", /^[a-f0-9]{40}$/, "release PR must have an immutable merge SHA");
  assert.equal(pr.baseBranchName, "main");
  assert.equal(pr.headBranchName, "release-please--branches--main");
  assert.equal(pr.title, "chore: release main");
  const body = PullRequestBody.parse(pr.body);
  assert.ok(body && body.releaseData.length > 0, "release PR must contain component notes; overflow bodies need explicit source review");
  const manifest = await Manifest.fromManifest(github, pr.sha!);
  const releases: CandidateRelease[] = [];
  for (const [path, config] of Object.entries(manifest.repositoryConfig)) {
    assert.ok(!config.forceTag, "force tag creation is forbidden");
    const strategy = await buildStrategy({ ...config, github, path, targetBranch: pr.sha! });
    for (const release of await strategy.buildReleases(pr)) {
      const pkg = await github.getFileJson<{ version: string }>(path === "." ? "package.json" : `${path}/package.json`, pr.sha!);
      assert.equal(release.tag.version.toString(), pkg.version, `${path} notes must match the immutable manifest`);
      assert.equal(release.sha, pr.sha);
      releases.push({ ...release, path, pullRequest: pr, draft: config.draft, prerelease: config.prerelease });
    }
  }
  assert.equal(releases.length, body.releaseData.length, "every declared component must select exactly one release");
  assert.equal(new Set(releases.map(r => r.tag.toString())).size, releases.length, "component tags must be unique");
  return releases;
}

export function releaseOutputs(releases: CreatedRelease[]): Record<string, string | boolean> {
  const output: Record<string, string | boolean> = { releases_created: releases.length > 0, paths_released: JSON.stringify(releases.map(r => r.path)) };
  for (const release of releases) {
    const prefix = release.path === "." ? "" : `${release.path}--`;
    output[`${prefix}release_created`] = true;
    output[`${prefix}tag_name`] = release.tagName;
    output[`${prefix}version`] = release.version;
    output[`${prefix}sha`] = release.sha;
  }
  return output;
}

// Preflight all immutable identities before the first write. Existing releases
// are never moved, deleted or republished. Recovery may only fill absent ones.
export async function createMissingComponentReleases(github: Scm, candidates: CandidateRelease[]): Promise<CreatedRelease[]> {
  const tags = new Map<string, string>();
  const published = new Map<string, string>();
  for await (const tag of github.tagIterator({ maxResults: 1000 })) tags.set(tag.name, tag.sha);
  for await (const release of github.releaseIterator({ maxResults: 1000 })) published.set(release.tagName, release.sha);
  assert.ok(tags.size < 1000 && published.size < 1000, "release inventory exceeded bounded preflight");
  for (const candidate of candidates) {
    const tag = candidate.tag.toString();
    if (tags.has(tag)) assert.equal(tags.get(tag), candidate.sha, `existing ${tag} source must match`);
    if (published.has(tag)) {
      assert.equal(published.get(tag), candidate.sha, `existing ${tag} release source must match`);
      assert.ok(tags.has(tag), `existing ${tag} release must have a tag`);
    }
  }
  const created: CreatedRelease[] = [];
  for (const candidate of candidates) {
    if (published.has(candidate.tag.toString())) continue;
    const release = await github.createRelease(candidate, { draft: candidate.draft, prerelease: candidate.prerelease, forceTag: false });
    assert.equal(release.tagName, candidate.tag.toString());
    assert.equal(release.sha, candidate.sha);
    const version = candidate.tag.version;
    created.push({ ...release, id: release.id!, path: candidate.path, version: version.toString(), major: version.major, minor: version.minor, patch: version.patch, prNumber: candidate.pullRequest.number });
  }
  return created;
}

export async function runComponentReleases(github: Scm, isAncestor: (sha: string) => void, recovery?: { pr: number; sha: string }): Promise<CreatedRelease[]> {
  const requests: PullRequest[] = [];
  // A tagged PR's merge SHA comes from the MERGED iterator, not getPullRequest's
  // head SHA. Recovery never restores labels or edits the generated body.
  for await (const pr of github.pullRequestIterator("main", "MERGED", 200, false)) {
    if (recovery ? pr.number === recovery.pr : pr.labels.includes("autorelease: pending")) requests.push(pr);
  }
  if (recovery) {
    assert.equal(requests.length, 1, "recovery PR must be found in bounded merged history");
    assert.equal(requests[0].sha, recovery.sha, "recovery source must match the requested merge SHA");
  }
  const result: CreatedRelease[] = [];
  for (const pr of requests) {
    isAncestor(pr.sha!);
    const created = await createMissingComponentReleases(github, await selectComponentReleases(github, pr));
    result.push(...created);
    if (!recovery) {
      await github.removeIssueLabels(["autorelease: pending"], pr.number);
      await github.addIssueLabels(["autorelease: tagged"], pr.number);
    }
  }
  return result;
}

async function main(): Promise<void> {
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "release creation must use the current main workflow");
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  assert.ok(owner && repo && process.env.RELEASE_PLEASE_TOKEN && process.env.GITHUB_OUTPUT);
  const pr = process.env.RECOVER_RELEASE_PR ?? "";
  const sha = process.env.RECOVER_RELEASE_SHA ?? "";
  assert.equal(!!pr, !!sha, "recovery requires both PR and merge SHA");
  if (pr) { assert.match(pr, /^[1-9][0-9]*$/); assert.match(sha, /^[a-f0-9]{40}$/); }
  const github = await GitHub.create({ owner, repo, token: process.env.RELEASE_PLEASE_TOKEN, defaultBranch: "main" });
  const releases = await runComponentReleases(github, (source) => {
    execFileSync("git", ["merge-base", "--is-ancestor", source, "HEAD"], { windowsHide: true, timeout: 30_000 });
  }, pr ? { pr: Number(pr), sha } : undefined);
  for (const [key, value] of Object.entries(releaseOutputs(releases))) appendFileSync(process.env.GITHUB_OUTPUT!, `${key}=${value}\n`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
