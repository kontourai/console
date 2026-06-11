# Contributing

This file is intentionally short.

The main docs in this repo are written for people installing and using Console.
This file is the footnote for people developing the product itself.

## Development Rules

- Console is the suite operating plane over primitives — it renders and correlates; it must not become the authority for claim, gate, review, or governance semantics
- keep the core product generic — no machine-specific paths, usernames, or private workspace assumptions in tracked source
- this repo is public; the production console.kontourai.io configuration lives privately — never commit hosted configuration
- run `npm run check:content-boundary` before any commit that touches public-facing copy — this repo must not leak private deployment or vertical terms
- keep `docs/product-boundaries.md` and `CONTEXT.md` current when the product boundary changes

## Setup

```bash
npm install
```

Node >= 22 is required (the `console-server` workspace uses `node:sqlite`).

## Verification

Before opening a PR:

```bash
npm test
```

This runs typechecks, the content-boundary check, all workspace suites (console-core, console-server, console-ui), the dev-local smoke test, and browser tests.

Individual checks:

- `npm run typecheck` — TypeScript across all workspaces
- `npm run check:content-boundary` — no private or vertical terms in public copy
- `npm run test:browser` — Playwright browser tests
- `npm run validate:repo-hooks` — verify repo hook wiring

## PR Expectations

- one concern per PR; keep diffs reviewable
- link to the relevant spec in `docs/specs/` when changing an event or projection contract
- use conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`) — releases are automated with release-please

## Releases

Releases are automated with release-please: merges to main accumulate into a release PR, and merging it tags the version and dispatches the npm publish workflow. The publish job covers `@kontourai/console-core` then `@kontourai/console`.

## Repository

https://github.com/kontourai/console

All projects are Apache-2.0.
