import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import {
  classifyActivity,
  classifyFleetBucket,
  classifyFreshness,
  deriveFleetCard,
  deriveFleetCards,
  deriveFleetCounts,
  partitionFleet,
  FRESH_THRESHOLD_MS,
  FUTURE_SKEW_TOLERANCE_MS,
  STALL_THRESHOLD_MS,
  type FleetCard,
} from "../src/sections/workers/derive";

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

// ── classifyFreshness ────────────────────────────────────────────────────────

test("classifyFreshness: no updatedAt is unknown, never fabricated as fresh", () => {
  assert.equal(classifyFreshness(undefined), "unknown");
});

test("classifyFreshness: empty string is unknown", () => {
  assert.equal(classifyFreshness(""), "unknown");
});

test("classifyFreshness: a garbage/unparsable string is unknown", () => {
  assert.equal(classifyFreshness("not-a-date"), "unknown");
});

test("classifyFreshness: fresh below FRESH_THRESHOLD_MS", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now).toISOString(), now), "fresh");
  assert.equal(classifyFreshness(new Date(now - (FRESH_THRESHOLD_MS - 1000)).toISOString(), now), "fresh");
});

test("classifyFreshness: idle between FRESH_THRESHOLD_MS and STALL_THRESHOLD_MS", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now - FRESH_THRESHOLD_MS).toISOString(), now), "idle");
  assert.equal(classifyFreshness(new Date(now - (STALL_THRESHOLD_MS - 1000)).toISOString(), now), "idle");
});

test("classifyFreshness: stalled at or beyond STALL_THRESHOLD_MS", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now - STALL_THRESHOLD_MS).toISOString(), now), "stalled");
  assert.equal(classifyFreshness(new Date(now - STALL_THRESHOLD_MS * 12).toISOString(), now), "stalled"); // e.g. "12d ago"
});

// console#251 review finding 2: future/invalid timestamps must never produce a
// false "fresh"/"active" claim.

test("classifyFreshness: a small future timestamp (+2min, ordinary clock skew) is fresh", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now + 2 * 60 * 1000).toISOString(), now), "fresh");
});

test("classifyFreshness: a future timestamp at exactly the skew tolerance is still fresh", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now + FUTURE_SKEW_TOLERANCE_MS).toISOString(), now), "fresh");
});

test("classifyFreshness: a clearly-future timestamp (+24h) is unknown, never fresh — no silent 'ahead of schedule' claim", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now + 24 * 60 * 60 * 1000).toISOString(), now), "unknown");
});

test("classifyFreshness: a future timestamp just beyond the skew tolerance is unknown, not fresh", () => {
  const now = Date.now();
  assert.equal(classifyFreshness(new Date(now + FUTURE_SKEW_TOLERANCE_MS + 1000).toISOString(), now), "unknown");
});

// ── classifyActivity — the freshness+display pairing ────────────────────────

test("classifyActivity: missing or garbage updatedAt never renders a <time> (display 'none')", () => {
  const now = Date.now();
  assert.deepEqual(classifyActivity(undefined, now), { freshness: "unknown", display: "none" });
  assert.deepEqual(classifyActivity("", now), { freshness: "unknown", display: "none" });
  assert.deepEqual(classifyActivity("not-a-date", now), { freshness: "unknown", display: "none" });
});

test("classifyActivity: a clearly-future timestamp is parsable, so it renders as raw text, not a lying relative time", () => {
  const now = Date.now();
  const iso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  assert.deepEqual(classifyActivity(iso, now), { freshness: "unknown", display: "raw" });
});

test("classifyActivity: an ordinary past/near-future timestamp renders relative", () => {
  const now = Date.now();
  assert.equal(classifyActivity(new Date(now - 1000).toISOString(), now).display, "relative");
  assert.equal(classifyActivity(new Date(now + 2 * 60 * 1000).toISOString(), now).display, "relative");
});

// ── classifyFleetBucket ──────────────────────────────────────────────────────

test("classifyFleetBucket: terminal statuses archive regardless of age", () => {
  const now = Date.now();
  const longAgo = new Date(now - STALL_THRESHOLD_MS * 30).toISOString();
  for (const status of ["complete", "completed", "done", "closed", "cancelled", "canceled", "failed"]) {
    assert.equal(classifyFleetBucket(proc({ id: "p", status, updatedAt: longAgo }), now), "archived", status);
  }
});

