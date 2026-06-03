# Kontour Emitter, Sink, And Plane Contract

Status: v0.1 draft

Kontour products emit product-owned records into Kontour Console without making the console, a hosted service, or a generic sink the authority for product semantics. This contract defines the Console producer boundary between semantic records and delivery adapters.

The event and projection schemas remain the record shape contract. This spec defines how those records move from a Console producer to local files now and to future hosted or telemetry destinations later.

## Terminology

A **Portable Product Record** is a product-owned durable record shaped for reuse across Kontour products, agents, consoles, APIs, and exported evidence packages. It usually follows the shared Kontour Resource Shape (`apiVersion`, `kind`, `metadata`, `spec`, `status`, and optional `proof`). Portable Product Records remain meaningful without Kontour Console.

A **Console handoff record** is the management-plane event or projection a Console producer emits so Kontour Console can aggregate, replay, correlate, display, and route through product authority. Console handoff records may carry, reference, or be derived from Portable Product Records, but they do not replace the product-owned record.

A **Console producer** is the Kontour product or product runtime that emits control-plane records for Kontour Console. Surface, Flow, Survey, Veritas, and Flow Agents are the primary Console producers. Vertical products usually contribute through those primitives as extension metadata and refs, rather than depending on `.kontour` or Kontour Console directly.

A **domain producer** is a product-native source inside one of those products, such as a crawler, extractor, verifier, importer, workflow runner, agent, or policy clock. Domain producers may appear as `actor`, `derivedFrom`, `evidence`, `payload.data`, or product-specific `extensions`, but they do not replace the top-level `producer` field's Console meaning.

The JSON field remains named `producer` for compatibility and brevity. In this spec, unqualified "producer" means Console producer unless explicitly described as a domain producer, actor, source, projector, or product-native component.

## Product Records And Console Handoffs

Kontour uses a layered contract:

| Layer | Shape | Owner | Purpose |
| --- | --- | --- | --- |
| Portable product record | Shared Kontour Resource Shape or product-native durable record. | The product that owns the domain semantics. | Durable product state, proof, review history, gate/run records, trust snapshots, and exported evidence packages. |
| Console event | `kontour.console.event` | The Console producer, under the producing product's authority. | Append-only "what happened" stream for replay, timeline, correlation, and live operating views. |
| Console projection | `kontour.console.projection` | The Console producer or projector, under the producing product's authority. | Current read model for fast local rendering and server ingest compatibility. |
| Sink delivery result | `SinkDeliveryResult` | The sink attempting delivery. | Operational delivery status for local files, fanout, future hosted API, or telemetry correlation. |

The consistent product record shape has value because it gives every product a predictable place for identity, observed state, and proof. The Console handoff shape has value because it gives the management plane a predictable stream/snapshot contract. They should map cleanly, but they are not the same authority.

Console handoff records must not require every product to migrate all internal records to the shared resource shape before emitting useful local Console state. During adoption, a producer may emit lightweight Console refs with `product`, `kind`, and `id`. When the referenced object is a Portable Product Record, the producer should enrich the ref with the resource's `apiVersion`, `name`, and `uid`.

### Mapping Rules

| Product-owned concept | Console handoff mapping | Authority |
| --- | --- | --- |
| Surface claim freshness changed | `claim.freshness.changed` event with the claim as `subject`; projection `claims[]` carries current status/freshness. | Surface owns freshness and trust semantics. |
| Surface claim verified with evidence | `claim.status.changed`, `claim.reverification.completed`, or `evidence.attached` events; projection `claims[]` and `evidence[]` carry current read model. | Surface owns claim status and evidence trust semantics. |
| Flow run progressed | `process.started` or `process.progressed` event with the Flow run as `subject`; projection `processes[]` carries current step and percent. | Flow owns process lifecycle semantics. |
| Flow gate opened, blocked, passed, failed, or routed back | `gate.opened`, `gate.failed`, `gate.passed`, or `gate.routed_back` event with the gate as `subject`; projection `gates[]` carries current gate state and refs. | Flow owns gate evaluation and route-control semantics. |
| Flow gate depends on a Surface claim | Event/projection `links` and refs connect the Flow gate/run to the Surface claim with `controls`, `blocks`, `updates`, or `evidenced_by` as appropriate. | The emitting products own the relationship assertions they emit; Console uses them for correlation. |
| Available refresh/resume/review action | Projection `actions[]` carries an inert descriptor and subject refs. | The authority product owns execution; sinks and generic Console consumers do not execute descriptors. |

