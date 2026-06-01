## Story / Outcome

As a Kontour product implementer, I want a small emitter and local/composite sink implementation, so that one semantic control record can be delivered to local JSONL and another sink without products hand-writing transport logic.

## Problem

The current inspector can read fixtures, but producers do not yet have a small reusable boundary for writing records. Without a skeleton, products will create ad hoc file writers and make multi-output delivery harder.

## Scope

- Add dependency-free emitter module.
- Implement `LocalFileSink` for control events/projections under `.kontour/` paths.
- Implement `CompositeSink` with independent sink results.
- Add an in-memory test sink for tests.
- Add tests proving fanout preserves event/projection id and does not execute action descriptors.
- Add README or docs usage snippet.

## Non-goals

- Real HTTP/API network sink.
- Real OTLP exporter.
- Background retries, durable outbox, auth, hosted ingestion.
- Product adapters or Campfit integration.
- UI.

## Requirements

- R1: Emitter MUST accept control events and projection snapshots matching the V0 contract.
- R2: Local sink MUST write append-only JSONL for events and latest/current JSON for projections using safe repo-relative paths.
- R3: Composite sink MUST fan out the same record to multiple sinks without changing record id.
- R4: Composite sink MUST report per-sink success/failure independently.
- R5: Implementation MUST NOT execute action descriptors, open URLs, fetch endpoints, or mutate product-owned state.
- R6: Tests MUST prove local+secondary sink fanout for one control event.

## Acceptance Criteria

- AC1: A test emits one control event through `CompositeSink([LocalFileSink, InMemorySink])` and verifies the same `event.id` reaches both sinks.
- AC2: A test emits one projection snapshot through the local sink and verifies it can be read by the existing inspector/loader.
- AC3: Per-sink delivery result includes sink id/name, status, and error details when simulated failure occurs.
- AC4: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports.
- AC5: README or docs show local+future API fanout concept without implementing the API.

## Verification Expectation

- `node --test`.
- Fixture inspector command still passes.
- Forbidden API scan.
- Code and security review.

## Milestone / Delivery Outcome

`Kontour Console Producer Contract`

## Dependencies / Blockers

Blocked by #4: Define Kontour Emitter, Sink, And Plane Contracts, unless the contract docs are included in the same PR.

## Source Artifact

`.agents/flow-agents/kontour-emitter-sink-boundary/kontour-emitter-sink-boundary--idea-to-backlog.md`

## Priority Rationale

This provides implementation evidence for the producer output boundary and prevents products from building ad hoc file-only emitters.

## Expected Size

Medium.

## Thinnest Meaningful Slice

Dependency-free local/composite sink skeleton with tests only. No real network sink, hosted API, OTLP exporter, product adapter, or UI.
