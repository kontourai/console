# Discover local .kontour producer outputs

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: selected
type: pull-work

## board_snapshot

- Provider: GitHub Issues in `kontourai/kontour-console`.
- Selected item: `#6 Discover local .kontour producer outputs`.
- URL: `https://github.com/kontourai/kontour-console/issues/6`.
- State: `OPEN`.
- Milestone: `Kontour Console Producer Contract`.
- Dependencies: `#5 Implement local and composite sink skeleton` is closed and provides `KontourEmitter`, `LocalFileSink`, `CompositeSink`, and `InMemorySink`.

## wip_assessment

- Local workspace was clean before selection.
- No open implementation work is active in this checkout.
- Start-new-work decision: `proceed`.

## selection

Selected issue `#6` because it is the next thin slice after the local emitter/sink skeleton. It closes the local loop from Console producer output to Console reader input without introducing hosted ingestion, product adapters, or UI.

## grouping_check

- Grouping decision: `single-item`.
- Split/keep decision: keep as one issue because `.kontour` event discovery, projection discovery, tests, and docs form one usable local read path.

## anchor

Objective: teach the console foundation and inspector to discover local `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json` outputs written by Console producers, while preserving checked-in fixture inspection.

Authoritative sources:

- GitHub issue `#6`.
- `.agents/flow-agents/discover-local-kontour-producer-outputs/issue-body.md`.
- `docs/specs/projection-schema.md`.
- `docs/specs/emitter-sink-plane-contract.md`.
- Existing loader/inspector in `src/console-foundation/index.js`.

Non-goals:

- Hosted API ingestion.
- HTTP/API sink.
- Product-specific Surface/Flow/Survey adapters.
- UI/dashboard work.
- Durable outbox or background watcher.
- Replaying events into new projections beyond reading existing local event streams and projection snapshots.

Done criteria:

- AC1: A test writes one event through `LocalFileSink`, then loads it through the console foundation local discovery path and verifies the same event id is present.
- AC2: A test writes one projection through `LocalFileSink`, then loads it through the console foundation local discovery path and verifies existing projection summaries/action descriptors work.
- AC3: Existing `npm run inspect:fixtures` output still works for checked-in examples.
- AC4: README/docs show the local loop: `KontourEmitter`/`LocalFileSink` writes `.kontour`, then inspector/foundation reads `.kontour`.
- AC5: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports.

## work_scope

Allowed files/areas:

- `src/console-foundation/index.js`
- `bin/kontour-console-inspect.js`
- `test/*.test.js`
- `README.md` and relevant docs under `docs/specs/`
- `.agents/flow-agents/discover-local-kontour-producer-outputs/`

Risky areas:

- recursive `.kontour` discovery path containment
- symlink handling for local input files/directories
- preserving fixture-only behavior for `inspect:fixtures`
- avoiding action execution or network behavior

## worktree_decision

- sandbox_mode: `local-edit`.
- Worktree used: no.
- Rationale: repo is small, workspace is clean, and the slice is bounded to existing loader/CLI/tests/docs.

## pickup_gate

- Status: pass.
- Reason: issue is shaped, dependency #5 is complete, acceptance criteria are concrete, and implementation scope is narrow.

## handoff

Recommended `plan-work` prompt:

> Plan implementation for GitHub issue #6 in `/Users/brian/dev/github/kontourai/kontour-console`: add local `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json` discovery to the console foundation/inspector. Preserve existing fixture inspection behavior. Add tests that write through `LocalFileSink` then read through the local discovery path. Include source labels/relative paths distinguishing docs examples from `.kontour` outputs. Update README/docs for the local emit -> inspect loop. Do not implement hosted ingestion, HTTP/API sink, product adapters, UI, durable outbox, watcher, or event-to-projection rebuilding.
