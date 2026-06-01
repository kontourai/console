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

A Console producer is the Kontour product or product runtime that emits control-plane records for Kontour Console. Surface, Flow, Survey, Veritas, and Flow Agents are the primary Console producers. Vertical products usually contribute through those primitives as extension metadata and refs, rather than depending on `.kontour` or Kontour Console directly. This is separate from any product-native "producer" concept inside those products, such as a crawler, verifier, importer, workflow runner, or agent.

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

After a producer writes local records, inspect the generated `.kontour` tree without copying files into `docs/examples`:

```sh
node bin/kontour-console-inspect.js local
```

The same local read path is exported for programmatic consumers:

```js
const { inspectLocalKontour } = require("./src/console-foundation");

const report = inspectLocalKontour({ rootDir: process.cwd() });
console.log(report.eventStreams.length, report.projections.length);
```

`inspectLocalKontour` recursively reads `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json`, labels records as `local`, and treats action descriptors as read-only data. `npm run inspect:fixtures` remains fixture-only for checked-in examples under `docs/examples`.

`CompositeSink` returns one child result per sink, so a local `accepted` result can remain visible even when another sink fails. A future hosted API sink can be added as another child sink role in this fanout model, but this package does not implement an API, network transport, background retries, or remote ingestion.

### Surface Claim Status/Freshness Producer Helper

`surfaceClaimStateToProjection()` and `surfaceFreshnessTransitionToEvent()` are the first Surface Console producer pattern in this package. They are dependency-free helper/example functions for mapping caller-owned Surface claim state into local Console records; they are not live Surface integration.

```js
const {
  KontourEmitter,
  LocalFileSink,
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent
} = require("./src/console-foundation");

const emitter = new KontourEmitter({
  sink: new LocalFileSink({ root: ".kontour" })
});

await emitter.emitProjection(surfaceClaimStateToProjection({
  claimId: "claim-provider-directory-current",
  status: "verified",
  freshness: { status: "fresh", asOf: "2026-06-01T16:05:00Z" },
  validFrom: "2026-06-01T16:00:00Z",
  validUntil: "2026-06-30T16:00:00Z",
  lastUpdatedAt: "2026-06-01T16:05:00Z",
  generatedAt: "2026-06-01T16:06:00Z",
  evidenceRefs: [{ product: "surface", kind: "evidence", id: "evidence-directory-crawl" }],
  actionRefs: [{ product: "surface", kind: "action", id: "action-refresh-directory" }]
}));

await emitter.emitEvent(surfaceFreshnessTransitionToEvent({
  claimId: "claim-provider-directory-current",
  occurredAt: "2026-06-01T16:10:00Z",
  before: { status: "stale" },
  after: { status: "fresh" }
}));
```

Optional action descriptors supplied to the helper are persisted as inert projection data only. The helper does not fetch Surface data, start Flow, execute commands, dereference URLs, or mutate product state.

### Flow Process/Gate Status Producer Helper

`flowProcessStateToProjection()` and `flowGateTransitionToEvent()` are dependency-free Flow Console producer helper/example functions. They map caller-owned process and gate state into local Console records; they are not real Flow integration, do not run Flow control semantics, and do not perform action descriptors. Action descriptors are inert, read-only metadata for display and review.

```js
const {
  KontourEmitter,
  LocalFileSink,
  inspectLocalKontour,
  getFlowProcessStatus,
  flowProcessStateToProjection,
  flowGateTransitionToEvent
} = require("./src/console-foundation");

const emitter = new KontourEmitter({
  sink: new LocalFileSink({ root: ".kontour" })
});

await emitter.emitProjection(flowProcessStateToProjection({
  processId: "run-provider-onboarding-42",
  status: "running",
  currentStep: { id: "review-provider-fields" },
  percentComplete: 62,
  generatedAt: "2026-06-01T18:12:30Z",
  openGateRefs: [{ product: "flow", kind: "gate", id: "gate-provider-review" }],
  gates: [{ id: "gate-provider-review", status: "open" }],
  actions: [{
    id: "action-resume-provider-onboarding",
    kind: "resume",
    authority: { product: "flow", command: "flow.run.resume" },
    subjectRefs: [{ product: "flow", kind: "run", id: "run-provider-onboarding-42" }]
  }]
}));

await emitter.emitEvent(flowGateTransitionToEvent({
  processId: "run-provider-onboarding-42",
  gateId: "gate-provider-review",
  occurredAt: "2026-06-01T18:15:00Z",
  before: { status: "waiting" },
  after: { status: "open" }
}));

const report = inspectLocalKontour({ rootDir: process.cwd() });
const statuses = getFlowProcessStatus(report.projections, {
  processId: "run-provider-onboarding-42"
});
console.log(statuses[0].status, statuses[0].actions[0].readOnly);
```

## Docs

- [Product Boundaries](docs/product-boundaries.md)
- [Event And Projection Schema](docs/specs/projection-schema.md)
- [Emitter, Sink, And Plane Contract](docs/specs/emitter-sink-plane-contract.md)
- [Example event streams](docs/examples/event-streams/)
- [ADR 0001: Kontour Console As Suite Management Plane](docs/adr/0001-kontour-console-as-suite-management-plane.md)
