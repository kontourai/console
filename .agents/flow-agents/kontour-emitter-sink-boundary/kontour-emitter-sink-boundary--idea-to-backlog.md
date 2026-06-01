# Kontour Emitter And Sink Boundary

phase: backlog
created: 2026-06-01
source: Builder Kit shape
issue_sync_status: not_requested

## Builder Kit Shape

- Builder Kit Flow Definition: `kits/builder/flows/shape.flow.json`
- Product-level surface used: `builder-shape`
- Delegated primitive: `idea-to-backlog`
- Issue sync: `not_requested`
- Backlog gate decision: stopped before GitHub issue creation because the user invoked shaping, not issue sync.

## source_ideas

Raw inputs from the current conversation:

- Kontour Console should remain local-first, but not be trapped in local filesystem writes.
- Products should emit semantic Kontour records through an abstraction, not hand-write final transport formats forever.
- A single product source stream should be able to fan out to multiple outputs, such as local files and a hosted API.
- Control plane and analytics/observability plane should be distinct, with shared correlation but different authority and data shapes.
- OpenTelemetry is likely useful for telemetry/analytics, not as the primary control-plane domain contract.
- Hosted/org Kontour Console will eventually need multi-project artifact management, but primitives must remain portable without hosted infrastructure.

## idea_inventory

| ID | Idea | Classification | Outcome | Reason |
| --- | --- | --- | --- | --- |
| I1 | Transport-neutral Kontour emitter/sink boundary | feature | commit | This is the thinnest foundation that prevents products from coupling directly to filesystem-only output while preserving local-first operation. |
| I2 | Control plane vs telemetry plane contract split | feature | commit | This terminology must be explicit before sinks are added, otherwise every record becomes a generic event and authority semantics blur. |
| I3 | Multi-sink fanout semantics | feature | shape | Needed for local+API output from one source stream; should be shaped with I1 because it directly defines emitter behavior. |
| I4 | Hosted HTTP ingest API | feature | park | Valuable but premature until emitter/sink interfaces and local semantics are stable. |
| I5 | OpenTelemetry bridge | research question | research | Needs separate mapping decisions after control/telemetry split is documented. |
| I6 | Generic repo root inspector for `.kontour/` outputs | feature | shape | Useful consumer-side complement to emitter work, but should follow or run after producer output paths are defined. |

## slice_candidates

### S1: Define Emission Planes And Sink Boundary

- Thinnest meaningful slice: Add a contract/spec describing `KontourEmitter`, control records, telemetry records, sink behavior, multi-sink fanout, and required local-first semantics. Include no production network client.
- Success signal: A product implementer can read the spec and know how to emit once to local file plus future API/telemetry sinks without changing domain event semantics.
- Non-goals: hosted API implementation, OpenTelemetry exporter, retry daemon, UI, product integration.

### S2: Implement Local And Composite Sink Skeleton

- Thinnest meaningful slice: Add dependency-free code that exposes `KontourEmitter`, `LocalFileSink`, and `CompositeSink` for control events/projections, with tests proving identical event ids are delivered to multiple sinks as inert records.
- Success signal: Tests demonstrate one semantic event can be written to local JSONL and captured by a second in-memory sink with same event id and independent sink results.
- Non-goals: real HTTP posting, OTLP export, durable outbox retries, hosted auth, product adapter integration.

### S3: Define Telemetry/Otel Mapping Spike

- Thinnest meaningful slice: Research/write an ADR for how Kontour telemetry maps to traces/metrics/logs and where correlation IDs bridge to control events.
- Success signal: Clear recommendation for whether to emit telemetry as local JSONL, OTLP, both, or a future bridge.
- Non-goals: implementing exporter, collecting live metrics, changing Flow Agents telemetry.

### S4: Generic `.kontour/` Root Inspector

- Thinnest meaningful slice: Extend the inspector to read `.kontour/events/control`, `.kontour/projections`, and possibly `.kontour/events/telemetry` from a supplied root with containment checks.
- Success signal: A non-fixture repo using the local sink can be inspected without custom adapter code.
- Non-goals: Campfit mapping, hosted sync, mutation, action execution.

