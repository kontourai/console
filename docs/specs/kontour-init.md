---
title: Kontour Init
description: Inspect, plan, and explicitly apply product-owned repository and harness onboarding.
---

# Kontour Init

`kontour init` is a suite-level onboarding transaction planner. It shows how a repository would be configured and delegates approved actions to the product that owns them. It does not implement Flow Agents runtime, provider, power, doctor, or kit semantics.

Use exact, explicitly installed product roots. The initial released contract pins `@kontourai/cli@0.2.0`, `@kontourai/console@2.5.0`, `@kontourai/flow-agents@3.8.0`, and `@kontourai/flow@3.1.4`.

```sh
kontour --product-root=flow-agents=/absolute/path/to/node_modules/@kontourai/flow-agents \
  init --inspect --json

kontour --product-root=flow-agents=/absolute/path/to/node_modules/@kontourai/flow-agents \
  init --plan --runtime codex --kit builder --json

kontour --product-root=flow-agents=/absolute/path/to/node_modules/@kontourai/flow-agents \
  init --apply --runtime codex --kit builder --plan-id <sha256> --yes --json
```

Exactly one of `--inspect`, `--plan`, or `--apply` is required. All modes support JSON. Plan output is deterministic for the same repository, desired state, and exact product version.

## No implicit kits

The desired kit list defaults to empty. A plan without `--kit` passes no kit activation flags to Flow Agents. Builder is activated only when the caller explicitly supplies `--kit builder`. Kontour does not maintain its own kit catalog or infer a kit from the repository.

## Consent and mutation

Inspect delegates only released read-only Flow Agents diagnostics (`telemetry-doctor` and `kit status`) and preserves their structured output and exit status. Plan performs no product delegation and writes nothing: the approved plan id is emitted on stdout. Apply recomputes the plan from the same explicit runtime and kit inputs plus live canonical repository/package state; saved plan files and output paths are deliberately unsupported.

Apply requires the SHA-256 plan id and `--yes`. Before delegation it recomputes the canonical repository identity; the exact `process.execPath` interpreter identity and bytes; and deterministic content digests for every realpath-identified Flow Agents package instance plus its actually loadable dependency, optional-dependency, and peer-dependency graph, including Flow. Duplicate package names at different realpaths/versions remain distinct graph nodes. Verified package instances are copied into a self-contained private store, rehashed, and connected only with internally generated links that reproduce the approved topology. The verified Node binary is copied too and invoked directly with the JavaScript entrypoint, so neither shebang resolution nor `PATH` selects the interpreter. All private material is removed in `finally`.

Immediately before the first action, Kontour enters the canonical repository directory and compares `.` to the already-open directory descriptor. Delegated children inherit that held cwd without a new pathname lookup, so a later rename cannot redirect subsequent actions into a replacement directory. Every action identifies its product owner, literal argv vector, side-effect class, expected paths, postcondition, and recovery instruction. Delegation uses an argv array and no shell.

Actions run in order. A failure stops the sequence: later actions are `not_run`, and the result includes recovery instructions for actions that actually ran. Kontour performs no automatic rollback, does not claim a cross-product transaction, and does not delete unknown files. Follow Flow Agents-owned lifecycle guidance and restore only material whose provenance you have independently confirmed.

## Product-owned gaps

Flow Agents owns unified doctor findings, provider discovery/settings, runtime detection, policy settings, powers/MCP registration, tokens, kit catalog behavior, and validators. Until those capabilities are exposed by a compatible released Flow Agents descriptor, inspect reports them as unsupported or not verified with their upstream issue references. Console does not substitute its own checks or writers.

Public npm bootstrap verification remains required whenever the exact `@kontourai/cli` release is not registry-visible. A local packed-package E2E is useful implementation evidence but is not a substitute for that release check.
