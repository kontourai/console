---
role: plan
parent: kontour-console-v0-event-stream-contract--plan-work
created: 2026-06-01T00:00:00-06:00
---

# Define Kontour Console V0 Event Stream Contract

## Plan

Tighten the existing first-pass event/projection spec into a v0 event-stream contract that products can emit locally without a hosted console. Keep the durable contract in `docs/specs/projection-schema.md`, add JSONL examples under `docs/examples/event-streams/`, and avoid implementing reducers, adapters, auth, hosted ingestion, UI, or product-owned semantics. The implementation should preserve the current model that events are the durable integration contract, projections are cached read models, Surface owns trust derivation, Flow owns gate/run semantics, and vertical products keep domain truth under `payload.data` or `extensions`.

## Definition Of Done

- **User outcome:** A product builder can read the docs and emit a minimal Kontour Console v0 local JSONL event stream for Surface claim freshness, Flow gate route-back, or Campfit field review, with enough replay guidance to rebuild projections from those events.
- **Scope:** Update docs/specs and examples only. Include event envelope fields, event type vocabulary and intent, ordering/correlation/replay rules, local JSONL file convention, projection rebuild semantics, and three example event sequences. Exclude hosted event bus, auth/multi-tenant ingestion, UI implementation, product-specific adapters, action execution endpoints, and projection reducer implementation.
- **Acceptance criteria:**
  - [ ] AC1 `event-required-fields`: A spec lists required fields for `KontourConsoleEvent`. Evidence: `docs/specs/projection-schema.md` has an explicit required/optional field table covering `schema`, `version`, `id`, `type`, `occurredAt`, `producer`, `scope`, `subject`, and `payload`.
  - [ ] AC2 `v0-event-types`: A spec lists v0 event types and their intended use. Evidence: `docs/specs/projection-schema.md` maps every v0 event type to intended use and covers claim status/freshness, process progress, gates, review items, evidence, decisions, actions, and exceptions.
  - [ ] AC3 `local-jsonl-convention`: A local JSONL file convention is documented. Evidence: `docs/specs/projection-schema.md` documents file naming/location guidance, one event per line, UTF-8 JSON, append-only expectations, ordering, event IDs, sequence handling, correlation/causation, backfill, and local replay behavior.
  - [ ] AC4 `event-sequence-examples`: At least three example event sequences exist: Surface claim freshness, Flow gate route-back, Campfit field review. Evidence: JSONL examples exist under `docs/examples/event-streams/` and are referenced from `docs/specs/projection-schema.md`.
  - [ ] AC5 `projection-rebuilds`: The spec states how projections are rebuilt from events. Evidence: `docs/specs/projection-schema.md` explains deterministic replay/folding, idempotency by event id, ordering by sequence or occurred time, `derivedFrom` metadata, snapshot fallback, and unresolved limits without implementing a reducer.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable from `docs/specs/projection-schema.md`.
  - [ ] Product authority boundaries remain explicit for Surface, Flow, Campfit/verticals, and Kontour Console.
  - [ ] Unknown, `NOT_VERIFIED`, and TODO gaps are resolved or explicitly accepted in the final docs.
  - [ ] Examples are inspectable as local JSONL and do not depend on hosted infrastructure.
- **Stop-short risks:** The doc could list fields but fail to say which are required; examples could be valid-looking but omit correlation/causation or links; projection rebuild guidance could be too vague to guide a later reducer; event vocabulary could leak Campfit-specific fields into the core envelope instead of keeping them under `payload.data` or `extensions`; local JSONL guidance could imply a hosted service or product adapter that is out of scope.
- **Durable docs target:** `docs/specs/projection-schema.md` plus example fixtures in `docs/examples/event-streams/`. Update `README.md` only if a docs index link is missing or useful after examples are added.
- **Sandbox mode:** `local-edit`.

## Requirement Traceability

| Requirement | Planned coverage |
| --- | --- |
| R1 | Wave 1 Task 1 defines required envelope fields and optional links. |
| R2 | Wave 1 Task 1 and Task 3 document correlation id, causation id, identity links, and example usage. |
| R3 | Wave 1 Task 2 documents v0 event type vocabulary and intended use across claims, process, gates, review, evidence, decisions, actions, exceptions. |
| R4 | Wave 1 Task 3 documents local JSONL convention and replay without hosted infrastructure. |
| R5 | Wave 1 Task 1 and Task 4 keep product-specific detail under `payload.data` or `extensions`. |
| AC1 | Wave 1 Task 1. |
| AC2 | Wave 1 Task 2. |
| AC3 | Wave 1 Task 3. |
| AC4 | Wave 1 Task 4. |
| AC5 | Wave 2 Task 5. |

### Wave 1 (parallel)

#### Task: Formalize event envelope fields

