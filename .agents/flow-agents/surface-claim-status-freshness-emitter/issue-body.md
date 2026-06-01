## Story / Outcome

As a Kontour product implementer, I want a concrete Surface claim status/freshness emitter example, so other Kontour products can see the smallest pattern for mapping product state into Console events/projections and local `.kontour` output.

## Problem

Kontour Console now has a local emitter/sink boundary and can discover `.kontour` outputs, but producers still lack a concrete adapter pattern. Without one, Surface, Flow, Survey, Veritas, Flow Agents, and vertical products may each invent slightly different projection/event shapes for claim status, freshness, validity windows, evidence refs, and refresh actions.

## Scope

- Add a dependency-free Surface claim status/freshness adapter helper or fixture module.
- Map a small Surface claim state object into a `KontourConsoleProjection` containing `claims[]`, `freshness`, `validFrom`, `validUntil`, `lastUpdatedAt`, evidence refs, and action refs.
- Map a freshness transition into a `KontourConsoleEvent`, such as `claim.freshness.changed`.
- Emit through `KontourEmitter` and `LocalFileSink` in tests.
- Verify `inspectLocalKontour()` reads the emitted Surface projection/event and `getSurfaceClaimStatus()` can query the current claim without selecting a Flow run.
- Document the producer pattern as an example to copy, not a real Surface repo integration.

## Non-goals

- Real Surface repo integration.
- Hosted API ingestion.
- HTTP/API sink.
- UI/dashboard work.
- Product adapters for Flow, Survey, Veritas, Flow Agents, or Campfit.
- Event-to-projection reducer/rebuild engine.
- Action execution or Flow run start integration.

## Requirements

- R1: The adapter MUST identify `producer.product` as `surface` and preserve Console producer terminology.
- R2: The projection MUST include claim status, freshness, validity window fields, evidence refs, action refs, and inert action descriptors when provided.
- R3: The event helper MUST produce a valid `claim.freshness.changed` Console event with stable id, subject claim ref, before/after payload, and cross-product refs.
- R4: Tests MUST emit through `KontourEmitter`/`LocalFileSink` and read back through `inspectLocalKontour()`.
- R5: The queried claim MUST be readable via `getSurfaceClaimStatus()` without requiring a selected Flow run.
- R6: The implementation MUST NOT execute actions, dereference URLs, call endpoints, fetch network resources, or mutate product-owned Surface state.

## Acceptance Criteria

- AC1: A test maps a Surface claim state into a projection, emits it locally, discovers it with `inspectLocalKontour()`, and verifies `getSurfaceClaimStatus()` returns status, freshness, `validFrom`, `validUntil`, `lastUpdatedAt`, evidence refs, and action refs.
- AC2: A test maps a freshness transition into a `claim.freshness.changed` event, emits it locally, discovers it with `inspectLocalKontour()`, and verifies the event id/type/subject/payload refs.
- AC3: Adapter output validates through the existing event and projection validators with no validation errors.
- AC4: README or docs show this as the first Surface Console producer pattern, clearly marked as an example/helper rather than real Surface integration.
- AC5: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports.

## Verification Expectation

- `npm test`
- `npm run inspect:fixtures`
- local discovery smoke via tests or CLI
- forbidden API scan
- code and security review

## Priority Rationale

This gives Kontour products the first concrete copyable Console producer pattern after the generic emitter/sink and `.kontour` discovery work.

## Expected Size

Medium.

## Thinnest Meaningful Slice

One dependency-free Surface claim status/freshness helper plus tests and docs. No real product integration, hosted ingestion, UI, or reducer engine.
