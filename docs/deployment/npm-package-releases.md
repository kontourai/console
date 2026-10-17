# npm package releases

`@kontourai/console-core` is the canonical owner of shared Console contracts and is released independently from the root Console package. The CLI uses an exact Core version because its executable loads Core package subpaths at startup.

Release Core before CLI. A CLI tag is allowed to publish only after its exact Core dependency is visible on npm and exposes both `./product-capability-descriptor` and `./product-capability-descriptor/node`. Core publication is blocking, not best effort.

The reusable publisher applies that exact registry check, including the
`./intent-binding` export, to the resolved root Console, Server, and UI manifests
on automatic releases and immutable retries. Core itself has no dependency on
its own publication. Current-main policy code reads each immutable tag's manifest.

Local workspace success is not adopter evidence. Pull requests must install copied CLI and Core tarballs in a temporary directory outside the repository with workspace resolution unavailable. Release verification additionally installs exact public versions into an isolated npm cache and runs the public `npx` entrypoint. Release Please owns package manifests, changelogs, component tags, and root lock workspace identities; generated release pull requests must not be repaired by hand.

Packed Console and Server adopters must also compile their public declarations
with `skipLibCheck: false` and without the optional Flow Agents package. Optional
Kit integration is checked separately with the real Flow Agents contract.

## Trusted publisher identity and retries

Configure each npm package's GitHub Actions trusted publisher with organization `kontourai`, repository `console`, and workflow filename `release-please.yml`. npm validates the calling workflow when a reusable workflow performs `npm publish`, so `.github/workflows/publish-npm.yml` is implementation-only and must not be configured or dispatched as a second publisher identity. Both the parent and reusable child retain `id-token: write`; no long-lived npm publish token is used.

Retry an immutable target through the same trusted-publisher identity from current `main`:

```bash
gh workflow run release-please.yml --repo kontourai/console --ref main -f target_tag=cli-v0.4.0
```

Replace the tag with the exact existing Release Please tag, such as `v2.7.0` or `console-core-v0.2.0`. The reusable publisher resolves the exact tag, proves it is an ancestor of current `main`, repeats the Node 22/24 verification matrix, skips an already-published package, publishes an absent version once with provenance, and confirms the exact registry version before succeeding. Never retag a failed release or retry it from a branch workflow definition.

## Complete a partially created component release

Component creation uses the locked Release Please library's strategies with the
original merged PR body. Re-parsing a body that has already been serialized from
HTML text can decode escaped custom elements and hide later component sections.
The normal PR-generation action remains separate and skips release creation.
Every selected version must equal its package manifest at the original merge SHA;
all existing tag and release source identities are checked before any creation.

If a merged release PR created only some component releases, use the same trusted
caller on current `main`, binding both the merged PR number and merge SHA:

```bash
gh workflow run release-please.yml --repo kontourai/console --ref main \
  -f recover_release_pr=245 \
  -f recover_release_sha=2a64d90497f37b683c3e7cd0129d938caf3e849a
```

This recovery is for missing releases from that exact merge, not a new version
bump. For PR 245, the expected missing releases are `console-core-v0.4.0` and
`console-ui-v0.3.0`. Existing `v2.9.0` and `console-server-v1.1.0` remain unchanged
and produce no new publisher outputs. Recovery does not edit the PR body or
labels, regenerate a release PR, force a tag, or publish from a newer source.
A repeated completed recovery creates nothing. Conflicting existing identities
or notes/manifests refuse recovery before creation.

After this source repair lands, the operator should:

1. Capture the existing publisher's current state. Queued jobs are pending, not
   failures. Keep the exact-Core gate enabled; do not retry dependent publication
   while Core 0.4.0 is unavailable.
2. Run the bound component recovery above. Confirm that only the missing Core/UI
   releases are created at the original merge SHA. The existing Core-first
   publisher ordering and Node 22/24 gates then apply to those outputs.
3. Retain actual primary-publish results and exact public Core 0.4.0 metadata and
   required exports before allowing dependent publication. Core 0.5.0 alone
   cannot satisfy the immutable root/Server 0.4.0 dependency pins.
   If an interrupted recovery already created the exact Core tag/release but
   npm 0.4.0 is still absent, recover its publication through the same workflow
   with `target_tag=console-core-v0.4.0` before resuming UI or other dependents.
   Release creation and npm publication are separate observations.
4. For an existing root/Server run that actually failed and remains unpublished,
   retry its existing exact tag through `target_tag` only after Core 0.4.0 is
   public. Do not duplicate a pending or successful run. Verify UI 0.3.0 and all
   public archives, provenance, strict adopters and entrypoints separately.
5. Refresh and review future generated release proposals through normal Release
   Please flow after the missing boundary is restored. Do not merge an unreviewed
   higher-version proposal as a substitute for these exact missing versions.

Do not combine `target_tag` with component recovery inputs. Source and recovery
controls do not establish successful publication or registry availability. An
actual credentials, trusted-publisher, or organization/bootstrap error requires
its own retained execution evidence; first publication alone does not establish
such a blocker.
