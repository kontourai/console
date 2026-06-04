# Fully Type Console Foundation Internals

## Context

The console package split moves source ownership toward TypeScript-only packages:
`console-core`, `console-server`, and `console-ui`.

To keep that split reviewable, legacy foundation internals migrated into
`console-server/src/console-foundation/`, `console-server/bin/`, and
`console-server/test/` may temporarily use `// @ts-nocheck`. That is a
migration bridge, not the desired final state.

## Goal

Remove temporary `// @ts-nocheck` coverage from the legacy console foundation
internals and tests by adding proper TypeScript types at the server/domain
boundary.

## Acceptance Criteria

- No `// @ts-nocheck` remains in `console-server/src/console-foundation/`,
  `console-server/bin/`, or `console-server/test/`.
- Foundation APIs have useful exported types for records, validation issues,
  inspection reports, delivery results, sinks, local hub options, and current
  operating state projection.
- `console-server` typecheck runs with strict checks enabled for migrated source
  and tests.
- Existing root commands remain green: `npm run typecheck`, `npm test`,
  `npm run inspect:fixtures`.
- No runtime behavior changes beyond type-safety fixes.

## Notes

Do this after the package split lands. Keeping it separate avoids turning the
package migration into a broad foundation rewrite.
