# Kontour Console Foundation - Idea To Backlog

Date: 2026-06-01
Phase: backlog
Next gate: Backlog Gate - BLOCKED on GitHub remote/auth before issue sync.

## source_ideas

- Conversation: realtime claim status, Flow run/control visibility, Flow Console, Surface Console alignment, Campfit review surface extraction, Kontour Console as suite-level product, event-first integration.
- Existing repo artifacts:
  - `CONTEXT.md`
  - `docs/product-boundaries.md`
  - `docs/specs/projection-schema.md`
  - `docs/adr/0001-kontour-console-as-suite-management-plane.md`
- Related product docs:
  - `../surface/CONTEXT.md`
  - `../flow/CONTEXT.md`
  - `../flow/docs/console.md`
  - `../flow/docs/adr/0004-flow-console-review-queues-and-run-control.md`

## idea_inventory

### I1 - Kontour Console Product Context

- Classification: feature / product foundation
- Outcome: commit
- Reason: already agreed Kontour Console is a suite-level product and has a new repo. It needs durable product context before implementation.

### I2 - Event-First Console Integration Contract

- Classification: feature / platform contract
- Outcome: shape
- Reason: user explicitly chose event stream as the direction. This is the foundation for realtime visibility, auditability, replay, and projections.

### I3 - Derived Projection / Read Model Contract

- Classification: feature / platform contract
- Outcome: shape
- Reason: events need cached projections for fast console rendering and compatibility with current Surface Console patterns.

### I4 - Cross-Product Identity Links

- Classification: feature / platform contract
- Outcome: shape
- Reason: identity links are required to join Surface Claims, Flow Runs, Review Items, evidence, actions, and vertical domain records.

### I5 - Flow Console V0 With Campfit Extension

- Classification: feature / product integration
- Outcome: research then shape
- Reason: desired implementation target is Flow-focused first with Campfit as reference extension. Needs exploration of Campfit repo and Flow/Surface console code before executable scope.

### I6 - Surface Console / Flow Console Architectural Alignment

- Classification: cleanup / architecture
- Outcome: shape
- Reason: alignment is a constraint for future Kontour Console but should be implemented incrementally through contracts and route/projection conventions.

### I7 - Realtime Current Claim Status

- Classification: feature / product behavior
- Outcome: shape
- Reason: Surface should show current claim status without forcing a run-first view. Some freshness state can be clock-derived; reverification remains producer-owned.

### I8 - Suite-Level Workspace IA

- Classification: product design / feature
- Outcome: park
- Reason: important, but should follow event/object model so IA reflects reliable primitives rather than speculative screens.

## slice_candidates

### S1 - Establish Kontour Console Repo And Product Context

- Ideas: I1
- Thinnest meaningful slice: create standalone repo with product glossary, boundaries, first ADR, and event/projection spec index.
- Success signal: future agents can identify Kontour Console as suite-level product without reading Flow docs.
- Non-goals: app scaffold, hosted service, shared component package.
- Status: done in local repo; issue optional.

### S2 - Define V0 Event Stream Contract

- Ideas: I2
- Thinnest meaningful slice: specify event envelope, required fields, v0 event types, ordering/correlation rules, JSONL file convention, and examples for Surface/Flow/Campfit.
- Success signal: Surface, Flow, and Campfit can each emit a minimal event stream that Kontour Console can consume.
- Non-goals: hosted event bus, durable storage engine, UI.

### S3 - Define V0 Projection Read Model

- Ideas: I3
- Thinnest meaningful slice: specify projection envelope derived from events, required object arrays, `derivedFrom` metadata, and read-model compatibility with Surface Console style.
- Success signal: a fixture event stream can fold into a deterministic console projection.
- Non-goals: final IA, shared component package, mutations/actions execution.

### S4 - Define Cross-Product Identity Link Minimums

- Ideas: I4
- Thinnest meaningful slice: specify required `CrossProductRef` and `CrossProductLink` fields and minimum link relations for claim-process-review-evidence-action joins.
- Success signal: console can answer "what workflow is changing this claim?" and "what claim does this review item affect?" from fixtures.
- Non-goals: global identity service, database schema, graph store.

### S5 - Flow Console Contract And Local Server Spike

- Ideas: I5, I6
- Thinnest meaningful slice: explore Surface Console architecture and define Flow Console local file/route conventions, then create a minimal Flow-owned projection/server plan.
- Success signal: executable issue can be planned for Flow Console v0 without importing Campfit-specific assumptions.
- Non-goals: full app, shared `kontour-console` package, hosted UI.

