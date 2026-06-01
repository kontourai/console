## Story / Outcome

As a Kontour Console user, I want the local inspector to discover `.kontour/` outputs written by Console producers, so the local emit -> local read loop works without copying records into checked-in fixture folders.

## Problem

`KontourEmitter` and `LocalFileSink` can now write local events and projections under `.kontour/`, but the inspector primarily reads checked-in examples under `docs/examples`. That leaves the producer boundary and console reader disconnected for local product integration.

## Scope

- Add local `.kontour/events` and `.kontour/projections` discovery to the console foundation.
- Preserve existing fixture inspection behavior by default or make combined fixture+local inspection explicit and predictable.
- Include source labels or relative paths that distinguish checked-in examples from local `.kontour` records.
- Add tests that emit via `LocalFileSink`, then load/inspect the emitted local outputs.
- Update README/docs with the local emit -> inspect loop.

## Non-goals

- Hosted API ingestion.
- HTTP/API sink.
- Product-specific Surface/Flow/Survey adapters.
- UI/dashboard work.
- Durable outbox or background watcher.
- Replaying events into new projections beyond reading existing local event streams and projection snapshots.

## Requirements

- R1: Console foundation MUST load event streams from `.kontour/events/**/*.jsonl` using the existing event validation path.
- R2: Console foundation MUST load projection snapshots from `.kontour/projections/**/*.json` using the existing projection validation path.
- R3: Existing docs example fixture inspection MUST keep working.
- R4: Local discovery MUST distinguish source/relative paths sufficiently for users to see whether a record came from docs examples or `.kontour` output.
- R5: Local discovery MUST NOT execute actions, dereference URLs, call endpoints, or fetch network resources.
- R6: Local discovery MUST preserve path containment/symlink safety expectations for `.kontour` inputs.

## Acceptance Criteria

- AC1: A test writes one event through `LocalFileSink`, then loads it through the console foundation local discovery path and verifies the same event id is present.
- AC2: A test writes one projection through `LocalFileSink`, then loads it through the console foundation local discovery path and verifies existing projection summaries/action descriptors work.
- AC3: Existing `npm run inspect:fixtures` output still works for checked-in examples.
- AC4: README/docs show the local loop: `KontourEmitter`/`LocalFileSink` writes `.kontour`, then inspector/foundation reads `.kontour`.
- AC5: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports.

## Verification Expectation

- `npm test`
- `npm run inspect:fixtures`
- targeted local discovery command or smoke check
- forbidden API scan
- code and security review

## Priority Rationale

This closes the first practical local integration loop after the emitter/sink skeleton: Kontour products can emit Console records locally and Kontour Console can discover those local outputs.

## Expected Size

Medium.

## Thinnest Meaningful Slice

Read existing `.kontour` event/projection files into the current console foundation. No hosted ingestion, watcher, product adapter, UI, or projection rebuilding.
