# Implement local and composite sink skeleton

branch: main
worktree: /Users/brian/dev/github/kontourai/kontour-console
created: 2026-06-01
status: selected
type: pull-work

## board_snapshot

- Provider: GitHub Issues in `kontourai/kontour-console`.
- Board source: GitHub Issues plus milestone state. No repository helper such as `scripts/effective-backlog-settings.py` is present in this small package.
- Filters used: issue `#5`, milestone `Kontour Console Producer Contract`.
- Selected item: `#5 Implement local and composite sink skeleton`, state `OPEN`, URL `https://github.com/kontourai/kontour-console/issues/5`.
- Milestone: `Kontour Console Producer Contract`, GitHub milestone #2, open.
- Labels: none.
- Blockers: `#4 Define Kontour emitter, sink, and plane contracts` is `CLOSED`, so the stated dependency is satisfied.

## wip_assessment

- Local branch: `main`.
- Local status: clean before selection.
- Open PRs authored by current user: none.
- Local worktrees: only the main checkout at `/Users/brian/dev/github/kontourai/kontour-console`.
- Active sidecars: completed V0 contract/foundation sidecars exist; no dirty local implementation sidecar is active for this issue.
- Start-new-work decision: `proceed`.

## my_active_work

- No open PRs by the current user.
- No dirty worktrees.
- No unpublished implementation changes at selection time.

## shepherding_candidates

- None.

## stale_worktrees

- None.

## open_prs_by_me

- None from `gh pr list --author @me`.

## global_conflicts

- No open PR overlap was identified during pull selection.
- Expected files overlap only with existing local package internals: `src/console-foundation/index.js`, `test/console-foundation.test.js`, `README.md`, and possibly docs under `docs/specs/`.

## dependency_impacts

- `#5` depends on `#4`; `#4` is closed and `docs/specs/emitter-sink-plane-contract.md` is present.
- Completing `#5` unlocks future producer adapters and prevents product repos from hand-writing incompatible file emitters.

## start_new_work_decision

`proceed`: dependency is closed, workspace is clean, no open personal PR needs shepherding, and the issue is a bounded implementation slice.

## selection

- Selected issue: `#5 Implement local and composite sink skeleton`.
- Rationale: next thinnest implementation slice after the emitter/sink/plane contract. It creates the local-first producer write boundary without API, OTLP, product adapter, hosted ingestion, or UI scope.
- Priority: high within the `Kontour Console Producer Contract` milestone because it turns the contract into reusable code and test evidence.

## grouping_check

- Grouping decision: `single-item`.
- Bundle justification: none. The issue is already the thinnest meaningful slice.
- Split/keep decision: keep as one item because emitter, local sink, composite sink, and tests are one usable producer boundary.

## anchor

Objective: implement a dependency-free `KontourEmitter`, `LocalFileSink`, `CompositeSink`, and in-memory test sink so one semantic control record can be delivered to local JSONL/current projection files and another sink with independent delivery results.

Authoritative sources:

- GitHub issue `#5`.
- `docs/specs/emitter-sink-plane-contract.md`.
- `docs/specs/projection-schema.md`.
- Existing loader/inspector in `src/console-foundation/index.js`.

Non-goals:

- Real HTTP/API network sink.
- Real OTLP exporter.
- Background retries, durable outbox, auth, hosted ingestion.
- Product adapters or Campfit integration.
- UI.

Done criteria:

- `node --test` passes.
- Fixture inspector command still passes.
- Forbidden API scan passes for no `child_process`, command execution, URL open/fetch, or network imports.
- Code and security review pass.
- README or docs show local plus future API fanout concept without implementing API.

## work_scope

Allowed files/areas:

- `src/console-foundation/index.js` or a small sibling module under `src/console-foundation/`.
- `test/console-foundation.test.js` or focused new tests under `test/`.
- `README.md` and/or docs snippets.
- `.agents/flow-agents/implement-local-composite-sink-skeleton/` workflow artifacts.

Risky areas:

- File path safety for `.kontour/` writes.
- Preserving projection identity without using `generatedAt` as a dedupe key.
- Ensuring action descriptors remain inert data.
- Avoiding accidental network/API/Otel scope creep.

## worktree_decision

- sandbox_mode: `local-edit`.
- Worktree used: no.
- Rationale: repo is small, workspace is clean, and the selected item has a narrow file set. A separate worktree would add overhead without reducing meaningful conflict risk.

## worktree_lifecycle

- path: `/Users/brian/dev/github/kontourai/kontour-console`.
- branch: `main`.
- retain_until: work merged/pushed and issue closed.
- cleanup_owner: orchestrator.
- cleanup_command: none, because no extra worktree is created.
- cleanup_blocked_by: none.

## pickup_gate

- Status: pass.
- Reason: issue is shaped, dependency is closed, acceptance criteria are concrete, and local workspace is clean.

## handoff

Recommended `plan-work` prompt:

> Plan implementation for GitHub issue #5 in `/Users/brian/dev/github/kontourai/kontour-console`: add a dependency-free Kontour emitter plus local and composite sink skeleton. Preserve the #4 emitter/sink/plane contract, including required `recordId` delivery results and projection identity not based on `generatedAt`. Scope is local JSONL/current projection writes under safe `.kontour/` paths, composite fanout with per-sink results, in-memory test sink, tests for event fanout/projection loader compatibility/failure result shape/action descriptor inertness, and README/docs usage. Do not implement HTTP/API, OTLP, product adapters, background retries, auth, hosted ingestion, or UI.

Acceptance criteria to preserve:

- AC1: A test emits one control event through `CompositeSink([LocalFileSink, InMemorySink])` and verifies the same `event.id` reaches both sinks.
- AC2: A test emits one projection snapshot through the local sink and verifies it can be read by the existing inspector/loader.
- AC3: Per-sink delivery result includes sink id/name, status, and error details when simulated failure occurs.
- AC4: Security/scope scan finds no `child_process`, command execution, URL open/fetch, or network imports.
- AC5: README or docs show local+future API fanout concept without implementing the API.

## builder_kit_handoff

- probe_status: `accepted_gap`
- probe_artifact_ref: `.agents/flow-agents/implement-local-composite-sink-skeleton/implement-local-composite-sink-skeleton--pull-work.md`
- selected_item_ids: `github:kontourai/kontour-console#5`
- grouping_decision: `single-item`
- accepted_gaps: direct primitive workflow was requested; no separate Builder Kit pickup Probe was run.
- route_reason: user asked to continue implementation after selecting this issue.
- next_action: delegate to `tool-planner` via `plan-work`.