### S6 - Campfit Reference Extension Mapping

- Ideas: I5
- Thinnest meaningful slice: map Campfit provider review concepts to Flow Review Items, Surface Claims, evidence, decisions, actions, and cross-product events.
- Success signal: one Campfit provider review fixture can be represented as events plus projection objects.
- Non-goals: migrating Campfit admin UI, production adapter, data writes back to Campfit.

### S7 - Surface Current Claim Status Events

- Ideas: I7
- Thinnest meaningful slice: define claim status/freshness event semantics that distinguish clock-derived freshness changes, producer reverification requests, producer reverification completion, and full runs.
- Success signal: Surface Console and Kontour Console can show current claim status without choosing a run first.
- Non-goals: changing Surface trust derivation immediately, hosted scheduler.

### S8 - Suite Workspace IA

- Ideas: I8
- Thinnest meaningful slice: define the first suite navigation model after S2-S4 produce object vocabulary.
- Success signal: IA maps directly to event/projection objects and actions.
- Non-goals: visual design system, app implementation.

## bundle_justification

The work should not ship as one bundled implementation. The ideas share one outcome, but the executable slices have different risk profiles:

- S1 is already completed as documentation/repo setup.
- S2-S4 are the platform contract foundation and should be bundled only as a "Kontour Console V0 contract" milestone because each depends on the others for a coherent integration target.
- S5-S6 depend on S2-S4 and should follow as proof through Flow/Campfit.
- S7 can proceed in parallel conceptually but should align with S2 event vocabulary.
- S8 should wait until the object/event model is stable enough to avoid speculative IA.

Decision: split into separate backlog issues under one milestone rather than one large issue.

## dependency_map

- S2 blocks S3, S5, S6, S7, S8.
- S4 blocks S3, S5, S6, S8.
- S3 blocks implementation of any shared console renderer.
- S5 blocks production-grade Flow Console.
- S6 depends on S5 enough to avoid leaking Campfit semantics into Flow core.
- S7 related to S2 and S3; it can be shaped in Surface once event vocabulary exists.
- S8 blocked by S2-S4.

## decisions

| Date | Decision | Rationale | Decision maker |
|---|---|---|---|
| 2026-06-01 | Kontour Console is a suite-level product. | The comprehensive management/view layer is the product being sold; primitives remain portable. | User |
| 2026-06-01 | Create standalone `kontour-console` repo. | Avoid burying suite-level language inside Flow. | User |
| 2026-06-01 | Event stream is the preferred direction. | Realtime visibility, auditability, replay, and current status require events; projections can still exist as read models. | User |
| 2026-06-01 | Do not start with a throwaway prototype. | The product boundary is clear enough to shape contracts first. | User |

## opportunity_briefs

### OB1 - Kontour Console V0 Contract

- Problem: product consoles and primitives need a common way to feed a suite-level operating view without losing product authority.
- Stakeholder: Kontour product builders, operators, producers, future suite customers.
- Outcome: event-first contract plus projection/read-model contract that products can emit locally.
- Confidence: medium-high; direction is agreed, exact v0 required fields need validation.
- Size: medium.

### OB2 - Flow Console With Campfit Reference Extension

- Problem: Flow needs a real console path for run/gate/review visibility, and Campfit is the current best proof of a domain review workflow.
- Stakeholder: Flow users, Campfit operators, future vertical products, Flow Agents.
- Outcome: Flow Console can show process state and review queues while Campfit supplies native field/evidence rendering.
- Confidence: medium; requires code exploration and likely incremental implementation.
- Size: large.

### OB3 - Realtime Claim Status

- Problem: Surface Console is currently run-oriented, but users need current claim status, freshness, and reverification state independent of a selected run.
- Stakeholder: operators, producers, Kontour Console users.
- Outcome: current claim status and freshness can update through events and clock-derived logic without a full run.
- Confidence: medium; requires careful separation between derived freshness and producer verification.
- Size: medium.

## shaped_work

### Work Item W1 - Define Kontour Console V0 Event Stream Contract

Story / Outcome:
As a product builder, I want a stable event contract for Kontour Console so that Surface, Flow, Campfit, and future products can emit realtime operating state without coupling to a hosted console.

Problem:
Snapshots alone make realtime progress, audit, and cross-product correlation difficult. Products need an append-only event shape that Kontour Console can consume locally or hosted.

