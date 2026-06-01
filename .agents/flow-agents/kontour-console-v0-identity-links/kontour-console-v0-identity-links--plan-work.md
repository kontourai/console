# Define Kontour Console V0 Identity Link Minimums

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: executed
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

## Execution Progress

### Implementation (complete)

- [x] Specify ref and link field minimums. Supports: AC1, R1, R2.
- [x] Define relation vocabulary semantics and direction. Supports: AC1, AC2, R3.
- [x] Define required v0 link minimums. Supports: AC2, AC3, R4.
- [x] Add identity-link examples or fixtures. Supports: AC2, AC3, R1, R2, R3, R4.
- [x] Verify scope, compatibility, and traceability. Supports: AC1, AC2, AC3, R1, R2, R3, R4.

### Modified Files

- `docs/specs/projection-schema.md`
- `.agents/flow-agents/kontour-console-v0-identity-links/kontour-console-v0-identity-links--plan-work.md`

### Validation Notes

- Doc inspection with `rg -n "CrossProductRef Minimum|CrossProductLink Minimum|Relation Vocabulary|Required V0 Links|Identity Link Examples|supports|blocks|updates|reviews|produced_by|evidenced_by|controls|derived_from|provider-123.registration_status" docs/specs/projection-schema.md` confirmed the required sections, all v0 relations, and the Campfit provider field chain are present.
- No fixture files were added under `docs/examples/identity-links/`, so no fixture parse check was required. Examples are inline JSON snippets in `docs/specs/projection-schema.md`; `ruby -rjson -e 'text=File.read("docs/specs/projection-schema.md"); text.scan(/^```json\n(.*?)^```/m).each_with_index { |(s), i| JSON.parse(s); puts "json fence #{i + 1}: ok" }'` parsed all 4 JSON fences successfully.
- `git diff --check` passed.
- Scope check: changes are docs/artifact only. No graph database, global identity service, inferred linker, projection reducer, hosted ingestion, adapter, or UI was added.
- Compatibility check: existing event contract fields remain intact; identity still travels through `subject`, `payload.refs`, and `links`.
