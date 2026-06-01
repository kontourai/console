# Define Kontour Console V0 Projection Read Model

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: planned
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

1. Projection envelope/provenance, object catalogue, authority and snapshot boundary language.
2. Campfit projection example and Surface current claim status example.
3. Verification and scope check.
