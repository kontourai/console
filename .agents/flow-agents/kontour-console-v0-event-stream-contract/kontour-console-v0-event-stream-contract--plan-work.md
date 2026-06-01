# Define Kontour Console V0 Event Stream Contract

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: planned
type: plan-work

## Plan

Plan artifact:

`.agents/flow-agents/kontour-console-v0-event-stream-contract/kontour-console-v0-event-stream-contract--plan-work-plan.md`

Summary:

Tighten the existing first-pass event/projection spec into a v0 event-stream contract that products can emit locally without a hosted console. Keep the durable contract in `docs/specs/projection-schema.md`, add JSONL examples under `docs/examples/event-streams/`, and avoid implementing reducers, adapters, auth, hosted ingestion, UI, or product-owned semantics.

Execution waves:

- Wave 1: formalize event envelope fields, document v0 event type vocabulary, define local JSONL stream convention, and add three example event sequences.
- Wave 2: specify projection rebuild semantics and do a final docs consistency pass.

Traceability:

- R1 / AC1: required event envelope fields.
- R2: correlation, causation, identity links, and example usage.
- R3 / AC2: v0 event type vocabulary and intended use.
- R4 / AC3: local JSONL convention and replay without hosted infrastructure.
- R5 / AC4: product-specific detail stays under `payload.data` or `extensions`.
- AC5: projection rebuild semantics from events.

## Definition Of Done

- User outcome: A product builder can read the docs and emit a minimal Kontour Console v0 local JSONL event stream for Surface claim freshness, Flow gate route-back, or Campfit field review, with enough replay guidance to rebuild projections from those events.
- Scope: Update docs/specs and examples only. Include event envelope fields, event type vocabulary and intent, ordering/correlation/replay rules, local JSONL file convention, projection rebuild semantics, and three example event sequences.
- Non-goals: Hosted event bus, auth/multi-tenant ingestion, UI implementation, product-specific adapters, action execution endpoints, and projection reducer implementation.
- Acceptance criteria: AC1 through AC5 from issue #1, mirrored in `acceptance.json`.
- Stop-short risks: missing required/optional distinction, examples without correlation/causation/links, vague replay guidance, leaking Campfit fields into core envelope, or implying a hosted service.
- Durable docs target: `docs/specs/projection-schema.md` plus `docs/examples/event-streams/`.
- Sandbox mode: `local-edit`.