The first proof pair is Surface plus Flow because it exercises both sides of the management plane: Surface trust state and Flow process/gate state. Survey, Veritas, Flow Agents, and vertical products should adopt the same mapping after the Surface/Flow path proves the contract.

## Goals

- distinguish control-plane records from telemetry-plane records
- keep local file output as a required first-class sink
- support multi-sink fanout from one semantic source record
- define per-sink delivery results, at-least-once delivery, and dedupe expectations
- preserve product authority when adapting records to different delivery formats
- keep action descriptors inert in every generic sink

## Non-Goals

This contract does not implement a hosted API, HTTP sink, OTLP exporter, retry daemon, outbox, product integration, UI, or action executor. Future sink roles are named so later implementation work has stable responsibilities, not because the repo currently ships those sinks.

## Planes And Authority

Kontour Console composes two related but separate planes:

| Plane | Records | Authority |
| --- | --- | --- |
| Control plane | Product-owned events, projection snapshots, evidence refs, identity links, decisions, review items, gates, process state, and action descriptors. | The producing product or primitive owns domain meaning. Surface owns claim trust state; Flow owns gate, transition, exception, and run-control semantics; Survey owns fact-review records; Veritas owns repo/change governance; Flow Agents owns runtime adapter state; vertical products own their domain truth. Kontour Console may aggregate, correlate, display, and route through product authority, but it does not redefine product truth. |
| Telemetry plane | Traces, spans, metrics, logs, usage/cost observations, health checks, delivery diagnostics, and operational events. | Telemetry describes operation and performance. It is not authority for claims, gates, review decisions, product domain facts, product state transitions, or action execution. |

Control-plane records answer what a product says is true, in progress, blocked, decided, evidenced, or available as a next action. They include:

- semantic events matching `KontourConsoleEvent`
- projection snapshots matching `KontourConsoleProjection`
- evidence refs and proof summaries
- cross-product identity links
- action descriptors carried by events or projections

Telemetry-plane records answer how Console producers, emitters, sinks, and consumers behaved operationally. They may include:

- traces and spans for emission, fanout, replay, or projection work
- metrics such as delivery latency, queue depth, retry count, duplicate count, and bytes written
- logs and operational events for debugging
- usage and cost observations for hosted or agentic workflows

The planes may share `correlationId`, `causationId`, producer identity, scope identity, event id, projection provenance, or trace context so an operator can connect a product event to delivery and processing behavior. Shared correlation does not transfer authority between planes. A telemetry success does not prove a claim is true, a telemetry error does not revoke product state, and a generic sink does not become the decision maker for a product action.

## Record Identity

Each semantic control-plane record has a stable identity before fanout:

- an event keeps its stable `id`
- a projection keeps its stable producer/scope/provenance identity and any product object ids inside the projection
- linked refs keep their product/kind/id tuple

Re-emitting the same semantic record keeps the same identity. Sinks may wrap or encode the record for a destination, but they must preserve the semantic identity needed for replay, dedupe, projection rebuilds, correlation, and audit trails.

## Roles

