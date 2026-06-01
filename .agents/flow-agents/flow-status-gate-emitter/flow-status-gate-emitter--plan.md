---
role: plan
parent: flow-status-gate-emitter--pull-work.md
created: 2026-06-01T21:38:21Z
---

# Plan: Flow Process Gate Status Emitter Example

## Plan

Add a dependency-free Flow Console producer helper/example by following the existing Surface helper pattern. The implementation should introduce `src/console-foundation/flow-process-helper.js`, export `flowProcessStateToProjection()`, `flowGateTransitionToEvent()`, and `getFlowProcessStatus()` from `src/console-foundation/index.js`, prove local round trips with `KontourEmitter`, `LocalFileSink`, `inspectLocalKontour()`, `validateProjection()`, and `validateEvent()`, and document the helper as example-only code that does not call Flow, execute run-control semantics, fetch URLs, or run action descriptors.

## Definition Of Done

- **User outcome:** A Flow implementer can copy the helper/example, emit current Flow process/gate status and gate transition events into local Kontour Console files, inspect them, and query current process status without needing hosted services, Campfit, Surface selection, live Flow repo integration, or run-control execution.
- **Scope:** Include a dependency-free helper module, exports, tests, and README/docs updates. Exclude real Flow integration, hosted ingestion, network/API sinks, process mutation, command execution, event reducer/rebuild logic, Campfit-specific mapping, UI, background retries, and any action execution.
- **Acceptance criteria:**
  - [ ] AC1 `flow-status-round-trip`: A test maps Flow process/gate state into a projection, emits it locally, discovers it with `inspectLocalKontour()`, and verifies `getFlowProcessStatus()` returns process status, current step, percent complete, open gate refs, gate statuses, next action refs, and inert action descriptors. Evidence: `npm test` output and assertions in `test/flow-process-helper.test.js`.
  - [ ] AC2 `flow-gate-event-round-trip`: A test maps a gate transition into a valid event, emits it locally, discovers it with `inspectLocalKontour()`, and verifies event id/type/subject/payload refs. Evidence: `npm test` output and assertions in `test/flow-process-helper.test.js`.
  - [ ] AC3 `validator-clean`: Helper output validates through existing `validateProjection()` and `validateEvent()` with no validation errors. Evidence: validation assertions in `test/flow-process-helper.test.js` and `npm run inspect:fixtures`.
  - [ ] AC4 `helper-example-docs`: README or docs show this as a Flow Console producer helper/example and explicitly say it is not real Flow integration or run-control execution. Evidence: README diff and doc review.
  - [ ] AC5 `forbidden-api-clean`: Forbidden API scan finds no command execution, URL open/fetch, network imports, or action execution in the changed helper/test/doc scope. Evidence: `rg -n "child_process|exec\\(|execFile\\(|spawn\\(|fork\\(|open\\(|fetch\\(|node:http|node:https|require\\(['\\\"]node:net|require\\(['\\\"]node:tls" src/console-foundation/flow-process-helper.js test/flow-process-helper.test.js README.md` returns no matches.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable from README.
  - [ ] Flow producer identity stays top-level while runner/agent/control details remain under actor, provenance, or extensions.
  - [ ] Action descriptors are represented as read-only/inert data and are not executed by helper, tests, or docs.
  - [ ] Unknown, NOT_VERIFIED, and TODO gaps are resolved or explicitly accepted before delivery.
- **Stop-short risks:** Tests could validate envelope shape while missing the read helper’s filtering semantics; docs could imply the helper controls real Flow runs; action descriptor examples could look executable; event ids could be accepted by validators but not stable/copyable; helper could accidentally couple to Campfit or Surface-specific selection logic.
- **Durable docs target:** `README.md` local producer helper section.
- **Sandbox mode:** `local-edit`.

### Wave 1 (parallel)

#### Task: Add Flow helper module
- **Files:** Create `src/console-foundation/flow-process-helper.js`.
- **Changes:** Implement a dependency-free CommonJS module patterned after `src/console-foundation/surface-claim-helper.js`, using only local helpers such as `requireObject`, `requireString`, `cloneArray`, `clone`, `hasRef`, `stableStringify`, and `compactObject`.
- **Acceptance:** Projection and event objects satisfy `validateProjection()` and `validateEvent()` with zero `error` entries in later tests.
- **Supports:** AC1, AC2, AC3, AC5.
- **Context:** Preserve Console producer identity as Flow: default `producer` should be `{ product: "flow", id: "flow-console-producer" }`, default scope should be Flow-oriented, and actor/runner/control details should be placed under `actor`, `provenance`, or `extensions`, not by changing `producer.product`.

