# Kontour Console V0 Identity Links - Pull Work

Date: 2026-06-01
Repository: `kontourai/kontour-console`
Selected issue: https://github.com/kontourai/kontour-console/issues/3
Milestone: https://github.com/kontourai/kontour-console/milestone/1

## board_snapshot

Provider:

- WorkItemProvider: GitHub Issues
- BoardProvider: GitHub milestone
- Provider settings helper: unavailable in this repo (`scripts/effective-backlog-settings.py` not present)
- Selection source: user requested next work after issue #1 completion

Filters:

- Repository: `kontourai/kontour-console`
- Milestone: `Kontour Console V0 Contract`
- State: all

Issues:

| Issue | Title | State | Readiness | Notes |
|---|---|---|---|---|
| #1 | Define Kontour Console V0 Event Stream Contract | closed | complete | Event envelope and local JSONL contract are verified |
| #2 | Define Kontour Console V0 Projection Read Model | open | blocked-by #3 | Projection should consume stable identity link minimums |
| #3 | Define Cross-Product Identity Link Minimums | open | ready | Dependency-unlocking slice after #1 |

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

Recent completed work:

- Issue #1 was reviewed, verified, pushed, commented, and closed.
- Verification evidence for #1 is recorded under `.agents/flow-agents/kontour-console-v0-event-stream-contract/`.

Related repo state:

- `../flow` has one local doc commit ahead of remote on branch `flow-definition-transition-guard-impl` and an unrelated untracked `.agents/` directory.
- `../surface` has one local doc commit ahead of remote on `main`.
- These do not block issue #3, which is scoped to `kontour-console` docs/specs.

## my_active_work

- `kontour-console`: issue #1 complete; no open PRs; no dirty worktree before this handoff.
- `flow`: local docs commit ahead of remote; not in scope.
- `surface`: local docs commit ahead of remote; not in scope.

## shepherding_candidates

- None blocking issue #3.
- Optional follow-up outside this issue: decide whether to push or PR the Flow and Surface doc commits.

## stale_worktrees

- None detected for `kontour-console`.

## open_prs_by_me

- None detected for `kontourai/kontour-console`.

## global_conflicts

- No open PR conflicts found in `kontour-console`.
- Issue #3 is docs/spec work and should primarily touch `docs/specs/projection-schema.md`, possibly `docs/product-boundaries.md`, `README.md`, and examples/fixtures if needed.

## dependency_impacts

- #3 unlocks #2 by defining the identity link minimums the projection read model needs to compose objects reliably.
- #3 builds on #1 by using the event envelope, `subject`, `payload.refs`, and `links` fields already established.
- #3 prepares the later Flow Console / Campfit proof slice by defining how provider fields, Surface Claims, Flow Review Items, evidence, and actions join.

## start_new_work_decision

Decision: proceed

Reason:

- #1 is closed and verified.
- #3 is the next dependency-unlocking slice for the milestone.
- #2 should wait until the minimum identity link contract exists.
- No active PR or local WIP in `kontour-console` blocks the work.

## selection

Selected:

- #3 Define Cross-Product Identity Link Minimums

Rationale:

- It is the next thinnest meaningful slice.
- It makes future projections meaningful by defining how claims, workflows, review items, evidence, actions, and domain records relate.
- It avoids prematurely shaping projection arrays before link semantics are stable.

Priority:

- High for `Kontour Console V0 Contract`.

Dependencies:

- Builds on #1 event envelope.
- Unblocks #2 projection read model.

## grouping_check

Decision: single-item

Reason:

- #2 is related but should not be bundled; projection shape depends on link minimums.
- #3 has independent acceptance criteria and can reach review/verification as docs/spec work.

## anchor

Objective:

Define the v0 cross-product identity link minimums for Kontour Console.

Authoritative artifacts:

- GitHub issue: https://github.com/kontourai/kontour-console/issues/3
- Source backlog: `.agents/flow-agents/kontour-console-foundation/kontour-console-foundation--idea-to-backlog.md`
- Completed event contract: `docs/specs/projection-schema.md`
- Issue #1 evidence: `.agents/flow-agents/kontour-console-v0-event-stream-contract/evidence.json`
- Product context: `CONTEXT.md`
- Product boundary doc: `docs/product-boundaries.md`
- ADR: `docs/adr/0001-kontour-console-as-suite-management-plane.md`

Non-goals:

- Global identity service
- Graph database
- Automatically inferred links
- Projection reducer implementation
- Hosted suite ingestion
- UI implementation

Done criteria:

- AC1: Cross-product ref and link shapes are documented.
- AC2: Required v0 link examples are documented.
- AC3: Campfit provider field to Surface claim to Flow Review Item mapping can be represented.

## work_scope

Allowed areas:

- `docs/specs/projection-schema.md`
- `docs/product-boundaries.md` if identity-link boundary language needs tightening
- `CONTEXT.md` if glossary terms need small updates
- `README.md` if index links need updating
- optional example docs/fixtures under `docs/examples/` if planning decides mapping examples should be external to the spec

Risky areas:

- Do not add a graph database, global identity service, runtime linker, adapter, or UI.
- Do not redefine Surface, Flow, Survey, Veritas, Flow Agents, or vertical product semantics.
- Do not infer links automatically in the contract; document emitted/declared links.

Coordination notes:

- Keep Surface Claims as the trust backbone.
- Keep Flow Runs/Gates/Review Items as process objects.
- Keep vertical product domain records under product-owned refs/extensions.
- Make links sufficient for the later projection read model issue.

## worktree_decision

Sandbox mode recommendation: `local-edit`

Worktree used: no

Rationale:

- The selected item is narrow docs/spec work in a clean repo.
- No concurrent `kontour-console` worktree exists.

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

Plan issue #3 in `/Users/brian/dev/github/kontourai/kontour-console`: define the Kontour Console V0 cross-product identity link minimums. Use GitHub issue https://github.com/kontourai/kontour-console/issues/3 and source artifact `.agents/flow-agents/kontour-console-v0-identity-links/kontour-console-v0-identity-links--pull-work.md`. Preserve R1-R4 and AC1-AC3. Keep scope to docs/specs and optional examples/fixtures. Do not implement a graph database, global identity service, inferred linker, projection reducer, hosted ingestion, adapters, or UI.

Acceptance criteria for planning:

- Plan maps every R* and AC* from issue #3.
- Plan identifies exact docs/spec files to edit.
- Plan includes verification by doc inspection and fixture/example mapping.
- Plan records non-goals and product authority boundaries.

## pickup_gate

Status: PASS

Reason:

- Issue #3 is ready, bounded, unblocked, and selected as a single-item slice.
- WIP check found no blocking active work in `kontour-console`.
- The next action is planning, not implementation.

## pickup_probe

Not applicable. This is a direct `pull-work` invocation, not a Builder Kit build-flow pickup probe.

## builder_kit_handoff

- probe_status: missing
- probe_artifact_ref: not applicable for direct pull-work
- selected_item_ids:
  - `github:kontourai/kontour-console#3`
- grouping_decision: single-item
- accepted_gaps:
  - No repo-specific backlog provider settings helper exists; GitHub Issues plus milestone were used from live provider state and explicit user context.
- route_reason: ready_for_plan_work
- next_action: run `plan-work` for issue #3 if the user wants execution planning to begin

