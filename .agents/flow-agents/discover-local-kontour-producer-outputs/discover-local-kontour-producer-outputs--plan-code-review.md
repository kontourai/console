---
role: code-review
parent: discover-local-kontour-producer-outputs--plan.md
created: 2026-06-01T20:38:07Z
verdict: CHANGES_REQUESTED
---

## Code Review

Files reviewed: 7
Findings: 1 HIGH, 1 MEDIUM

### Findings

#### [HIGH] src/console-foundation/index.js:39 - Relative `kontourRoot` ignores the supplied `rootDir`
`inspectLocalKontour` defaults to `rootDir/.kontour`, but when callers pass a relative `kontourRoot` it is resolved against `process.cwd()` through `path.resolve(kontourRoot)`, not against the supplied `rootDir`. The subsequent reads also use the raw relative `kontourRoot`:

```js
const rootDir = options.rootDir || process.cwd();
const kontourRoot = options.kontourRoot || options.localRoot || path.join(rootDir, LOCAL_KONTOUR_DIR);
const sourceRoot = path.resolve(kontourRoot);
const eventStreams = loadEventStreams(path.join(kontourRoot, "events"), sourceRoot, {
```

This breaks the programmatic contract documented in `README.md:74-83` for callers inspecting a project root other than the current process directory, and it can silently read an unrelated `.kontour` tree. For example, `inspectLocalKontour({ rootDir: "/tmp/project", kontourRoot: ".kontour" })` inspects `<cwd>/.kontour`, while the rest of the API shape implies `/tmp/project/.kontour`. Normalize relative explicit roots against `rootDir`, then use the resolved root for both containment and read paths.

#### [MEDIUM] test/emitter-sinks.test.js:55 - Local discovery tests do not cover nested producer output paths
The implementation is intended to discover `.kontour/events/**/*.jsonl` and `.kontour/projections/**/*.json` recursively, but the end-to-end tests only assert that a single stream/projection is found and the relative path starts with the top-level directory:

```js
assert.equal(report.eventStreams.length, 1);
assert.match(report.eventStreams[0].relativePath, /^events\//);
```

`LocalFileSink` currently writes nested producer paths, but the assertions would still pass if discovery only read one nested producer directory or missed deeper producer/scope layouts. Add assertions for the actual nested relative paths, such as `events/<producer>/<scope-kind>-<scope-id>.jsonl` and `projections/<producer>/<scope-kind>-<scope-id>.json`, or add a manual deeper fixture under a temp `.kontour` tree. This protects the explicit recursive discovery requirement and the stop-short risk called out in the plan.

### Verdict: CHANGES_REQUESTED
Fix relative custom root resolution and strengthen recursive path coverage before merge.
