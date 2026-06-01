---
role: plan
parent: implement-local-composite-sink-skeleton--pull-work.md
created: 2026-06-01T10:37:36-06:00
---

## Plan

Implement a dependency-free producer boundary in the existing CommonJS console foundation package. Keep loader/inspector behavior unchanged, add a focused emitter/sink module under `src/console-foundation/`, and re-export it from `src/console-foundation/index.js`. `KontourEmitter` should validate the minimum envelope, preserve stable semantic identity, and delegate to a configured sink. `LocalFileSink` should write local control-plane records only under a configured `.kontour/` root using sanitized producer/scope tokens, appending events to JSONL streams and writing current projection JSON snapshots. `CompositeSink` should fan out the same source record to child sinks and return per-sink delivery results, including failures. `InMemorySink` should exist for tests and examples only. Do not add network/API/OTLP behavior, background retries, action execution, or dependencies.

## Definition Of Done

- **User outcome:** A product can emit one Kontour control-plane event or projection snapshot through a local-first emitter/sink skeleton, inspect the local projection with the existing loader, and see independent delivery results for every sink in a composite fanout.
- **Scope:** Include `KontourEmitter`, `LocalFileSink`, `CompositeSink`, `InMemorySink`, local JSONL/current projection writes under safe `.kontour/` paths, exports, tests, and a README/docs usage snippet. Exclude HTTP/API sink implementation, OTLP exporter, product adapters/Campfit integration, background retries, auth, hosted ingestion, and UI.
- **Acceptance criteria:**
  - [ ] AC1 `event-fanout`: A test emits one control event through `CompositeSink([LocalFileSink, InMemorySink])` and verifies the same `event.id` reaches both sinks. Evidence: `npm test` with assertions over local JSONL and in-memory records.
  - [ ] AC2 `projection-loader-compatibility`: A test emits one projection snapshot through the local sink and verifies it can be read by the existing inspector/loader. Evidence: `npm test` with `loadProjectionSnapshots` or `inspectFixtures` pointed at the emitted projection directory.
  - [ ] AC3 `per-sink-failure-results`: Per-sink delivery result includes sink id/name, status/outcome, required `recordId`, and safe error details when simulated failure occurs. Evidence: `npm test` with a failing test sink or sink stub.
  - [ ] AC4 `security-scope-scan`: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports in implementation/tests/docs snippets. Evidence: `rg -n "child_process|execFile|exec\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http:|https:|node:http|node:https|net\\b|tls\\b" src test README.md docs`.
  - [ ] AC5 `fanout-docs`: README or docs show local plus future API fanout concept without implementing the API. Evidence: README/docs diff and targeted `rg` for `future`/`HttpApiSink`/`CompositeSink` wording.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable from `README.md`.
  - [ ] Local output scope is separated from future hosted/global API scope.
  - [ ] No UI/dashboard visual evidence is needed because this is a Node package API slice.
  - [ ] Unknown, `NOT_VERIFIED`, and TODO gaps are resolved or explicitly accepted.
- **Stop-short risks:** Passing tests could still miss unsafe path traversal if only happy-path identifiers are tested; include at least one invalid identifier/path containment test. A projection file could validate but be named by `generatedAt`; require projection identity/name derived from producer/scope/provenance or an explicit projection id, not `generatedAt`. A composite aggregate could hide child failures; tests must inspect child results directly. Documentation could imply an implemented API sink; wording must clearly mark it future-only.
- **Durable docs target:** `README.md` local emitter/sink usage snippet. Optional durable spec clarification only if implementation reveals ambiguity; otherwise leave specs unchanged.
- **Sandbox mode:** `local-edit`.

### Wave 1 (parallel)

#### Task: Emitter And Delivery Result Core
- **Files:** Create `src/console-foundation/emitter.js`; modify `src/console-foundation/index.js` exports.
- **Changes:** Add `KontourEmitter` with `emit(record)` and optional convenience methods such as `emitEvent(event)` / `emitProjection(projection)` if that matches the local style. Add shared helpers to classify records (`event`, `projection`, unknown), derive required stable `recordId`, validate minimum envelopes using existing `validateEvent` / `validateProjection` where practical, and format `SinkDeliveryResult` objects with `sinkId`, `sinkRole`, `outcome`, `recordId`, `recordKind`, optional `destination`, `retryable`, `errorCode`, `safeMessage`, and `observedAt`. Projection `recordId` must prefer an explicit stable id if present, otherwise derive a deterministic identity from `schema`, `version`, `producer.product`, `producer.id`, `scope.kind`, `scope.id`, and `derivedFrom` identity fields; do not include `generatedAt`.
- **Acceptance:** Unit assertions in later tasks can import the new classes from `../src/console-foundation`; direct tests should prove event ids are preserved and projection ids are stable across different `generatedAt` values with identical provenance.
- **Supports:** AC1, AC2, AC3.
- **Context:** Preserve `docs/specs/emitter-sink-plane-contract.md` delivery result terminology and the projection dedupe rule. Keep dependency-free CommonJS and avoid external packages.

#### Task: Local File Sink
- **Files:** Create or extend `src/console-foundation/emitter.js`; add focused tests in `test/console-foundation.test.js` or `test/emitter-sinks.test.js`.
- **Changes:** Implement `LocalFileSink` with configurable root defaulting to `.kontour`. For events, append one JSON object plus newline to `.kontour/events/<producer-id>/<scope-kind>-<scope-id>.jsonl`. For projections, write current JSON snapshots under `.kontour/projections/<producer-id>/<scope-kind>-<scope-id>.json`. Create parent directories as needed. Sanitize producer/scope tokens by rejecting empty values, absolute paths, `..`, path separators, control characters, and symlink escapes; resolve and verify every write path stays inside the configured root. Do not read destination paths from record payloads or action descriptors.
- **Acceptance:** Tests write to a temporary directory under `test` or OS temp, verify JSONL event content and projection JSON content, verify loader compatibility for projections, and verify invalid identifiers fail with a `failed` delivery result instead of escaping the root.
- **Supports:** AC1, AC2, AC4.
- **Context:** Existing loader functions read a caller-supplied directory and validate snapshots. Use `fs`/`path` only; no network, URL, shell, or command APIs.

