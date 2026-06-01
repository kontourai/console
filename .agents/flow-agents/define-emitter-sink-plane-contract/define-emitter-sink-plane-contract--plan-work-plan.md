---
role: plan
parent: define-emitter-sink-plane-contract--plan-work
created: 2026-06-01T09:55:04-06:00
---

# Define Kontour Emitter, Sink, And Plane Contracts

## Plan

Create a producer-side contract spec that sits beside the existing event/projection schema and makes the emission boundary explicit before any sink implementation work begins. The durable target should be `docs/specs/emitter-sink-plane-contract.md`, with small cross-links from `docs/specs/projection-schema.md` and `docs/product-boundaries.md` only if needed for discoverability. Keep the work docs/spec only: define planes, record categories, emitter responsibilities, sink roles, fanout and delivery result semantics, local-first fallback, dedupe expectations, and inert action descriptors without adding hosted API, HTTP/OTLP/network sinks, emitter code, integrations, or UI.

## Definition Of Done

- **User outcome:** A Kontour product implementer can read the docs and understand how to emit one semantic Kontour record through a transport-neutral emitter to a required local file sink and future hosted or telemetry sinks, while preserving product authority, local-first operation, idempotent replay, and non-executing action descriptors.
- **Scope:** Docs/spec only. Include control-plane and telemetry-plane authority boundaries, record categories, `KontourEmitter`, `LocalFileSink`, `CompositeSink`, future `HttpApiSink`, future telemetry/Otel sink role, multi-sink fanout, per-sink delivery results, local-first fallback, at-least-once/dedupe semantics, and inert action descriptor rules. Exclude hosted API, HTTP/OTLP/network sink implementation, emitter code, retry daemon/outbox design beyond minimal contract language, product integrations, and UI.
- **Acceptance criteria:**
  - [ ] AC1 `planes-authority`: Docs define control-plane vs telemetry-plane data types and authority boundaries. Evidence: `docs/specs/emitter-sink-plane-contract.md` contains explicit sections for control-plane records, telemetry-plane records, shared correlation, and authority limits.
  - [ ] AC2 `emitter-sink-roles`: Docs define `KontourEmitter`, `LocalFileSink`, `CompositeSink`, future `HttpApiSink`, and future telemetry/Otel sink roles. Evidence: role table or equivalent normative prose covers each named role without implementation details.
  - [ ] AC3 `fanout-results`: Docs define multi-output fanout with stable event/projection ids and independent per-sink results. Evidence: spec states one source record keeps one semantic id across sinks and each sink returns its own delivery result.
  - [ ] AC4 `local-first-dedupe`: Docs define local-first fallback and at-least-once/dedupe semantics. Evidence: spec states local file output is first-class/required, local failure/success expectations are separate from future network delivery, retries may re-deliver, and consumers dedupe by stable record id.
  - [ ] AC5 `inert-actions`: Docs explicitly state no generic sink executes action descriptors, opens URLs, or mutates product state. Evidence: spec repeats the prohibition for sink behavior and aligns with existing action descriptor wording in `docs/specs/projection-schema.md`.
- **Usefulness checks:**
  - [ ] User-facing workflow is documented or discoverable from `docs/specs/`.
  - [ ] Local and future hosted/org scope are separated: local file sink is required now; HTTP/API and telemetry/Otel sinks remain future roles.
  - [ ] Security-sensitive wording around commands, URLs, endpoints, fanout, and local file paths is precise and does not imply blind execution, backend fetching, path interpolation, or product-state mutation.
  - [ ] Unknown, `NOT_VERIFIED`, and TODO gaps are resolved or explicitly accepted in final docs.
  - [ ] Diff scope remains docs/spec and workflow artifacts only; no production emitter, sink, network, integration, or UI code is added.
- **Stop-short risks:** The doc could define role names but leave delivery results too vague for issue #5; it could blur telemetry into control-plane authority; it could mention HTTP/OTLP in a way that sounds implemented or required; it could preserve local-first language but not require local file output as a first-class sink; it could fail to repeat that action descriptors, URLs, endpoints, commands, and local paths are untrusted data and inert until handled by trusted product authority.
- **Durable docs target:** Primary target `docs/specs/emitter-sink-plane-contract.md`. Optional small cross-links in `docs/specs/projection-schema.md`, `docs/product-boundaries.md`, or `README.md` only if discoverability needs them.
- **Sandbox mode:** `local-edit`.

