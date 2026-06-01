---
role: plan
parent: read-only-console-foundation--deliver.md
created: 2026-06-01T14:52:57Z
---

# Read-Only Console Foundation Plan

## Plan

Create the smallest repo-native read-only foundation for Kontour Console: a local Node.js CLI and library that parse the checked-in JSONL event streams and projection snapshots, validate the v0 envelope/object boundaries enough for fixture inspection, and expose query functions for current Surface claim status plus Campfit field-review state. Keep this as a local fixture inspector, not an app, service, reducer, adapter, or action runner. Use only built-in Node modules and the existing fixtures under `docs/examples/event-streams/` and `docs/examples/projections/` unless a test fixture gap is discovered.

## Definition Of Done

- **User outcome:** From the repo root, a developer can run one local command to inspect checked-in Kontour Console event/projection fixtures, see event and object counts plus current-state summaries, and query Surface claim and Campfit review state without any hosted service or action execution.
- **Scope:** Add a conservative implementation skeleton for fixture loading, validation, summarization, and read-only queries. Include local tests/verification commands. Exclude hosted services, UI, product adapters, reducers that invent product semantics, product-owned state mutation, and action execution.
- **Acceptance criteria:**
  - [ ] AC1 `fixture-inspection-command`: A local command can inspect checked-in event stream and projection fixtures and report counts/current-state summaries. Evidence: command output from the new CLI over `docs/examples/event-streams/*.jsonl` and `docs/examples/projections/*.json`.
  - [ ] AC2 `projection-boundaries-preserved`: Projection loading preserves the V0 contract boundaries: provenance, object arrays, product authority refs, and links. Evidence: tests assert `derivedFrom`, known object arrays, action authority descriptors, source/producer refs, and `links[]` survive loading.
  - [ ] AC3 `surface-claim-query-no-run-picker`: The implementation can query current Surface claim status without selecting a Flow run. Evidence: test or CLI query against `surface-current-claim-status.json` returns claim status/freshness and proves `requiresSelectedFlowRun` is false or no process selection is required.
  - [ ] AC4 `campfit-field-review-query`: The implementation can query Campfit field-review state across claim, review item, evidence, decision/action, and links. Evidence: test or CLI query against `campfit-field-review.json` returns the expected claim, review item, evidence, decision, action, and linked refs.
  - [ ] AC5 `actions-read-only`: Action descriptors remain read-only; no endpoint, command, URL, or product mutation is executed. Evidence: tests cover action descriptor extraction as data only and grep/scope review finds no `exec`, `spawn`, network fetch, URL open, or mutation path in the console foundation.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable from `README.md` or a small docs note.
  - [ ] Local examples remain separate from product-owned state and hosted infrastructure.
  - [ ] Fixture loading reports validation gaps clearly instead of silently accepting malformed data.
  - [ ] Unknown, NOT_VERIFIED, and TODO gaps are resolved or explicitly accepted.
- **Stop-short risks:** The CLI could only parse JSON without exposing useful current-state queries; the loader could flatten projection objects and lose provenance or authority refs; action descriptors could be treated like executable commands or links; tests could pass on counts while missing the cross-object Campfit links that make the console useful.
- **Durable docs target:** Update `README.md` only if needed to make the local inspection command discoverable; otherwise implementation comments/tests are sufficient for this first skeleton.
- **Sandbox mode:** `local-edit`.

## Requirements Traceability

| Requirement | Planned coverage |
| --- | --- |
| AC1 | Wave 2 CLI inspection command and Wave 3 tests. |
| AC2 | Wave 1 loader/validator and Wave 3 boundary tests. |
| AC3 | Wave 2 Surface query and Wave 3 Surface test. |
| AC4 | Wave 2 Campfit query and Wave 3 Campfit test. |
| AC5 | Wave 1 read-only action model, Wave 2 descriptor rendering only, Wave 3 security/scope checks. |

### Wave 1 (parallel)

#### Task: Add Repo-Native Node Skeleton
- **Files:** Add `package.json` if absent; add `src/console-foundation/` or `lib/console-foundation/` with modules for fixture discovery, JSONL parsing, projection loading, validation, and query exports.
- **Changes:** Use built-in `node:fs`, `node:path`, and `node:test` only. Define a small module boundary such as `loadEventStreams`, `loadProjectionSnapshots`, `inspectFixtures`, `getSurfaceClaimStatus`, and `getCampfitFieldReviewState`. Keep APIs data-returning and side-effect free after file reads.
- **Acceptance:** Source compiles/runs under Node without installing dependencies; no hosted service, database, browser, network, adapter, or UI is introduced.
- **Supports:** AC1, AC2, AC3, AC4, AC5.
- **Context:** Repo currently has docs and fixtures only. Prefer a tiny JavaScript implementation over TypeScript/build tooling unless a worker finds existing repo-native tooling that should be reused.

