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

test("deriveFocusMap groups by project with counts, sessions, files, tools, lastAt", () => {
  const focus = deriveFocusMap([
    ev({ project: "kontourai-io", sessionId: "s1", toolName: "execute_bash", path: "a.ts", observedAt: "2026-07-12T01:00:00Z" }),
    ev({ project: "kontourai-io", sessionId: "s1", toolName: "execute_bash", observedAt: "2026-07-12T02:00:00Z" }),
    ev({ project: "kontourai-io", sessionId: "s2", toolName: "fs_read", path: "b.ts", observedAt: "2026-07-12T03:00:00Z" }),
    ev({ project: "mqtt-recorder", sessionId: "s3", toolName: "fs_read", path: "c.ts", observedAt: "2026-07-12T00:30:00Z" }),
  ]);

  assert.equal(focus.length, 2);
  // Most active project first.
  assert.equal(focus[0].project, "kontourai-io");
  assert.equal(focus[0].eventCount, 3);
  assert.equal(focus[0].sessionCount, 2);
  assert.deepEqual(focus[0].files, ["a.ts", "b.ts"]);
  assert.deepEqual(focus[0].tools, [
    { name: "execute_bash", count: 2 },
    { name: "fs_read", count: 1 },
  ]);
  assert.equal(focus[0].lastAt, "2026-07-12T03:00:00Z");

  assert.equal(focus[1].project, "mqtt-recorder");
  assert.equal(focus[1].eventCount, 1);
  assert.deepEqual(focus[1].files, ["c.ts"]);
});

test("deriveFocusMap attributes a missing/blank project to 'unattributed'", () => {
  const focus = deriveFocusMap([ev({ toolName: "execute_bash" }), ev({ project: "  " })]);
  assert.equal(focus.length, 1);
  assert.equal(focus[0].project, UNATTRIBUTED_PROJECT);
  assert.equal(focus[0].eventCount, 2);
  assert.equal(focus[0].sessionCount, 0);
  assert.deepEqual(focus[0].files, []);
  assert.equal(focus[0].lastAt, undefined);
});
