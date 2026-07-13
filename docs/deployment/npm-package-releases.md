# npm package releases

`@kontourai/console-core` is the canonical owner of shared Console contracts and is released independently from the root Console package. The CLI uses an exact Core version because its executable loads Core package subpaths at startup.

Release Core before CLI. A CLI tag is allowed to publish only after its exact Core dependency is visible on npm and exposes both `./product-capability-descriptor` and `./product-capability-descriptor/node`. Core publication is blocking, not best effort.

Local workspace success is not adopter evidence. Pull requests must install copied CLI and Core tarballs in a temporary directory outside the repository with workspace resolution unavailable. Release verification additionally installs exact public versions into an isolated npm cache and runs the public `npx` entrypoint. Release Please owns package manifests, changelogs, component tags, and root lock workspace identities; generated release pull requests must not be repaired by hand.

## Trusted publisher identity and retries

Configure each npm package's GitHub Actions trusted publisher with organization `kontourai`, repository `console`, and workflow filename `release-please.yml`. npm validates the calling workflow when a reusable workflow performs `npm publish`, so `.github/workflows/publish-npm.yml` is implementation-only and must not be configured or dispatched as a second publisher identity. Both the parent and reusable child retain `id-token: write`; no long-lived npm publish token is used.

Retry an immutable target through the same trusted-publisher identity from current `main`:

```bash
gh workflow run release-please.yml --repo kontourai/console --ref main -f target_tag=cli-v0.4.0
```

Replace the tag with the exact existing Release Please tag, such as `v2.7.0` or `console-core-v0.2.0`. The reusable publisher resolves the exact tag, proves it is an ancestor of current `main`, repeats the Node 22/24 verification matrix, skips an already-published package, publishes an absent version once with provenance, and confirms the exact registry version before succeeding. Never retag a failed release or retry it from a branch workflow definition.
