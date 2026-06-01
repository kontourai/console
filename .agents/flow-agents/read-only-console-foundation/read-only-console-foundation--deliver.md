# Read-Only Console Foundation

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: delivered
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

Execution delegated to `tool-worker`.

Implementation completed in this worktree.

Modified files:
- `package.json`
- `bin/kontour-console-inspect.js`
- `src/console-foundation/index.js`
- `test/console-foundation.test.js`
- `README.md`
- `.agents/flow-agents/read-only-console-foundation/read-only-console-foundation--deliver.md`

Implemented:
- Node-only local fixture inspector over `docs/examples/event-streams/*.jsonl` and `docs/examples/projections/*.json`.
- Read-only foundation APIs for event stream loading, projection snapshot loading, validation, summaries, Surface claim status queries, Campfit field-review queries, and inert action descriptor extraction.
- V0 boundary validation for event envelopes, projection metadata, object arrays, nested projection object refs, links, and action authorities.
- Tests for fixture counts, projection boundary preservation, Surface claim query behavior, Campfit review composition, read-only action descriptors, and malformed nested projection refs.

## Verification Report

Local execution checks completed:
- `node --test` PASS: 6 tests passed.
- `npm run inspect:fixtures` PASS: reported 3 event streams, 2 projections, 13 total events, projection object counts, current-state summaries, and 0 validation errors.
- `rg "child_process|\bexec\b|\bspawn\b|fetch\(|open\(|require\(\"node:http|require\(\"node:https|require\('node:http|require\('node:https" src test bin package.json` PASS: no matches.
- `git status --short` completed for final worktree state review.

## Review Report

Review delegated to `tool-code-reviewer` and `tool-security-reviewer`.

- `tool-code-reviewer` (`019e83ba-e50d-7372-b3c3-ebfdbe325916`): PASS, no findings.
- `tool-security-reviewer` (`019e83bb-0843-72a0-86fc-e31484eb4c38`): PASS, no findings.
- Critique artifact: `.agents/flow-agents/read-only-console-foundation/critique.json`.

## Goal Fit Gate

- [x] User outcome: from repo root, `npm run inspect:fixtures` inspects checked-in streams/projections and reports current-state summaries.
- [x] Surface query: `node bin/kontour-console-inspect.js surface-claim claim-provider-directory-current` returns verified/fresh status without Flow run selection.
- [x] Campfit query: `node bin/kontour-console-inspect.js campfit-review review-provider-118-npi` returns review, claim, evidence, decision, action, and links.
- [x] Read-only boundary: no hosted services, adapters, URL loading, command execution, or product-owned state mutation were added.
- [x] Evidence: `tool-code-reviewer`, `tool-security-reviewer`, and `tool-verifier` all passed.

## Final Acceptance

- [x] Review passed: `tool-code-reviewer` (`019e83ba-e50d-7372-b3c3-ebfdbe325916`) and `tool-security-reviewer` (`019e83bb-0843-72a0-86fc-e31484eb4c38`).
- [x] Verification passed: `tool-verifier` (`019e83bc-b9e5-7dc3-ba11-d0e895309216`) passed AC1-AC5 and Goal Fit.
- [x] Durable usage note: README documents the local fixture inspector and read-only behavior.