| Role | Plane | Responsibility | Status |
| --- | --- | --- | --- |
| `KontourEmitter` | Control plane first; may emit telemetry about delivery. | Console-producer-facing boundary that accepts a semantic Kontour record, validates the minimum envelope expected by this contract, assigns or preserves stable identity from the Console producer, and delegates delivery to configured sinks. It does not own product domain meaning or execute actions. | Contract role. |
| `LocalFileSink` | Control plane. | Required first-class sink that writes local JSONL event streams and local projection artifacts under a configured output root using sanitized producer/scope identifiers. It is the baseline local-first output and must remain useful without hosted infrastructure. | Required first sink role. |
| `CompositeSink` | Control plane fanout; may summarize telemetry. | Fanout coordinator that sends one semantic source record to multiple configured sinks and returns independent per-sink delivery results. It preserves the record identity across sinks and does not collapse network failure into local failure or local success into network success. | Contract role for multi-sink delivery. |
| Future `HttpApiSink` | Control plane delivery transport. | Future hosted/org delivery adapter that serializes semantic control-plane records to an authenticated API when configured. It adapts transport format, batching, headers, and response handling; it does not change product domain meaning, ids, action authority, or trust semantics. | Future role, not implemented here. |
| Future telemetry/Otel sink | Telemetry plane. | Future OpenTelemetry or telemetry exporter for traces, metrics, logs, and delivery diagnostics. It may reference control-plane ids for correlation, but it emits operational telemetry only and is not a control-plane source of truth. | Future role, not implemented here. |

Sinks adapt delivery format and transport. They do not adapt product meaning. A sink must not rewrite a Surface claim status into a different trust meaning, reinterpret a Flow gate result, normalize vertical domain truth, mint new product object identities, or turn an action descriptor into an executed action.

## Local-First Output

`LocalFileSink` is required because Kontour primitives must remain portable and useful without a hosted dependency. A Console producer that supports this contract must be able to emit control-plane records locally even when future hosted, org, telemetry, or network sinks are absent or failing.

Local file output follows the local JSONL and projection conventions in [Event And Projection Schema](projection-schema.md). Path tokens such as producer id, scope kind, and scope id are sanitized identifiers, not trusted path fragments. A local sink must resolve candidate paths under its configured output root, reject absolute paths, `..`, path separators inside identifier tokens, control characters, and symlink escapes, and must not read local paths from semantic records as write destinations.

Local success and future network success are separate results. A hosted/API sink failure must not erase a successful local write. A local write failure must be reported directly and must not be hidden by success from another sink.

## Fanout Contract

Fanout starts with one semantic source record:

1. The Console producer creates or supplies one stable semantic record.
2. `KontourEmitter` passes that record to its configured sink, often a `CompositeSink`.
3. `CompositeSink` sends the same semantic record, or a destination-specific encoding that preserves semantic identity, to each child sink.
4. Each sink returns its own delivery result.
5. The emitter returns an aggregate result that keeps every child result visible.

Fanout must not produce one product event id per sink. If the same `claim.status.changed` event is written locally, sent to a future hosted API, and correlated with telemetry, the control-plane event id remains stable across outputs. Projection object ids and cross-product refs follow the same rule.

## Delivery Results

Each sink delivery attempt reports an independent result:

```ts
type SinkDeliveryResult = {
  sinkId: string;
  sinkRole: "LocalFileSink" | "CompositeSink" | "HttpApiSink" | "TelemetryOtelSink" | string;
  outcome: "accepted" | "skipped" | "failed";
  recordId: string;
  recordKind: "event" | "projection" | "telemetry" | string;
  destination?: string;
  retryable?: boolean;
  errorCode?: string;
  safeMessage?: string;
  observedAt: string;
};
```

`accepted` means the sink accepted responsibility for the record according to that sink's contract, such as appending a local JSONL line or receiving a successful future API response. `skipped` means the sink intentionally did not deliver the record, such as a telemetry sink skipping a control-plane payload that has no telemetry representation. `failed` means the sink did not accept the record.

