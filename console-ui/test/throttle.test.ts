import assert from "node:assert/strict";
import test from "node:test";
import { Throttle } from "../src/utils/throttle";

// console#252: the pure throttle backing SSE-triggered telemetry/economics
// refetches (App.tsx / hooks/useThrottledRefresh.ts) — "min 1-2s between
// refetches" per the acceptance criteria. Tested with an injectable clock so
// it's fully deterministic (no real timers, no jsdom/testing-library).

function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

test("Throttle: fires immediately on the first trigger", () => {
  const clock = fakeClock();
  const throttle = new Throttle(1000, clock.now);
  assert.equal(throttle.shouldFireNow(), true);
});

test("Throttle: a second trigger inside the window is coalesced (does not fire now)", () => {
  const clock = fakeClock();
  const throttle = new Throttle(1000, clock.now);
  assert.equal(throttle.shouldFireNow(), true);
  clock.advance(400);
  assert.equal(throttle.shouldFireNow(), false);
});

test("Throttle: msUntilReady reports the remaining window, clamped to 0", () => {
  const clock = fakeClock();
  const throttle = new Throttle(1000, clock.now);
  assert.equal(throttle.shouldFireNow(), true);
  clock.advance(400);
  assert.equal(throttle.msUntilReady(), 600);
  clock.advance(1000);
  assert.equal(throttle.msUntilReady(), 0);
});

test("Throttle: fires again once the window has fully elapsed", () => {
  const clock = fakeClock();
  const throttle = new Throttle(1000, clock.now);
  assert.equal(throttle.shouldFireNow(), true);
  clock.advance(999);
  assert.equal(throttle.shouldFireNow(), false);
  clock.advance(1);
  assert.equal(throttle.shouldFireNow(), true);
});

test("Throttle: markFired resets the window from an externally-scheduled trailing fire", () => {
  const clock = fakeClock();
  const throttle = new Throttle(1000, clock.now);
  assert.equal(throttle.shouldFireNow(), true);
  clock.advance(200);
  assert.equal(throttle.shouldFireNow(), false); // coalesced — caller schedules a trailing timer
  clock.advance(800); // trailing timer fires at the 1000ms mark
  throttle.markFired();
  clock.advance(1);
  assert.equal(throttle.shouldFireNow(), false); // window restarted by the trailing fire
  clock.advance(999);
  assert.equal(throttle.shouldFireNow(), true);
});