test("classifyFleetBucket: interactive statuses are waiting-on-you regardless of age", () => {
  const now = Date.now();
  const longAgo = new Date(now - STALL_THRESHOLD_MS * 30).toISOString();
  for (const status of ["paused", "blocked", "waiting", "needs_input", "review_pending"]) {
    assert.equal(classifyFleetBucket(proc({ id: "p", status, updatedAt: longAgo }), now), "waiting-on-you", status);
  }
});

test("classifyFleetBucket: a recently-updated running process is active", () => {
  const now = Date.now();
  const recent = new Date(now - 1000).toISOString();
  assert.equal(classifyFleetBucket(proc({ id: "p", status: "running", updatedAt: recent }), now), "active");
});

test("classifyFleetBucket: a long-running process (e.g. 12d idle) is stalled, not active", () => {
  const now = Date.now();
  const twelveDaysAgo = new Date(now - STALL_THRESHOLD_MS * 12).toISOString();
  assert.equal(classifyFleetBucket(proc({ id: "p", status: "running", updatedAt: twelveDaysAgo }), now), "stalled");
});

// console#251 review finding 2: an unknown freshness (missing/garbage/clearly-
// future updatedAt) must be treated exactly as conservatively as "stalled" —
// NEVER silently folded into "active".

test("classifyFleetBucket: a process with no status and no updatedAt is conservatively stalled, not active (nothing to disprove staleness)", () => {
  assert.equal(classifyFleetBucket(proc({ id: "p" })), "stalled");
});

test("classifyFleetBucket: a garbage/unparsable updatedAt is stalled, not active", () => {
  const now = Date.now();
  assert.equal(classifyFleetBucket(proc({ id: "p", status: "running", updatedAt: "not-a-date" }), now), "stalled");
});

test("classifyFleetBucket: an empty-string updatedAt is stalled, not active", () => {
  const now = Date.now();
  assert.equal(classifyFleetBucket(proc({ id: "p", status: "running", updatedAt: "" }), now), "stalled");
});

test("classifyFleetBucket: a clearly-future updatedAt (+24h) is stalled, not active — never silently 'ahead of schedule'", () => {
  const now = Date.now();
  const iso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(classifyFleetBucket(proc({ id: "p", status: "running", updatedAt: iso }), now), "stalled");
});

test("classifyFleetBucket: a small future updatedAt (+2min, clock skew) is active", () => {
  const now = Date.now();
  const iso = new Date(now + 2 * 60 * 1000).toISOString();
  assert.equal(classifyFleetBucket(proc({ id: "p", status: "running", updatedAt: iso }), now), "active");
});

// A waiting-on-you or archived status still wins outright even with an
// unparsable/future updatedAt — the review's "bucket by status only if
// waiting-on-you/terminal" requirement.
test("classifyFleetBucket: waiting-on-you/archived status overrides an unparsable or future updatedAt", () => {
  const now = Date.now();
  assert.equal(classifyFleetBucket(proc({ id: "p1", status: "paused", updatedAt: "not-a-date" }), now), "waiting-on-you");
  assert.equal(classifyFleetBucket(proc({ id: "p2", status: "complete", updatedAt: "not-a-date" }), now), "archived");
  const farFuture = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(classifyFleetBucket(proc({ id: "p3", status: "blocked", updatedAt: farFuture }), now), "waiting-on-you");
});

// ── deriveFleetCard — the #251 timestamp regression ─────────────────────────

// Regression (console#251): the old "Needs you" triage built paused-run cards
// from gate records via a detail string that never included any age/timestamp
// — every OTHER status variant (running/blocked/needs_input/review_pending/
// complete/failed) sourced its detail differently too, so nothing guaranteed a
// timestamp rendered consistently. deriveFleetCard reads `updatedAt` straight
// off the process record with no per-status branch, so every status variant
// below carries it through identically.
test("deriveFleetCard: every status variant carries updatedAt through unconditionally", () => {
  const updatedAt = "2026-07-10T12:00:00.000Z";
  for (const status of ["running", "paused", "blocked", "waiting", "needs_input", "review_pending", "complete", "failed", "cancelled", undefined]) {
    const card = deriveFleetCard(proc({ id: `p-${status}`, status, updatedAt }));
    assert.equal(card.updatedAt, updatedAt, `status=${status}`);
  }
});

test("deriveFleetCard: a process with no updatedAt at all renders that honestly (undefined, not fabricated)", () => {
  const card = deriveFleetCard(proc({ id: "p", status: "paused" }));
  assert.equal(card.updatedAt, undefined);
  assert.equal(card.freshness, "unknown");
  assert.equal(card.display, "none");
});

