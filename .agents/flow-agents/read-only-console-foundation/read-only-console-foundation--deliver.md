# Read-Only Console Foundation

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: planning
type: deliver
iteration: 0

## Workflow Rules

- Reviewers and verifiers are report-only.
- Any code change requires clean review and verification before delivery.
- Scope stays read-only: no hosted service, no action execution, no mutation of product-owned state.
- Temporary workflow artifacts live in `.agents/flow-agents/read-only-console-foundation/`.

## Goal

Create the first read-only Kontour Console foundation that can load local event stream and projection snapshot fixtures, validate/inspect them, and expose current claim/process/gate/review state for a future console without executing actions.

## Acceptance Criteria

- AC1: A local command can inspect checked-in event stream and projection fixtures and report counts/current-state summaries.
- AC2: Projection loading preserves the V0 contract boundaries: provenance, object arrays, product authority refs, and links.
- AC3: The implementation can query current Surface claim status without selecting a Flow run.
- AC4: The implementation can query Campfit field-review state across claim, review item, evidence, decision/action, and links.
- AC5: Action descriptors remain read-only; no endpoint, command, URL, or product mutation is executed.

## Plan

Plan artifact: `.agents/flow-agents/read-only-console-foundation/read-only-console-foundation--plan-work-plan.md`

## Definition Of Done

- **User outcome:** From the repo root, a developer can run one local command to inspect checked-in Kontour Console event/projection fixtures, see event and object counts plus current-state summaries, and query Surface claim and Campfit review state without any hosted service or action execution.
- **Scope:** Add a conservative implementation skeleton for fixture loading, validation, summarization, and read-only queries. Include local tests/verification commands. Exclude hosted services, UI, product adapters, reducers that invent product semantics, product-owned state mutation, and action execution.
- **Acceptance criteria:**
  - [ ] AC1 `fixture-inspection-command`: A local command can inspect checked-in event stream and projection fixtures and report counts/current-state summaries.
  - [ ] AC2 `projection-boundaries-preserved`: Projection loading preserves the V0 contract boundaries: provenance, object arrays, product authority refs, and links.
  - [ ] AC3 `surface-claim-query-no-run-picker`: The implementation can query current Surface claim status without selecting a Flow run.
  - [ ] AC4 `campfit-field-review-query`: The implementation can query Campfit field-review state across claim, review item, evidence, decision/action, and links.
  - [ ] AC5 `actions-read-only`: Action descriptors remain read-only; no endpoint, command, URL, or product mutation is executed.

## Execution Progress

Ready for execution from the plan artifact.

## Verification Report

Pending verification.

## Goal Fit Gate

Pending verification.

## Final Acceptance

Pending delivery.