## Requirement Traceability

| Requirement | Planned coverage |
| --- | --- |
| R1 | Wave 1 Task 1 defines control-plane and telemetry-plane records and authority boundaries. |
| R2 | Wave 1 Task 2 defines `LocalFileSink` as required and first-class; Wave 2 checks consistency with existing local JSONL/projection conventions. |
| R3 | Wave 1 Task 3 defines multi-sink fanout from one semantic source record. |
| R4 | Wave 1 Task 3 defines per-sink delivery results, at-least-once delivery, and dedupe expectations. |
| R5 | Wave 1 Task 2 states sinks adapt delivery format, not product domain meaning. |
| R6 | Wave 2 Task 4 hardens inert action descriptor, URL, endpoint, command, and mutation language. |
| AC1 | Wave 1 Task 1. |
| AC2 | Wave 1 Task 2. |
| AC3 | Wave 1 Task 3. |
| AC4 | Wave 1 Task 3 and Wave 2 Task 4. |
| AC5 | Wave 2 Task 4. |

### Wave 1 (parallel)

#### Task: Define emission planes and record categories

- **Files:** Create `docs/specs/emitter-sink-plane-contract.md`.
- **Changes:** Add the spec title/status, context, non-goals, and a section that distinguishes control-plane records from telemetry-plane records. Control-plane categories should include semantic events, projection snapshots, evidence refs, identity links, and action descriptors. Telemetry-plane categories should include traces/spans, metrics, logs, usage/cost, and operational events. State that shared correlation ids can connect planes, but telemetry is not authority for claims, gates, review decisions, product domain truth, or action execution.
- **Acceptance:** Doc inspection confirms R1 and AC1 are satisfied, with explicit authority boundaries for Surface, Flow, Survey, Veritas, Flow Agents, vertical products, and Kontour Console where relevant.
- **Supports:** R1, AC1.
- **Context:** Reuse language from `CONTEXT.md`, `docs/product-boundaries.md`, ADR 0001, and `docs/specs/projection-schema.md`. Avoid redefining existing event/projection envelope fields unless a concise pointer is enough.

#### Task: Define emitter and sink roles

- **Files:** Create or modify `docs/specs/emitter-sink-plane-contract.md`.
- **Changes:** Document `KontourEmitter` as the producer-facing boundary that accepts semantic records and delegates delivery to configured sinks. Define `LocalFileSink` as the required first-class local output role; `CompositeSink` as the fanout coordinator; future `HttpApiSink` as a hosted/org delivery adapter; and future telemetry/Otel sink as telemetry-plane delivery. State that sinks adapt record delivery format and transport, not product domain meaning, ids, authority, or action semantics.
- **Acceptance:** Doc inspection confirms every role named in AC2 is present and R2/R5 are explicit. The future HTTP/API and telemetry/Otel roles must be described as future contract roles, not implemented dependencies.
- **Supports:** R2, R5, AC2.
- **Context:** Issue #5 will consume these names for a local/composite skeleton, so define expected responsibilities clearly enough to guide code later without putting code in this issue.

#### Task: Specify fanout, delivery results, fallback, and dedupe

- **Files:** Create or modify `docs/specs/emitter-sink-plane-contract.md`.
- **Changes:** Add fanout semantics: one semantic source record keeps stable `id`/projection identity across all sinks; each sink receives the same semantic record or a transport adaptation that preserves identity; each sink reports independent delivery result status, sink id/name, accepted/skipped/failed outcome, error detail when safe, and retryability when known. Define at-least-once behavior, duplicate re-delivery, consumer dedupe by stable record id, local-first fallback, and how future network sink failure must not erase local output.
- **Acceptance:** Doc inspection confirms R3/R4 and AC3/AC4 are satisfied. The text should not define a full retry daemon/outbox, but it may leave future durable retry as out of scope.
- **Supports:** R3, R4, AC3, AC4.
- **Context:** Existing `docs/specs/projection-schema.md` already says event ids are stable and local replay ignores duplicates. Align with that language and avoid contradicting append-only JSONL and projection snapshot behavior.