- **Files:** Modify `docs/specs/projection-schema.md`.
- **Changes:** Add an explicit `KontourConsoleEvent` field table with required vs optional status, stable type expectations, and producer/scope/subject/payload/link responsibilities. Clarify that `payload.data` and `extensions` are the only places for product-specific detail that does not belong to the core envelope.
- **Acceptance:** Doc inspection confirms required fields cover R1 and AC1, optional fields include actor, observedAt, correlationId, causationId, sequence, links, and extensions, and R5 is explicit.
- **Supports:** R1, R2, R5, AC1.
- **Context:** Existing `Event Envelope`, `Event Payload`, `Producer`, `Scope`, and `Cross-Product Links` sections already provide the first-pass types. Preserve them and add normative prose/tables instead of replacing the model.

#### Task: Document v0 event type vocabulary

- **Files:** Modify `docs/specs/projection-schema.md`.
- **Changes:** Convert or supplement the existing `ConsoleEventType` union with a table grouping v0 event types by product-neutral category and intended use. Cover claim status/freshness/reverification, process lifecycle/progress, gates including route-back, review item lifecycle, evidence attachment, decisions, actions, and exceptions.
- **Acceptance:** Doc inspection confirms each current event type has an intended-use sentence and the vocabulary covers R3 and AC2 without adding product-specific core event names.
- **Supports:** R3, AC2.
- **Context:** The current event type union is a good base. Keep `| string` extensibility but state that custom event types must not be required for Kontour Console v0 core behavior.

#### Task: Define local JSONL stream convention

- **Files:** Modify `docs/specs/projection-schema.md`.
- **Changes:** Add a local event stream convention covering recommended file path pattern, UTF-8 JSONL, one complete `KontourConsoleEvent` per line, append-only writes, stable event IDs, producer-local sequence numbers, ordering rules, correlation/causation rules, backfill/replay expectations, duplicate handling, and projection snapshot fallback.
- **Acceptance:** Doc inspection confirms AC3 and R4 are satisfied and no hosted event bus, ingestion service, auth model, or adapter implementation is introduced.
- **Supports:** R2, R4, AC3, AC5.
- **Context:** ADR 0001 and `CONTEXT.md` require local-first primitives and no hidden hosted dependency.

#### Task: Add example event sequences

- **Files:** Add `docs/examples/event-streams/surface-claim-freshness.jsonl`, `docs/examples/event-streams/flow-gate-route-back.jsonl`, and `docs/examples/event-streams/campfit-field-review.jsonl`; modify `docs/specs/projection-schema.md` to link them.
- **Changes:** Create three short JSONL files using the documented envelope. Each line should be a complete event. Include correlation ids, causation ids where a later event follows an earlier one, subject refs, relevant links, and product-specific details under `payload.data` or `extensions`.
- **Acceptance:** Manual inspection confirms the three named scenarios exist, are referenced from the spec, and demonstrate R2/R5 plus AC4.
- **Supports:** R2, R5, AC4.
- **Context:** Required scenarios are Surface claim freshness, Flow gate route-back, and Campfit field review. Campfit should remain a vertical example, not a core product enum requirement.

### Wave 2 (after Wave 1)

#### Task: Specify projection rebuild semantics

- **Files:** Modify `docs/specs/projection-schema.md`.
- **Changes:** Add a concise `Rebuilding Projections From Events` section describing deterministic replay, idempotency by event id, ordering by producer sequence when available and by occurred/observed time otherwise, use of correlation/causation for timelines, link accumulation, snapshot fallback, and how `KontourConsoleProjection.derivedFrom` records stream ids, last event id, last sequence, and event count.
- **Acceptance:** Doc inspection confirms AC5 is satisfied and the text remains high-level spec guidance, not reducer implementation.
- **Supports:** AC5, R2, R4.
- **Context:** Existing projection envelope already includes `derivedFrom`; this task makes its rebuild contract explicit.

#### Task: Final doc consistency pass

- **Files:** Review `docs/specs/projection-schema.md`, `docs/product-boundaries.md`, `CONTEXT.md`, and `README.md`; modify only if needed for links or small terminology alignment.
- **Changes:** Ensure terms match the product context, non-goals remain clear, open questions are updated so answered v0 decisions are not still listed as unresolved, and any new examples are discoverable.
- **Acceptance:** Manual review confirms no contradictory product-authority language, no stale TODO/open question for local JSONL v0 convention, and no scope creep into hosted services or UI.
- **Supports:** R1, R2, R3, R4, R5, AC1, AC2, AC3, AC4, AC5.
- **Context:** `docs/product-boundaries.md` already links to the spec. Avoid broad edits unless the new example directory needs an index link.

## Verification Plan

- Run `git diff -- docs/specs/projection-schema.md docs/examples/event-streams README.md CONTEXT.md docs/product-boundaries.md` and inspect that only docs/examples changed.
- Inspect `docs/specs/projection-schema.md` for required field table, event type intended-use table, local JSONL convention, example links, and projection rebuild semantics.
- Inspect each JSONL example for one event object per line and required event fields.
- Optional lightweight check: run `python3 -m json.tool` or a short local JSON parser over each line of `docs/examples/event-streams/*.jsonl` if execution policy allows; record failures as verification gaps rather than adding schema tooling in this issue.
