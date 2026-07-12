# Product Boundaries

Console exists to make Kontour primitives operable together without turning the suite-level console into the authority for each product's core semantics.

## Product Stack

```text
Surface
  Product transparency foundation.
  Claims, evidence, policies, trust snapshots, freshness, gaps.

Flow
  Process transparency and gate enforcement built with Surface.
  Steps, gates, transitions, runs, exceptions, Flow Reports, Run Control API, Flow Console contracts.

Survey
  Fact-review record contracts built with Surface and Flow.
  Sources, observations, extractions, candidates, review records, claim publication, Survey Console review surfaces.

Veritas
  Repo/change governance vertical built with Surface.
  Repo standards, requirements, evidence checks, merge readiness.

Flow Agents
  Agent-facing workflow distribution built with Flow.
  Modes, skills, runtime adapters, provider settings, hooks, agent-specific console extensions.

Console
  Suite-level management and visibility product built over the primitives.
  Cross-product claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions.
```

## Primitive Boundary

Kontour primitives must remain useful without Console:

- Surface trust state remains portable, schema-first, and inspectable without a hosted service.
- Flow Runs and Flow Reports remain local, file-backed, and useful without a hosted service.
- Survey fact-review records remain product-side contracts.
- Veritas readiness and evidence checks remain repo/change governance.
- Flow Agents runtime adapters and kits remain usable outside a suite-level console.

Console may host, aggregate, correlate, and manage cross-product state, but it must preserve each product's authority boundary.

## Suite-Level Boundary

Console owns the integrated operating experience:

- cross-product navigation
- current operating state
- unified work queues
- action routing
- proof and decision timelines
- claim/process/evidence correlation
- primitive-console and vertical extension composition
- hosted collaboration, monitoring, and notification features when present

Console should answer:

- What is currently true?
- What is stale or disputed?
- What is in progress?
- What is blocked?
- What proof supports this state?
- What decisions were made?
- What is the next action?
- Who or what has authority to move it forward?

## Product Authority

Console must not redefine:

- Surface status, freshness, conflict, or trust derivation semantics
- Flow gate, transition, route-back, exception, or run-control semantics
- Survey source, extraction, candidate, review, or publication semantics
- Veritas repo standards, requirements, evidence checks, or merge readiness semantics
- Flow Agents runtime adapter, hook, provider, or skill semantics
- vertical product domain truth

Suite-level actions must route through the product that owns the authority for that action.

## Survey And Vertical Review Boundary

Survey is the primitive review surface for source-to-candidate-to-review workflows. A Survey Console can expose review queues, review item detail, candidate/evidence context, reviewer decisions, and publication intent without requiring Console.

A vertical product should extend Survey Console for domain-specific admin review UX. It can provide domain labels, subject refs, field renderers, vertical action context, and domain links, but Survey owns review item lifecycle and decision semantics. Surface owns the resulting claims/evidence/trust state. Flow owns process, gate, route-back, and run-control semantics.

The vertical product should not need to know about `.kontourai/console` or Console in the normal path. The primitive layer can emit Console records locally or to future sinks; Console reads those primitive records and composes the suite-level view. A vertical may later expose an optional Console extension, but that should be additive, not a requirement for using Survey, Surface, or Flow.

## Console Contract Foundation

The shared foundation should be contracts first:

- projection/read-model boundaries
- cross-product identity links
- queue and action vocabulary
- extension metadata
- route conventions
- freshness, refresh, and reverification semantics
- event and decision timelines

## Console Producers

For Console contracts, a producer is the Kontour product or product runtime emitting control-plane records for suite-level visibility. The primary producers are the portable primitives: Surface, Flow, Survey, Veritas, and Flow Agents. Vertical products usually contribute through those primitives as extension metadata and cross-product refs; they should not be required to emit `.kontourai/console` or Console records directly.

That meaning is separate from product-native producers inside each product. A crawler, extractor, verifier, importer, workflow runner, agent, or policy clock should be preserved as an actor/source/provenance detail, but it does not replace the top-level product authority boundary.

Shared UI code can come later, after Surface Console, Flow Console, and Survey Console prove which primitives are actually common. Vertical admin review UX is expected to extend Survey Console first, then appear in Console through Survey/Surface/Flow records.

See [Event And Projection Schema](specs/projection-schema.md) for the v0.1 local event stream and projection envelope, [Emitter, Sink, And Plane Contract](specs/emitter-sink-plane-contract.md) for the Console producer boundary between semantic records, required local file output, future sinks, and telemetry, and [Product Capability Descriptor Protocol](specs/product-capability-descriptor.md) for offline discovery of product-owned CLI capabilities without transferring execution authority to Console.
