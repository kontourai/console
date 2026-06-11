# Console Event And Projection Schema

Status: v0.1 draft

Console composes product-owned event streams and projections. It does not replace Surface Claims, Flow Runs, Survey records, Veritas readiness, Flow Agents runtime state, or vertical product records.

The event stream is the durable integration contract. Projections are cached read models derived from events so the suite-level console can render claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions quickly.

See [Emitter, Sink, And Plane Contract](emitter-sink-plane-contract.md) for the Console producer delivery boundary, including control-plane versus telemetry-plane records, required local file output, multi-sink fanout, and inert action descriptor rules.

## Producer Terminology

The top-level `producer` field identifies the **Console producer**: the Kontour product or product runtime that emitted the event or projection for Console. The primary Console producers are portable primitives such as `surface`, `flow`, `survey`, `veritas`, and `flow-agents`.

Vertical products usually contribute through primitive producers rather than emitting Console records directly. A provider-field admin review UX should extend Survey's review surface; Survey emits review records, Surface emits claims/evidence/trust state, and Flow emits process/gate state. Vertical-specific provider IDs, field names, and render hints belong in refs, `payload.data`, or namespaced `extensions`.

This is intentionally separate from product-native producer concepts. A crawler, extractor, verifier, importer, workflow runner, agent, or policy clock inside a product is a **domain producer** or actor/source. Put that lower-level source in `actor`, `derivedFrom`, `evidence`, `payload.data`, or product-specific `extensions` as appropriate.

The JSON field remains named `producer`; in this schema, unqualified "producer" means Console producer unless a section explicitly says domain producer, actor, source, or projector.

## Principle

Surface Claims are the trust backbone. Most products should emit Surface Claims when they need to say whether something is verified, stale, disputed, rejected, unsupported, fresh, or policy-compliant.

Console also needs management objects that are not themselves claims:

- active or historical process runs
- open gates
- review items
- pending actions
- decisions
- proof summaries
- exceptions
- cross-product identity links

The event and projection schemas compose those objects without making Console the source of truth for any of them.

## Event-First Contract

Console producers should emit append-only events for meaningful state changes and decisions. Console can fold those events into snapshots/projections for fast rendering.

Event-first gives the suite-level console:

- live progress updates without waiting for full runs to finish
- auditability for decisions, exceptions, and route-backs
- replayable state when projections need to be rebuilt
- clearer separation between source events and derived read models
- support for local files without a hosted dependency

Snapshot/projection files are still useful. They are read models, not the durable source contract.

## Surface And Flow Handoff Example

The first deterministic handoff proof pair is Surface plus Flow:

- Surface says whether a claim is fresh, stale, verified, disputed, or supported by evidence.
- Flow says where a process is, which gate is active, and whether work is blocked, routed back, or ready.
- Console joins those records through refs and links so an operator can see the current stage without making Console the authority for either product.

Concrete story:

```text
Flow says:   process run-provider-directory-refresh started.
Flow says:   gate gate-provider-directory-freshness opened.
Surface says: claim claim-provider-directory-current is stale.
Console says: the Flow run is blocked because the linked Surface claim is stale.
Surface says: fresh evidence was attached and the claim is verified.
Flow says:   the gate passed and the process can continue.
```

The same story can be represented by local JSONL events and current projections:

| Moment | Console event | Primary subject | Important refs/links | Projection effect |
| --- | --- | --- | --- | --- |
| Flow starts work | `process.started` | Flow run | Optional `updates` link to the Surface claim the run may refresh. | `processes[]` shows the run as `running`. |
| Flow reaches a trust gate | `gate.opened` | Flow gate | Gate refs the Flow run and the Surface claim it expects. | `gates[]` shows the gate as `waiting` or `open`; `processes[].openGateRefs` points at the gate. |
| Surface claim is stale | `claim.freshness.changed` | Surface claim | Claim may link to the Flow gate, run, definition, or refresh action. | `claims[]` shows `freshness.status: "stale"`; Console can explain the gate block. |
| Surface attaches proof | `evidence.attached` | Surface evidence | Evidence refs/supports the Surface claim and may be linked to the Flow gate expectation. | `evidence[]` appears and claim/gate `evidenceRefs` can point to it. |
| Surface verifies the claim | `claim.status.changed` or `claim.reverification.completed` | Surface claim | Claim remains linked to evidence and the Flow gate/run. | `claims[]` shows `status: "verified"` and `freshness.status: "fresh"`. |
| Flow continues | `process.progressed` or `gate.passed` | Flow run or gate | Gate refs the verified claim/evidence. | `gates[]` shows `passed`; `processes[]` advances. |

This handoff requires no hosted server, database, action endpoint, or product API call. A local producer can append the events under `.kontour/events/...` and write current snapshots under `.kontour/projections/...`. A later server Sink can receive the same semantic events/projections without changing their product meaning.

The operator-facing Console view should prioritize the plain-language current stage, such as "checking provider directory freshness" or "still waiting on Surface claim." Raw event and projection detail should remain inspectable, but it is supporting evidence rather than the primary user experience.

## Local JSONL Stream Convention

Console v0 starts with local JSONL event streams. A Console producer can emit events without a hosted event bus, hosted ingestion service, auth layer, product adapter, or action execution endpoint.

Recommended location:

```text
docs/examples/event-streams/<scenario>.jsonl
.kontour/events/<producer-id>/<scope-kind>-<scope-id>.jsonl
```

The `docs/examples` path is for checked-in examples. The `.kontour/events` path is the recommended local working convention for Console producer output when a repo wants replayable console state.

The path tokens in this convention are sanitized identifiers, not raw path fragments. Console producers and consumers must reject `producer-id`, `scope-kind`, and `scope-id` values that are absolute paths, contain `..`, path separators, control characters, or otherwise escape identifier syntax. Consumers must resolve candidate stream files under an allowed stream root such as `.kontour/events`, verify the resolved path remains inside that root, and reject symlink escapes before opening a file.

Rules:

| Rule | Convention |
| --- | --- |
| Encoding | Files are UTF-8 text. |
| Line format | Each non-empty line is one complete JSON object matching `KontourConsoleEvent`. |
| File naming | Use sanitized Console producer or scenario identifiers plus sanitized scope identity. Avoid timestamps in file names unless the file is a closed archive segment. |
| Append-only writes | Console producers append events. They do not rewrite prior lines to correct state; corrections are new events with causal links. |
| Event IDs | `id` is globally stable and unique enough for idempotent replay. Re-emitting the same event keeps the same `id`. |
| Ordering | Consumers sort by `sequence` within a producer and stream when present. Without `sequence`, consumers use `occurredAt`, then `observedAt`, then file order as a local tie-breaker. |
| Sequence | `sequence` is producer-local and monotonically increasing for a stream. Gaps are allowed for segmented or backfilled streams and must not imply data loss by themselves. |
| Correlation | `correlationId` groups events that belong to the same workflow, claim refresh, route-back, review, or backfill batch. |
| Causation | `causationId` points to the prior event or action that directly caused this event. Use it for timelines and route-back chains, not for broad grouping. |
| Identity links | `subject`, `payload.refs`, and `links` carry cross-product identity. Product-specific field names stay under `payload.data` or `extensions`. |
| Backfill | Backfilled events keep the best known `occurredAt`; set `observedAt` to the collection time and use a shared `correlationId` for the backfill batch. |
| Replay | Local replay reads JSONL files, ignores duplicate `id` values after the first accepted event, applies deterministic ordering, and folds events into projections. |
| Snapshots | Projection snapshots may seed or speed local replay, but events remain the preferred durable contract when history exists. |

