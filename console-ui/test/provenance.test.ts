import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveProvenance, isProvenanceEmpty } from "../src/sections/telemetry/provenance";
import type { ConsoleTelemetrySourceSummary } from "../src/serverApiTypes";

function source(opts: Partial<ConsoleTelemetrySourceSummary> & { id: string }): ConsoleTelemetrySourceSummary {
  return { recordCount: 0, ...opts };
}

test("deriveProvenance ranks sources by recordCount desc and totals records", () => {
  const summary = deriveProvenance(
    [
      source({ id: "b", recordCount: 5, kind: "jsonl", path: "/b" }),
      source({ id: "a", recordCount: 20, kind: "jsonl", path: "/a" }),
      source({ id: "c", recordCount: 5, kind: "sqlite" })
    ],
    { "tool.invoke": 100 }
  );
  assert.equal(summary.sourceCount, 3);
  assert.equal(summary.totalRecords, 30);
  // recordCount desc, ties broken by id asc
  assert.deepEqual(summary.sources.map((s) => s.id), ["a", "b", "c"]);
});

test("deriveProvenance folds raw event-type counts, dropping empties, sorted desc", () => {
  const summary = deriveProvenance(
    [source({ id: "a", recordCount: 1 })],
    { "tool.result": 40, "tool.invoke": 40, "session.usage": 3, "agent.delegate": 0 }
  );
  // zero-count dropped; ties broken by type asc
  assert.deepEqual(summary.eventTypes.map((e) => e.type), ["tool.invoke", "tool.result", "session.usage"]);
  assert.deepEqual(summary.eventTypes.map((e) => e.count), [40, 40, 3]);
});

test("deriveProvenance caps sources at 12 and event types at 8", () => {
  const manySources = Array.from({ length: 20 }, (_unused, i) =>
    source({ id: `s${String(i).padStart(2, "0")}`, recordCount: 100 - i })
  );
  const manyEvents: Record<string, number> = {};
  for (let i = 0; i < 15; i += 1) manyEvents[`evt.${i}`] = 100 - i;
  const summary = deriveProvenance(manySources, manyEvents);
  assert.equal(summary.sources.length, 12, "sources capped");
  assert.equal(summary.eventTypes.length, 8, "event types capped");
  assert.equal(summary.sourceCount, 20, "count reflects all sources, not the capped list");
  assert.equal(summary.totalRecords, manySources.reduce((s, x) => s + x.recordCount, 0), "total spans all sources");
  // Overflow is surfaced so the view can render an honest "+N more" hint.
  assert.equal(summary.hiddenSourceCount, 8, "20 sources − 12 shown");
  assert.equal(summary.hiddenEventTypeCount, 7, "15 event types − 8 shown");
});

test("deriveProvenance reports zero overflow when nothing is truncated", () => {
  const summary = deriveProvenance(
    [source({ id: "a", recordCount: 3 }), source({ id: "b", recordCount: 1 })],
    { "tool.invoke": 2, "tool.result": 2 }
  );
  assert.equal(summary.hiddenSourceCount, 0, "both sources shown → no overflow");
  assert.equal(summary.hiddenEventTypeCount, 0, "both event types shown → no overflow");
});

test("deriveProvenance tolerates missing/undefined inputs", () => {
  const summary = deriveProvenance(undefined, undefined);
  assert.equal(summary.sourceCount, 0);
  assert.equal(summary.totalRecords, 0);
  assert.deepEqual(summary.sources, []);
  assert.deepEqual(summary.eventTypes, []);
  assert.equal(isProvenanceEmpty(summary), true, "empty when no sources and no event types");
});

test("isProvenanceEmpty is false when only event types are present", () => {
  const summary = deriveProvenance([], { "tool.invoke": 3 });
  assert.equal(summary.sources.length, 0);
  assert.equal(summary.eventTypes.length, 1);
  assert.equal(isProvenanceEmpty(summary), false, "event-type mix alone still renders the footnote");
});
