# Kontour Console

Kontour Console is the suite-level management and visibility product for Kontour.

The primitives remain portable:

- Surface owns claim trust state.
- Flow owns process transparency and gate control.
- Survey owns fact-review records.
- Veritas owns repo/change governance.
- Flow Agents owns agent-facing runtime distribution.

Kontour Console brings those products together into one operating plane for claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions.

This repo ships a small local read-only fixture inspector package alongside the product context and architecture decisions; it is not an app or hosted service.

## Local Fixture Inspection

Run the read-only fixture inspector from the repo root:

```sh
npm run inspect:fixtures
```

The command reads checked-in files under `docs/examples/event-streams/` and `docs/examples/projections/`, validates the local v0 envelopes, and prints event counts plus current claim, process, gate, review, action, and link summaries. Actions are shown as inert descriptors only; the inspector does not execute product commands, follow URLs, or mutate product-owned state.

## Local Console Producer Emission

A Console producer is the Kontour product or product runtime that emits control-plane records for Kontour Console. Surface, Flow, Survey, Veritas, Flow Agents, and vertical products such as Campfit can all be Console producers. This is separate from any product-native "producer" concept inside those products, such as a crawler, verifier, importer, workflow runner, or agent.

Products can write local control-plane records without dependencies or hosted infrastructure. `LocalFileSink` writes under a configured `.kontour` root, appending events below `.kontour/events/` and writing current projection snapshots below `.kontour/projections/`.

```js
const {
  KontourEmitter,
  LocalFileSink,
  CompositeSink,
  InMemorySink
} = require("./src/console-foundation");

const memory = new InMemorySink();
const emitter = new KontourEmitter({
  sink: new CompositeSink([
    new LocalFileSink({ root: ".kontour" }),
    memory
  ])
});

const result = await emitter.emitEvent({
  schema: "kontour.console.event",
  version: "0.1",
  id: "event-provider-directory-updated",
  type: "claim.updated",
  occurredAt: "2026-06-01T16:00:00Z",
  producer: { product: "surface", id: "surface-console-producer" },
  scope: { product: "surface", kind: "tenant", id: "acme" },
  subject: { product: "surface", kind: "claim", id: "claim-provider-directory-current" },
  payload: {}
});

console.log(result.children.map((child) => ({
  sinkId: child.sinkId,
  outcome: child.outcome,
  recordId: child.recordId
})));
```

`CompositeSink` returns one child result per sink, so a local `accepted` result can remain visible even when another sink fails. A future hosted API sink can be added as another child sink role in this fanout model, but this package does not implement an API, network transport, background retries, or remote ingestion.

## Docs

- [Product Boundaries](docs/product-boundaries.md)
- [Event And Projection Schema](docs/specs/projection-schema.md)
- [Emitter, Sink, And Plane Contract](docs/specs/emitter-sink-plane-contract.md)
- [Example event streams](docs/examples/event-streams/)
- [ADR 0001: Kontour Console As Suite Management Plane](docs/adr/0001-kontour-console-as-suite-management-plane.md)
