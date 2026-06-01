# Define Kontour Console V0 Projection Read Model

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: verified
type: plan-work

## Plan

Plan artifact:

- `.agents/flow-agents/kontour-console-v0-projection-read-model/kontour-console-v0-projection-read-model--plan-work-plan.md`

Tighten the v0 projection/read-model contract in `docs/specs/projection-schema.md` on top of the verified event stream and identity-link contracts. The projection envelope should read as a current read model, make event-to-snapshot provenance and fallback semantics explicit, and include examples proving Campfit review mapping and Surface current claim status can be represented without a run-picker dependency.

## Definition Of Done

- A console implementer can understand the v0 `KontourConsoleProjection` envelope, object arrays, event-derived provenance, direct snapshot fallback, Campfit mapping, and Surface current-claim-status representation.
- Scope stays in `docs/specs/projection-schema.md` plus optional examples under `docs/examples/`.
- AC1-AC4 are traceable to doc inspection and JSON/example evidence.
- R1-R4 are covered by envelope provenance, object catalogue, authority boundaries, and direct snapshot fallback semantics.
- Stop-short risks: weak `derivedFrom` provenance, prose-only Campfit mapping, run-scoped Surface status, or direct snapshots without explicit unavailable/partial event history.

## Execution Waves

1. Projection envelope/provenance, object catalogue, authority and snapshot boundary language. Complete.
2. Campfit projection example and Surface current claim status example. Complete.
3. Verification and scope check. Complete.

## Execution Progress

### Wave 1-2 (complete)

- [x] Projection envelope, provenance, object catalogue, and snapshot fallback. Supports: R1, R2, R3, R4, AC1, AC2.
- [x] Campfit field review projection example. Supports: R2, R3, AC3.
- [x] Surface current claim status projection example. Supports: R1, R2, R3, AC4.

### Wave 3 (complete)

- [x] Scope and evidence check. Supports: AC1, AC2, AC3, AC4.

## Requirements Trace

- R1 Projection includes `derivedFrom` stream metadata. Acceptance: AC2, AC4.
- R2 Projection represents claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links. Acceptance: AC1, AC3, AC4.
- R3 Projection objects retain product authority references. Acceptance: AC1, AC3, AC4.
- R4 Projection schema permits direct snapshot emission when event history is unavailable. Acceptance: AC2.

## Modified Files

- `docs/specs/projection-schema.md`
- `docs/examples/projections/campfit-field-review.json`
- `docs/examples/projections/surface-current-claim-status.json`

## Evidence

- `rg -n "Projection Envelope|ProjectionProvenance|Projection Object Catalogue|Snapshot fallback|Campfit example|Surface example|type (ClaimStatusProjection|ProcessStatusProjection|GateStatusProjection|ReviewItemProjection|EvidenceProjection|DecisionProjection|ConsoleActionProjection|ExceptionProjection|CrossProductLink)" docs/specs/projection-schema.md`
- `python3 -m json.tool docs/examples/projections/campfit-field-review.json >/tmp/campfit-projection.json`
- `python3 -m json.tool docs/examples/projections/surface-current-claim-status.json >/tmp/surface-projection.json`
- `git status --short`

Review fixes applied after initial critique:

- Added untrusted handling guidance for `EvidenceProjection.sourceUrl`.
- Added required Campfit `provider_field -> Surface claim` `updates` and `review_item -> provider_field` `reviews` links.
- Corrected Surface refresh `controls` direction to Flow definition controlling the refresh action.
- Reset acceptance sidecar statuses to `pending_verification` until `tool-verifier` writes evidence.

## Review Report

- `tool-code-reviewer` (`019e8372-1f60-7c13-9736-75fe906c79a1`): PASS, no findings after fixes.
- `tool-security-reviewer` (`019e8372-3b56-75e3-b55f-1e69f1bf814c`): PASS, no findings after fixes.
- Review artifact: `.agents/flow-agents/kontour-console-v0-projection-read-model/critique.json`.

## Verification Report

- `tool-verifier` (`019e8373-a8f5-7b00-84d8-c3ff6c774055`): PASS for AC1, AC2, AC3, AC4, R1, R2, R3, R4, and Goal Fit.
- Verification artifact: `.agents/flow-agents/kontour-console-v0-projection-read-model/kontour-console-v0-projection-read-model--verify-work-review.md`.
- Evidence sidecar: `.agents/flow-agents/kontour-console-v0-projection-read-model/evidence.json`.
- Build/types/lint/provider checks were skipped because this issue is docs/examples-only and the repo has no build system in scope.