Example sequences:

- [Surface claim freshness](../examples/event-streams/surface-claim-freshness.jsonl)
- [Flow gate route-back](../examples/event-streams/flow-gate-route-back.jsonl)
- [Survey field review](../examples/event-streams/survey-field-review.jsonl)

Example projection snapshots:

- [Survey field review projection](../examples/projections/survey-field-review.json)
- [Surface current claim status projection](../examples/projections/surface-current-claim-status.json)

## Event Envelope

```ts
type KontourConsoleEvent = {
  schema: "kontour.console.event";
  version: "0.1";
  id: string;
  type: ConsoleEventType;
  occurredAt: string;
  observedAt?: string;
  producer: ConsoleProducer;
  scope: ConsoleScope;
  subject: CrossProductRef;
  actor?: ConsoleActor;
  correlationId?: string;
  causationId?: string;
  sequence?: number;
  payload: ConsoleEventPayload;
  links?: CrossProductLink[];
  extensions?: Record<string, unknown>;
};
```

`occurredAt` is when the product says the event happened. `observedAt` is when Console or another collector saw it. `correlationId` groups related events across products; `causationId` points to the event or action that caused this event.

### Event Envelope Fields

| Field | Required | Type | Responsibility |
| --- | --- | --- | --- |
| `schema` | Yes | `"kontour.console.event"` | Identifies the record as a Console event envelope. |
| `version` | Yes | `"0.1"` | Identifies this v0.1 contract version. |
| `id` | Yes | `string` | Stable event identity for idempotency, duplicate handling, and causal references. |
| `type` | Yes | `ConsoleEventType` | Product-neutral event vocabulary used for routing, filtering, and projection folding. |
| `occurredAt` | Yes | ISO 8601 `string` | Time the producing product says the event happened. |
| `producer` | Yes | `ConsoleProducer` | Kontour product or product runtime that emitted the event for Console consumption. |
| `scope` | Yes | `ConsoleScope` | Boundary the event belongs to, such as repo, workspace, project, product, tenant, or domain. |
| `subject` | Yes | `CrossProductRef` | Primary object changed or described by the event. |
| `payload` | Yes | `ConsoleEventPayload` | State delta, summary, reason, refs, and product-specific data. |
| `actor` | No | `ConsoleActor` | Human, agent, producer, or system that caused the transition when known. |
| `observedAt` | No | ISO 8601 `string` | Time the event was collected or observed by a local collector or console process. |
| `correlationId` | No | `string` | Workflow, review, route-back, claim refresh, or backfill grouping id. |
| `causationId` | No | `string` | Direct parent event id or action id that caused this event. |
| `sequence` | No | `number` | Producer-local stream order. Prefer monotonically increasing integers within a producer and scope. |
| `links` | No | `CrossProductLink[]` | Explicit identity and relationship links across products. |
| `extensions` | No | `Record<string, unknown>` | Namespaced product or deployment detail that is not part of the core v0 envelope. |

`payload.data` and `extensions` are the only places for vertical-specific facts that Console does not need for core v0 behavior. For example, provider field names, source-specific confidence scores, render hints, and domain-specific review metadata belong there, not as new top-level envelope fields.

Use `correlationId` when multiple events describe one user-visible workflow. Use `causationId` when one event follows another, such as `gate.routed_back` caused by `gate.failed`, or `review_item.approved` caused by a reviewer action. Use `links` when the relationship should survive projection rebuilding, such as a Flow gate controlling a Surface claim refresh or a provider field being reviewed by a review item.

## Event Types

```ts
type ConsoleEventType =
  | "claim.status.changed"
  | "claim.freshness.changed"
  | "claim.reverification.requested"
  | "claim.reverification.completed"
  | "process.started"
  | "process.progressed"
  | "process.paused"
  | "process.resumed"
  | "process.blocked"
  | "process.completed"
  | "gate.opened"
  | "gate.passed"
  | "gate.failed"
  | "gate.routed_back"
  | "review_item.opened"
  | "review_item.updated"
  | "review_item.approved"
  | "review_item.rejected"
  | "evidence.attached"
  | "decision.recorded"
  | "action.requested"
  | "action.completed"
  | "exception.requested"
  | "exception.accepted"
  | "exception.rejected"
  | "inquiry.resolved"
  | "inquiry.mapping.proposed"
  | "inquiry.mapping.reviewed"
  | "claim.dispute.resolved"
  | string;
```

Event types should be specific enough for routing and filtering but not so product-specific that Console must understand every vertical domain model.

The `| string` extension point lets products emit additional names, but custom event types must not be required for Console v0 core behavior.

### V0 Event Type Vocabulary