`recordId` is required for every delivery result. It is the stable semantic identity used to correlate child sink results for one source record, not a sink-local receipt id. Sinks that receive a projection snapshot use the projection identity described below; sinks that need destination-specific receipt ids should store them in `destination` or a future safe extension field without replacing `recordId`.

Error detail must be safe to log or display. Results should avoid leaking credentials, raw headers, local absolute paths outside an approved root, unredacted payload secrets, or backend response bodies that have not been classified for display.

An aggregate `CompositeSink` result is a container over child results. It may have an overall status for convenience, but consumers must inspect child results when deciding what was delivered where.

## At-Least-Once And Dedupe

Delivery is at least once unless a sink explicitly documents stronger behavior. Emitters, local writers, future network clients, and future retry mechanisms may re-deliver the same semantic record after uncertainty, timeout, process interruption, or partial fanout failure.

Consumers must dedupe control-plane records by stable semantic identity:

- events by `id`
- projection snapshots by an explicit projection record id when one is provided by the Console producer or emitter; otherwise by the deterministic tuple of `schema`, `version`, `producer.id`, `producer.product`, `scope.kind`, `scope.id`, and `derivedFrom` identity fields such as `mode`, `eventHistory`, `streamIds`, `lastAcceptedEventId`, `lastComparableSequence`, `acceptedEventCount`, and `directSnapshot.id` when present
- links by stable `from`, `to`, and `rel` identity where a consumer materializes link sets

`generatedAt` is display and freshness metadata, not a dedupe key by itself. Rebuilding the same projection from the same accepted event/provenance position may produce a different `generatedAt`; that must not force a consumer to treat the snapshot as a distinct semantic projection record.

Duplicate delivery is not a semantic state change. Local replay already ignores duplicate event ids after the first accepted event. Future hosted consumers and projection builders must follow the same expectation so replay, retry, and multi-sink delivery remain idempotent.

This spec does not define a durable retry daemon or outbox. Later work may add one, but it must preserve this contract: local output remains first-class, retries may duplicate records, and each sink reports independent results.

## Action Descriptor Safety

Action descriptors are control-plane data. They describe an action that may be available through the product that owns the authority; they are not executable instructions for generic sinks.

No generic sink, including `LocalFileSink`, `CompositeSink`, future `HttpApiSink`, or future telemetry/Otel sinks, may execute action descriptors, open URLs, call endpoints, run commands, fetch backend resources, mutate product-owned state, or treat record-provided paths as trusted filesystem targets.

Fields such as `authority.endpoint`, `authority.command`, `authority.externalUrl`, `sourceUrl`, and any product-provided local path are descriptors only. Action initiation must resolve through a trusted product adapter or registry, with allowlists, validation, confirmation where needed, and product-owned audit semantics. A sink may persist or transmit the descriptor as inert data for the authorized product path to handle later.

This prohibition applies even when a sink is capable of network or local file I/O. Delivery I/O is not action authority.

## Security And Trust Notes

- Future hosted/API sinks must authenticate to their destination, but authentication to a destination does not authorize action execution from record content.
- Future telemetry/Otel sinks should use control-plane ids only as correlation attributes and should avoid exporting sensitive payload bodies by default.
- Local file sinks must use configured roots and sanitized identifiers rather than interpolating record fields into paths.
- Sinks should treat all producer payload fields, URLs, endpoints, commands, and local paths as untrusted data unless a separate trusted product authority validates them.
- Sinks should not fetch linked evidence, dereference URLs, or call product APIs while delivering a record unless that behavior is part of a separate trusted adapter contract, not this generic sink contract.

## Relationship To Existing Schemas

[Event And Projection Schema](projection-schema.md) defines the v0.1 event envelope, projection envelope, local JSONL stream convention, replay rules, action projection shape, and cross-product refs. This contract relies on those shapes rather than redefining them.

When there is tension between delivery and semantics, product semantics win: the emitter and sinks may report delivery status, but Surface, Flow, Survey, Veritas, Flow Agents, and vertical products remain the authority for their own records.
