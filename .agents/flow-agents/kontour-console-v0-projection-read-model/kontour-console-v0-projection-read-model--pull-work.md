# Kontour Console V0 Projection Read Model - Pull Work

Date: 2026-06-01
Repository: `kontourai/kontour-console`
Selected issue: https://github.com/kontourai/kontour-console/issues/2
Milestone: https://github.com/kontourai/kontour-console/milestone/1

## board_snapshot

Provider:

- WorkItemProvider: GitHub Issues
- BoardProvider: GitHub milestone
- Provider settings helper: unavailable in this repo (`scripts/effective-backlog-settings.py` not present)
- Selection source: user requested next work after issues #1 and #3 completed

Issues:

| Issue | Title | State | Readiness | Notes |
|---|---|---|---|---|
| #1 | Define Kontour Console V0 Event Stream Contract | closed | complete | Event stream vocabulary and JSONL convention verified |
| #3 | Define Cross-Product Identity Link Minimums | closed | complete | Ref/link minimums verified |
| #2 | Define Kontour Console V0 Projection Read Model | open | ready | Final milestone item; now unblocked |

## wip_assessment

- `kontour-console` branch: `main`
- Working tree: clean before this artifact was added
- Open PRs authored by current user: none
- Worktrees: only primary checkout
- Issue #1 and #3 review/verification artifacts are recorded under `.agents/flow-agents/`.

## my_active_work

- `kontour-console`: issues #1 and #3 complete; issue #2 selected.
- `flow`: local docs commit ahead of remote; not in scope.
- `surface`: local docs commit ahead of remote; not in scope.

## shepherding_candidates

- None blocking issue #2.

## stale_worktrees

- None detected for `kontour-console`.

## open_prs_by_me

- None detected for `kontourai/kontour-console`.

## global_conflicts

- No open PR conflicts found in `kontour-console`.

## dependency_impacts

- #2 depends on #1 event stream vocabulary and #3 identity link minimums; both are closed and verified.
- #2 completes the `Kontour Console V0 Contract` milestone if review and verification pass.
- #2 should produce the projection/read-model contract needed by later Flow Console and Campfit extension work.

## start_new_work_decision

Decision: proceed

Reason:

- #2 is ready, unblocked, and the only remaining milestone issue.
- The repo is clean and has no blocking PR/WIP.

## selection

Selected:

- #2 Define Kontour Console V0 Projection Read Model

Rationale:

- It is the final contract slice after event streams and identity links.
- It defines the read model needed for fast UI rendering and future Flow/Campfit proof work.

Priority:

- High for `Kontour Console V0 Contract`.

Dependencies:

- #1 closed and verified.
- #3 closed and verified.

## grouping_check

Decision: single-item

Reason:

- No remaining milestone item should be bundled with #2.
- The scope is independently testable through docs/spec and mapping verification.

## anchor

Objective:

Define the v0 projection/read-model contract derived from events and identity links.

Authoritative artifacts:

- GitHub issue: https://github.com/kontourai/kontour-console/issues/2
- Source backlog: `.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`
- Event contract: `docs/specs/projection-schema.md`
- Issue #1 evidence: `.agents/flow-agents/kontour-console-v0-event-stream-contract/evidence.json`
- Identity link contract: `docs/specs/projection-schema.md`
- Issue #3 evidence: `.agents/flow-agents/kontour-console-v0-identity-links/evidence.json`
- Product context: `CONTEXT.md`
- Product boundary doc: `docs/product-boundaries.md`
- ADR: `docs/adr/0001-kontour-console-as-suite-management-plane.md`

Non-goals:

- Full reducer implementation
- Visual IA
- Hosted cache/storage
- Hosted ingestion
- Product adapters
- UI implementation

Done criteria:

- AC1: Projection envelope and object types are documented.
- AC2: The relationship between event stream and projection snapshot is explicit.
- AC3: The projection schema can represent the Campfit mapping example.
- AC4: The projection schema can represent Surface current claim status independent of run picker state.

## work_scope

Allowed areas:

- `docs/specs/projection-schema.md`
- `docs/product-boundaries.md` if projection boundary language needs tightening
- `README.md` if a link/index update is useful
- optional examples under `docs/examples/` if mapping evidence is clearer as checked-in data

Risky areas:

- Do not implement projection reducer code.
- Do not add app/server/UI scaffolding.
- Do not create hosted cache/storage or ingestion.
- Do not redefine Surface status semantics or Flow process semantics.

## worktree_decision

Sandbox mode recommendation: `local-edit`

Worktree used: no

Rationale:

- Narrow docs/spec work in a clean repo.

## worktree_lifecycle

- Path: current checkout `/Users/brian/dev/github/kontourai/kontour-console`
- Branch: `main` unless planning chooses a feature branch
- Retain until: PR merged or branch abandoned if a branch is created later
- Cleanup owner: orchestrator/user
- Cleanup command: not applicable unless a worktree is created later
- Cleanup blocked by: none

## handoff

Recommended next skill:

- `plan-work`

Recommended prompt:

Plan issue #2 in `/Users/brian/dev/github/kontourai/kontour-console`: define the Kontour Console V0 projection/read model contract. Use GitHub issue https://github.com/kontourai/kontour-console/issues/2 and source artifact `.agents/flow-agents/kontour-console-v0-projection-read-model/kontour-console-v0-projection-read-model--pull-work.md`. Build on the verified event contract from issue #1 and identity-link contract from issue #3. Preserve R1-R4 and AC1-AC4. Keep scope to docs/specs and optional examples/fixtures. Do not implement a reducer, UI, hosted cache/storage, hosted ingestion, or adapters.

Acceptance criteria for planning:

- Plan maps every R* and AC* from issue #2.
- Plan identifies exact docs/spec files to edit.
- Plan includes verification by doc inspection and fixture/example mapping.
- Plan records non-goals and product authority boundaries.

## pickup_gate

Status: PASS

Reason:

- Issue #2 is ready, bounded, unblocked, and selected as a single-item slice.
- WIP check found no blocking active work in `kontour-console`.
- The next action is planning, not implementation.

## pickup_probe

Not applicable. This is a direct `pull-work` invocation, not a Builder Kit build-flow pickup probe.

## builder_kit_handoff

- probe_status: missing
- probe_artifact_ref: not applicable for direct pull-work
- selected_item_ids:
  - `github:kontourai/kontour-console#2`
- grouping_decision: single-item
- accepted_gaps:
  - No repo-specific backlog provider settings helper exists; GitHub Issues plus milestone were used from live provider state and explicit user context.
- route_reason: ready_for_plan_work
- next_action: run `plan-work` for issue #2

