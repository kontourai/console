import assert from "node:assert/strict";
import test from "node:test";
import { deriveFocusMap, UNATTRIBUTED_PROJECT } from "../src/sections/telemetry/focus";
import type { ConsoleTelemetryRecentEvent } from "../src/serverApiTypes";

let seq = 0;
function ev(overrides: Partial<ConsoleTelemetryRecentEvent> = {}): ConsoleTelemetryRecentEvent {
  seq += 1;
  return { eventId: `e${seq}`, sourceId: "src", eventType: "tool.invoke", ...overrides };
}

test("deriveFocusMap returns [] for empty/undefined/null", () => {
  assert.deepEqual(deriveFocusMap([]), []);
  assert.deepEqual(deriveFocusMap(undefined), []);
  assert.deepEqual(deriveFocusMap(null), []);
});

test("deriveFocusMap groups by project with counts, sessions, tools, lastAt", () => {
  const focus = deriveFocusMap([
    ev({ project: "kontourai-io", sessionId: "s1", toolName: "execute_bash", observedAt: "2026-07-12T01:00:00Z" }),
    ev({ project: "kontourai-io", sessionId: "s1", toolName: "execute_bash", observedAt: "2026-07-12T02:00:00Z" }),
    ev({ project: "kontourai-io", sessionId: "s2", toolName: "fs_read", observedAt: "2026-07-12T03:00:00Z" }),
    ev({ project: "mqtt-recorder", sessionId: "s3", toolName: "fs_read", observedAt: "2026-07-12T00:30:00Z" }),
  ]);

  assert.equal(focus.length, 2);
  // Most active project first.
  assert.equal(focus[0].project, "kontourai-io");
  assert.equal(focus[0].unattributed, false);
  assert.equal(focus[0].eventCount, 3);
  assert.equal(focus[0].sessionCount, 2);
  assert.deepEqual(focus[0].tools, [
    { name: "execute_bash", count: 2 },
    { name: "fs_read", count: 1 },
  ]);
  assert.equal(focus[0].lastAt, "2026-07-12T03:00:00Z");

  assert.equal(focus[1].project, "mqtt-recorder");
  assert.equal(focus[1].eventCount, 1);
});

test("deriveFocusMap picks the max observedAt regardless of arrival order (Date.parse, not string order)", () => {
  const focus = deriveFocusMap([
    ev({ project: "p", observedAt: "2026-07-12T05:00:00.000Z" }),
    ev({ project: "p", observedAt: "2026-07-12T05:00:00Z" }), // earlier same instant, different precision
    ev({ project: "p", observedAt: "2026-07-12T04:59:00Z" }),
  ]);
  assert.equal(focus[0].lastAt, "2026-07-12T05:00:00.000Z");
});

test("deriveFocusMap attributes a missing/blank project to 'unattributed' and flags it", () => {
  const focus = deriveFocusMap([ev({ toolName: "execute_bash" }), ev({ project: "  " })]);
  assert.equal(focus.length, 1);
  assert.equal(focus[0].project, UNATTRIBUTED_PROJECT);
  assert.equal(focus[0].unattributed, true);
  assert.equal(focus[0].eventCount, 2);
  assert.equal(focus[0].sessionCount, 0);
  assert.equal(focus[0].lastAt, undefined);
});

test("deriveFocusMap groups non-blank projects by their RAW (untrimmed) value to match server-side filtering", () => {
  const focus = deriveFocusMap([ev({ project: " spaced " }), ev({ project: " spaced " })]);
  assert.equal(focus.length, 1);
  assert.equal(focus[0].project, " spaced ");
  assert.equal(focus[0].unattributed, false);
});
