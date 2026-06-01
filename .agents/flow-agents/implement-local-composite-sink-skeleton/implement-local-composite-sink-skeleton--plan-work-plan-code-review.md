---
role: code-review
parent: implement-local-composite-sink-skeleton--plan-work-plan.md
created: 2026-06-01T00:00:00-06:00
verdict: CHANGES_REQUESTED
---

## Code Review

Files reviewed: 6
Findings: 1 HIGH

### Findings

#### [HIGH] src/console-foundation/emitter.js:127 - CompositeSink records async child sinks as accepted before they settle
`CompositeSink.deliver` synchronously maps child sinks and immediately normalizes each return value:

```js
const childResults = this.sinks.map((sink, index) => {
  try {
    return normalizeChildResult(sink.deliver(record), sink, index, classified);
  } catch (error) {
```

`normalizeChildResult` then treats any object without delivery fields as an accepted result:

```js
return formatDeliveryResult({
  sinkId: result.sinkId || sink.sinkId || sink.id || `sink-${index}`,
  sinkRole: result.sinkRole || sink.sinkRole || sink.name || "sink",
  outcome: result.outcome || result.status || "accepted",
```

A Promise returned by a child sink is an object with no `outcome`, so the composite reports `accepted` immediately, omits the actual child delivery result, and never captures async rejection. That breaks the fanout contract that every child sink returns an independent delivery result and that failures remain visible. It is especially risky for the planned future `HttpApiSink`/telemetry sinks, which are naturally async, and it means `KontourEmitter.emit()` resolving a composite result does not actually prove fanout completed.

The tests only cover synchronous `LocalFileSink`, `InMemorySink`, and a synchronous throwing stub (`test/emitter-sinks.test.js:57`), so this regression is not caught. Add async child sink coverage for both resolve and reject paths, and make `CompositeSink.deliver` either consistently async/await child results or explicitly reject async sinks at construction/delivery time so it cannot falsely report `accepted`.

### Verdict: CHANGES_REQUESTED
Fix async child result handling or explicitly disallow async sinks before treating the composite delivery result as contract-compatible.
