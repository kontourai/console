# Define Kontour Emitter, Sink, And Plane Contracts

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: pulled
type: pull-work

## board_snapshot

- Provider: GitHub Issues in `kontourai/kontour-console`
- Selected issue: #4 `Define Kontour emitter, sink, and plane contracts`
- Issue URL: https://github.com/kontourai/kontour-console/issues/4
- State: OPEN
- Milestone: `Kontour Console Producer Contract`
- Labels: none
- Related issue: #5 `Implement local and composite sink skeleton`

## wip_assessment

- Local worktree is clean at pickup.
- No uncommitted implementation work is present.
- Prior milestone work is committed and pushed.
- Starting new work is acceptable because #4 is the dependency-unlocking docs/spec slice for #5.

## my_active_work

- Current active selection: #4.
- Existing active artifact root for this work: `.agents/flow-agents/define-emitter-sink-plane-contract/`.

## shepherding_candidates

- None identified before starting #4.

## stale_worktrees

- None inspected beyond the current shared checkout.

## open_prs_by_me

- Not inspected in detail; this repo has been working directly on `main` for early contract work.

## global_conflicts

- No local file conflicts detected.
- #5 is explicitly downstream and should remain blocked until #4 lands unless planning intentionally bundles both.

## dependency_impacts

- #4 unlocks #5 by defining the emitter, sink, fanout, and control/telemetry vocabulary that the implementation should follow.
- Candidate telemetry/Otel ADR and generic `.kontour/` root inspector remain follow-up work, not part of this slice.

## start_new_work_decision

- Decision: `proceed`
- Reason: #4 is open, unblocked, scoped to docs/spec contract work, and unlocks the next executable issue.

## selection

- Selected issue: #4 `Define Kontour emitter, sink, and plane contracts`
- Rationale: It is the smallest dependency-unlocking slice for the Producer Contract milestone.
- Priority: high for current milestone because it prevents product emitters from coupling directly to filesystem-only writes.

## grouping_check

- Grouping decision: single-item
- Split decision: keep #4 separate from #5.
- Bundle justification: not bundled. #4 can deliver value as terminology and contract documentation without code. #5 should consume that contract later.
- Thinnest meaningful slice: docs/spec only defining planes, emitter, sink roles, fanout semantics, local-first fallback, delivery result expectations, and read-only/action authority boundaries.

## anchor

Objective:

Define the producer-side Kontour Console contract for transport-neutral emitters, sinks, control-plane records, telemetry-plane records, multi-sink fanout, local-first fallback, and non-executing action descriptors.

Source artifacts:

- GitHub issue #4: https://github.com/kontourai/kontour-console/issues/4
- Shaping artifact: `.agents/flow-agents/kontour-emitter-sink-boundary/kontour-emitter-sink-boundary--idea-to-backlog.md`
- Existing schema: `docs/specs/projection-schema.md`
- Existing product boundaries: `docs/product-boundaries.md`

Non-goals:

- Implement hosted API.
- Implement HTTP, OTLP, or other network sinks.
- Implement emitter code.
- Integrate products or vertical repos.
- Build UI/dashboard.
- Define retry daemon/outbox beyond minimal contract language.

Done criteria:

- AC1: Docs define control-plane vs telemetry-plane data types and authority boundaries.
- AC2: Docs define `KontourEmitter`, `LocalFileSink`, `CompositeSink`, future `HttpApiSink`, and future telemetry/Otel sink roles.
- AC3: Docs define multi-output fanout with stable event/projection ids and independent per-sink results.
- AC4: Docs define local-first fallback and at-least-once/dedupe semantics.
- AC5: Docs explicitly state no generic sink executes action descriptors, opens URLs, or mutates product state.

## work_scope

Allowed:

- Durable docs under `docs/`, likely `docs/specs/` and/or `docs/adr/`.
- README link only if discoverability requires it.
- Workflow artifacts under `.agents/flow-agents/define-emitter-sink-plane-contract/`.

Risky areas:

- Any production emitter implementation, network client, HTTP sink, OTLP exporter, or action execution path is out of scope.
- Security-sensitive wording around commands, URLs, endpoints, sink fanout, and local file paths must be precise.

## worktree_decision

- Worktree used: no
- Sandbox mode recommendation: `local-edit`
- Rationale: Docs/spec-only work in a clean shared checkout has low conflict risk and no runtime side effects.
- Escalation condition: use a worktree if planning expands scope into implementation or broad refactors.

## handoff

Recommended `plan-work` prompt:

Plan issue #4 in `/Users/brian/dev/github/kontourai/kontour-console`: define the Kontour emitter, sink, and plane contracts. Use GitHub issue https://github.com/kontourai/kontour-console/issues/4 and source artifact `.agents/flow-agents/define-emitter-sink-plane-contract/define-emitter-sink-plane-contract--pull-work.md`. Keep scope docs/spec only. Preserve R1-R6 and AC1-AC5. Do not implement hosted API, HTTP/OTLP/network sinks, emitter code, product integrations, or UI.

## pickup_gate

- Status: pass
- Reason: Issue is open, unblocked, scoped, dependency-unlocking, and ready for planning.
