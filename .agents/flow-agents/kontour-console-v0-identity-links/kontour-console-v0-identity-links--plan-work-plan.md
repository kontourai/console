---
role: plan
parent: kontour-console-v0-identity-links--plan-work
created: 2026-06-01T13:01:18Z
---

# Define Cross-Product Identity Link Minimums

## Plan

Define the v0 identity-link minimums as a docs/spec slice centered on `docs/specs/projection-schema.md`. The existing schema already has first-pass `CrossProductRef`, `CrossProductLink`, `subject`, `payload.refs`, and projection `links`; implementation should tighten that draft into an explicit minimum contract: required ref/link fields, relation vocabulary semantics, required links each product should emit for v0 usefulness, and checked examples that prove claim-to-run, review-to-claim, gate-to-evidence, and Campfit domain-field-to-claim-to-review mapping. Keep Kontour Console as the suite management plane and avoid implementing link inference, graph storage, reducers, adapters, ingestion, or UI.

## Definition Of Done

- **User outcome:** A product builder can read the Kontour Console v0 spec and know the minimum identity refs and links needed to connect Surface Claims, Flow Runs/Gates/Review Items, evidence, actions, and Campfit provider fields.
- **Scope:** Update `docs/specs/projection-schema.md` and optional checked-in examples/fixtures under `docs/examples/`. Only touch `CONTEXT.md`, `docs/product-boundaries.md`, or `README.md` if a small index/glossary clarification is needed. Exclude graph databases, global identity services, inferred linkers, projection reducers, hosted ingestion, adapters, and UI.
- **Acceptance criteria:**
  - [ ] AC1 `cross-product-shapes-documented`: Cross-product ref and link shapes are documented. Evidence: doc inspection of `docs/specs/projection-schema.md` showing R1/R2 fields and relation shape.
  - [ ] AC2 `required-v0-link-examples-documented`: Required v0 link examples are documented. Evidence: doc inspection and optional fixture parse showing claim-to-run, review-to-claim, gate-to-evidence, and domain-field-to-claim examples.
  - [ ] AC3 `campfit-field-claim-review-representable`: Campfit provider field to Surface claim to Flow Review Item mapping can be represented. Evidence: concrete example in the spec or fixture mapping includes Campfit field ref, Surface claim ref, Flow review item ref, and connecting links.
  - [ ] R1 `ref-fields`: References include `product`, `kind`, `id`, and optional `label`/`url`. Evidence: `CrossProductRef` type/table states required vs optional fields.
  - [ ] R2 `link-fields`: Links include `from`, `to`, `relation`, and optional `strength`. Evidence: `CrossProductLink` type/table states required vs optional fields.
  - [ ] R3 `relation-vocabulary`: v0 relation vocabulary supports `supports`, `blocks`, `updates`, `reviews`, `produced_by`, `evidenced_by`, `controls`, and `derived_from`. Evidence: relation vocabulary section lists each relation with intended direction and use.
  - [ ] R4 `required-v0-links`: The spec identifies which links are required for v0 console usefulness. Evidence: required minimum links section lists emitting expectations by product/object scenario.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable through the identity-link examples.
  - [ ] Product-owned refs remain separate from suite-level correlation; Kontour Console does not become authority for Surface, Flow, Survey, Veritas, Flow Agents, or Campfit semantics.
  - [ ] Unknown, NOT_VERIFIED, and TODO gaps are resolved or explicitly accepted before closing the issue.
  - [ ] Existing issue #1 event contract remains compatible with `subject`, `payload.refs`, and `links`.
- **Stop-short risks:** The work could technically list types but fail to state link direction; examples could omit the Campfit provider field hop; required links could be too vague for issue #2 projection work; relation names could be documented without preserving product authority boundaries.
- **Durable docs target:** `docs/specs/projection-schema.md` is the durable contract. Optional durable examples may live under `docs/examples/identity-links/` or as JSONL additions under `docs/examples/event-streams/`.
- **Sandbox mode:** `local-edit`

### Wave 1 (parallel)

#### Task: Specify ref and link field minimums

