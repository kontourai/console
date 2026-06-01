# Product Boundaries

Kontour Console exists to make Kontour primitives operable together without turning the suite-level console into the authority for each product's core semantics.

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
  Sources, observations, extractions, candidates, review records, claim publication.

Veritas
  Repo/change governance vertical built with Surface.
  Repo standards, requirements, evidence checks, merge readiness.

Flow Agents
  Agent-facing workflow distribution built with Flow.
  Modes, skills, runtime adapters, provider settings, hooks, agent-specific console extensions.

Kontour Console
  Suite-level management and visibility product built over the primitives.
  Cross-product claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions.
```

## Primitive Boundary

Kontour primitives must remain useful without Kontour Console:

- Surface trust state remains portable, schema-first, and inspectable without a hosted service.
- Flow Runs and Flow Reports remain local, file-backed, and useful without a hosted service.
- Survey fact-review records remain product-side contracts.
- Veritas readiness and evidence checks remain repo/change governance.
- Flow Agents runtime adapters and kits remain usable outside a suite-level console.

Kontour Console may host, aggregate, correlate, and manage cross-product state, but it must preserve each product's authority boundary.

## Suite-Level Boundary

Kontour Console owns the integrated operating experience:

- cross-product navigation
- current operating state
- unified work queues
- action routing
- proof and decision timelines
- claim/process/evidence correlation
- product and vertical extension composition
- hosted collaboration, monitoring, and notification features when present

Kontour Console should answer:

- What is currently true?
- What is stale or disputed?
- What is in progress?
- What is blocked?
- What proof supports this state?
- What decisions were made?
- What is the next action?
- Who or what has authority to move it forward?

## Product Authority

Kontour Console must not redefine:

- Surface status, freshness, conflict, or trust derivation semantics
- Flow gate, transition, route-back, exception, or run-control semantics
- Survey source, extraction, candidate, review, or publication semantics
- Veritas repo standards, requirements, evidence checks, or merge readiness semantics
- Flow Agents runtime adapter, hook, provider, or skill semantics
- vertical product domain truth

Suite-level actions must route through the product that owns the authority for that action.

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

For Kontour Console contracts, a producer is the Kontour product or product runtime emitting control-plane records for suite-level visibility. Surface, Flow, Survey, Veritas, Flow Agents, and vertical products such as Campfit can all act as Console producers.

That meaning is separate from product-native producers inside each product. A crawler, extractor, verifier, importer, workflow runner, agent, or policy clock should be preserved as an actor/source/provenance detail, but it does not replace the top-level product authority boundary.

Shared UI code can come later, after Surface Console and Flow Console prove which primitives are actually common.

See [Event And Projection Schema](specs/projection-schema.md) for the v0.1 local event stream and projection envelope, and [Emitter, Sink, And Plane Contract](specs/emitter-sink-plane-contract.md) for the Console producer boundary between semantic records, required local file output, future sinks, and telemetry.
