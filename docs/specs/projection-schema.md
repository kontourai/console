# Kontour Console Event And Projection Schema

Status: first pass

Kontour Console composes product-owned event streams and projections. It does not replace Surface Claims, Flow Runs, Survey records, Veritas readiness, Flow Agents runtime state, or vertical product records.

The event stream is the durable integration contract. Projections are cached read models derived from events so the suite-level console can render claim status, process status, proof, queues, decisions, freshness, exceptions, and next actions quickly.

## Principle

Surface Claims are the trust backbone. Most products should emit Surface Claims when they need to say whether something is verified, stale, disputed, rejected, unsupported, fresh, or policy-compliant.

Kontour Console also needs management objects that are not themselves claims:

- active or historical process runs
- open gates
- review items
- pending actions
- decisions
- proof summaries
- exceptions
- cross-product identity links

The event and projection schemas compose those objects without making Kontour Console the source of truth for any of them.

## Event-First Contract

Products should emit append-only events for meaningful state changes and decisions. Kontour Console can fold those events into snapshots/projections for fast rendering.

Event-first gives the suite-level console:

- live progress updates without waiting for full runs to finish
- auditability for decisions, exceptions, and route-backs
- replayable state when projections need to be rebuilt
- clearer separation between source events and derived read models
- support for both local files and hosted streams

Snapshot/projection files are still useful. They are read models, not the durable source contract.

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

`occurredAt` is when the product says the event happened. `observedAt` is when Kontour Console or another collector saw it. `correlationId` groups related events across products; `causationId` points to the event or action that caused this event.

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
  | string;
```

Event types should be specific enough for routing and filtering but not so product-specific that Kontour Console must understand every vertical domain model.

## Event Payload

```ts
type ConsoleEventPayload = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  summary?: string;
  reason?: string;
  refs?: CrossProductRef[];
  data?: Record<string, unknown>;
};
```

Events may carry a full `after` view, a small patch, or a product-specific `data` object. Consumers should use event type, subject, refs, and links for cross-product behavior; product-specific detail belongs under `data` or `extensions`.

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
  derivedFrom?: {
    streamIds?: string[];
    lastEventId?: string;
    lastSequence?: number;
    eventCount?: number;
  };
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
  links?: CrossProductLink[];
  extensions?: Record<string, unknown>;
};
```

Projections should be rebuildable from events where possible. A product may also emit a projection snapshot directly when event history is unavailable, but the long-term integration contract should still prefer events.

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

The producer identifies the product or vertical emitting the projection. A vertical product such as Campfit may emit both product-native objects and links to Surface/Flow objects.

## Scope

```ts
type ConsoleScope = {
  kind: "repo" | "product" | "workspace" | "tenant" | "project" | "domain" | string;
  id: string;
  label?: string;
  refs?: CrossProductRef[];
};
```

Scope tells Kontour Console what boundary the projection describes: a repository, product, customer workspace, domain entity set, or other product-owned unit.

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

Claims should be projected from Surface whenever possible. Kontour Console can display them, filter them, and link them to workflow state, but Surface remains the authority for trust derivation.

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

Gates belong to Flow. Kontour Console can expose status and actions, but it must route mutations through Flow control semantics.

## Review Items

```ts
type ReviewItemProjection = {
  id: string;
  label?: string;
  kind: "claim_review" | "field_change" | "candidate_fact" | "gate_exception" | "evidence_gap" | "readiness_gap" | string;
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

Review Items can be created by Flow gates, Survey candidate workflows, Veritas readiness gaps, Flow Agents continuations, or vertical products. The owning product remains responsible for the decision semantics.

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

Decision records should be immutable summaries of product-owned decisions. Kontour Console should not invent decision history after the fact.

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

Actions are routed through the product that owns the authority. Kontour Console may present and initiate actions, but it should not bypass product-owned APIs, CLIs, or control semantics.

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

Identity links are the core of the suite-level console. They let Kontour Console answer questions such as:

- Which Flow Run is changing this Surface Claim?
- Which Review Item is waiting on this Survey Candidate?
- Which Veritas readiness gap blocks this Flow gate?
- Which Flow Agents session produced this decision?
- Which Campfit provider field does this claim describe?

## Campfit Mapping Example

Campfit can project its current review workflow like this:

- provider registration status claim -> `ClaimStatusProjection`
- crawl or review workflow -> `ProcessStatusProjection`
- required-field coverage check -> `GateStatusProjection` or Surface claim, depending on whether it is process progress or trust state
- proposed field change -> `ReviewItemProjection`
- source excerpt and source URL -> `EvidenceProjection`
- approve/reject/apply next -> `ConsoleActionProjection`
- field provenance and `lastVerifiedAt` -> claim freshness/evidence metadata
- provider ID, field name, claim ID, review item ID, and Flow Run ID -> `CrossProductLink`

Campfit can also emit events as the workflow happens:

- crawl started -> `process.started`
- source observed -> `evidence.attached`
- proposed field change created -> `review_item.opened`
- reviewer approved a value -> `review_item.approved` and `decision.recorded`
- provider field applied -> `action.completed`
- Surface claim updated -> `claim.status.changed`
- field verification expires by policy -> `claim.freshness.changed`

The read model shown in Kontour Console can then be rebuilt from the event stream or loaded from the latest projection snapshot.

## Open Questions

- Should each product emit local JSONL event streams, hosted streams, or both?
- Should each product emit one projection file, or should Kontour Console assemble projections from events and product-native APIs?
- Should action authority start as CLI commands, local HTTP endpoints, or both?
- Which identity links should be required for v0.1?
- Which events must be emitted synchronously, and which can be backfilled from product snapshots?
