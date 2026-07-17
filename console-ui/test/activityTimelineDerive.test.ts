import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveActivityTimeline,
  formatBucketLabel,
  timelineWindowLabel,
  TIMELINE_WINDOW_CAP
} from "../src/sections/telemetry/activityTimelineDerive";
import type { ConsoleTelemetryActivityTimeline } from "../src/serverApiTypes";

function timeline(
  buckets: ConsoleTelemetryActivityTimeline["buckets"],
  bucket: "hour" | "day" = "hour"
): ConsoleTelemetryActivityTimeline {
  return { bucket, buckets };
}

test("deriveActivityTimeline flattens buckets to per-class points and totals actions", () => {
  const view = deriveActivityTimeline(
    timeline([
      { startedAt: "2026-07-14T00:00:00.000Z", total: 3, byActionClass: { edit: 2, read: 0, search: 1, execute: 0, web: 0, delegate: 0, other: 0 } },
      { startedAt: "2026-07-14T01:00:00.000Z", total: 1, byActionClass: { edit: 0, read: 0, search: 0, execute: 1, web: 0, delegate: 0, other: 0 } }
    ])
  );
  assert.equal(view.points.length, 2);
  assert.equal(view.points[0].edit, 2);
  assert.equal(view.points[0].search, 1);
  assert.equal(view.points[0].total, 3);
  assert.equal(view.points[1].execute, 1);
  assert.equal(view.totalActions, 4);
  assert.deepEqual(view.classes, ["edit", "search", "read", "execute", "web", "delegate", "other"]);
});

test("deriveActivityTimeline zero-fills every class key for a stable chart shape", () => {
  const view = deriveActivityTimeline(
    timeline([{ startedAt: "2026-07-14T00:00:00.000Z", total: 1, byActionClass: { edit: 1 } as never }])
  );
  const p = view.points[0];
  for (const key of ["edit", "read", "search", "execute", "web", "delegate", "other"] as const) {
    assert.equal(typeof p[key], "number", `${key} is a number`);
  }
  assert.equal(p.read, 0);
});

test("deriveActivityTimeline tolerates a missing timeline", () => {
  const view = deriveActivityTimeline(undefined);
  assert.deepEqual(view.points, []);
  assert.equal(view.totalActions, 0);
});

test("formatBucketLabel handles hourly, daily, and unparseable timestamps", () => {
  assert.equal(formatBucketLabel("not-a-date", "hour"), "");
  assert.match(formatBucketLabel("2026-07-14T09:00:00.000Z", "hour"), /\d/);
  assert.match(formatBucketLabel("2026-07-14T09:00:00.000Z", "day"), /\w/);
});

test("deriveActivityTimeline discloses the fixed display window so truncated history is not silently implied complete", () => {
  const view = deriveActivityTimeline(
    timeline([{ startedAt: "2026-07-14T00:00:00.000Z", total: 1, byActionClass: { edit: 1, read: 0, search: 0, execute: 0, web: 0, delegate: 0, other: 0 } }])
  );
  assert.match(view.windowLabel, new RegExp(String(TIMELINE_WINDOW_CAP)), "discloses the window cap");
  assert.match(view.windowLabel, /hour/i);
});

test("timelineWindowLabel names the bucket unit for hour vs day", () => {
  assert.match(timelineWindowLabel("hour"), /hours, bucketed hourly/);
  assert.match(timelineWindowLabel("day"), /days, bucketed daily/);
  assert.match(timelineWindowLabel("hour", 48), /48 hours/, "custom cap is reflected");
});