#### Task: Composite And In-Memory Sinks
- **Files:** Create or extend `src/console-foundation/emitter.js`; add focused tests in `test/console-foundation.test.js` or `test/emitter-sinks.test.js`.
- **Changes:** Implement `CompositeSink` with an ordered child sink list. It should deliver the exact same semantic record object, or an immutable equivalent if defensively copied, to every child and return an aggregate object that keeps all child results visible. Child failures should be captured as failed result entries and must not prevent later sinks from receiving the record unless construction explicitly rejects non-sink inputs. Implement `InMemorySink` with a stable `sinkId`, `sinkRole`, and an array of accepted records/results for tests and local examples. Include an optional failure mode or use a test stub to simulate AC3.
- **Acceptance:** Tests verify both local and memory sinks receive the same event id, and a simulated sink failure yields a result with sink id/name, `outcome: "failed"`, `recordId`, `recordKind`, `errorCode`, `safeMessage`, and `observedAt` while other child results remain visible.
- **Supports:** AC1, AC3.
- **Context:** The #4 contract allows an aggregate CompositeSink result, but consumers must inspect children. Make result shape obvious and documented enough for future sinks.

### Wave 2 (parallel after Wave 1 APIs exist)

#### Task: Tests For Loader Compatibility And Inert Actions
- **Files:** Modify `test/console-foundation.test.js` or add `test/emitter-sinks.test.js`.
- **Changes:** Add fixture builders for a valid event and projection snapshot. The projection should include an inert action descriptor with fields like `authority.command`, `authority.endpoint`, or `authority.externalUrl` to prove local delivery persists descriptors without executing or dereferencing them. Point `loadProjectionSnapshots` at the emitted `.kontour/projections/<producer-id>` directory, or at the precise projection root produced by `LocalFileSink`, and assert validation errors are empty plus action descriptor warnings remain inert/read-only through existing extraction helpers.
- **Acceptance:** `npm test` passes and includes assertions for AC2 and action descriptor inertness. Tests should not require network, shell, or a running service.
- **Supports:** AC2, AC4.
- **Context:** Existing tests already assert read-only action descriptor extraction from checked-in fixtures; extend that pattern for emitted local projections.

#### Task: README Usage Snippet
- **Files:** Modify `README.md`.
- **Changes:** Add a short "Local Producer Emission" or similar section showing dependency-free local output with `KontourEmitter`, `LocalFileSink`, `CompositeSink`, and `InMemorySink`. Show a commented or clearly named future `HttpApiSink` placeholder in prose only, making clear API fanout is a future sink role and is not implemented. Mention `.kontour/events` and `.kontour/projections`, local-first behavior, and independent per-sink results.
- **Acceptance:** AC5 verified by reading README and targeted search; wording does not imply HTTP/API code exists.
- **Supports:** AC5.
- **Context:** Keep README aligned with current package positioning as a local fixture/console foundation package, not a hosted service.

### Wave 3 (serial verification)

#### Task: Verification And Scope Review
- **Files:** No production changes expected; verifier may write workflow evidence artifacts later.
- **Changes:** Run the package tests, fixture inspector, forbidden API scan, and quick export/import smoke check. Inspect diff for non-goal creep and for projection identity using `generatedAt`.
- **Acceptance:** Commands below pass, or failures are recorded with exact gaps:
  - `npm test`
  - `npm run inspect:fixtures`
  - `rg -n "child_process|execFile|exec\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http:|https:|node:http|node:https|net\\b|tls\\b" src test README.md docs`
  - `rg -n "generatedAt" src test README.md docs/specs/emitter-sink-plane-contract.md docs/specs/projection-schema.md`
- **Supports:** AC1, AC2, AC3, AC4, AC5.
- **Context:** The forbidden API scan may find descriptive spec text in docs from prior work; verification should distinguish production/test implementation from authoritative docs that prohibit those behaviors, and should record whether the implementation itself imports or calls forbidden APIs.

## Expected Files

- `src/console-foundation/emitter.js` or an equivalent small sibling module under `src/console-foundation/`
- `src/console-foundation/index.js`
- `test/emitter-sinks.test.js` or `test/console-foundation.test.js`
- `README.md`
- Workflow artifacts under `.agents/flow-agents/implement-local-composite-sink-skeleton/`

## Verification Commands

```sh
npm test
npm run inspect:fixtures
rg -n "child_process|execFile|exec\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http:|https:|node:http|node:https|net\\b|tls\\b" src test README.md docs
rg -n "generatedAt" src test README.md docs/specs/emitter-sink-plane-contract.md docs/specs/projection-schema.md
```

## Task-To-Acceptance Traceability

| Task | AC1 | AC2 | AC3 | AC4 | AC5 |
| --- | --- | --- | --- | --- | --- |
| Emitter And Delivery Result Core | Yes | Yes | Yes | No | No |
| Local File Sink | Yes | Yes | No | Yes | No |
| Composite And In-Memory Sinks | Yes | No | Yes | No | No |
| Tests For Loader Compatibility And Inert Actions | No | Yes | No | Yes | No |
| README Usage Snippet | No | No | No | No | Yes |
| Verification And Scope Review | Yes | Yes | Yes | Yes | Yes |