Implementation guidance for `flowProcessStateToProjection()`:
- Accept caller-owned state plus options and throw `TypeError` for missing non-empty `processId`/`id`, process `status`, and `generatedAt`.
- Return a `kontour.console.projection` v0.1 object with `producer.product: "flow"`.
- Include `processes[]`, `gates[]`, optional `evidence`, `decisions`, inert `actions[]`, `links`, and `extensions`.
- Build a primary process object from `state.process` or top-level state fields: `id`, `definitionId`, `label`, `status`, `currentStep`, `startedAt`, `updatedAt`, `completedAt`, `percentComplete`, `openGateRefs`, `claimRefs`, `reviewItemRefs`, `nextActionRefs`, `extensions`.
- Preserve supplied `state.processes` if multiple processes are supplied, while ensuring the main process exists when only top-level state is supplied.
- Derive `nextActionRefs` from supplied `actions[]` ids when not already present. Use product from `action.product`, `action.authority.product`, or `"flow"`, kind `"action"`, and preserve labels when supplied.
- Do not execute or resolve actions. Actions are copied as descriptors only.
- Add `summary` counts when useful, especially open gate count and pending action count, but keep it derived data.
- Use `derivedFrom` as a direct snapshot ref by default, for example `{ directSnapshot: { product: "flow", kind: "run", id: processId } }`.

Implementation guidance for `flowGateTransitionToEvent()`:
- Accept caller-owned transition plus options and throw `TypeError` for missing non-empty `gateId`/`id`, transition `status`/`after.status`, and `occurredAt`.
- Map transition statuses to event types: `open`/`opened` -> `gate.opened`, `passed`/`pass` -> `gate.passed`, `failed`/`fail` -> `gate.failed`, `routed_back`/`route_back`/`waiting` with route-back metadata -> `gate.routed_back`. Allow explicit `transition.type` override only when it starts with `gate.`.
- Return a `kontour.console.event` v0.1 object with stable id. Suggested fallback id: `flow:${processId || "process"}:gate:${gateId}:${eventType}:${statusKey(before)}->${statusKey(after)}`.
- Subject should default to `{ product: "flow", kind: "gate", id: gateId }`.
- Payload must include `before`, `after`, `refs`, optional `summary`, `reason`, and `data`; ensure the gate subject and process ref are present in `payload.refs` when available.
- Preserve optional `actor`, `correlationId`, `causationId`, `sequence`, `links`, and `extensions`.

#### Task: Export Flow helper and query function
- **Files:** Modify `src/console-foundation/index.js`.
- **Changes:** Require the new helper and export `flowProcessStateToProjection`, `flowGateTransitionToEvent`, and `getFlowProcessStatus`.
- **Acceptance:** Test imports can require all three functions from `../src/console-foundation`.
- **Supports:** AC1, AC2, AC3.
- **Context:** Keep existing exports stable. Add the read helper near `getSurfaceClaimStatus()` and `getCampfitFieldReviewState()` so Console query helpers remain discoverable.

Implementation guidance for `getFlowProcessStatus()`:
- Accept loaded projection records from `inspectLocalKontour()` or `loadProjectionSnapshots()` and optional filters such as `{ processId, status, gateId }`.
- Only read projections whose `snapshot.producer.product === "flow"`.
- Return an array of process status records containing `projection`, `id`, `definitionId`, `label`, `status`, `currentStep`, `percentComplete`, `openGateRefs`, `claimRefs`, `reviewItemRefs`, `nextActionRefs`, `gates`, `openGates`, `evidence`, `decisions`, `actions`, and `source`.
- Join gates by `gate.processRef.id === process.id` and include all matching gate statuses; `openGates` should include gates with status `open`, `waiting`, or `routed_back` plus any refs listed in `process.openGateRefs`.
- Join actions by `nextActionRefs`, `action.subjectRefs`, or matching process/gate ids. Convert actions through existing `toActionDescriptor()` so callers see `readOnly: true` and inert warnings.
- Do not require a Surface claim, Campfit review item, selected Flow run, or live Flow runtime.

