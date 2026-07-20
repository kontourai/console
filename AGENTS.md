# Console Agent Guidance

Console is the suite operating plane over the primitives — it renders and correlates; it never becomes the authority for claim, gate, review, or governance semantics. This repo is public; the production console.kontourai.io configuration lives privately.

## Source Of Truth

- Product framing and boundaries: `README.md`, [docs/product-boundaries.md](docs/product-boundaries.md), `CONTEXT.md`.
- Three workspaces: `console-core` (shapes), `console-server` (hub, sinks, bridge, bins), `console-ui` (React app, not published).
- Event/projection contracts: [docs/specs/](docs/specs/); cross-product example streams: `docs/examples/event-streams/`.
- `dist/` outputs are generated; the golden demo lives at [docs/examples/golden-demo.md](docs/examples/golden-demo.md).

## Pull More Context When Needed

- See it locally (hub + UI + replay): README "See it locally".
- Bridging real Flow runs: README "Bridge a real Flow run" and `console-server/src/console-foundation/flow-bridge.ts`.
- Hosted deployment shape (generic): [docs/deployment/hosted-console.md](docs/deployment/hosted-console.md).

## Match Checks To Change Type

- Any code change: `npm test` (typecheck, content boundary, all workspace suites, dev-local, browser tests).
- Public-facing copy: `npm run check:content-boundary` — this repo must not leak private deployment or vertical terms.
- Package metadata/exports/bins: `npm pack --dry-run` per workspace; node:sqlite requires Node >= 22.
- Releases: `release-please.yml` is the single npm trusted-publisher identity; it publishes exact component tags via OIDC and owns immutable-tag retries. See [docs/deployment/npm-package-releases.md](docs/deployment/npm-package-releases.md).

## Useful Commands

- `npm test` · `npm run dev:local` · `npm run inspect:fixtures` · `npm run check:content-boundary` · `npm run validate:repo-hooks`

<!-- veritas:governance-block:start -->
This repo uses Veritas for AI governance. Read `.veritas/GOVERNANCE.md` before making changes.
After changes, run `veritas readiness` and address any FAIL lines before finishing.
<!-- veritas:governance-block:end -->
