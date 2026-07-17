import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveToolReliability,
  formatLatencyMs,
  formatFailureRate,
  failureTone,
  failureBarWidth
} from "../src/sections/telemetry/toolReliabilityDerive";
import type {
  ConsoleTelemetryToolReliability,
  ConsoleTelemetryToolReliabilitySummary
} from "../src/serverApiTypes";

function tool(opts: Partial<ConsoleTelemetryToolReliability> & { toolName: string }): ConsoleTelemetryToolReliability {
  return {
    actionClass: "other",
    count: 0,
    p50DurationMs: null,
    p95DurationMs: null,
    failureRate: 0,
    failCount: 0,
    passCount: 0,
    ambiguousCount: 0,
    ...opts
  };
}

test("deriveToolReliability caps rows and preserves server order", () => {
  const summary: ConsoleTelemetryToolReliabilitySummary = {
    tools: Array.from({ length: 20 }, (_u, i) => tool({ toolName: `t${i}`, count: 20 - i, passCount: 1 }))
  };
  const { rows } = deriveToolReliability(summary, 12);
  assert.equal(rows.length, 12, "capped to limit");
  assert.equal(rows[0].toolName, "t0", "server order preserved");
});

test("deriveToolReliability reports hasSignal only when latency or outcome exists", () => {
  // Bare counts, no duration and no pass/fail/ambiguous → not yet.
  assert.equal(deriveToolReliability({ tools: [tool({ toolName: "Read", count: 3 })] }).hasSignal, false);
  // An outcome present → signal.
  assert.equal(deriveToolReliability({ tools: [tool({ toolName: "Read", count: 3, passCount: 1 })] }).hasSignal, true);
  // A latency present (even with no outcome) → signal.
  assert.equal(deriveToolReliability({ tools: [tool({ toolName: "Read", count: 3, p50DurationMs: 12 })] }).hasSignal, true);
});

test("deriveToolReliability tolerates a missing summary", () => {
  const view = deriveToolReliability(undefined);
  assert.deepEqual(view.rows, []);
  assert.equal(view.hasSignal, false);
});

test("deriveToolReliability marks hasFailureSignal false when denom==0 (only ambiguous/unlabeled), even with real latency — never a reassuring 0%", () => {
  const { rows } = deriveToolReliability({
    tools: [
      tool({ toolName: "Grep", count: 5, p50DurationMs: 40, p95DurationMs: 90, ambiguousCount: 5, passCount: 0, failCount: 0, failureRate: 0 })
    ]
  });
  assert.equal(rows[0].hasFailureSignal, false, "denom==0 (0 pass + 0 fail) → no failure signal, distinct from a true 0%");
  assert.equal(rows[0].p50DurationMs, 40, "latency still surfaced — it is real data");
  assert.equal(rows[0].p95DurationMs, 90);
});

test("deriveToolReliability marks hasFailureSignal true once at least one pass or fail exists", () => {
  const passOnly = deriveToolReliability({ tools: [tool({ toolName: "Edit", passCount: 1 })] }).rows[0];
  assert.equal(passOnly.hasFailureSignal, true);
  const failOnly = deriveToolReliability({ tools: [tool({ toolName: "Edit", failCount: 1 })] }).rows[0];
  assert.equal(failOnly.hasFailureSignal, true);
});

test("formatLatencyMs renders ms / seconds / minutes and null as an em dash", () => {
  assert.equal(formatLatencyMs(0), "0ms");
  assert.equal(formatLatencyMs(820), "820ms");
  assert.equal(formatLatencyMs(1400), "1.4s");
  assert.equal(formatLatencyMs(12000), "12s");
  assert.equal(formatLatencyMs(123000), "2m 3s");
  assert.equal(formatLatencyMs(null), "—");
  assert.equal(formatLatencyMs(undefined), "—");
  assert.equal(formatLatencyMs(-5), "—");
});

test("formatFailureRate never rounds a real failure away to 0%", () => {
  assert.equal(formatFailureRate(0), "0%");
  assert.equal(formatFailureRate(0.004), "<1%", "small but real → <1%, not 0%");
  assert.equal(formatFailureRate(0.25), "25%");
  assert.equal(formatFailureRate(1), "100%");
});

test("failureTone escalates green → amber → red", () => {
  assert.equal(failureTone(0), "good");
  assert.equal(failureTone(0.05), "good");
  assert.equal(failureTone(0.1), "caution");
  assert.equal(failureTone(0.2), "bad");
  assert.equal(failureTone(0.9), "bad");
});

test("failureBarWidth keeps 0 empty but gives any real rate a visible sliver", () => {
  assert.equal(failureBarWidth(0), 0);
  assert.equal(failureBarWidth(0.001), 2, "tiny rate floored to a 2% sliver");
  assert.equal(failureBarWidth(0.5), 50);
  assert.equal(failureBarWidth(2), 100, "clamped to 100%");
});
