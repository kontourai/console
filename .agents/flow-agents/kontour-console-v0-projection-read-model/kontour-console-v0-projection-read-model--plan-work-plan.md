---
role: plan
parent: kontour-console-v0-projection-read-model--pull-work.md
created: 2026-06-01T13:33:01Z
---

# Define Kontour Console V0 Projection Read Model

## Plan

Tighten the v0 projection/read-model contract in `docs/specs/projection-schema.md` on top of the verified event stream and identity-link contracts. The work should document the projection envelope as a current read model, make event-to-snapshot provenance and fallback semantics explicit, and add example evidence that the schema can represent both Campfit review mapping and Surface current claim status without a run-picker dependency. Keep implementation scope to durable docs plus optional checked-in examples/fixtures; do not add a reducer, app, hosted cache, ingestion service, adapters, or UI.

## Definition Of Done

- **User outcome:** A console implementer can read the docs and understand the v0 `KontourConsoleProjection` envelope, object arrays, event-derived provenance, direct snapshot fallback, Campfit mapping, and Surface current-claim-status representation.
- **Scope:** Update `docs/specs/projection-schema.md` and, if useful for discoverability, optional examples under `docs/examples/`. Do not change production code or add runtime infrastructure.
- **Acceptance criteria:**
  - [ ] AC1 `projection-envelope-object-types-documented`: Projection envelope and object types are documented. Evidence: doc inspection cites the envelope and all object sections.
  - [ ] AC2 `event-stream-to-snapshot-explicit`: The relationship between event stream and projection snapshot is explicit. Evidence: doc inspection cites `derivedFrom`, rebuild semantics, direct snapshot fallback, and event replay boundaries.
  - [ ] AC3 `campfit-mapping-representable`: The projection schema can represent the Campfit mapping example. Evidence: inline JSON or fixture inspection shows Campfit provider field, Surface claim, Flow review item, evidence, decision/action, and links represented by projection objects.
  - [ ] AC4 `surface-current-claim-status-independent`: The projection schema can represent Surface current claim status independent of run picker state. Evidence: doc or fixture inspection shows a claim current status/freshness object usable without a selected Flow run while retaining optional process/action links.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable from `docs/specs/projection-schema.md`.
  - [ ] Local projection snapshots and event-derived projections are clearly separated from hosted cache/storage concerns.
  - [ ] Product authority boundaries are preserved for Surface trust state, Flow gates/actions, and vertical domain truth.
  - [ ] Unknown, NOT_VERIFIED, and TODO gaps are resolved or explicitly accepted.
- **Stop-short risks:** The docs could list types without explaining how `derivedFrom` proves snapshot provenance; the Campfit section could remain prose-only and fail to demonstrate field-to-claim-to-review links in projection objects; Surface status could still read as run-scoped if the example only appears under a process/run; direct snapshot fallback could be allowed without marking event history as unavailable or partial.
- **Durable docs target:** `docs/specs/projection-schema.md`; optional supporting fixtures under `docs/examples/projections/`.
- **Sandbox mode:** `local-edit`.

### Requirements Traceability

| Requirement | Plan coverage |
| --- | --- |
| R1: Projection must include `derivedFrom` stream metadata. | Wave 1 task `Projection envelope and provenance`. |
| R2: Projection must represent claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links. | Wave 1 task `Projection object catalogue`; Wave 2 task `Fixture and example coverage`. |
| R3: Projection objects must retain product authority references. | Wave 1 task `Authority and link boundaries`; Wave 2 fixture checks. |
| R4: Projection schema must permit direct snapshot emission when event history is unavailable. | Wave 1 task `Snapshot fallback semantics`. |
| AC1 | Wave 1 tasks, verified by doc inspection. |
| AC2 | Wave 1 provenance/fallback tasks, verified by doc inspection. |
| AC3 | Wave 2 Campfit projection example/fixture, verified by parse/inspection. |
| AC4 | Wave 2 Surface current claim status example/fixture, verified by parse/inspection. |

### Wave 1 (parallel)

