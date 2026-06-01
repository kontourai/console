---
role: plan
parent: discover-local-kontour-producer-outputs--pull-work.md
created: 2026-06-01T20:29:36Z
---

# Discover Local Kontour Producer Outputs Plan

## Plan

Add a safe local discovery layer beside the existing fixture inspector rather than replacing it. Keep `inspectFixtures()` and `npm run inspect:fixtures` focused on checked-in `docs/examples` so AC3 remains stable, then introduce exported foundation helpers that discover `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json` recursively under a configured root. Reuse the existing `validateEvent`, `validateProjection`, `summarizeEvents`, `summarizeProjection`, and action descriptor extraction path by enriching loaded stream/projection objects with source metadata such as `sourceKind`, `sourceRoot`, and repo-relative `relativePath`. Tests should write through `LocalFileSink` into a temp `.kontour` root, then read through the new local discovery API so the producer and reader contracts are proven end to end.

## Definition Of Done

- **User outcome:** A local Console producer can emit events/projections through `KontourEmitter`/`LocalFileSink`, then the console foundation/inspector can discover and inspect those `.kontour` outputs without copying them into `docs/examples`.
- **Scope:** Include recursive local `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json` read discovery, source labels/relative paths, tests covering LocalFileSink-to-discovery for events and projections, CLI/docs updates for the local loop, and a forbidden API scan. Exclude hosted ingestion, HTTP/API sinks, product adapters, UI, durable outbox, watchers, and event-to-projection rebuilding.
- **Acceptance criteria:**
  - [ ] AC1 `local-event-discovery`: A test writes one event through `LocalFileSink`, then loads it through the console foundation local discovery path and verifies the same event id is present. Evidence: `npm test` and test assertion over emitted event id.
  - [ ] AC2 `local-projection-discovery`: A test writes one projection through `LocalFileSink`, then loads it through the console foundation local discovery path and verifies projection summaries/action descriptors work. Evidence: `npm test` and assertions over `summary.objectCounts`, extracted `actions`, `readOnly`, and inert warning behavior.
  - [ ] AC3 `fixture-inspection-preserved`: Existing `npm run inspect:fixtures` output still works for checked-in examples. Evidence: `npm run inspect:fixtures` exits 0 and still reports the current docs examples.
  - [ ] AC4 `local-loop-docs`: README/docs show the local loop: `KontourEmitter`/`LocalFileSink` writes `.kontour`, then inspector/foundation reads `.kontour`. Evidence: updated `README.md` and, if helpful, `docs/specs/projection-schema.md` or `docs/specs/emitter-sink-plane-contract.md`.
  - [ ] AC5 `no-execution-or-network`: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports. Evidence: `rg -n "child_process|execFile|exec\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http\\b|https\\b|net\\b|tls\\b|undici|axios|got|node:child_process|node:http|node:https|node:net|node:tls" src bin test`.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable.
  - [ ] Fixture examples and local `.kontour` outputs are distinguishable by source labels or repo-relative paths.
  - [ ] Unknown, NOT_VERIFIED, and TODO gaps are resolved or explicitly accepted.
  - [ ] Local discovery reads only files under configured local roots and preserves symlink/path containment expectations.
- **Stop-short risks:** The code could pass event/projection count tests while only scanning one directory level, missing nested `**/*` outputs; the CLI could silently switch `inspect:fixtures` to local+fixture mode and break predictable example output; relative paths could omit whether records came from `docs/examples` versus `.kontour`; recursive discovery could follow symlink escapes; action descriptors could accidentally be treated as executable by new inspector code.
- **Durable docs target:** `README.md` is required for the local emit -> inspect loop. Specs under `docs/specs/` may be updated only if implementation clarifies the existing local read convention.
- **Sandbox mode:** `local-edit`.

### Wave 1 (parallel)

#### Task: Foundation local discovery helpers
- **Files:** Modify `src/console-foundation/index.js`.
- **Changes:** Add constants for `.kontour/events` and `.kontour/projections`; add an exported local discovery function such as `inspectLocalKontour(options = {})` or `inspectKontourOutputs(options = {})` that takes `rootDir` and optional `kontourRoot`/`localRoot`. It should load events from `.kontour/events/**/*.jsonl` and projections from `.kontour/projections/**/*.json`, using existing validation/summarization/action descriptor functions. Keep `inspectFixtures()` unchanged for `docs/examples`, or implement it through a generic helper while preserving its existing behavior and return shape.
- **Acceptance:** Local event/projection read APIs return the same object shapes as fixture streams/projections plus source metadata; invalid/missing local dirs return empty arrays with no throw; source labels distinguish fixture vs `.kontour`.
- **Supports:** AC1, AC2, AC3, AC5.
- **Context:** Current `listFiles(dir, extension)` only reads one level. Replace or complement it with a recursive walker that uses `fs.lstatSync` to reject/skip symlinked directories/files and verifies resolved candidate paths stay inside the allowed root before reading. Avoid new dependencies and avoid any network/action execution APIs.