Scope:
- Define `KontourConsoleEvent` required and optional fields.
- Define v0 event type vocabulary.
- Define local JSONL convention.
- Define ordering, event IDs, correlation, causation, and replay expectations.
- Include examples for Surface claim status, Flow process/gate state, and Campfit review events.

Non-goals:
- Hosted event bus.
- Auth/multi-tenant ingestion.
- UI implementation.
- Product-specific adapters.

Requirements:
- R1: The event envelope must include stable event id, type, time, producer, scope, subject, payload, and optional links.
- R2: The event contract must support cross-product correlation through correlation id, causation id, and identity links.
- R3: The event vocabulary must cover claim status/freshness, process progress, gates, review items, evidence, decisions, actions, and exceptions.
- R4: The local event file convention must be usable without a hosted service.
- R5: Product-specific detail must live under `data` or `extensions` without changing the core event envelope.

Acceptance Criteria:
- AC1: A spec lists required fields for `KontourConsoleEvent`.
- AC2: A spec lists v0 event types and their intended use.
- AC3: A local JSONL file convention is documented.
- AC4: At least three example event sequences exist: Surface claim freshness, Flow gate route-back, Campfit field review.
- AC5: The spec states how projections are rebuilt from events.

Verification Expectation:
Review docs for required fields and examples; optionally validate example JSONL with a lightweight schema in a later implementation issue.

### Work Item W2 - Define Kontour Console V0 Projection Read Model

Story / Outcome:
As a console implementer, I want a derived projection schema so that the UI can render current operating state quickly from event streams.

Problem:
Event streams are durable and replayable, but UI rendering needs a current read model for summary, lists, detail panels, queues, and actions.

Scope:
- Define `KontourConsoleProjection` as a read model derived from events.
- Define summary, claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links arrays.
- Define `derivedFrom` metadata.
- Define deterministic folding expectations at a high level.

Non-goals:
- Full reducer implementation.
- Visual IA.
- Hosted cache/storage.

Requirements:
- R1: Projection must include `derivedFrom` stream metadata.
- R2: Projection must represent claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links.
- R3: Projection objects must retain product authority references.
- R4: Projection schema must permit direct snapshot emission when event history is unavailable.

Acceptance Criteria:
- AC1: Projection envelope and object types are documented.
- AC2: The relationship between event stream and projection snapshot is explicit.
- AC3: The projection schema can represent the Campfit mapping example.
- AC4: The projection schema can represent Surface current claim status independent of run picker state.

Verification Expectation:
Doc review plus fixture mapping in a later implementation issue.

### Work Item W3 - Define Cross-Product Identity Link Minimums

Story / Outcome:
As an operator, I want Kontour Console to connect claims, workflows, review items, evidence, and domain records so that I can understand why something is blocked or stale without hunting across tools.

Problem:
Surface Claims, Flow Runs, Survey Candidates, Veritas checks, Flow Agents sessions, and Campfit fields are related but currently use product-local identifiers.

Scope:
- Define required `CrossProductRef` fields.
- Define v0 `CrossProductLink` relations.
- Define minimum links each product should emit.
- Define examples for claim-to-run, review-to-claim, gate-to-evidence, and domain-field-to-claim.

Non-goals:
- Global identity service.
- Graph database.
- Automatically inferred links.

Requirements:
- R1: References must include product, kind, id, and optional label/url.
- R2: Links must include from, to, relation, and optional strength.
- R3: v0 relation vocabulary must support supports, blocks, updates, reviews, produced_by, evidenced_by, controls, and derived_from.
- R4: The spec must identify which links are required for v0 console usefulness.

Acceptance Criteria:
- AC1: Cross-product ref and link shapes are documented.
- AC2: Required v0 link examples are documented.
- AC3: Campfit provider field to Surface claim to Flow Review Item mapping can be represented.

Verification Expectation:
Doc review and fixture mapping.

### Work Item W4 - Explore Flow Console V0 With Campfit Extension

Story / Outcome:
As a Flow product builder, I want Flow Console v0 grounded in Campfit review workflows so that generic Flow run/control/review semantics are proven against a real vertical product.

Problem:
Flow Console should not become abstract UI theory, and Campfit should not define Flow core. We need an exploration artifact that maps the real Campfit admin/review flow into Flow/Kontour Console contracts.