#### Task: Projection Envelope And Provenance
- **Files:** Modify `docs/specs/projection-schema.md`.
- **Changes:** Tighten the `KontourConsoleProjection` section so `derivedFrom` records stream identity, last accepted event, sequence when comparable, event count, and direct snapshot provenance. Clarify that projections are current read models and events remain the preferred durable contract when available.
- **Acceptance:** AC1 and AC2 doc inspection can cite the envelope, `derivedFrom` metadata, rebuild rules, snapshot seeding, and direct snapshot fallback language.
- **Supports:** R1, R4, AC1, AC2.
- **Context:** Build on Issue #1 evidence: local JSONL and deterministic replay are verified; no reducer implementation is required.

#### Task: Projection Object Catalogue
- **Files:** Modify `docs/specs/projection-schema.md`.
- **Changes:** Ensure summary, claims, processes, gates, review items, evidence, decisions, actions, exceptions, links, and extensions have documented shapes, authority notes, and intended use. Add missing fields only if they are necessary for AC3/AC4 and fit existing v0 vocabulary.
- **Acceptance:** AC1 doc inspection can cite every object type and show each remains product-owned rather than Kontour-owned.
- **Supports:** R2, R3, AC1.
- **Context:** Preserve existing type names and status vocabularies unless the examples expose a concrete gap.

#### Task: Authority And Snapshot Boundary Language
- **Files:** Modify `docs/specs/projection-schema.md`; modify `docs/product-boundaries.md` only if a short clarifying link is needed.
- **Changes:** State that projection objects retain `CrossProductRef` references and action authority descriptors, and that direct snapshots are allowed only as read-model input or fallback, not as a new source of truth.
- **Acceptance:** Verification can cite product authority boundaries for Surface claims, Flow gates/actions, and Campfit/domain records.
- **Supports:** R3, R4, AC2.
- **Context:** Issue #3 identity-link evidence verifies `CrossProductRef`, `CrossProductLink`, relation vocabulary, and required links.

### Wave 2 (parallel after Wave 1)

#### Task: Campfit Projection Example
- **Files:** Modify `docs/specs/projection-schema.md`; optionally add `docs/examples/projections/campfit-field-review.json`.
- **Changes:** Add a concrete projection example that represents a Campfit provider field review through claim, process, gate or review item as appropriate, evidence, decision/action, and cross-product links.
- **Acceptance:** AC3 verification can parse any JSON fixture or inspect inline JSON and confirm representation of Campfit provider field, Surface claim, Flow review item, evidence, decision/action, and links.
- **Supports:** R2, R3, AC3.
- **Context:** Reuse the existing Campfit field review event-stream example and identity-link example; do not add a Campfit adapter or UI.

#### Task: Surface Current Claim Status Example
- **Files:** Modify `docs/specs/projection-schema.md`; optionally add `docs/examples/projections/surface-current-claim-status.json`.
- **Changes:** Add a projection example showing `ClaimStatusProjection` with status and freshness that can render directly from the projection without selecting a Flow run. Include optional links to processes/actions/evidence without making them required for the current claim status.
- **Acceptance:** AC4 verification can cite a claim status/freshness object that stands independently of run picker state and still preserves links to producer runs or refresh actions when available.
- **Supports:** R1, R2, R3, AC4.
- **Context:** Surface owns trust derivation and freshness semantics; Kontour Console displays current operating state.

### Wave 3 (serial)

#### Task: Verification And Scope Check
- **Files:** No production files; update workflow evidence later under `.agents/flow-agents/kontour-console-v0-projection-read-model/`.
- **Changes:** Run doc/fixture checks: parse JSON fixtures or inline JSON blocks, inspect docs against AC1-AC4 and R1-R4, and confirm the diff is docs/examples only.
- **Acceptance:** Evidence records PASS/FAIL/NOT_VERIFIED for each AC, commands/checks run, and any accepted gaps.
- **Supports:** AC1, AC2, AC3, AC4.
- **Context:** Expected checks include JSON parse for any examples, grep/doc citations for object sections, and `git diff --name-only` scope review.
