---
role: plan
parent: surface-claim-status-freshness-emitter--pull-work.md
created: 2026-06-01T21:08:49Z
---

# Surface Claim Status Freshness Emitter Plan

## Plan

Add a small dependency-free Surface Console producer helper under `src/console-foundation/` that maps caller-owned Surface claim state into v0.1 Kontour Console records, then prove the helper through local file emission and discovery. The helper should create a `KontourConsoleProjection` with `producer.product: "surface"`, current `claims[]` status/freshness/validity/evidence/action refs, and optional inert `actions[]`; it should also create a `claim.freshness.changed` event with stable id, subject claim ref, before/after freshness payload, and cross-product refs. Tests should emit both records through `KontourEmitter` and `LocalFileSink`, read them back with `inspectLocalKontour()`, validate with existing validators, and verify `getSurfaceClaimStatus()` can read the current Surface claim without a selected Flow run. README/docs should present this as the first copyable Surface Console producer pattern, not real Surface integration.

## Definition Of Done

- **User outcome:** A Kontour product implementer can copy a dependency-free Surface helper pattern that emits local Console projection/event records and can inspect/query the emitted Surface claim status without running Flow.
- **Scope:** Include a helper/example module, exports, focused local emission/discovery tests, README or docs updates, and a forbidden API scan. Exclude real Surface repo integration, hosted ingestion, HTTP/API sinks, UI, other product adapters, reducer/rebuild engine, action execution, and Flow run starting.
- **Acceptance criteria:**
  - [ ] AC1 `surface-projection-local-query`: A test maps Surface claim state into a projection, emits it locally, discovers it with `inspectLocalKontour()`, and verifies `getSurfaceClaimStatus()` returns status, freshness, `validFrom`, `validUntil`, `lastUpdatedAt`, `evidenceRefs`, and `actionRefs`. Evidence: `npm test` output and test assertions in the new Surface helper test.
  - [ ] AC2 `freshness-event-local-discovery`: A test maps a freshness transition into a `claim.freshness.changed` event, emits it locally, discovers it with `inspectLocalKontour()`, and verifies event id/type/subject/payload refs. Evidence: `npm test` output and event assertions in the new Surface helper test.
  - [ ] AC3 `validator-clean`: Adapter output validates through existing event and projection validators with no validation errors. Evidence: explicit `validateEvent`/`validateProjection` assertions plus `inspectLocalKontour().validation.errors.length === 0`.
  - [ ] AC4 `document-example-helper`: README or docs show this as the first Surface Console producer pattern, clearly marked as an example/helper rather than real Surface integration. Evidence: README/docs diff and `npm run inspect:fixtures` still passes.
  - [ ] AC5 `scope-security-scan`: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports. Evidence: `rg` forbidden-pattern command returns no matches in the new helper/test/doc implementation except inert descriptor text where intentionally documented.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable.
  - [ ] Console producer scope and product-native/domain producer scope remain separated.
  - [ ] Action descriptors remain inert and no action execution path is introduced.
  - [ ] Unknown, NOT_VERIFIED, and TODO gaps are resolved or explicitly accepted.
- **Stop-short risks:** The helper could technically emit valid envelopes while omitting inert action descriptors, using `producer` to mean a Surface-native actor instead of the Console producer, validating only direct objects without proving `LocalFileSink`/`inspectLocalKontour` round trip, or documenting the helper in a way that implies live Surface integration.
- **Durable docs target:** `README.md` is the primary durable docs target; optionally add a short spec/example note under `docs/specs/` only if README would become too dense.
- **Sandbox mode:** `local-edit`.

### Wave 1 (parallel)

#### Task: Surface Helper Module
- **Files:** Create `src/console-foundation/surface-claim-helper.js`; update `src/console-foundation/index.js` exports.
- **Changes:** Implement dependency-free functions such as `surfaceClaimStateToProjection(state, options)` and `surfaceFreshnessTransitionToEvent(transition, options)`. Preserve caller-provided IDs/timestamps/refs where supplied, default `schema`/`version`, set top-level `producer.product` to `surface`, keep lower-level Surface source/clock/verifier details under `actor`, `derivedFrom`, `payload.data`, `extensions`, or refs, and include optional inert `actions[]` copied from caller input without executing or resolving anything.
- **Acceptance:** Direct unit assertions can build a projection/event and `validateProjection(...).filter(error).length === 0`, `validateEvent(...).filter(error).length === 0`.
- **Supports:** AC1, AC2, AC3, AC5; requirements R1, R2, R3, R6.
- **Context:** Reuse the fixture shape in `docs/examples/projections/surface-current-claim-status.json` and `docs/examples/event-streams/surface-claim-freshness.jsonl`. Existing validators are intentionally lightweight and live in `src/console-foundation/index.js`; do not add dependencies or JSON schema packages.