## bundle_justification

Split by default:

- S1 and S2 are related but can remain separate. S1 is the contract; S2 is the first implementation. S2 depends on S1 or must include a small embedded contract update.
- S3 is related-only to S1/S2. It should not block the control emitter boundary because OpenTelemetry is not the source of truth for control-plane state.
- S4 is downstream of S1/S2. It becomes valuable once products can produce `.kontour/` outputs.

If issues are synced, recommended near-term bundle is **S1 only first**, or **S1+S2 together** only if we want implementation evidence immediately. Do not bundle S3 or S4 into the first issue.

## dependency_map

| Slice | Blocks | Blocked by | Relationship |
| --- | --- | --- | --- |
| S1 Define Emission Planes And Sink Boundary | S2, S3, S4 | none | foundational |
| S2 Implement Local And Composite Sink Skeleton | product integrations, generic root inspector | S1 | hard dependency |
| S3 Define Telemetry/Otel Mapping Spike | future Otel bridge | S1 | related dependency |
| S4 Generic `.kontour/` Root Inspector | real repo local-mode inspection | S1/S2 | downstream consumer |
| Hosted HTTP ingest API | org-level managed console | S1/S2 | parked future dependency |

## decisions

| Decision | Rationale | Decision maker | Date |
| --- | --- | --- | --- |
| Keep local-first support required | Primitives must remain portable and useful without hosted Kontour Console. | User + agent | 2026-06-01 |
| Separate control plane from telemetry plane | Control events carry authority-bearing product state; telemetry carries operational analytics. | User + agent | 2026-06-01 |
| Support multi-output fanout from one source emission | Products should emit once and deliver to local/API/Otel sinks without changing domain semantics. | User + agent | 2026-06-01 |
| Stop at backlog gate without GitHub issue sync | User invoked shaping skills but did not explicitly ask to create issues. | Builder shape contract | 2026-06-01 |

## opportunity_briefs

### O1: Emission Planes And Sink Boundary

- Problem: Products currently risk coupling directly to local file writes, which makes future hosted/org console ingestion harder.
- Stakeholder: Kontour product builders integrating Surface, Flow, Survey, Veritas, Flow Agents, and vertical products.
- Outcome: Products emit semantic records once through a stable emitter boundary and can fan out to local and future hosted sinks.
- Confidence: high.
- Size: small for spec, medium for first skeleton.
- Tradeoff: Adds abstraction early, but this abstraction protects product boundaries and hosted migration path.

### O2: Telemetry/Otel Mapping

- Problem: Analytics and observability can be confused with control-plane state if both are treated as generic events.
- Stakeholder: Console operators, product owners, agent/runtime maintainers.
- Outcome: Telemetry can enrich timelines, cost, latency, and health without becoming authority for claims/gates/reviews.
- Confidence: medium.
- Size: small research/ADR first.
- Tradeoff: Premature implementation could overfit to Otel before we know what product telemetry the console needs.

## shaped_work

### Candidate Issue 1: Define Kontour Emitter, Sink, And Plane Contracts

**Story / Outcome**

As a Kontour product implementer, I want a transport-neutral emitter/sink contract, so that products can emit control and telemetry records once while preserving local-first operation and preparing for hosted Console ingestion.

**Problem**

Kontour products need to produce events/projections for local Console use today and hosted/org Console use later. Direct filesystem writes alone will create migration friction. Treating telemetry and control state as the same kind of event will blur authority boundaries.

**Scope**

- Document `KontourEmitter` responsibilities.
- Define control-plane record categories: semantic events, projection snapshots, evidence refs, identity links, action descriptors.
- Define telemetry-plane record categories: traces/spans, metrics, logs, usage/cost, operational events.
- Define sink semantics: local file sink, future HTTP/API sink, future telemetry/Otel sink, composite sink.
- Define fanout semantics: same semantic record id, per-sink delivery results, at-least-once delivery, dedupe by id, local-first fallback.
- Define non-execution rule for action descriptors.