| Category | Event type | Intended use |
| --- | --- | --- |
| Claims | `claim.status.changed` | A Surface or product claim changed trust/status, such as verified, stale, disputed, rejected, or superseded. |
| Claims | `claim.freshness.changed` | Freshness changed because of time, policy, observation, or verification expiry without necessarily changing the claim value. |
| Claims | `claim.reverification.requested` | A producer, actor, gate, or policy requested that a claim be checked again. |
| Claims | `claim.reverification.completed` | Reverification finished and can be linked to resulting status, freshness, evidence, or decision events. |
| Process | `process.started` | A Flow run, product workflow, agent session, crawl, review process, or readiness process began. |
| Process | `process.progressed` | A process advanced to another step, updated percent complete, or reported meaningful progress. |
| Process | `process.paused` | A process stopped temporarily by actor, policy, gate, or product control semantics. |
| Process | `process.resumed` | A paused or waiting process resumed. |
| Process | `process.blocked` | A process cannot continue until evidence, decision, action, exception, or external state changes. |
| Process | `process.completed` | A process reached terminal completion. Failed or cancelled products may still use product-specific detail in `payload.data`. |
| Gates | `gate.opened` | A Flow gate or product gate became active and needs evidence, decision, exception, or action. |
| Gates | `gate.passed` | A gate passed under its owning product semantics. |
| Gates | `gate.failed` | A gate failed and may cause a block, exception request, or route-back. |
| Gates | `gate.routed_back` | Flow or another process owner routed work back to an earlier step or owning actor. |
| Review items | `review_item.opened` | A review item was created for a claim, field change, candidate fact, gate exception, evidence gap, or readiness gap. |
| Review items | `review_item.updated` | Assignment, priority, due date, subject, evidence, or other review metadata changed. |
| Review items | `review_item.approved` | The owning product recorded an approval for a review item. |
| Review items | `review_item.rejected` | The owning product recorded a rejection for a review item. |
| Evidence | `evidence.attached` | Evidence, proof, source excerpt, observed result, or integrity metadata was attached to a subject. |
| Decisions | `decision.recorded` | A durable approval, rejection, exception, route-back, refresh request, publish, or other decision was recorded. |
| Learning | `learning.*` | A product-owned learning was recorded or updated as non-authoritative operating context. Learning may reference decisions, telemetry, Flow Agents `workflow-learning` records, or other source records, but it cannot revoke or change claims, gates, decisions, actions, product records, source facts, or product truth. |
| Actions | `action.requested` | A next action was requested or queued through the product that owns the authority. |
| Actions | `action.completed` | A product-owned action completed, such as refresh, approve, apply, resume, route back, or attach evidence. |
| Exceptions | `exception.requested` | A product or actor requested an exception to gate, readiness, policy, or process requirements. |
| Exceptions | `exception.accepted` | The owning authority accepted an exception, optionally with expiry and trust implications. |
| Exceptions | `exception.rejected` | The owning authority rejected an exception request. |
| Inquiries | `inquiry.resolved` | Surface resolved an Inquiry with one of three outcomes: `matched` (an existing claim answers it), `derived` (a named derivation rule answers it), or `unsupported` (no claim or rule exists — a demand-signal gap). Carries `inquiryId`, `outcome`, resolved `claimRefs` or `ruleRefs`, `asker`, and `statusFunctionVersion`. Unsupported outcomes are the primary demand signal for new mappings and rules. |
| Inquiries | `inquiry.mapping.proposed` | A probabilistic proposer proposed that a natural-language question maps to an existing canonical claim or rule. The proposal is a reviewable record with provenance (excerpt, rationale, confidence) and goes through Survey review machinery before counting. |
| Inquiries | `inquiry.mapping.reviewed` | A Survey review of a mapping proposal completed. `outcome` is one of `verified`, `assumed`, or `rejected`. An accepted mapping makes future identical questions resolve as `matched` or `derived` rather than `unsupported`. |
| Inquiries | `claim.dispute.resolved` | Surface recorded an authority-backed decision resolving a `disputed` claim status. Carries the decision event reference, the `reviewerAuthority`, `authorityTrace`, and resulting claim status. This is an append-only verification event, not a mutation of prior evidence. |

## Event Payload

```ts
type ConsoleEventPayload = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  summary?: string;
  reason?: string;
  refs?: CrossProductRef[];
  links?: CrossProductLink[];
  data?: Record<string, unknown>;
};
```

Events may carry a full `after` view, a small patch, or a product-specific `data` object. Consumers should use event type, subject, refs, and links for cross-product behavior; product-specific detail belongs under `data` or `extensions`.

`learning.*` event payloads should carry refs, links, summaries, and product-specific `data` or `extensions`; they are Console handoff records, not a universal source schema. Source schemas remain product-owned. A learning that results in an authoritative product change must be accompanied by the owning product's normal event, such as `decision.recorded`, `claim.status.changed`, `gate.routed_back`, or `action.requested`.

## Actor

```ts
type ConsoleActor = {
  kind: "human" | "agent" | "producer" | "system" | string;
  id?: string;
  label?: string;
  product?: string;
};
```

Actors identify who or what caused a decision, action, or state transition when the product can provide that information.

## Projection Envelope

```ts
type KontourConsoleProjection = {
  schema: "kontour.console.projection";
  version: "0.1";
  generatedAt: string;
  derivedFrom: ProjectionProvenance;
  producer: ConsoleProducer;
  scope: ConsoleScope;
  summary?: ConsoleSummary;
  claims?: ClaimStatusProjection[];
  processes?: ProcessStatusProjection[];
  gates?: GateStatusProjection[];
  reviewItems?: ReviewItemProjection[];
  evidence?: EvidenceProjection[];
  decisions?: DecisionProjection[];
  actions?: ConsoleActionProjection[];
  exceptions?: ExceptionProjection[];
  learnings?: LearningProjection[];
  inquiries?: InquiryProjection[];
  links?: CrossProductLink[];
  extensions?: Record<string, unknown>;
};

type ProjectionProvenance = {
  mode: "event_replay" | "direct_snapshot" | "snapshot_plus_events";
  eventHistory: "complete" | "partial" | "unavailable";
  streamIds?: string[];
  lastAcceptedEventId?: string;
  lastAcceptedEventOccurredAt?: string;
  lastComparableSequence?: {
    producerId: string;
    streamId: string;
    sequence: number;
  };
  acceptedEventCount?: number;
  directSnapshot?: {
    id: string;
    emittedAt: string;
    producer: ConsoleProducer;
    reason: "event_history_unavailable" | "event_history_partial" | "seed_replay" | string;
    sourceRef?: CrossProductRef;
  };
};
```

Projections are current read models. They are optimized for rendering the latest suite-level operating state, not for replacing product event logs, Surface trust records, Flow runs, Survey records, or other product-owned sources of truth.

`derivedFrom` is required for v0 projection snapshots. It tells a consumer whether the snapshot was rebuilt from events, emitted directly because event history is unavailable or partial, or seeded from a prior snapshot and then advanced with later accepted events. Direct snapshots are allowed only as read-model input or fallback. They must not become a new authority for claim truth, run-control state, vertical domain values, decisions, or action execution.

## Rebuilding Projections From Events

Projection rebuilds are deterministic folds over accepted events. Given the same event set, duplicate-handling rules, and ordering rules, a rebuild should produce the same `KontourConsoleProjection` values except for `generatedAt` and explicitly producer-provided volatile summaries.

Rebuild behavior:

| Concern | Semantics |
| --- | --- |
| Input streams | Read one or more local JSONL streams for the projection scope. Candidate files must be resolved and containment-checked under an allowed stream root before reading. A stream id should be the stable file path, archive segment id, or producer-declared stream identity. |
| Idempotency | Accept the first valid event for an `id` and ignore later duplicates with the same `id`. Re-emitted events must keep the same `id`; corrections are new events linked by `causationId`. |
| Ordering | Sort by producer-local `sequence` when it is present for events from the same producer and stream. Events without usable sequence order by `occurredAt`, then `observedAt`, then file order as the final local tie-breaker. |
| Folding | Apply events as state transitions into claims, processes, gates, review items, evidence, decisions, actions, exceptions, learnings, links, and summaries. The specific reducer is out of scope for v0; the fold must not invent product-owned semantics. |
| Correlation and causation | Use `correlationId` to build user-visible timelines for one workflow, review, claim refresh, route-back, or backfill. Use `causationId` to show direct parent-child transitions such as a failed gate causing a route-back. |
| Link accumulation | Accumulate explicit `links`, `payload.refs`, and subject relationships into projection `links` where they remain relevant to the current read model. Later events may supersede status, but historical links remain available for timelines when retained by the reducer. |
| Snapshot fallback | A projection snapshot may seed replay or stand in when event history is unavailable or partial. If events exist after the snapshot point, replay only the accepted events after the snapshot's recorded position and set `derivedFrom.mode` to `snapshot_plus_events`. |

`KontourConsoleProjection.derivedFrom` records replay provenance for the read model:

- `mode` records whether the snapshot came from accepted event replay, direct snapshot emission, or a direct snapshot plus later events.
- `eventHistory` records whether the producer or projector believes the event history used for the read model is complete, partial, or unavailable.
- `streamIds` lists the local stream identities folded into the projection. These values are provenance labels and must not be blindly reopened as filesystem paths unless each candidate is separately validated against the allowed stream root, identifier rules, and symlink containment checks.
- `lastAcceptedEventId` records the final accepted event id after deterministic ordering.
- `lastAcceptedEventOccurredAt` records the producer-reported time for the final accepted event when available.
- `lastComparableSequence` records the final accepted producer-local sequence only when the folded events share one comparable sequence domain. Omit it when multiple producers or streams cannot be compared safely.
- `acceptedEventCount` records the count of accepted, non-duplicate events folded into the projection, not the number of physical JSONL lines read.
- `directSnapshot` records the direct snapshot identity, emitter, time, reason, and optional source object when a snapshot is used as the starting point or full read-model input.

Event history remains preferred when available. A direct snapshot with `eventHistory: "unavailable"` or `eventHistory: "partial"` is a display fallback: it may tell the console what to render, but it does not prove historical transitions and does not grant Console authority to make product-owned decisions.

These rules describe the rebuild contract only. They do not require a hosted event bus, product adapter, action endpoint, UI, or shared reducer implementation.

## Projection Object Catalogue

The v0 projection envelope carries arrays of product-owned objects plus explicit links between them:

| Object | Field | Authority boundary | Intended console use |
| --- | --- | --- | --- |
| Summary | `summary` | The projector may compute it from included objects or label it producer-provided. | Counts, freshness of the read model, and top-level scan state. |
| Claims | `claims` | Surface owns trust status, freshness, validity windows, and claim semantics. Vertical products may emit domain-derived claims through Surface refs. | Current trust state, stale/disputed queues, and claim detail panels. |
| Processes | `processes` | Flow or the emitting product owns run lifecycle and transition semantics. | Running, blocked, completed, or waiting work. |
| Gates | `gates` | Flow owns gate evaluation, route-back, exception, and run-control semantics. | Blocking reasons, missing evidence, and route-back visibility. |
| Review items | `reviewItems` | Survey owns source/candidate/review lifecycle semantics for fact review. Flow, Veritas, and Flow Agents may create review-like control items under their own semantics. Vertical products extend Survey review context instead of redefining review lifecycle. | Unified review queues and subject navigation. |
| Evidence | `evidence` | The producer or Surface owns evidence integrity, availability, and privacy semantics. | Proof summaries, source navigation, and missing/stale evidence display. |
| Decisions | `decisions` | The product or actor that recorded the decision owns the durable decision meaning. | Timeline entries and rationale display. |
| Actions | `actions` | The authority descriptor identifies the owning product; Console must route execution through trusted product control paths. | Available next actions, disabled reasons, and pending/completed action state. |
| Exceptions | `exceptions` | Flow or the product governance layer owns exception acceptance, rejection, expiry, and trust implications. | Exception requests and accepted exception visibility. |
| Learnings | `learnings` | The emitting product owns the source schema, lifecycle, and meaning. Learning records are non-authoritative Console operating context only. | Explanatory context connected to workflows, decisions, source records, telemetry, or domain observations. |
| Inquiries | `inquiries` | Surface owns Inquiry record identity, resolution path, outcome, and asker. Console folds only counts, outcome refs, and links; it does not recompute outcomes or mutate Inquiry records. | Unsupported-gap and pending-mapping-proposal attention queue items; cross-product navigation from inquiry to claim or rule. |
| Links | `links` | Emitting products own explicit identity and relationship assertions. | Cross-product navigation and correlation without global id minting. |
| Extensions | `extensions` | Namespaced product or deployment detail remains product-owned. | Optional vertical fields that are not required for core v0 behavior. |

Each object should retain `CrossProductRef` fields for the product objects it describes or depends on. Product-specific facts that are not needed for core v0 rendering belong under object-level `extensions` or event `payload.data`.

The checked-in projection examples demonstrate two required v0 shapes:

- The Survey field review example maps a provider field to a Surface `claim`, a Flow-owned process/gate, a Survey review item, evidence, decision/action, and explicit `links`.
- The Surface example keeps current claim `status`, `freshness`, `validFrom`, `validUntil`, and `lastUpdatedAt` directly on `claims[]`, so a console can render current claim status without selecting a Flow run. It still retains optional links to the Flow refresh definition/action and Surface evidence.

## Producer

```ts
type ConsoleProducer = {
  id: string;
  product: "surface" | "flow" | "survey" | "veritas" | "flow-agents" | string;
  name?: string;
  runId?: string;
  generatedBy?: string;
};
```

The producer identifies the Console producer: the Kontour product or product runtime emitting the event or projection for Console consumption. Primitive producers should be preferred. A vertical product should normally contribute through Survey, Surface, and Flow records, with product-native objects preserved as refs and extension metadata. Direct vertical Console emission is optional and should be treated as an escape hatch, not the normal integration path.

Use `actor`, `derivedFrom`, `evidence.producerRef`, `payload.data`, or product-specific `extensions` to preserve product-native source detail. For example, Surface may be the Console producer while `actor` identifies a Surface verifier agent, or Flow may be the Console producer while `derivedFrom` identifies a specific run.

## Scope

```ts
type ConsoleScope = {
  kind: "repo" | "product" | "workspace" | "tenant" | "project" | "domain" | string;
  id: string;
  label?: string;
  refs?: CrossProductRef[];
};
```

Scope tells Console what boundary the projection describes: a repository, product, customer workspace, domain entity set, or other product-owned unit.

## Summary

```ts
type ConsoleSummary = {
  claimCount?: number;
  staleClaimCount?: number;
  disputedClaimCount?: number;
  activeProcessCount?: number;
  blockedProcessCount?: number;
  openGateCount?: number;
  reviewItemCount?: number;
  pendingActionCount?: number;
  unsupportedInquiryCount?: number;
  pendingMappingProposalCount?: number;
  lastUpdatedAt?: string;
};
```

