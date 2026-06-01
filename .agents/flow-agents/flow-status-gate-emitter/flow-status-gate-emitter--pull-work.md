---
role: pull-work
issue: 8
created: 2026-06-01
---

# Add Flow Process Gate Status Emitter Example

Issue: https://github.com/kontourai/kontour-console/issues/8

## Selection Rationale

The Surface producer helper proved current claim/freshness emission and local Console querying. The next useful slice is the matching Flow helper pattern: current process/gate status, gate transition events, and inert next actions. This keeps the Console producer contract concrete before introducing Campfit-specific extension mapping or a UI.

## Scope Summary

- Add a dependency-free Flow helper/example module.
- Export Flow projection/event helper functions and a current Flow status query helper.
- Prove local `KontourEmitter` + `LocalFileSink` round trip through `inspectLocalKontour()`.
- Document helper-only semantics and explicit non-execution of Flow run control/actions.

## Ready For Planning

- Existing fixtures cover Flow route-back event vocabulary.
- Existing validators cover `processes[]`, `gates[]`, refs, actions, and projection/event envelopes.
- Existing Surface helper and tests provide implementation pattern.