Scope:
- Inspect Surface Console architecture.
- Inspect Flow run/report/control state.
- Inspect Campfit admin review data and UI flow.
- Produce a Flow Console v0 implementation plan with Campfit extension boundary.
- Identify required event/projection additions.

Non-goals:
- Production implementation.
- Migrating Campfit UI.
- Creating shared `kontour-console` package.

Requirements:
- R1: Exploration must identify reusable Surface Console architecture patterns.
- R2: Exploration must map Campfit review concepts to Flow Review Items and Kontour events.
- R3: Exploration must separate Flow-owned semantics from Campfit extension rendering.
- R4: Exploration must produce executable follow-up issues.

Acceptance Criteria:
- AC1: Exploration artifact lists relevant files and current code facts.
- AC2: Flow Console v0 scope is defined.
- AC3: Campfit extension boundary is defined.
- AC4: Follow-up issues are ready for `pull-work`.

Verification Expectation:
Read-only code exploration and artifact review.

### Work Item W5 - Shape Surface Current Claim Status Events

Story / Outcome:
As an operator, I want to see current claim status and freshness without selecting a run so that I can understand what is valid now and what needs attention.

Problem:
Surface Console currently emphasizes run snapshots, but current status can change through time, freshness policy, events, and producer reverification.

Scope:
- Define Surface claim status/freshness event semantics.
- Distinguish clock-derived freshness from producer reverification.
- Define one-off refresh/reverify action events.
- Align with Kontour Console event contract.

Non-goals:
- Implement Surface Console changes.
- Hosted scheduling.
- Replacing Surface trust derivation.

Requirements:
- R1: Current claim status must not require selecting a producer run.
- R2: Freshness changes that are purely time-derived must be representable without a new producer run.
- R3: Producer reverification request/completion must be representable as events.
- R4: Full runs remain provenance, not the only status lens.

Acceptance Criteria:
- AC1: Status/freshness event semantics are documented.
- AC2: One-off reverification lifecycle is documented.
- AC3: Surface Console and Kontour Console implications are described.

Verification Expectation:
Doc review against Surface glossary and console docs.

## risk_release_notes

- Risk class: medium. Product boundary and contract decisions affect several repos.
- Rollout: docs/specs first, fixtures second, local event ingestion third, UI fourth.
- Rollback: specs can be revised before implementation; avoid publishing npm/API contracts until examples validate.
- Observability: event streams should include IDs, sequence, correlation, causation, producer, and timestamps from the start.

## backlog_links

- No GitHub issues created yet.
- GitHub sync attempted on 2026-06-01.
- Blocker: `kontour-console` has no GitHub remote configured.
- Blocker: `gh auth status` reports the active `briananderson1222` token is invalid.
- Decision: W1-W3 are committed as the first executable backlog slice under milestone `Kontour Console V0 Contract`; issue sync is blocked only on remote/auth setup.

## issue_drafts

### Issue 1 - Define Kontour Console V0 Event Stream Contract

Story / Outcome:
As a product builder, I want a stable event contract for Kontour Console so that Surface, Flow, Campfit, and future products can emit realtime operating state without coupling to a hosted console.

Problem:
Snapshots alone make realtime progress, audit, and cross-product correlation difficult. Products need an append-only event shape that Kontour Console can consume locally or hosted.

Scope:
- Define `KontourConsoleEvent` required and optional fields.
- Define v0 event type vocabulary.
- Define local JSONL convention.
- Define ordering, event IDs, correlation, causation, and replay expectations.
- Include examples for Surface claim status, Flow process/gate state, and Campfit review events.

Non-goals:
- Hosted event bus.
- Auth/multi-tenant ingestion.
- UI implementation.
- Product-specific adapters.

Requirements:
- R1: The event envelope must include stable event id, type, time, producer, scope, subject, payload, and optional links.
- R2: The event contract must support cross-product correlation through correlation id, causation id, and identity links.
- R3: The event vocabulary must cover claim status/freshness, process progress, gates, review items, evidence, decisions, actions, and exceptions.
- R4: The local event file convention must be usable without a hosted service.
- R5: Product-specific detail must live under `data` or `extensions` without changing the core event envelope.

Acceptance Criteria:
- AC1: A spec lists required fields for `KontourConsoleEvent`.
- AC2: A spec lists v0 event types and their intended use.
- AC3: A local JSONL file convention is documented.
- AC4: At least three example event sequences exist: Surface claim freshness, Flow gate route-back, Campfit field review.
- AC5: The spec states how projections are rebuilt from events.

