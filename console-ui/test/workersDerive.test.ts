import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import {
  classifyFleetBucket,
  classifyFreshness,
  deriveFleetCard,
  deriveFleetCards,
  deriveFleetCounts,
  partitionFleet,
  FRESH_THRESHOLD_MS,
  STALL_THRESHOLD_MS,
  type FleetCard,
} from "../src/sections/workers/derive";

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

// ── classifyFreshness ────────────────────────────────────────────────────────

test("classifyFreshness: no updatedAt is unknown, never fabricated as fresh", () => {
  assert.equal(classifyFreshness(undefined), "unknown");
  assert.equal(classifyFreshness(""), "unknown");
});

test("classifyFreshness: an unparsable timestamp is unknown", () => {
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

test("classifyFleetBucket: a process with no status and no updatedAt defaults to active (nothing to disprove progress)", () => {
  assert.equal(classifyFleetBucket(proc({ id: "p" })), "active");
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
