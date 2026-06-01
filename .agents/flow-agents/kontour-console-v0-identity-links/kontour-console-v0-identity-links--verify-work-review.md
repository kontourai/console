# Verification Report: Kontour Console V0 Identity Links

Verdict: PASS

## Checks Run

| Check | Result | Evidence |
| --- | --- | --- |
| Doc inspection for AC1-AC3 and R1-R4 | PASS | `docs/specs/projection-schema.md:529`, `docs/specs/projection-schema.md:567`, `docs/specs/projection-schema.md:579`, `docs/specs/projection-schema.md:592`, `docs/specs/projection-schema.md:607`, `docs/specs/projection-schema.md:624`, `docs/specs/projection-schema.md:668` |
| Inline JSON fenced examples parse | PASS | `python3 -c ...` found 4 `json` fences in `docs/specs/projection-schema.md`; all parsed successfully. |
| Checked-in JSONL examples parse | PASS | `python3 -c ...` parsed 3 files under `docs/examples/event-streams`: `campfit-field-review.jsonl` 5 records, `surface-claim-freshness.jsonl` 3 records, `flow-gate-route-back.jsonl` 5 records. |
| Scope remains docs/artifacts only | PASS | `git diff --name-only` showed only workflow artifacts currently uncommitted; `find ... -newer plan-work-plan.md` showed `docs/specs/projection-schema.md` and workflow artifacts. Spec explicitly excludes hosted bus/ingestion, adapters, UI, shared reducer, inferred links, graph storage, and global identity service at `docs/specs/projection-schema.md:278` and `docs/specs/projection-schema.md:622`. |
| Issue #1 event contract compatibility | PASS | Identity remains carried by `subject`, `payload.refs`, and `links` at `docs/specs/projection-schema.md:68`, `docs/specs/projection-schema.md:91`, `docs/specs/projection-schema.md:97`, `docs/specs/projection-schema.md:204`, and `docs/specs/projection-schema.md:721`. |

## Acceptance Mapping

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| AC1: Cross-product ref and link shapes are documented. | PASS | `CrossProductRef` and `CrossProductLink` type shapes are documented at `docs/specs/projection-schema.md:531`; field minimum tables are documented at `docs/specs/projection-schema.md:567` and `docs/specs/projection-schema.md:579`. |
| AC2: Required v0 link examples are documented. | PASS | Required scenarios are listed at `docs/specs/projection-schema.md:607`; examples cover claim-to-run at `docs/specs/projection-schema.md:626`, review-to-claim at `docs/specs/projection-schema.md:638`, gate-to-evidence at `docs/specs/projection-schema.md:649`, and domain-field-to-claim at `docs/specs/projection-schema.md:668`. |
| AC3: Campfit provider field to Surface claim to Flow Review Item mapping can be represented. | PASS | The Campfit example includes `campfit` provider field, `surface` claim, `flow` review item refs, and `derived_from`, `updates`, and `reviews` links at `docs/specs/projection-schema.md:668`. |
| R1: References include product, kind, id, optional label/url. | PASS | Type shape lists `product`, `kind`, `id`, optional `label`, optional `url` at `docs/specs/projection-schema.md:531`; required/optional table confirms the same at `docs/specs/projection-schema.md:571`. |
| R2: Links include from, to, relation, optional strength. | PASS | Type shape lists `from`, `to`, `relation`, optional `strength` at `docs/specs/projection-schema.md:540`; field table confirms required and optional status at `docs/specs/projection-schema.md:583`. |
| R3: Relation vocabulary supports supports, blocks, updates, reviews, produced_by, evidenced_by, controls, derived_from. | PASS | Relation union includes all required terms at `docs/specs/projection-schema.md:543`; relation vocabulary table documents direction and use for each term at `docs/specs/projection-schema.md:596`. |
| R4: Spec identifies which links are required for v0 console usefulness. | PASS | Required V0 Links section states minimum emitted links and scenarios at `docs/specs/projection-schema.md:607`. |

## Goal Fit

PASS. A product builder can read the spec and identify the minimum refs and directed links needed to connect Surface Claims, Flow Runs/Gates/Review Items, evidence, actions, and Campfit provider fields. The spec preserves product-owned semantics and keeps Kontour Console as the suite management plane rather than an authority or linker.

## Notes

- `context/contracts/artifact-contract.md`, `context/contracts/verification-contract.md`, and `schemas/` were not present in this checkout, so sidecars were updated using the existing local sidecar shape.
- No production source files were modified during verification.