### Wave 2 (after Wave 1)

#### Task: Harden action, URL, endpoint, command, and path safety language

- **Files:** Modify `docs/specs/emitter-sink-plane-contract.md`; optionally modify `docs/specs/projection-schema.md` only if a cross-link or wording alignment is needed.
- **Changes:** Add a security-sensitive section stating generic sinks never execute action descriptors, open URLs, call endpoints, run commands, fetch backend resources, mutate product-owned state, or interpret local file paths from records as trusted input. Reuse the existing projection schema language that action authority fields are descriptors only and must resolve through trusted product adapters/registries with allowlists and validation. For local sink paths, state producer/scope tokens are sanitized identifiers and must be containment-checked under the configured output root.
- **Acceptance:** Doc inspection confirms R6 and AC5 are satisfied and wording is precise enough for a security reviewer. No language should imply that generic sinks are trusted action routers or network clients in this issue.
- **Supports:** R6, AC5, AC4.
- **Context:** Existing `docs/specs/projection-schema.md` already warns about `authority.endpoint`, `authority.command`, `authority.externalUrl`, `sourceUrl`, local stream path tokens, and symlink containment. Prefer cross-reference plus targeted repetition over broad rewrites.

#### Task: Add discoverability and consistency links

- **Files:** Modify `docs/specs/projection-schema.md`, `docs/product-boundaries.md`, and/or `README.md` only if needed.
- **Changes:** Link the new emitter/sink/plane contract from the existing event/projection schema or product boundary doc so future implementers can find the producer-side contract. Ensure terminology is consistent: event streams are durable control-plane integration records; projections are read models; telemetry is non-authoritative operational data; Kontour Console remains local-first and not a hidden hosted dependency.
- **Acceptance:** Manual review confirms a reader starting from `docs/product-boundaries.md` or `docs/specs/projection-schema.md` can discover the new spec. Diff remains narrow and no unrelated docs are rewritten.
- **Supports:** R1, R2, R5, AC1, AC2.
- **Context:** `docs/product-boundaries.md` currently links to `specs/projection-schema.md`. A single additional sentence or link may be enough.

### Wave 3 (after Waves 1-2)

#### Task: Verification and scope review

- **Files:** No production files. Update workflow evidence later during verification.
- **Changes:** Verify that the docs satisfy R1-R6 and AC1-AC5, run lightweight formatting/grep checks, and inspect `git diff` for scope creep. Suggested checks: `rg -n "control-plane|telemetry-plane|KontourEmitter|LocalFileSink|CompositeSink|HttpApiSink|Otel|OpenTelemetry|fanout|delivery result|at-least-once|dedupe|descriptor|execute|endpoint|command|externalUrl|local-first" docs/specs docs/product-boundaries.md README.md`; `git diff -- docs README.md .agents/flow-agents/define-emitter-sink-plane-contract`; optionally `npm test` only if docs links/examples are touched in a way that could affect fixture tests.
- **Acceptance:** Verification records doc-inspection evidence for each AC, security review notes for command/URL/endpoint/path language, and scope evidence that no hosted API/client, HTTP/OTLP/network sink, emitter code, integration, or UI was added.
- **Supports:** R1, R2, R3, R4, R5, R6, AC1, AC2, AC3, AC4, AC5.
- **Context:** This is docs-only work, so verification is primarily inspection plus scope diff. If `npm test` is not run, record it as not required unless production fixtures changed.

## Verification Expectations

- Inspect `docs/specs/emitter-sink-plane-contract.md` for preserved R1-R6 and AC1-AC5 coverage.
- Run a targeted `rg` check over docs for the key contract vocabulary and security-sensitive terms.
- Review `git diff -- docs README.md .agents/flow-agents/define-emitter-sink-plane-contract` to confirm scope is docs/spec plus workflow artifacts only.
- Perform a security-focused doc review for action descriptors, URLs, endpoints, commands, fanout, future network sinks, and local path handling.
- Do not require runtime tests unless implementation files, examples, or inspector-visible fixtures are unexpectedly changed.