#### Task: Inspector command surface
- **Files:** Modify `bin/kontour-console-inspect.js`; optionally modify `package.json` only if adding a new npm script is useful.
- **Changes:** Preserve the default `inspect`/`npm run inspect:fixtures` fixture behavior. Add a predictable local command such as `kontour-console-inspect local` or `kontour-console-inspect inspect --local` that calls the local discovery helper, and optionally a combined command that prints both fixture and local reports. Update headings from fixture-specific text only where local output is printed so users can see source kind/path.
- **Acceptance:** `npm run inspect:fixtures` remains fixture-only and exits 0 with existing examples; a targeted local smoke command can inspect a temp or repo-local `.kontour` root without changing checked-in examples.
- **Supports:** AC3, AC4, AC5.
- **Context:** `printInspection(report)` currently says "Kontour Console fixture inspection"; if reused for local reports, parameterize the title or set report/source labels. Do not add URL opening, fetching, command execution, or action execution.

#### Task: Documentation for local emit -> inspect loop
- **Files:** Modify `README.md`; optionally modify `docs/specs/projection-schema.md` and/or `docs/specs/emitter-sink-plane-contract.md` if a brief consumer note is needed.
- **Changes:** Extend the existing "Local Console Producer Emission" section to show that emitted `.kontour` files can be inspected with the new local inspector/foundation path. Include the relevant command and a short code mention of the foundation helper if exported as public API. Keep action descriptors described as inert.
- **Acceptance:** Docs clearly show `KontourEmitter`/`LocalFileSink` writing `.kontour` and the inspector/foundation reading `.kontour`.
- **Supports:** AC4.
- **Context:** README already contains the emitter example; update that section rather than creating a separate long tutorial.

### Wave 2 (after Wave 1)

#### Task: Local discovery tests
- **Files:** Modify `test/console-foundation.test.js` and/or `test/emitter-sinks.test.js`.
- **Changes:** Add a test that creates a temp root, emits a valid event through `KontourEmitter` and `LocalFileSink`, calls the new local discovery function, and asserts the event id is present. Add a projection test that writes through `LocalFileSink`, reads through local discovery, and asserts summary/action descriptor behavior. Keep existing fixture tests intact.
- **Acceptance:** `npm test` passes and proves LocalFileSink output is compatible with local discovery, not just direct single-directory loader calls.
- **Supports:** AC1, AC2, AC3.
- **Context:** `test/emitter-sinks.test.js` already has `tempRoot()`, `validEvent()`, and `validProjection()` helpers. Reuse those patterns or move minimal helper duplication; avoid writing into the repo `.kontour` directory.

#### Task: Source labeling and path safety coverage
- **Files:** Modify `test/console-foundation.test.js` and/or `test/emitter-sinks.test.js`.
- **Changes:** Assert loaded fixture records include source info such as `sourceKind: "fixture"` or paths under `docs/examples`; assert local records include source info such as `sourceKind: "local"` or paths under `.kontour`. Add a symlink-safety test for discovery if the recursive walker has new behavior not covered by sink tests, skipping on Windows as current symlink tests do.
- **Acceptance:** Tests fail if local discovery follows symlink escapes or if source metadata is missing/ambiguous.
- **Supports:** AC3, AC5 and requirements R4, R6.
- **Context:** The sink already rejects symlink writes. Reader discovery needs equivalent caution because `.kontour` input files are producer-owned local data.

### Wave 3 (verification)

#### Task: Verification and scope scan
- **Files:** No production edits expected; record evidence in workflow verification artifacts later.
- **Changes:** Run the required commands and inspect output for criteria mapping.
- **Acceptance:** Commands pass or failures are documented with exact remediation:
  - `npm test`
  - `npm run inspect:fixtures`
  - targeted local discovery smoke, for example a node test or CLI invocation against temp `.kontour` data
  - `rg -n "child_process|execFile|exec\\(|spawn\\(|fork\\(|open\\(|fetch\\(|http\\b|https\\b|net\\b|tls\\b|undici|axios|got|node:child_process|node:http|node:https|node:net|node:tls" src bin test`
- **Supports:** AC1, AC2, AC3, AC4, AC5.
- **Context:** The forbidden scan may match fixture data strings like `externalUrl`; review matches by file and API usage. AC5 is about imported/executable capabilities and network calls, not inert descriptor fields in fixtures.

## Expected Files

- `src/console-foundation/index.js`
- `bin/kontour-console-inspect.js`
- `test/console-foundation.test.js`
- `test/emitter-sinks.test.js`
- `README.md`
- Optional: `package.json`
- Optional: `docs/specs/projection-schema.md`
- Optional: `docs/specs/emitter-sink-plane-contract.md`

## Traceability

| Task | AC1 | AC2 | AC3 | AC4 | AC5 | Requirements |
| --- | --- | --- | --- | --- | --- | --- |
| Foundation local discovery helpers | yes | yes | yes | no | yes | R1, R2, R3, R4, R5, R6 |
| Inspector command surface | no | no | yes | yes | yes | R3, R4, R5 |
| Documentation for local emit -> inspect loop | no | no | no | yes | no | R4 |
| Local discovery tests | yes | yes | yes | no | no | R1, R2, R3 |
| Source labeling and path safety coverage | no | partial | yes | no | yes | R4, R5, R6 |
| Verification and scope scan | yes | yes | yes | yes | yes | R1-R6 |