#### Task: Local Round-Trip Tests
- **Files:** Create `test/surface-claim-helper.test.js` or extend `test/emitter-sinks.test.js` if the repo prefers fewer test files.
- **Changes:** Use `node:test`, `node:assert/strict`, temporary directories, `KontourEmitter`, `LocalFileSink`, `inspectLocalKontour`, `getSurfaceClaimStatus`, `validateEvent`, and `validateProjection`. Test projection emission to `.kontour/projections/...`, discovery, zero validation errors, and `getSurfaceClaimStatus(report.projections, { claimId })`. Test freshness event emission to `.kontour/events/...`, discovery, zero validation errors, stable id/type/subject, `payload.before`, `payload.after`, and `payload.refs`.
- **Acceptance:** `npm test` passes; tests fail if fields named in AC1/AC2 are absent or if the helper requires a Flow run selection.
- **Supports:** AC1, AC2, AC3; requirements R4, R5.
- **Context:** Existing temp-root/local discovery tests in `test/emitter-sinks.test.js` show the pattern. `getSurfaceClaimStatus()` already filters projections where `snapshot.producer.product === "surface"`.

### Wave 2 (after Wave 1)

#### Task: Producer Pattern Documentation
- **Files:** Update `README.md`; optionally add or update a short doc under `docs/specs/` only if needed.
- **Changes:** Add a "Surface claim status/freshness producer helper" section near local producer emission. Show minimal CommonJS usage of the helper with `KontourEmitter`/`LocalFileSink`, state that it is an example/helper and not real Surface integration, and state that action descriptors are persisted as inert data only.
- **Acceptance:** A reader can identify this as the first Surface Console producer pattern and can tell it does not fetch Surface, start Flow, execute commands, dereference URLs, or mutate product state.
- **Supports:** AC4, AC5; requirements R1, R6.
- **Context:** README already explains local fixture inspection, producer terminology, and inert action descriptors. Keep the addition short and aligned with that language.

#### Task: Verification And Scope Scan
- **Files:** No production files; record command output in the session/verification artifact during execution.
- **Changes:** Run the package checks and forbidden API scan after implementation.
- **Acceptance:** Commands complete as expected:
  - `npm test`
  - `npm run inspect:fixtures`
  - `rg -n "child_process|exec\\(|execFile\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http:|https:|node:http|node:https|net\\.|node:net" src test README.md docs`
  The forbidden scan should have no matches in executable helper/test code. Documentation may mention forbidden behavior only as inert/non-executed scope language; if matches appear, review and classify them explicitly in verification evidence.
- **Supports:** AC3, AC4, AC5; requirements R4, R6.
- **Context:** `LocalFileSink` uses filesystem I/O by design; this scan targets command execution, URL/network access, and action execution. Do not add network imports or shell invocation helpers.

## Expected Files

- `src/console-foundation/surface-claim-helper.js` new helper module.
- `src/console-foundation/index.js` export additions only.
- `test/surface-claim-helper.test.js` new focused tests, or equivalent additions to existing tests.
- `README.md` producer pattern documentation.
- No changes expected to `docs/examples/` fixtures unless the implementer chooses to add a static example; the acceptance criteria can be satisfied through generated temp `.kontour` output in tests.

## Verification Commands

```sh
npm test
npm run inspect:fixtures
rg -n "child_process|exec\\(|execFile\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http:|https:|node:http|node:https|net\\.|node:net" src test README.md docs
```

## Task To AC Traceability

| Task | AC1 | AC2 | AC3 | AC4 | AC5 |
| --- | --- | --- | --- | --- | --- |
| Surface Helper Module | Yes | Yes | Yes | No | Yes |
| Local Round-Trip Tests | Yes | Yes | Yes | No | No |
| Producer Pattern Documentation | No | No | No | Yes | Yes |
| Verification And Scope Scan | No | No | Yes | Yes | Yes |