**Non-goals**

- Implement hosted API.
- Implement real HTTP or OTLP network calls.
- Integrate Campfit, Surface, Flow, Survey, Veritas, or Flow Agents.
- Build UI or dashboards.
- Define retry daemon/outbox beyond minimal contract language.

**Requirements**

- R1: The contract MUST distinguish control-plane records from telemetry-plane records.
- R2: The contract MUST keep local file output as a required first-class sink.
- R3: The contract MUST support multi-sink fanout from one semantic source record.
- R4: The contract MUST define per-sink delivery results and at-least-once/dedupe expectations.
- R5: The contract MUST state that sinks adapt delivery format, not product domain meaning.
- R6: The contract MUST state that action descriptors remain inert and are never executed by generic sinks.

**Acceptance Criteria**

- AC1: Docs define control-plane vs telemetry-plane data types and authority boundaries.
- AC2: Docs define `KontourEmitter`, `LocalFileSink`, `CompositeSink`, future `HttpApiSink`, and future telemetry/Otel sink roles.
- AC3: Docs define multi-output fanout with stable event/projection ids and independent per-sink results.
- AC4: Docs define local-first fallback and at-least-once/dedupe semantics.
- AC5: Docs explicitly state no generic sink executes action descriptors, opens URLs, or mutates product state.

**Verification Expectation**

- Doc inspection for R1-R6 and AC1-AC5.
- Security review for action descriptor, URL, and network-boundary language.
- Scope review confirming no hosted API/client implementation was added.

**Milestone / Delivery Outcome**

Recommended milestone: `Kontour Console Producer Contract`.

**Dependencies / Blockers**

None.

### Candidate Issue 2: Implement Local And Composite Sink Skeleton

**Story / Outcome**

As a Kontour product implementer, I want a small emitter and local/composite sink implementation, so that one semantic control record can be delivered to local JSONL and another sink without products hand-writing transport logic.

**Problem**

The current inspector can read fixtures, but producers do not yet have a small reusable boundary for writing records. Without a skeleton, products will create ad hoc file writers and make multi-output delivery harder.

**Scope**

- Add dependency-free emitter module.
- Implement `LocalFileSink` for control events/projections under `.kontour/` paths.
- Implement `CompositeSink` with independent sink results.
- Add an in-memory test sink for tests.
- Add tests proving fanout preserves event/projection id and does not execute action descriptors.
- Add README or docs usage snippet.

**Non-goals**

- Real HTTP/API network sink.
- Real OTLP exporter.
- Background retries, durable outbox, auth, hosted ingestion.
- Product adapters or Campfit integration.
- UI.

**Requirements**

- R1: Emitter MUST accept control events and projection snapshots matching the V0 contract.
- R2: Local sink MUST write append-only JSONL for events and latest/current JSON for projections using safe repo-relative paths.
- R3: Composite sink MUST fan out the same record to multiple sinks without changing record id.
- R4: Composite sink MUST report per-sink success/failure independently.
- R5: Implementation MUST NOT execute action descriptors, open URLs, fetch endpoints, or mutate product-owned state.
- R6: Tests MUST prove local+secondary sink fanout for one control event.

**Acceptance Criteria**

- AC1: A test emits one control event through `CompositeSink([LocalFileSink, InMemorySink])` and verifies the same `event.id` reaches both sinks.
- AC2: A test emits one projection snapshot through the local sink and verifies it can be read by the existing inspector/loader.
- AC3: Per-sink delivery result includes sink id/name, status, and error details when simulated failure occurs.
- AC4: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports.
- AC5: README or docs show local+future API fanout concept without implementing the API.

**Verification Expectation**

- `node --test`.
- Fixture inspector command still passes.
- Forbidden API scan.
- Code and security review.

**Milestone / Delivery Outcome**

Recommended milestone: `Kontour Console Producer Contract`.

**Dependencies / Blockers**

Blocked by Candidate Issue 1 unless Candidate Issue 1 docs are included in the same PR.

