# Kontour Console V0 Event Stream Contract - Pull Work

Date: 2026-06-01
Repository: `kontourai/kontour-console`
Selected issue: https://github.com/kontourai/kontour-console/issues/1
Milestone: https://github.com/kontourai/kontour-console/milestone/1

## board_snapshot

Provider:

- WorkItemProvider: GitHub Issues
- BoardProvider: GitHub milestone
- Provider settings helper: unavailable in this repo (`scripts/effective-backlog-settings.py` not present)
- Selection source: explicit user continuation from shaped backlog plus live GitHub issue state

Filters:

- Repository: `kontourai/kontour-console`
- Milestone: `Kontour Console V0 Contract`
- State: open

Issues:

| Issue | Title | State | Readiness | Notes |
|---|---|---|---|---|
| #1 | Define Kontour Console V0 Event Stream Contract | open | ready | First slice; no blockers |
| #2 | Define Kontour Console V0 Projection Read Model | open | blocked-by #1 | Projection depends on event vocabulary |
| #3 | Define Cross-Product Identity Link Minimums | open | related / partially blocked | Can proceed after event envelope shape stabilizes |

Milestone/provider state:

- Milestone exists and is open.
- No labels or assignees are currently set.
- No project fields inspected.

## wip_assessment

Local repo state:

- `kontour-console` branch: `main`
- Working tree: clean before this artifact was added
- Worktrees: only primary checkout
- Open PRs authored by current user in `kontourai/kontour-console`: none

Related repo state:

- Flow documentation changes were committed in `../flow` as `01b76c6 Document Flow console product boundary`.
- Surface documentation change was committed in `../surface` as `d38a6fd Clarify current claim status language`.
- Flow still has an unrelated untracked `.agents/` directory; it was not included in the doc commit.

## my_active_work

- `kontour-console`: initial product context and backlog setup completed and pushed.
- `flow`: doc commit exists on current branch `flow-definition-transition-guard-impl`; push state not assessed in this pull-work artifact.
- `surface`: doc commit exists on `main`; push state not assessed in this pull-work artifact.

## shepherding_candidates

- None blocking issue #1.
- Optional follow-up: decide whether to push or PR the Flow and Surface documentation commits if they should leave local-only state.

## stale_worktrees

- None detected for `kontour-console`.

## open_prs_by_me

- None detected for `kontourai/kontour-console`.

## global_conflicts

- No open PR conflict scan found in `kontour-console`.
- Issue #1 is documentation/spec-only and should touch only `docs/specs/projection-schema.md`, possibly `CONTEXT.md`, `README.md`, and fixture examples if added.

## dependency_impacts

- #1 unlocks #2 by stabilizing the event vocabulary that projections fold from.
- #1 informs #3 because identity links are carried on events and subjects.
- #1 is the correct first slice for milestone `Kontour Console V0 Contract`.

## start_new_work_decision

Decision: proceed

Reason:

- Selected issue is the first dependency in the milestone.
- No active PR or local WIP in `kontour-console` blocks the work.
- Scope is docs/specs and bounded by explicit acceptance criteria.

## selection

Selected:

- #1 Define Kontour Console V0 Event Stream Contract

Rationale:

- It is the thinnest meaningful slice and first dependency.
- It defines the durable event contract needed for realtime status, audit, replay, and future projections.
- It is ready for planning and does not require bundling with #2 or #3.

Priority:

- High for `Kontour Console V0 Contract`.

Dependencies:

- None.

## grouping_check

Decision: single-item

Reason:

- #2 and #3 are related but not required to complete #1.
- Bundling would expand scope from event contract into projection and identity-link minimums.
- #1 has independent acceptance criteria and unlocks later issues.

## anchor

Objective:

Define the v0 durable event stream contract for Kontour Console.

Authoritative artifacts:

- GitHub issue: https://github.com/kontourai/kontour-console/issues/1
- Source backlog: `.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`
- Current spec draft: `docs/specs/projection-schema.md`
- Product context: `CONTEXT.md`
- Product boundary doc: `docs/product-boundaries.md`
- ADR: `docs/adr/0001-kontour-console-as-suite-management-plane.md`

Non-goals:

- Hosted event bus
- Auth/multi-tenant ingestion
- UI implementation
- Product-specific adapters
- Full projection reducer

Done criteria:

- AC1: A spec lists required fields for `KontourConsoleEvent`.
- AC2: A spec lists v0 event types and their intended use.
- AC3: A local JSONL file convention is documented.
- AC4: At least three example event sequences exist: Surface claim freshness, Flow gate route-back, Campfit field review.
- AC5: The spec states how projections are rebuilt from events.

## work_scope

Allowed areas:

- `docs/specs/projection-schema.md`
- `docs/product-boundaries.md` if event-stream boundary language needs tightening
- `CONTEXT.md` if glossary terms need small updates
- `README.md` if index links need updating
- optional docs fixtures under `docs/fixtures/` or `examples/` if planning decides examples should live outside the spec

Risky areas:

- Do not add app scaffolding yet.
- Do not add a shared UI package.
- Do not redefine Surface or Flow semantics inside Kontour Console.
- Do not implement product-specific adapters.

Coordination notes:

- Keep Surface Claims as trust backbone.
- Keep event stream as durable integration contract.
- Keep projections as derived read models.
- Preserve product authority boundaries.

## worktree_decision

Sandbox mode recommendation: `local-edit`

Worktree used: no

Rationale:

- The selected item is a narrow docs/spec issue in a clean repo.
- No concurrent local worktree exists for `kontour-console`.
- Isolation can be added later for implementation-heavy issues.

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

Plan issue #1 in `/Users/brian/dev/github/kontourai/kontour-console`: define the Kontour Console V0 Event Stream Contract. Use GitHub issue https://github.com/kontourai/kontour-console/issues/1 and source artifact `.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`. Keep scope to docs/specs and examples. Preserve R1-R5 and AC1-AC5. Do not implement hosted services, UI, adapters, or a projection reducer.

Acceptance criteria for planning:

- Plan maps every R* and AC* from issue #1.
- Plan identifies exact docs/spec files to edit.
- Plan includes verification by doc inspection and example coverage.
- Plan records non-goals and product authority boundaries.

## pickup_gate

Status: PASS

Reason:

- Issue #1 is ready, bounded, unblocked, and selected as a single-item slice.
- WIP check found no blocking active work in `kontour-console`.
- The next action is planning, not implementation.

## pickup_probe

Not applicable. This is a direct `pull-work` invocation, not a Builder Kit build-flow pickup probe.

## builder_kit_handoff

- probe_status: missing
- probe_artifact_ref: not applicable for direct pull-work
- selected_item_ids:
  - `github:kontourai/kontour-console#1`
- grouping_decision: single-item
- accepted_gaps:
  - No repo-specific backlog provider settings helper exists; GitHub Issues plus milestone were used from live provider state and explicit user context.
- route_reason: ready_for_plan_work
- next_action: run `plan-work` for issue #1 if the user wants execution planning to begin