test("deriveFleetCard: display is 'none' for missing/garbage/empty updatedAt, 'raw' for clearly-future, 'relative' otherwise", () => {
  const now = Date.now();
  assert.equal(deriveFleetCard(proc({ id: "p1" }), now).display, "none");
  assert.equal(deriveFleetCard(proc({ id: "p2", updatedAt: "not-a-date" }), now).display, "none");
  assert.equal(deriveFleetCard(proc({ id: "p3", updatedAt: "" }), now).display, "none");
  assert.equal(deriveFleetCard(proc({ id: "p4", updatedAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() }), now).display, "raw");
  assert.equal(deriveFleetCard(proc({ id: "p5", updatedAt: new Date(now + 2 * 60 * 1000).toISOString() }), now).display, "relative");
  assert.equal(deriveFleetCard(proc({ id: "p6", updatedAt: new Date(now - 1000).toISOString() }), now).display, "relative");
});

test("deriveFleetCard: reads currentStep from both a string and an {id,label} shape", () => {
  const asString = deriveFleetCard(proc({ id: "p1", currentStep: "verify-gate" }));
  assert.equal(asString.stepLabel, "verify-gate");

  const asObjectWithLabel = deriveFleetCard(proc({ id: "p2", currentStep: { id: "learn", label: "Learn" } }));
  assert.equal(asObjectWithLabel.stepLabel, "Learn");

  const asObjectIdOnly = deriveFleetCard(proc({ id: "p3", currentStep: { id: "learn" } }));
  assert.equal(asObjectIdOnly.stepLabel, "learn");

  const missing = deriveFleetCard(proc({ id: "p4" }));
  assert.equal(missing.stepLabel, undefined);
});

test("deriveFleetCard: carries label fallback, blockedReason, percentComplete, and sourceRef.product", () => {
  const withLabel = deriveFleetCard(proc({ id: "p1", label: "Ship the release" }));
  assert.equal(withLabel.label, "Ship the release");

  const withoutLabel = deriveFleetCard(proc({ id: "p2" }));
  assert.equal(withoutLabel.label, "p2");

  const blocked = deriveFleetCard(proc({ id: "p3", blockedReason: "Waiting on operator input." }));
  assert.equal(blocked.blockedReason, "Waiting on operator input.");

  const withPct = deriveFleetCard(proc({ id: "p4", percentComplete: 42 }));
  assert.equal(withPct.percentComplete, 42);

  const withSource = deriveFleetCard(proc({ id: "p5", sourceRef: { product: "flow-agents", kind: "run", id: "p5" } }));
  assert.equal(withSource.product, "flow-agents");
});

// ── deriveFleetCards / tolerance ─────────────────────────────────────────────

test("deriveFleetCards tolerates undefined/null state", () => {
  assert.deepEqual(deriveFleetCards(undefined), []);
  assert.deepEqual(deriveFleetCards(null), []);
  assert.deepEqual(deriveFleetCards({}), []);
});

// ── deriveFleetCounts ─────────────────────────────────────────────────────────

test("deriveFleetCounts tallies each bucket from a mixed fixture", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "active-1", status: "running", updatedAt: new Date(now - 1000).toISOString() }),
      proc({ id: "active-2", status: "running", updatedAt: new Date(now - 2000).toISOString() }),
      proc({ id: "waiting-1", status: "paused", updatedAt: new Date(now - 5000).toISOString() }),
      proc({ id: "stalled-1", status: "running", updatedAt: new Date(now - STALL_THRESHOLD_MS - 1000).toISOString() }),
      proc({ id: "archived-1", status: "complete", updatedAt: new Date(now - 3000).toISOString() }),
      proc({ id: "archived-2", status: "failed", updatedAt: new Date(now - 4000).toISOString() }),
    ],
  };
  const counts = deriveFleetCounts(deriveFleetCards(state, now));
  assert.deepEqual(counts, { active: 2, waitingOnYou: 1, stalled: 1, archived: 2 });
});

// ── partitionFleet ────────────────────────────────────────────────────────────

test("partitionFleet: archived work is out of the main grid entirely", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "running", status: "running", updatedAt: new Date(now).toISOString() }),
      proc({ id: "done", status: "complete", updatedAt: new Date(now).toISOString() }),
      proc({ id: "cancelled", status: "cancelled", updatedAt: new Date(now).toISOString() }),
    ],
  };
  const { main, archived } = partitionFleet(deriveFleetCards(state, now));
  assert.deepEqual(main.map((c) => c.id), ["running"]);
  assert.deepEqual(archived.map((c) => c.id).sort(), ["cancelled", "done"]);
});