Summary fields are display aids. They must be derivable from included objects or explicitly labeled as producer-provided summaries.

## Claims

```ts
type ClaimStatusProjection = {
  id: string;
  subject?: string;
  claimType?: string;
  label?: string;
  status: "unknown" | "proposed" | "assumed" | "verified" | "stale" | "disputed" | "superseded" | "rejected" | string;
  currentValue?: unknown;
  validFrom?: string;
  validUntil?: string;
  lastUpdatedAt?: string;
  lastVerifiedAt?: string;
  freshness?: FreshnessProjection;
  materiality?: "low" | "medium" | "high" | "critical" | string;
  evidenceRefs?: CrossProductRef[];
  actionRefs?: CrossProductRef[];
  sourceRef?: CrossProductRef;
  extensions?: Record<string, unknown>;
};
```

Claims should be projected from Surface whenever possible. Console can display them, filter them, and link them to workflow state, but Surface remains the authority for trust derivation.

## Processes

```ts
type ProcessStatusProjection = {
  id: string;
  definitionId?: string;
  label?: string;
  status: "not_started" | "running" | "paused" | "blocked" | "waiting" | "completed" | "failed" | "cancelled" | string;
  currentStep?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  percentComplete?: number;
  timeEstimate?: TimeEstimateProjection;
  openGateRefs?: CrossProductRef[];
  reviewItemRefs?: CrossProductRef[];
  claimRefs?: CrossProductRef[];
  nextActionRefs?: CrossProductRef[];
  extensions?: Record<string, unknown>;
};
```

Processes are usually projected from Flow Runs. Flow remains the authority for gate, transition, exception, and run-control semantics.

## Gates

```ts
type GateStatusProjection = {
  id: string;
  processRef: CrossProductRef;
  label?: string;
  status: "open" | "passed" | "failed" | "blocked" | "waiting" | "accepted_by_exception" | string;
  expectationRefs?: CrossProductRef[];
  evidenceRefs?: CrossProductRef[];
  missingEvidence?: string[];
  routeBack?: {
    reason?: string;
    targetStep?: string;
    attempt?: number;
    maxAttempts?: number;
  };
  updatedAt?: string;
  extensions?: Record<string, unknown>;
};
```

Gates belong to Flow. Console can expose status and actions, but it must route mutations through Flow control semantics.

## Review Items

```ts
type ReviewItemProjection = {
  id: string;
  label?: string;
  kind: "claim_review" | "field_change" | "candidate_fact" | "gate_exception" | "evidence_gap" | "readiness_gap" | "inquiry_unsupported_gap" | "mapping_proposal" | string;
  status: "open" | "in_review" | "approved" | "rejected" | "applied" | "blocked" | "cancelled" | string;
  priority?: "low" | "medium" | "high" | "critical" | string;
  subjectRef?: CrossProductRef;
  claimRefs?: CrossProductRef[];
  processRefs?: CrossProductRef[];
  evidenceRefs?: CrossProductRef[];
  actionRefs?: CrossProductRef[];
  assignedTo?: string;
  createdAt?: string;
  updatedAt?: string;
  dueAt?: string;
  extensions?: Record<string, unknown>;
};
```

Review Items can be created by Survey candidate workflows, Flow gates, Veritas readiness gaps, or Flow Agents continuations. For vertical admin review UX, the vertical product should extend Survey review items with domain refs and render metadata. The owning primitive remains responsible for the decision semantics.

## Evidence

```ts
type EvidenceProjection = {
  id: string;
  label?: string;
  kind?: string;
  status?: "available" | "missing" | "private" | "stale" | "invalid" | string;
  summary?: string;
  observedResult?: string;
  sourceUrl?: string;
  sourceExcerpt?: string;
  capturedAt?: string;
  producerRef?: CrossProductRef;
  claimRefs?: CrossProductRef[];
  processRefs?: CrossProductRef[];
  integrity?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};
```

Evidence may point at Surface Evidence, Flow Gate Evidence, Veritas evidence checks, Survey source excerpts, or product-native proof records.

`sourceUrl` is a navigation descriptor only. Consumers must treat it as untrusted producer data, validate scheme and host through a trusted adapter or allowlist before rendering a link, reject dangerous schemes such as `javascript:` and local file access, and avoid backend fetching unless a separate trusted product path authorizes it.

## Decisions

```ts
type DecisionProjection = {
  id: string;
  label?: string;
  kind: "approval" | "rejection" | "exception" | "route_back" | "refresh_request" | "publish" | string;
  decidedAt: string;
  decidedBy?: string;
  rationale?: string;
  subjectRefs?: CrossProductRef[];
  evidenceRefs?: CrossProductRef[];
  result?: string;
  extensions?: Record<string, unknown>;
};
```

Decision records should be immutable summaries of product-owned decisions. Console should not invent decision history after the fact.

## Actions

```ts
type ConsoleActionProjection = {
  id: string;
  label: string;
  kind: "open" | "refresh" | "reverify" | "approve" | "reject" | "resume" | "pause" | "route_back" | "attach_evidence" | string;
  status?: "available" | "disabled" | "pending" | "completed" | string;
  reason?: string;
  authority: {
    product: string;
    endpoint?: string;
    command?: string;
    externalUrl?: string;
  };
  subjectRefs?: CrossProductRef[];
  requiresConfirmation?: boolean;
  extensions?: Record<string, unknown>;
};
```

Actions are routed through the product that owns the authority. Console may present and initiate actions, but it should not bypass product-owned APIs, CLIs, or control semantics.

`authority.endpoint`, `authority.command`, and `authority.externalUrl` are descriptors only. Consumers must not blindly call endpoints, execute commands, or open URLs from event or projection data. Action initiation must resolve through a trusted product adapter or registry, allowlist known commands and endpoints, avoid shell interpretation, require confirmation for sensitive actions, and treat URLs as untrusted until their scheme and host are validated.

## Exceptions

```ts
type ExceptionProjection = {
  id: string;
  label?: string;
  status: "requested" | "accepted" | "rejected" | "expired" | string;
  reason?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  expiresAt?: string;
  subjectRefs?: CrossProductRef[];
  evidenceRefs?: CrossProductRef[];
  extensions?: Record<string, unknown>;
};
```

Exceptions usually originate in Flow or product governance layers. Surface may reflect resulting trust implications through claims and events.

## Learnings

```ts
type LearningProjection = {
  id: string;
  subjectRef: CrossProductRef;
  family: "workflow" | "domain";
  nonAuthority: true;
  summary: string;
  confidence?: number;
  sourceRef?: CrossProductRef;
  refs?: CrossProductRef[];
  links?: CrossProductLink[];
  extensions?: Record<string, unknown>;
};
```