### Wave 2 (parallel after Wave 1)

#### Task: Add local round-trip tests
- **Files:** Create `test/flow-process-helper.test.js`.
- **Changes:** Add one projection/status round-trip test and one gate transition event round-trip test.
- **Acceptance:** `npm test` passes and the tests assert the AC1/AC2 fields explicitly.
- **Supports:** AC1, AC2, AC3.
- **Context:** Mirror `test/surface-claim-helper.test.js`: use `node:test`, `node:assert/strict`, `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, `KontourEmitter`, `LocalFileSink`, `inspectLocalKontour`, and validators.

Projection test guidance:
- Build sample Flow state with process id such as `run-provider-onboarding-42`, status `running`, `currentStep`, `percentComplete`, `openGateRefs`, `claimRefs`, `reviewItemRefs`, `nextActionRefs`, at least two gates with statuses such as `open` and `passed`, optional evidence/decisions, an inert action descriptor with `authority.command` like `flow.run.resume` or `flow.gate.retry`, and `links`.
- Validate with `validateProjection(projection, "flow-projection")`, emit with `emitter.emitProjection(projection)`, inspect with `inspectLocalKontour({ rootDir })`, call `getFlowProcessStatus(report.projections, { processId })`, and assert: status, current step, percent complete, open gate refs, returned gate statuses, next action refs, `actions[0].readOnly === true`, and inert warnings include the command warning.

Gate event test guidance:
- Build a transition for one of `gate.opened`, `gate.passed`, `gate.failed`, or `gate.routed_back`; include before/after, process ref, claim/evidence refs, correlationId, causationId, and sequence.
- Validate with `validateEvent(event, "flow-event")`, emit with `emitter.emitEvent(event)`, inspect with `inspectLocalKontour({ rootDir })`, and assert stable event id, type, subject `{ product: "flow", kind: "gate", id }`, and payload refs include gate/process/claim or evidence refs.

#### Task: Update README helper docs
- **Files:** Modify `README.md`.
- **Changes:** Add a concise Flow Console producer helper/example section near the existing Surface helper docs. Show imports, a minimal `flowProcessStateToProjection()` example, a `flowGateTransitionToEvent()` example, and a readback call to `getFlowProcessStatus()`.
- **Acceptance:** README explicitly says this is helper/example code only, not real Flow integration, not run-control execution, and action descriptors are inert/read-only metadata.
- **Supports:** AC4, AC5.
- **Context:** Reuse the tone and placement of the existing local producer and Surface helper sections. Avoid any code sample that calls `fetch`, opens URLs, executes shell commands, or suggests actions are executed.

### Wave 3 (serial verification)

#### Task: Run verification commands
- **Files:** No source edits expected; update workflow evidence artifacts only if this workflow requires them later.
- **Changes:** Run the required checks and fix any implementation/doc/test gaps found by the commands.
- **Acceptance:** All commands pass or any gap is explicitly recorded for verifier/orchestrator decision.
- **Supports:** AC1, AC2, AC3, AC4, AC5.
- **Context:** Required commands:

```bash
npm test
npm run inspect:fixtures
rg -n "child_process|exec\\(|execFile\\(|spawn\\(|fork\\(|open\\(|fetch\\(|node:http|node:https|require\\(['\\\"]node:net|require\\(['\\\"]node:tls" src/console-foundation/flow-process-helper.js test/flow-process-helper.test.js README.md
git diff --check
```

The forbidden API scan should return no matches. If README prose mentions the words in the regex, rephrase the docs rather than weakening the scan.

## Expected Files

- Create `src/console-foundation/flow-process-helper.js`.
- Create `test/flow-process-helper.test.js`.
- Modify `src/console-foundation/index.js`.
- Modify `README.md`.
- Do not modify checked-in fixtures unless a worker determines they are necessary for docs or `inspect:fixtures`; this issue can be completed with generated local test records only.

## Handoff Notes

- Use CommonJS and dependency-free helper code to match the package.
- Keep helper/test/doc scope free of command execution, network imports, URL fetch/open calls, and action execution.
- Treat Flow actions as inert descriptors only. The Console helper should describe possible next actions, not perform them.
- Keep Flow, Surface, and Campfit ownership boundaries explicit: Flow owns process/gate status and route-control semantics; Surface claim refs and Campfit review refs may appear only as referenced objects.
