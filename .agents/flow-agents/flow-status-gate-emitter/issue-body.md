## Story

As a Flow implementer, I want a copyable Flow Console producer helper so Flow can emit current process/gate status and gate transition events into Kontour Console without requiring a hosted service, a UI, Campfit integration, or real Flow repo integration.

## Scope

- Add a dependency-free Flow helper/example module in `src/console-foundation`.
- Map caller-owned Flow run/process state into a valid `KontourConsoleProjection` with `producer.product: "flow"`.
- Include current `processes[]`, `gates[]`, optional `evidence`, `decisions`, inert `actions[]`, and `links`.
- Add a read helper such as `getFlowProcessStatus()` that can query current process/gate state from loaded projections.
- Map gate transitions into Console events such as `gate.opened`, `gate.passed`, `gate.failed`, or `gate.routed_back`.
- Prove local emit -> `.kontour` -> `inspectLocalKontour()` -> query current Flow state.
- Document this as a Flow Console producer helper/example, not real Flow integration.

## Non-goals

- Real Flow repo integration.
- Run Control API calls.
- Starting, pausing, resuming, or mutating Flow runs.
- Hosted ingestion, API sinks, background retries, or UI.
- Campfit-specific mapping.
- Event reducer/rebuild engine.

## Requirements

- R1: The projection helper must preserve top-level Console producer identity as Flow while keeping runner/agent/control details under actor/provenance/extension fields.
- R2: The projection helper must expose current process status, current step, percent complete, open gates, claim refs, review item refs, next action refs, and inert action descriptors when supplied.
- R3: The gate event helper must emit valid Console events with stable id, type, subject, payload before/after/refs, and optional correlation/causation metadata.
- R4: The read helper must query current Flow process status from projection arrays without requiring a selected Surface claim, Campfit review, or live Flow run.
- R5: Tests must use `KontourEmitter`, `LocalFileSink`, `inspectLocalKontour()`, validators, and the read helper to prove local round trip.
- R6: Docs must clearly state the helper is example code only and does not execute action descriptors or call Flow control semantics.

## Acceptance Criteria

- AC1: A test maps Flow process/gate state into a projection, emits it locally, discovers it with `inspectLocalKontour()`, and verifies `getFlowProcessStatus()` returns process status, current step, percent complete, open gate refs, gate statuses, next action refs, and inert action descriptors.
- AC2: A test maps a gate transition into a valid event, emits it locally, discovers it with `inspectLocalKontour()`, and verifies event id/type/subject/payload refs.
- AC3: Helper output validates through existing `validateProjection()` and `validateEvent()` with no validation errors.
- AC4: README or docs show this as a Flow Console producer helper/example and explicitly say it is not real Flow integration or run-control execution.
- AC5: Forbidden API scan finds no command execution, URL open/fetch, network imports, or action execution in the changed helper/test/doc scope.

## Verification

- `npm test`
- `npm run inspect:fixtures`
- `rg -n "child_process|exec\\(|execFile\\(|spawn\\(|fork\\(|open\\(|fetch\\(|node:http|node:https|require\\(['\\\"]node:net|require\\(['\\\"]node:tls" src/console-foundation/flow-process-helper.js test/flow-process-helper.test.js README.md`
- `git diff --check`
