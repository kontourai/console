# ADR 0001: Kontour Console As Suite Management Plane

Date: 2026-05-31

## Status

Accepted

## Context

Kontour is splitting into focused primitives:

- Surface for claim trust state, evidence, freshness, conflicts, and transparency gaps
- Flow for process transparency, gates, transitions, exceptions, continuation, and run control
- Survey for fact-review records from sources through candidates and publication
- Veritas for repo/change governance, evidence checks, requirements, and merge readiness
- Flow Agents for agent-facing workflow distribution, runtime adapters, skills, hooks, and provider setup

Each primitive should remain portable and useful on its own. At the same time, the strongest product value is the comprehensive operating view across those primitives: one place to see what is true, what is in progress, what is stale, what is blocked, what proof exists, what decisions were made, and what should happen next.

If every product ships an isolated console, operators must reconstruct the actual state of work by jumping between Surface claim status, Flow Run state, Survey candidate reviews, Veritas readiness, Flow Agents sessions, and vertical product admin screens. If Kontour Console owns primitive semantics directly, the suite loses the portability and clarity of the underlying products.

## Decision

Create Kontour Console as a suite-level management and visibility product.

Kontour Console owns the integrated operating plane:

- cross-product navigation
- current operating state
- unified work queues
- claim/process/evidence correlation
- proof and decision timelines
- suite-level action routing
- hosted collaboration and monitoring when present
- extension composition across products and verticals

Kontour Console does not own the primitive semantics underneath it. Surface, Flow, Survey, Veritas, Flow Agents, and vertical products remain the authorities for their own status models, policies, actions, and domain truth.

The early foundation should be event-first contracts and composition, not a premature shared UI package:

- append-only product event streams
- projection/read-model boundaries
- cross-product identity links
- queue and action vocabulary
- extension metadata
- route conventions
- freshness, refresh, and reverification semantics
- event and decision timelines

Surface Console and Flow Console should converge architecturally so Kontour Console can bridge them without rewriting either product's core model. Events should be the durable integration contract; projections and snapshots should be derived read models for fast rendering. A shared shell or component package can emerge after the shared console primitives prove stable.

## Consequences

Positive:

- Kontour has a clear suite-level product to sell.
- The primitives stay portable, local-first, and independently valuable.
- Surface Console and Flow Console can align toward a future management plane without blocking on hosted infrastructure.
- Vertical products such as Campfit can expose native review workflows while still contributing to the suite-level operating state.
- Cross-product questions become first-class: claim status plus process status plus proof plus next action.

Trade-offs:

- There is another product boundary to explain.
- Early implementation must avoid turning Kontour Console into a hidden dependency.
- Product projections need stable identity links and action contracts.
- Product event streams need stable event IDs, ordering, correlation, and replay semantics.
- Some UI duplication between Surface Console and Flow Console may be tolerated until the shared shell is justified.

## Alternatives Considered

### Keep Kontour Console As A Shared Component Package

Rejected because the product value is not only shared UI components. The suite-level product is the comprehensive management plane across primitives.

### Put Suite Management Inside Flow

Rejected because Flow owns process transparency, not the entire Kontour operating plane. Flow Console should contribute process state to Kontour Console without becoming the suite product.

### Let Each Product Keep A Separate Console Only

Rejected because operators need a unified view of claim status, process status, proof, decisions, and next actions across products.