#### Task: Implement Fixture Validation Boundaries
- **Files:** Add validation helpers under the same foundation module; add unit tests under `test/` or `src/console-foundation/*.test.js`.
- **Changes:** Validate enough of the v0 contract to catch malformed fixtures: event envelope required fields, projection `schema/version/generatedAt/derivedFrom/producer/scope`, object arrays when present, `CrossProductRef` shape for refs, `links[]` shape, and action `authority` descriptors. Preserve original objects rather than normalizing away product-owned fields.
- **Acceptance:** Tests cover both projection fixtures and all three JSONL streams; validation returns structured warnings/errors rather than executing or mutating anything.
- **Supports:** AC1, AC2, AC5.
- **Context:** `docs/specs/projection-schema.md` is the contract. This foundation should inspect v0 fixtures, not become a full schema compiler or product semantics engine.

#### Task: Model Actions As Descriptors Only
- **Files:** Same foundation module and tests.
- **Changes:** Represent actions as inert data with `id`, `kind`, `status`, `authority`, `subjectRefs`, and warnings for untrusted `endpoint`, `command`, or `externalUrl`. Do not include any helper that executes commands, fetches endpoints, opens URLs, or mutates product-owned state.
- **Acceptance:** Tests assert action descriptors are returned as data and read-only warnings are present when executable-looking fields exist.
- **Supports:** AC5.
- **Context:** Fixtures include `authority.command` and `authority.externalUrl`; the implementation must make their non-execution boundary obvious.

### Wave 2 (after Wave 1)

#### Task: Add Local Inspect CLI
- **Files:** Add a CLI entry such as `bin/kontour-console-inspect.js`; update `package.json` scripts/bin; optionally update `README.md` with the command.
- **Changes:** Provide a local command, for example `npm run inspect:fixtures`, that reads default fixture roots `docs/examples/event-streams` and `docs/examples/projections`, prints counts for streams/events/projections/object arrays, and prints current-state summaries for claims, processes, gates, review items, evidence, decisions, actions, exceptions, and links.
- **Acceptance:** Running the command from repo root reports the three event streams, two projections, accepted event counts where available, and object counts/current statuses from the checked-in fixtures.
- **Supports:** AC1, AC2, AC5.
- **Context:** Keep output deterministic and human-readable; JSON output can be optional but should not expand scope.

#### Task: Add Surface Current Claim Query
- **Files:** Foundation query module, CLI option/subcommand if useful, tests.
- **Changes:** Add a query that returns current claim status/freshness by claim id or all Surface claims from loaded projection snapshots without requiring a Flow run selection. Include evidence/action refs as refs, not executable behavior.
- **Acceptance:** Test or CLI query against `docs/examples/projections/surface-current-claim-status.json` returns `claim-provider-directory-current` with `status: verified`, `freshness.status: fresh`, validity timestamps, evidence refs, action refs, and no selected Flow run requirement.
- **Supports:** AC3, AC5.
- **Context:** The fixture’s `extensions.rendering.requiresSelectedFlowRun` is false and the projection has no `processes[]`; that is the proof point.

#### Task: Add Campfit Field Review Query
- **Files:** Foundation query module, CLI option/subcommand if useful, tests.
- **Changes:** Add a query that composes Campfit field-review state from `claims[]`, `reviewItems[]`, `evidence[]`, `decisions[]`, `actions[]`, and `links[]` by review item id, provider field ref, or claim id.
- **Acceptance:** Test or CLI query against `docs/examples/projections/campfit-field-review.json` returns review `review-provider-118-npi`, claim `claim-provider-118-npi`, evidence `evidence-provider-118-npi-source`, decision `decision-provider-118-npi-approved`, action `action-apply-provider-118-npi`, and the relevant `reviews`, `evidenced_by`, `updates`, or `produced_by` links.
- **Supports:** AC4, AC5.
- **Context:** Preserve Campfit, Surface, and Flow authority boundaries; do not infer domain truth beyond linked projection objects.

### Wave 3 (serial)

#### Task: Tests, Verification, And Scope Review
- **Files:** Add or update tests; update workflow evidence later under `.agents/flow-agents/read-only-console-foundation/`.
- **Changes:** Run local tests and the inspect command. Review source for forbidden execution paths and verify the production diff is limited to the small skeleton, tests, and optional README command note.
- **Acceptance:** Evidence records PASS/FAIL/NOT_VERIFIED for AC1-AC5 with command output. Scope review confirms no hosted service, action execution, network fetch, URL opening, product adapter, or product-owned state mutation.
- **Supports:** AC1, AC2, AC3, AC4, AC5.
- **Context:** Suggested checks: `node --test`, `npm run inspect:fixtures`, `rg "exec|spawn|fetch\\(|open\\(|http|https|child_process" src test bin package.json`, `git diff --name-only`.