Verification Expectation:
Review docs for required fields and examples; optionally validate example JSONL with a lightweight schema in a later implementation issue.

Milestone / Delivery Outcome:
`Kontour Console V0 Contract`

Dependencies / Blockers:
None. First slice.

Source Artifact:
`.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`

### Issue 2 - Define Kontour Console V0 Projection Read Model

Story / Outcome:
As a console implementer, I want a derived projection schema so that the UI can render current operating state quickly from event streams.

Problem:
Event streams are durable and replayable, but UI rendering needs a current read model for summary, lists, detail panels, queues, and actions.

Scope:
- Define `KontourConsoleProjection` as a read model derived from events.
- Define summary, claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links arrays.
- Define `derivedFrom` metadata.
- Define deterministic folding expectations at a high level.

Non-goals:
- Full reducer implementation.
- Visual IA.
- Hosted cache/storage.

Requirements:
- R1: Projection must include `derivedFrom` stream metadata.
- R2: Projection must represent claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links.
- R3: Projection objects must retain product authority references.
- R4: Projection schema must permit direct snapshot emission when event history is unavailable.

Acceptance Criteria:
- AC1: Projection envelope and object types are documented.
- AC2: The relationship between event stream and projection snapshot is explicit.
- AC3: The projection schema can represent the Campfit mapping example.
- AC4: The projection schema can represent Surface current claim status independent of run picker state.

Verification Expectation:
Doc review plus fixture mapping in a later implementation issue.

Milestone / Delivery Outcome:
`Kontour Console V0 Contract`

Dependencies / Blockers:
Depends on Issue 1 event stream vocabulary.

Source Artifact:
`.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`

### Issue 3 - Define Cross-Product Identity Link Minimums

Story / Outcome:
As an operator, I want Kontour Console to connect claims, workflows, review items, evidence, and domain records so that I can understand why something is blocked or stale without hunting across tools.

Problem:
Surface Claims, Flow Runs, Survey Candidates, Veritas checks, Flow Agents sessions, and Campfit fields are related but currently use product-local identifiers.

Scope:
- Define required `CrossProductRef` fields.
- Define v0 `CrossProductLink` relations.
- Define minimum links each product should emit.
- Define examples for claim-to-run, review-to-claim, gate-to-evidence, and domain-field-to-claim.

Non-goals:
- Global identity service.
- Graph database.
- Automatically inferred links.

Requirements:
- R1: References must include product, kind, id, and optional label/url.
- R2: Links must include from, to, relation, and optional strength.
- R3: v0 relation vocabulary must support supports, blocks, updates, reviews, produced_by, evidenced_by, controls, and derived_from.
- R4: The spec must identify which links are required for v0 console usefulness.

Acceptance Criteria:
- AC1: Cross-product ref and link shapes are documented.
- AC2: Required v0 link examples are documented.
- AC3: Campfit provider field to Surface claim to Flow Review Item mapping can be represented.

Verification Expectation:
Doc review and fixture mapping.

Milestone / Delivery Outcome:
`Kontour Console V0 Contract`

Dependencies / Blockers:
Related to Issue 1 event envelope and Issue 2 projection objects.

Source Artifact:
`.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`

## parked_or_rejected

### Suite Workspace IA

- Reason: should follow object/event vocabulary and initial fixtures.
- Revisit trigger: after W1-W3 are shaped/accepted or after first fixture projection exists.

### Shared UI Package

- Reason: premature before Surface Console and Flow Console prove shared shell/component behavior.
- Revisit trigger: after Flow Console v0 exists and duplicates concrete Surface Console patterns.

## open_questions

- Owner: user / product lead. Configure GitHub remote for `kontour-console`.
- Owner: user / product lead. Refresh GitHub CLI auth.
- Owner: user / product lead. Should GitHub milestones be used for `Kontour Console V0 Contract`?
- Owner: user / product lead. Should action authority v0 prefer local HTTP endpoints, CLI commands, or both?
- Owner: implementation lead. Which exact local JSONL path convention should products use?
- Owner: implementation lead. Which v0 cross-product links are required versus recommended?

## next_gate

Gate: Backlog Gate
Status: BLOCKED
Reason: W1-W3 are committed as issue drafts for milestone `Kontour Console V0 Contract`, but GitHub issue sync is blocked because the repo has no remote and GitHub CLI auth is invalid. W4-W5 remain shaped follow-ups.
