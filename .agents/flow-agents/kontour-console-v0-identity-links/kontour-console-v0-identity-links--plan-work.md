# Define Kontour Console V0 Identity Link Minimums

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: planned
type: plan-work

## Plan

Plan artifact:

`.agents/flow-agents/kontour-console-v0-identity-links/kontour-console-v0-identity-links--plan-work-plan.md`

Summary:

Define the v0 identity-link minimums as a docs/spec slice centered on `docs/specs/projection-schema.md`. Tighten the existing `CrossProductRef`, `CrossProductLink`, `subject`, `payload.refs`, and projection `links` into an explicit minimum contract: required ref/link fields, relation vocabulary semantics, required links each product should emit for v0 usefulness, and examples that prove claim-to-run, review-to-claim, gate-to-evidence, and Campfit provider-field-to-claim-to-review mappings.

Execution waves:

- Wave 1: specify ref/link field minimums and relation vocabulary direction.
- Wave 2: define required v0 link minimums and add examples/fixtures.
- Wave 3: verify scope, compatibility, and traceability.

## Definition Of Done

- User outcome: A product builder can read the Kontour Console v0 spec and know the minimum identity refs and links needed to connect Surface Claims, Flow Runs/Gates/Review Items, evidence, actions, and Campfit provider fields.
- Scope: Update `docs/specs/projection-schema.md` and optional checked-in examples/fixtures under `docs/examples/`. Only touch `CONTEXT.md`, `docs/product-boundaries.md`, or `README.md` for small index/glossary clarifications.
- Non-goals: graph databases, global identity services, inferred linkers, projection reducers, hosted ingestion, adapters, and UI.
- Acceptance criteria: AC1 through AC3 from issue #3, with R1-R4 mirrored in `acceptance.json`.
- Stop-short risks: missing link direction, examples that omit the Campfit provider field hop, vague required links, or relation names that blur product authority boundaries.
- Durable docs target: `docs/specs/projection-schema.md`; optional examples under `docs/examples/identity-links/` or JSONL additions under `docs/examples/event-streams/`.
- Sandbox mode: `local-edit`.