### Candidate Issue 3: Shape Telemetry/Otel Mapping ADR

**Story / Outcome**

As a Kontour operator, I want telemetry mapped separately from control-plane state, so that Console can show performance, cost, and health without confusing observability data with product authority.

**Problem**

OpenTelemetry and analytics are useful, but they should not decide whether a claim is valid or a gate passed. Kontour needs a correlation model between semantic control records and operational telemetry.

**Scope**

- Write ADR defining telemetry plane and Otel relationship.
- Define correlation fields shared with control records.
- Recommend local telemetry JSONL vs OTLP vs bridge strategy.
- Identify future metrics/spans/logs needed for Flow, Flow Agents, Surface, and Console.

**Non-goals**

- Implement Otel exporter.
- Add metrics collection.
- Change Flow Agents telemetry hooks.
- Define hosted telemetry storage.

**Requirements**

- R1: ADR MUST state telemetry is non-authoritative for control-plane decisions.
- R2: ADR MUST define shared correlation identifiers between control records and telemetry records.
- R3: ADR MUST describe candidate Otel span/metric/log mappings.
- R4: ADR MUST recommend a first implementation path or explicitly park implementation.

**Acceptance Criteria**

- AC1: ADR separates control and telemetry authority.
- AC2: ADR includes examples mapping a Flow gate evaluation and Surface freshness check to telemetry.
- AC3: ADR records whether Otel is used directly, bridged, or deferred.
- AC4: ADR lists open questions for cost, token, latency, and health data.

**Verification Expectation**

- Doc review only.
- No production telemetry implementation.

**Milestone / Delivery Outcome**

Recommended milestone: `Kontour Console Producer Contract` or parked under research.

**Dependencies / Blockers**

Related to Candidate Issue 1; not required for emitter skeleton.

## risk_release_notes

| Candidate | Risk class | Rollout | Rollback | Observability |
| --- | --- | --- | --- | --- |
| Candidate 1 | Low | Docs/spec only. | Revert docs/ADR. | Review for terminology consistency. |
| Candidate 2 | Medium | Add local-only module and tests. | Revert module/tests/docs; no hosted state. | Tests, forbidden API scan, fixture inspector compatibility. |
| Candidate 3 | Low | ADR only. | Revert ADR. | Review for control/telemetry clarity. |

## backlog_links

- GitHub issue sync: `not_requested`
- Created issues: none
- Backlog gate status: shaped candidates are ready for issue sync if explicitly requested.

## parked_or_rejected

| Idea | Status | Reason | Revisit trigger |
| --- | --- | --- | --- |
| Hosted HTTP ingest API | parked | Premature before emitter/sink contract and local skeleton are stable. | After Candidate Issue 2 passes. |
| Real Otel exporter | parked/research | Need telemetry mapping ADR first. | After Candidate Issue 3. |
| Campfit producer integration | parked | Real repo mapping is premature until producer contract exists and Campfit/Survey/Surface integration is clearer. | After emitter/sink skeleton and generic `.kontour/` output paths exist. |

## open_questions

| Question | Owner | Needed evidence |
| --- | --- | --- |
| Should Candidate 1 and Candidate 2 be one issue or two? | User | Decision on whether docs-only contract should land before code skeleton. |
| What exact `.kontour/` local output paths should become canonical for control and telemetry? | Product/engineering | Review existing event/projection schema and inspector assumptions. |
| Should local sink failures ever block producer workflows, or only warn/outbox? | Product/engineering | Product-specific risk tolerance for Surface/Flow/Agents runs. |
| What hosted API auth/tenant model is expected later? | Product | Deferred until hosted ingest API shaping. |

## next_gate

- Gate: Backlog Gate
- Status: pass, stopped before issue creation
- Reason: shaped candidates are coherent and testable, but GitHub issue sync was not explicitly requested.
- Recommended next action if user wants execution backlog: sync Candidate Issue 1, or Candidate Issues 1+2 as a bundled milestone slice if immediate implementation evidence is preferred.
