# Surface claim status freshness emitter

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: selected
type: pull-work

## board_snapshot

- Provider: GitHub Issues in `kontourai/kontour-console`.
- Selected item: `#7 Add Surface claim status freshness emitter example`.
- URL: `https://github.com/kontourai/kontour-console/issues/7`.
- State: `OPEN`.
- Milestone: `Kontour Console Producer Contract`.
- Dependencies: `#5` emitter/sink skeleton and `#6` local `.kontour` discovery are closed.

## wip_assessment

- Local workspace was clean before selection.
- No open implementation work is active in this checkout.
- Start-new-work decision: `proceed`.

## selection

Selected issue `#7` because the generic emitter/sink and local discovery loop are complete, but products still need a concrete copyable producer pattern. Surface claim status/freshness is the smallest high-value first adapter shape.

## grouping_check

- Grouping decision: `single-item`.
- Split/keep decision: keep as one issue because projection mapping, event mapping, local emission, discovery verification, and docs form one usable producer pattern.

## anchor

Objective: add a dependency-free Surface claim status/freshness example/helper that maps a small Surface claim state into Console projection/event records, emits through `KontourEmitter`/`LocalFileSink`, and proves `inspectLocalKontour()` plus `getSurfaceClaimStatus()` can read the result.

Authoritative sources:

- GitHub issue `#7`.
- `.agents/flow-agents/surface-claim-status-freshness-emitter/issue-body.md`.
- `docs/specs/projection-schema.md`.
- `docs/specs/emitter-sink-plane-contract.md`.
- Existing `getSurfaceClaimStatus`, `KontourEmitter`, `LocalFileSink`, and `inspectLocalKontour` APIs.

Non-goals:

- Real Surface repo integration.
- Hosted API ingestion.
- HTTP/API sink.
- UI/dashboard work.
- Product adapters for Flow, Survey, Veritas, Flow Agents, or Campfit.
- Event-to-projection reducer/rebuild engine.
- Action execution or Flow run start integration.

## work_scope

Allowed files/areas:

- `src/console-foundation/` for a small Surface helper module/export.
- `test/` for focused tests.
- `README.md` and/or docs under `docs/specs/`.
- `.agents/flow-agents/surface-claim-status-freshness-emitter/`.

Risky areas:

- confusing example/helper with real Surface integration
- treating action descriptors as executable
- introducing product authority into Kontour Console
- drifting from Console producer terminology

## worktree_decision

- sandbox_mode: `local-edit`.
- Worktree used: no.
- Rationale: repo is clean and the slice is narrow.

## pickup_gate

- Status: pass.
- Reason: issue is shaped, dependencies are closed, and acceptance criteria are concrete.

## handoff

Recommended `plan-work` prompt:

> Plan implementation for GitHub issue #7 in `/Users/brian/dev/github/kontourai/kontour-console`: add a dependency-free Surface claim status/freshness emitter example/helper. It should map a small Surface claim state into a Console projection with claim status, freshness, validity windows, evidence refs, action refs, and inert action descriptors; map a freshness transition into a valid `claim.freshness.changed` event; emit through `KontourEmitter`/`LocalFileSink`; verify `inspectLocalKontour()` and `getSurfaceClaimStatus()` read the output; and document it as an example producer pattern, not real Surface repo integration. No hosted API, UI, other product adapters, action execution, or reducer engine.