Learning projection objects are thin Console control-plane summaries of product-owned learning records. `family` is limited to `workflow` or `domain`, `nonAuthority` must be `true`, and `summary` is the operator-facing statement. Optional `confidence`, `sourceRef`, `refs`, `links`, and namespaced `extensions` can connect the learning to source records, decisions, telemetry, Flow Agents `workflow-learning` records, or domain objects.

Console does not own or define the source learning schema. Product-specific learning fields remain in product-owned source records, event `payload.data`, refs, links, or namespaced extensions. A learning cannot revoke, change, or override claims, gates, decisions, actions, source facts, product records, or product truth; authoritative changes require the owning product's normal event.

## Inquiries

```ts
type InquiryProjection = {
  id: string;
  label?: string;
  outcome: "matched" | "derived" | "unsupported" | string;
  asker?: string;
  claimRefs?: CrossProductRef[];
  ruleRefs?: CrossProductRef[];
  statusFunctionVersion?: string;
  resolvedAt?: string;
  sourceRef?: CrossProductRef;
  extensions?: Record<string, unknown>;
};
```

Inquiry records are append-only testimony emitted by Surface. Each record captures what was knowable at the moment the inquiry resolved — the question, the resolution path, the outcome, and the asker. Inquiry records are never updated because they are not present-tense truth claims; they assert what was knowable at a specific moment.

Console projection rules for inquiries:

- Console folds `inquiry.resolved` events into `inquiries[]` as count and link summaries only. It does not recompute resolution paths, derive outcomes, or mutate inquiry records.
- `unsupported` outcomes join the suite-level attention queue as `review_item` objects with `kind: "inquiry_unsupported_gap"`. They represent demand signal gaps, not errors.
- Pending mapping proposals from `inquiry.mapping.proposed` join the suite-level attention queue as `review_item` objects with `kind: "mapping_proposal"`, routed through Survey review machinery.
- `matched` and `derived` outcomes appear in `inquiries[]` as fold-only records with `claimRefs` or `ruleRefs` for cross-product navigation to the Surface claim or derivation rule.
- Console never recomputes claim status from inquiry records. Surface remains the authority; Console links the inquiry to the claim, not the other way.
- `claim.dispute.resolved` events are folded as `decision` records. The resolution is an append-only verification event in Surface's ledger; Console records the decision reference for timeline and navigation without re-deriving the claim status.

The `ConsoleSummary` fields `unsupportedInquiryCount` and `pendingMappingProposalCount` are display aids derivable from included `inquiries[]` and `reviewItems[]` objects.

## Freshness And Time Estimates

```ts
type FreshnessProjection = {
  status?: "fresh" | "stale" | "expiring" | "unknown" | string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  expiresAt?: string;
  source?: "clock" | "producer" | "policy" | string;
};

type TimeEstimateProjection = {
  startedAt?: string;
  estimatedCompletionAt?: string;
  remainingSeconds?: number;
  source?: "producer" | "flow" | "agent" | "observed" | string;
};
```

Freshness can change because time passes. It should not always require a producer run. Reverification and refresh actions are separate from clock-derived freshness status.

## Cross-Product Links

```ts
type CrossProductRef = {
  product: "surface" | "flow" | "survey" | "veritas" | "flow-agents" | string;
  kind: string;
  id: string;
  apiVersion?: string;
  name?: string;
  uid?: string;
  scope?: {
    product?: string;
    kind?: string;
    id?: string;
  };
  label?: string;
  url?: string;
};

type CrossProductLink = {
  from: CrossProductRef;
  to: CrossProductRef;
  relation:
    | "supports"
    | "blocks"
    | "updates"
    | "reviews"
    | "produced_by"
    | "evidenced_by"
    | "controls"
    | "derived_from"
    | string;
  strength?: "direct" | "inferred" | "weak" | string;
  createdAt?: string;
  extensions?: Record<string, unknown>;
};
```

Identity links are the core of the suite-level console. They let Console answer questions such as:

- Which Flow Run is changing this Surface Claim?
- Which Review Item is waiting on this Survey Candidate?
- Which Veritas readiness gap blocks this Flow gate?
- Which Flow Agents session produced this decision?
- Which provider field does this claim describe?

### CrossProductRef Minimum

`product`, `kind`, and `id` form the minimum stable identity tuple. The producing product owns the meaning and lifecycle of each tuple; Console stores and displays refs but does not mint global ids, normalize product ids, or become the authority for product-local semantics.

When a referenced object is also a Portable Product Record, producers should enrich the same ref with `apiVersion`, `name`, and `uid` from that resource. This avoids creating two unrelated reference systems: lightweight Console handoffs can start with `product + kind + id`, while stricter product records can add resource identity as adoption matures.

| Field | Required | Minimum meaning |
| --- | --- | --- |
| `product` | Yes | Product or vertical namespace that owns the referenced object, such as `surface`, `flow`, `survey`, `veritas`, `flow-agents`, or a vertical product namespace. |
| `kind` | Yes | Product-owned object kind, such as `claim`, `run`, `gate`, `review_item`, `evidence`, `decision`, `action`, or `provider_field`. |
| `id` | Yes | Stable product-local object id. It must be stable enough for replay, deduplication, projection links, and external navigation. |
| `apiVersion` | No | Versioned resource namespace when the referenced object is a Portable Product Record, such as `surface.kontour.ai/v1alpha1` or `flow.kontour.ai/v1alpha1`. |
| `name` | No | Human-stable resource name when available. It is useful for debugging and provider-backed records, but it is not the dedupe identity by itself. |
| `uid` | No | Durable resource identity when the referenced object is a Portable Product Record. Prefer it for long-lived resource correlation when present. |
| `scope` | No | Optional disambiguating boundary, such as project, repo, workspace, tenant, or domain object set. Scope may narrow identity but should not replace a stable `id`. |
| `label` | No | Display text only. Consumers must not parse it for identity or semantics. |
| `url` | No | Navigation aid only. Consumers must treat it as untrusted until a trusted product adapter or URL allowlist validates it. |

Identity guidance:

- Use `product + kind + id` as the required minimum for every event `subject`, `payload.refs[]`, object ref, and link endpoint.
- Use `apiVersion + kind + uid` as the stronger identity for Portable Product Records when `uid` is present. Keep `product + kind + id` on the same ref so Console consumers can still join lightweight records.
- Treat `name`, `label`, and `url` as display/navigation metadata, not dedupe identity.
- Keep event identity separate from referenced object identity: a `KontourConsoleEvent.id` identifies the event, while `subject.id` identifies the product object changed by that event.
- Keep sink delivery identity separate from destination receipts: `SinkDeliveryResult.recordId` uses the semantic event/projection/resource identity, not a server receipt id.

Example enriched Surface claim ref:

```json
{
  "product": "surface",
  "kind": "claim",
  "id": "claim-provider-directory-current",
  "apiVersion": "surface.kontour.ai/v1alpha1",
  "name": "provider-directory-current",
  "uid": "surface-claim-provider-directory-current",
  "label": "Provider directory is current"
}
```

Example enriched Flow gate ref:

```json
{
  "product": "flow",
  "kind": "gate",
  "id": "gate-provider-directory-freshness",
  "apiVersion": "flow.kontour.ai/v1alpha1",
  "name": "provider-directory-freshness",
  "uid": "flow-gate-provider-directory-freshness",
  "scope": {
    "product": "flow",
    "kind": "run",
    "id": "run-provider-directory-refresh"
  },
  "label": "Provider directory freshness"
}
```

### CrossProductLink Minimum

`from`, `to`, and `relation` are the required relationship tuple. Links are explicit product-emitted statements; v0 required console behavior must not depend on Console automatically inferring missing links.

| Field | Required | Minimum meaning |
| --- | --- | --- |
| `from` | Yes | Source object of the directed relation. |
| `to` | Yes | Target object of the directed relation. |
| `relation` | Yes | Directed relation vocabulary term. Use the v0 terms below for core console behavior. |
| `strength` | No | Relationship confidence or origin descriptor. Prefer `direct` for product-owned emitted links. `inferred` and `weak` are allowed descriptors for enrichment, but not required v0 links. |
| `createdAt` | No | ISO 8601 time when the relationship was emitted, observed, or became known. |
| `extensions` | No | Namespaced product/deployment detail that does not change the core relation meaning. |

### Relation Vocabulary

Relations are directed from `from` to `to`. Product owners may add relation extensions, but Console v0 core projections should rely on these terms for cross-product workflows.

| Relation | Direction | Minimum use | Example pair |
| --- | --- | --- | --- |
| `supports` | evidence, observation, decision, or claim -> claim, gate, decision, or review item | The source provides positive support for the target. | Surface evidence `supports` Surface claim. |
| `blocks` | gate, gap, exception, review item, or failed check -> process, claim refresh, action, or gate | The source prevents target progress until resolved under the owning product's rules. | Failed Flow gate `blocks` Flow run. |
| `updates` | process, action, decision, domain field, or claim event -> claim, field, projection object, or process | The source changed or intends to change the target. | Flow run `updates` Surface claim. |
| `reviews` | review item, reviewer decision, or review workflow -> claim, domain field, evidence, candidate fact, or gate exception | The source is the review/control item whose subject is the target. | Flow Review Item `reviews` Surface claim. |
| `produced_by` | claim, evidence, decision, action, review item, or projection object -> run, agent session, actor, or producer | The target created, emitted, or recorded the source. | Decision `produced_by` Flow Agents run. |
| `evidenced_by` | claim, gate, decision, review item, or exception -> evidence or proof record | The target evidence is attached as proof for the source. | Flow gate `evidenced_by` source excerpt evidence. |
| `controls` | gate, policy, checklist item, or authority object -> process, claim refresh, action, exception path, or publish step | The source governs whether the target may proceed. | Flow gate `controls` claim reverification. |
| `derived_from` | claim, field value, evidence summary, decision, or projection object -> source field, source document, upstream claim, or observation | The source was calculated, copied, summarized, or transformed from the target. | Surface claim `derived_from` provider field. |

### Required V0 Links

Products should emit these links when the referenced objects exist. They are the minimum links that make Console useful for claim status, workflow progress, proof, route-back, and review queues without giving the console authority over product semantics.

| Scenario | Required link | Why it is required |
| --- | --- | --- |
| A process or run changes a claim. | Flow/product run `updates` Surface claim, or Surface claim `produced_by` Flow/product run when the claim was emitted from that run. | Lets the console answer which workflow is changing or last changed a claim. |
| A review item is about a claim. | Flow/product review item `reviews` Surface claim. | Lets the console route claim review queues and show pending review next to trust state. |
| A review item is about a domain field or candidate fact. | Flow/product review item `reviews` product domain field/candidate fact. If that field maps to a claim, also emit the domain-field-to-claim link below. | Lets vertical field review appear in the same queue as claim review. |
| A gate controls progress. | Flow/product gate `controls` process, claim refresh, action, or publish step. If failed or waiting, the gate may also `blocks` that same target. | Lets the console display why a process, refresh, or action cannot proceed. |
| Evidence proves or explains a claim, gate, decision, or review item. | Claim/gate/decision/review item `evidenced_by` evidence, or evidence `supports` claim/gate/decision/review item. | Lets the console surface proof and missing proof without parsing product payloads. |
| An action or decision came from a process, run, agent session, or actor. | Action/decision `produced_by` Flow run, Flow Agents session, actor, or product process. | Lets timelines explain who or what produced a queued action or decision. |
| A domain field maps to a Surface claim. | Surface claim `derived_from` product domain field when the claim is based on the field; product domain field `updates` Surface claim when the field change is intended to change the claim. | Lets vertical records, such as provider fields, connect to Surface trust state. |
| A Survey Review Item is about a claim or field. | Survey Review Item `reviews` Surface claim, product domain field, or both. | Lets the console show the same review item from claim, process, and domain-record views. |

Additional links can enrich timelines and navigation, but v0 examples and projection work should not require inferred links, graph storage, hosted ingestion, adapters, or a global identity service.

### Identity Link Examples

Claim changed by a Flow run:

```json
{
  "from": { "product": "flow", "kind": "run", "id": "run-provider-refresh-42", "label": "Provider refresh run 42" },
  "to": { "product": "surface", "kind": "claim", "id": "claim-provider-npi-active-123" },
  "relation": "updates",
  "strength": "direct",
  "createdAt": "2026-06-01T12:00:00Z"
}
```

Review item about a Surface claim:

```json
{
  "from": { "product": "flow", "kind": "review_item", "id": "review-provider-active-123" },
  "to": { "product": "surface", "kind": "claim", "id": "claim-provider-npi-active-123" },
  "relation": "reviews",
  "strength": "direct"
}
```

Gate with attached evidence:

```json
[
  {
    "from": { "product": "flow", "kind": "gate", "id": "gate-required-source-proof-123" },
    "to": { "product": "flow", "kind": "run", "id": "run-provider-refresh-42" },
    "relation": "controls",
    "strength": "direct"
  },
  {
    "from": { "product": "flow", "kind": "gate", "id": "gate-required-source-proof-123" },
    "to": { "product": "surface", "kind": "evidence", "id": "evidence-nppes-page-123" },
    "relation": "evidenced_by",
    "strength": "direct"
  }
]
```

Provider field to Surface claim to Survey Review Item:

```json
{
  "refs": {
    "providerField": {
      "product": "provider-directory",
      "kind": "provider_field",
      "id": "provider-123.registration_status",
      "label": "Provider 123 registration status"
    },
    "surfaceClaim": {
      "product": "surface",
      "kind": "claim",
      "id": "claim-provider-123-registration-active",
      "label": "Provider 123 registration is active"
    },
    "surveyReviewItem": {
      "product": "survey",
      "kind": "review_item",
      "id": "review-registration-status-123",
      "label": "Review provider registration status"
    }
  },
  "links": [
    {
      "from": { "product": "surface", "kind": "claim", "id": "claim-provider-123-registration-active" },
      "to": { "product": "provider-directory", "kind": "provider_field", "id": "provider-123.registration_status" },
      "relation": "derived_from",
      "strength": "direct"
    },
    {
      "from": { "product": "provider-directory", "kind": "provider_field", "id": "provider-123.registration_status" },
      "to": { "product": "surface", "kind": "claim", "id": "claim-provider-123-registration-active" },
      "relation": "updates",
      "strength": "direct"
    },
    {
      "from": { "product": "survey", "kind": "review_item", "id": "review-registration-status-123" },
      "to": { "product": "surface", "kind": "claim", "id": "claim-provider-123-registration-active" },
      "relation": "reviews",
      "strength": "direct"
    },
    {
      "from": { "product": "survey", "kind": "review_item", "id": "review-registration-status-123" },
      "to": { "product": "provider-directory", "kind": "provider_field", "id": "provider-123.registration_status" },
      "relation": "reviews",
      "strength": "direct"
    }
  ]
}
```

These examples can be emitted in event `links`, projection `links`, and supporting `payload.refs`. The event `subject` should still name the primary object changed by that event.

## Survey Review Extension Example

 should normally project its admin review workflow through Survey, Surface, and Flow rather than emitting Console records directly:

- provider registration status claim -> `ClaimStatusProjection` emitted by Surface
- crawl or review workflow -> `ProcessStatusProjection` emitted by Flow
- required-field coverage check -> `GateStatusProjection` or Surface claim, depending on whether it is process progress or trust state
- proposed field change -> `ReviewItemProjection` emitted by Survey
- source excerpt and source URL -> `EvidenceProjection` emitted by Survey or Surface, depending on evidence authority
- approve/reject/apply next -> inert `ConsoleActionProjection` routed through Survey or the owning vertical product
- field provenance and `lastVerifiedAt` -> claim freshness/evidence metadata
- provider ID, field name, claim ID, Survey review item ID, and Flow Run ID -> `CrossProductLink`

The primitive producers can emit events as the workflow happens:

- Flow crawl/review workflow started -> `process.started`
- Survey source observed -> `evidence.attached`
- Survey proposed field change created -> `review_item.opened`
- Survey reviewer approved a value -> `review_item.approved` and `decision.recorded`
- Vertical-owned provider field applied through a routed action -> `action.completed`
- Surface claim updated -> `claim.status.changed`
- Surface field verification expires by policy -> `claim.freshness.changed`

The read model shown in Console can then be rebuilt from the event stream or loaded from the latest projection snapshot.

The checked-in `survey-field-review` fixtures show Survey as the review producer with vertical details represented as generic refs and Survey extension metadata.

## Inquiry Lifecycle Worked Example

The following table mirrors the Surface-and-Flow handoff example, showing how an agent asking an unmapped question flows through the Inquiry primitive and joins the suite-level attention queue.

Concrete story:

```text
Surface says: agent asked a question with no registered claim — inquiry.resolved unsupported.
Console says: unsupported gap joins the attention queue as an inquiry_unsupported_gap review item.
Surface says: a probabilistic proposer proposed a mapping — inquiry.mapping.proposed.
Survey says:  the mapping proposal entered review as a mapping_proposal review item.
Survey says:  the mapping was reviewed and verified — inquiry.mapping.reviewed.
Surface says: the same question resolves as matched on the next inquiry — inquiry.resolved matched.
```

| Moment | Console event | Primary subject | Important refs/links | Projection effect |
| --- | --- | --- | --- | --- |
| Agent asks unmapped question | `inquiry.resolved` | Surface inquiry | `outcome: "unsupported"`; `inquiryId`, `asker`, `statusFunctionVersion` in `payload.data`. | `inquiries[]` adds the record with `outcome: "unsupported"`; `summary.unsupportedInquiryCount` increments. A `review_item.opened` event should follow, adding a `reviewItems[]` entry with `kind: "inquiry_unsupported_gap"`. |
| Unsupported gap enters attention queue | `review_item.opened` | Survey review item | `kind: "inquiry_unsupported_gap"`; refs the Surface inquiry and the asker. | `reviewItems[]` shows the gap as `open`; the suite-level attention queue surfaces it next to stale claims, evidence gaps, and open gates. |
| Proposer proposes a mapping | `inquiry.mapping.proposed` | Surface mapping proposal | Refs the Surface inquiry and the candidate claim or rule. `payload.data` carries excerpt, rationale, and confidence. | A `review_item.opened` event should follow with `kind: "mapping_proposal"`, adding a `reviewItems[]` entry; `summary.pendingMappingProposalCount` increments. |
| Mapping proposal enters Survey review | `review_item.opened` | Survey review item | `kind: "mapping_proposal"`; refs the mapping proposal and candidate claim or rule. | `reviewItems[]` shows the proposal as `open` or `in_review`; existing Survey review machinery handles the review workflow. |
| Mapping reviewed and verified | `inquiry.mapping.reviewed` | Surface mapping | `outcome: "verified"`; refs the accepted mapping, the claim or rule it maps to. | A `review_item.approved` or `review_item.rejected` event should follow. `reviewItems[]` advances to `approved`. The accepted mapping is the durable reusable artifact that makes future identical questions resolve as `matched`. |
| Mapping accepted; review item closed | `review_item.approved` | Survey review item | Refs the mapping proposal and resolved claim or rule. | `reviewItems[]` moves to `approved`; `pendingMappingProposalCount` decrements; `decision.recorded` may follow with the reviewer authority. |
| Subsequent inquiry resolves matched | `inquiry.resolved` | Surface inquiry | `outcome: "matched"`; refs the matched claim; `statusFunctionVersion`. | `inquiries[]` adds the matched record; `claimRefs` links to the Surface claim for cross-product navigation; Console does not recompute the match — Surface is the authority. |

This lifecycle requires no changes to Survey review machinery. The `inquiry_unsupported_gap` and `mapping_proposal` kinds are new values in the `ReviewItemProjection.kind` vocabulary; Survey's candidate-to-review path handles them as additional item types through the existing workbench.

## Open Questions

- After v0 local JSONL, should later versions add hosted stream ingestion as an optional transport?
- Should each product emit one projection file, or should Console assemble projections from events and product-native APIs?
- Should action authority start as CLI commands, local HTTP endpoints, or both?
- Which events must be emitted synchronously, and which can be backfilled from product snapshots?