- **Files:** `docs/specs/projection-schema.md`
- **Changes:** Expand the Cross-Product Links section with required/optional field tables for `CrossProductRef` and `CrossProductLink`. State that `product`, `kind`, and `id` are the stable identity tuple; `label` and `url` are display/navigation aids only; product-local ids remain owned by the producing product. State that `from`, `to`, and `relation` are required; `strength`, `createdAt`, and `extensions` are optional.
- **Acceptance:** Doc review confirms R1 and R2 are explicit and compatible with the existing TypeScript shapes.
- **Supports:** AC1, R1, R2
- **Context:** Preserve existing event envelope fields `subject: CrossProductRef`, `payload.refs`, and `links: CrossProductLink[]`. Do not introduce a global identity service or normalized database schema.

#### Task: Define relation vocabulary semantics and direction

- **Files:** `docs/specs/projection-schema.md`
- **Changes:** Add a relation vocabulary table for `supports`, `blocks`, `updates`, `reviews`, `produced_by`, `evidenced_by`, `controls`, and `derived_from`. For each relation, document intended direction, minimum use case, and one example pair. Clarify that `strength: "direct"` is preferred for emitted product-owned links and that `inferred`/`weak` are allowed descriptors but v0 required links should not depend on automatic inference.
- **Acceptance:** Doc review confirms all R3 relations are present with direction and examples.
- **Supports:** AC1, AC2, R3
- **Context:** Keep relation semantics product-neutral and do not redefine Surface trust derivation or Flow gate/control semantics.

### Wave 2 (parallel after Wave 1)

#### Task: Define required v0 link minimums

- **Files:** `docs/specs/projection-schema.md`
- **Changes:** Add a "Required V0 Links" section that identifies the minimum emitted links for console usefulness: claim changed by process/run, review item reviewing claim or domain field, gate controlling/blocking claim/process progress, evidence supporting/evidencing claim or gate, action/decision produced by a process or actor run, domain field derived from or updating a Surface claim, and Flow Review Item reviewing the claim/domain field it is about.
- **Acceptance:** Doc review confirms R4 is concrete enough for issue #2 projection work and names which links are required versus optional/enriching.
- **Supports:** AC2, AC3, R4
- **Context:** The pull-work handoff says #2 should wait for this minimum. Required links should make projections useful without requiring a reducer implementation in this issue.

#### Task: Add identity-link examples or fixtures

- **Files:** `docs/specs/projection-schema.md`; optional `docs/examples/identity-links/*.json` or updates to existing `docs/examples/event-streams/campfit-field-review.jsonl`
- **Changes:** Document required examples for claim-to-run, review-to-claim, gate-to-evidence, and domain-field-to-claim. Include a concrete Campfit chain: Campfit provider field ref -> Surface claim ref -> Flow review item ref, with relations such as `derived_from`/`updates` for field-to-claim and `reviews` for review-to-claim or review-to-field. If a JSON fixture is added, keep it small and parseable.
- **Acceptance:** Manual doc inspection proves AC2 and AC3. If fixture files are added, run a parse check over those files and record the command in execution notes.
- **Supports:** AC2, AC3, R1, R2, R3, R4
- **Context:** Existing example event streams include `campfit-field-review.jsonl`; reuse or extend them only if that keeps the example clearer than inline spec snippets.

### Wave 3 (dependent)

#### Task: Verify scope, compatibility, and traceability

- **Files:** `docs/specs/projection-schema.md`; any optional example files touched
- **Changes:** Review final docs for explicit traceability to R1-R4 and AC1-AC3. Confirm no production implementation, graph service, inference engine, reducer, adapter, hosted ingestion, or UI was added. Confirm issue #1 event contract remains intact: identity travels through `subject`, `payload.refs`, and `links`.
- **Acceptance:** Verification notes or evidence record include doc inspection results, optional JSON/JSONL parse command results, and a diff-scope check.
- **Supports:** AC1, AC2, AC3, R1, R2, R3, R4
- **Context:** Issue #1 evidence shows docs/examples-only verification is acceptable for this repo. This issue's expected verification is doc review and fixture mapping.