test("partitionFleet: main grid sorts most-recently-updated first", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "oldest", status: "running", updatedAt: new Date(now - 30000).toISOString() }),
      proc({ id: "newest", status: "running", updatedAt: new Date(now - 1000).toISOString() }),
      proc({ id: "middle", status: "running", updatedAt: new Date(now - 15000).toISOString() }),
    ],
  };
  const { main } = partitionFleet(deriveFleetCards(state, now));
  assert.deepEqual(main.map((c) => c.id), ["newest", "middle", "oldest"]);
});

test("partitionFleet: undated cards sink to the bottom of the main grid, not fabricated as recent", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "undated", status: "running" }),
      proc({ id: "dated", status: "running", updatedAt: new Date(now - 1000).toISOString() }),
    ],
  };
  const { main } = partitionFleet(deriveFleetCards(state, now));
  assert.deepEqual(main.map((c) => c.id), ["dated", "undated"]);
});

test("partitionFleet: archived cards sort most-recently-updated first too", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "older-done", status: "complete", updatedAt: new Date(now - 20000).toISOString() }),
      proc({ id: "newer-done", status: "complete", updatedAt: new Date(now - 1000).toISOString() }),
    ],
  };
  const { archived } = partitionFleet(deriveFleetCards(state, now));
  assert.deepEqual(archived.map((c) => c.id), ["newer-done", "older-done"]);
});

test("partitionFleet: empty fleet yields empty partitions", () => {
  const { main, archived } = partitionFleet([] as FleetCard[]);
  assert.deepEqual(main, []);
  assert.deepEqual(archived, []);
});

// console#251 review finding 1: recency sort must use numeric epoch compare,
// not lexical string compare on the raw ISO text.

test("partitionFleet: numeric epoch sort — sub-second precision orders correctly (not lexical)", () => {
  const state: OperatingState = {
    processes: [
      // Lexically, ".5" sorts BEFORE "Z" as a raw string compare, which would
      // wrongly put the whole-second timestamp ahead of the chronologically
      // later sub-second one under naive localeCompare.
      proc({ id: "whole-second", status: "running", updatedAt: "2026-07-20T11:00:00Z" }),
      proc({ id: "sub-second-later", status: "running", updatedAt: "2026-07-20T11:00:00.500Z" }),
    ],
  };
  const { main } = partitionFleet(deriveFleetCards(state));
  assert.deepEqual(main.map((c) => c.id), ["sub-second-later", "whole-second"]);
});

test("partitionFleet: numeric epoch sort — a UTC-offset timestamp that is chronologically newer sorts first, even though its raw string sorts last lexically", () => {
  const state: OperatingState = {
    processes: [
      proc({ id: "utc-form", status: "running", updatedAt: "2026-07-20T12:00:00Z" }), // 12:00:00 UTC
      proc({ id: "offset-form", status: "running", updatedAt: "2026-07-20T08:30:00-04:00" }), // 12:30:00 UTC — 30min NEWER
    ],
  };
  const { main } = partitionFleet(deriveFleetCards(state));
  assert.deepEqual(main.map((c) => c.id), ["offset-form", "utc-form"]);
});

test("partitionFleet: a garbage updatedAt sinks to the bottom of the main grid, never sorts first", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "garbage", status: "running", updatedAt: "not-a-date" }),
      proc({ id: "dated", status: "running", updatedAt: new Date(now - 1000).toISOString() }),
    ],
  };
  const { main } = partitionFleet(deriveFleetCards(state, now));
  assert.deepEqual(main.map((c) => c.id), ["dated", "garbage"]);
});

test("partitionFleet: garbage and undated cards sink to the bottom together, alongside each other", () => {
  const now = Date.now();
  const state: OperatingState = {
    processes: [
      proc({ id: "garbage", status: "running", updatedAt: "not-a-date" }),
      proc({ id: "undated", status: "running" }),
      proc({ id: "dated", status: "running", updatedAt: new Date(now - 1000).toISOString() }),
    ],
  };
  const { main } = partitionFleet(deriveFleetCards(state, now));
  assert.equal(main[0].id, "dated");
  assert.deepEqual(main.slice(1).map((c) => c.id).sort(), ["garbage", "undated"]);
});
