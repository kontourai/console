import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveHealthCounts,
  deriveAttentionItems,
  deriveActivityBuckets,
  deriveTopWorkloads,
  deriveProcessList,
  formatAge,
  isSourceQuiet,
  LONG_RUNNING_PROCESS_MS,
  QUIET_SOURCE_MS,
} from "../src/sections/environment/derive";
import type { OperatingState } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../src/serverApiTypes";

// ── deriveHealthCounts ───────────────────────────────────────────────────────

test("deriveHealthCounts returns zeros for empty state", () => {
  const counts = deriveHealthCounts({});
  assert.deepEqual(counts, {
    activeProcesses: 0,
    gatesPassed: 0,
    gatesBlocked: 0,
    claimsOk: 0,
    claimsAtRisk: 0,
    claimsStale: 0,
    openInquiries: 0,
  });
});

// Regression (console#182): the Operate tab white-screened with
// "Cannot read properties of undefined (reading 'processes')" when the hub
// stream had not yet delivered an operating state. These projections must
// tolerate an undefined/null state instead of throwing.
test("deriveHealthCounts tolerates undefined/null state", () => {
  const zeros = deriveHealthCounts({});
  assert.deepEqual(deriveHealthCounts(undefined), zeros);
  assert.deepEqual(deriveHealthCounts(null), zeros);
});

test("deriveAttentionItems tolerates undefined/null state", () => {
  assert.deepEqual(deriveAttentionItems(undefined, null), []);
  assert.deepEqual(deriveAttentionItems(null, null), []);
});

test("deriveProcessList tolerates undefined/null state", () => {
  assert.deepEqual(deriveProcessList(undefined), []);
  assert.deepEqual(deriveProcessList(null), []);
});

test("deriveHealthCounts counts active processes (excludes done/complete/closed/cancelled)", () => {
  const state: OperatingState = {
    processes: [
      { id: "p1", status: "active" },
      { id: "p2", status: "complete" },
      { id: "p3", status: "DONE" },
      { id: "p4" }, // no status → counts as active
      { id: "p5", status: "closed" },
      { id: "p6", status: "cancelled" },
    ],
  };
  const counts = deriveHealthCounts(state);
  assert.equal(counts.activeProcesses, 2); // p1 + p4
});

test("deriveHealthCounts classifies gates by status", () => {
  const state: OperatingState = {
    gates: [
      { id: "g1", status: "passed" },
      { id: "g2", status: "blocked" },
      { id: "g3", status: "failed" },
      { id: "g4", status: "approved" },
      { id: "g5", status: "accepted" },
      { id: "g6", status: "complete" },
    ],
  };
  const counts = deriveHealthCounts(state);
  assert.equal(counts.gatesPassed, 4); // passed + approved + accepted + complete
  assert.equal(counts.gatesBlocked, 2); // blocked + failed
});

// Regression: console-server's statusFromGateEvent emits "routed_back"
// (underscore) for a gate.routed_back event, but the blocked-gate set formerly
// checked a hyphenated "route-back" no producer ever emits, so routed-back gates
// were never counted as blocked.
test("deriveHealthCounts counts a routed_back gate as blocked", () => {
  const state: OperatingState = {
    gates: [
      { id: "g1", status: "routed_back" },
      { id: "g2", status: "passed" },
    ],
  };
  const counts = deriveHealthCounts(state);
  assert.equal(counts.gatesBlocked, 1);
});

test("deriveHealthCounts classifies claims by freshness status", () => {
  const state: OperatingState = {
    claims: [
      { id: "c1", freshness: { status: "ok" } },
      { id: "c2", freshness: { status: "stale" } },
      { id: "c3", freshness: { status: "expired" } },
      { id: "c4", status: "verified" }, // no freshness, use claim status
      { id: "c5" }, // no status → at-risk bucket
    ],
  };
  const counts = deriveHealthCounts(state);
  assert.equal(counts.claimsOk, 2);   // c1 + c4
  assert.equal(counts.claimsStale, 2); // c2 + c3
  assert.equal(counts.claimsAtRisk, 1); // c5
});

test("deriveHealthCounts counts open inquiries (unresolved)", () => {
  const state: OperatingState = {
    inquiries: [
      { id: "i1", outcome: "matched" }, // open (no resolvedAt)
      { id: "i2", outcome: "derived" }, // open
      { id: "i3", outcome: "matched", resolvedAt: "2026-01-01T00:00:00Z" }, // resolved
      { id: "i4", outcome: "unsupported" }, // open
    ],
  };
  const counts = deriveHealthCounts(state);
  assert.equal(counts.openInquiries, 3);
});

// ── deriveAttentionItems ─────────────────────────────────────────────────────

test("deriveAttentionItems returns empty list when nothing needs attention", () => {
  const items = deriveAttentionItems({}, null);
  assert.deepEqual(items, []);
});

test("deriveAttentionItems flags blocked gates", () => {
  const state: OperatingState = {
    gates: [
      { id: "g1", label: "Compliance Gate", status: "blocked", routeBack: { reason: "missing SLA doc" } },
      { id: "g2", status: "passed" }, // not flagged
    ],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "blocked-gate");
  assert.equal(items[0].id, "g1");
  assert.equal(items[0].label, "Compliance Gate");
  assert.equal(items[0].detail, "missing SLA doc");
});

// Regression: a routed_back gate (a downstream check sent the work back to an
// earlier step) must surface in the triage as a blocked-gate. It formerly matched
// neither BLOCKED_GATE_STATUSES (which listed a phantom hyphenated "route-back")
// nor PAUSED_GATE_STATUSES, so it was invisible to the owner.
test("deriveAttentionItems flags a routed_back gate as a blocked-gate with its route-back reason", () => {
  const state: OperatingState = {
    gates: [
      { id: "verify-gate", label: "verify", status: "routed_back", routeBack: { reason: "acceptance criteria not met" } },
    ],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "blocked-gate");
  assert.equal(items[0].id, "verify-gate");
  assert.equal(items[0].detail, "acceptance criteria not met");
});

test("deriveAttentionItems: a routed_back gate is a blocked-gate, not a paused-run (disjoint)", () => {
  const state: OperatingState = {
    gates: [{ id: "g1", label: "verify", status: "routed_back" }],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "blocked-gate");
  assert.equal(items.filter((i) => i.kind === "paused-run").length, 0);
});

test("deriveAttentionItems flags a run paused at an open (waiting) gate", () => {
  const state: OperatingState = {
    gates: [
      { id: "verify-gate", label: "verify", status: "waiting", processRef: { id: "run-568", label: "flow-agents #568" } },
      { id: "g-done", status: "passed" }, // not flagged
    ],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "paused-run");
  assert.equal(items[0].id, "run-568");
  assert.equal(items[0].label, "flow-agents #568");
  assert.ok(items[0].detail.includes("Parked at verify"), `expected 'Parked at verify' in "${items[0].detail}"`);
  assert.ok(items[0].detail.includes("waiting"), `expected 'waiting' in "${items[0].detail}"`);
});

test("deriveAttentionItems: a waiting gate is a paused-run, not a blocked-gate (disjoint)", () => {
  const state: OperatingState = {
    gates: [{ id: "g1", label: "verify", status: "waiting" }],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "paused-run");
  assert.equal(items.filter((i) => i.kind === "blocked-gate").length, 0);
});

test("deriveAttentionItems: paused-run detail lists the specific missing evidence", () => {
  const state: OperatingState = {
    gates: [
      {
        id: "verify-gate",
        label: "verify",
        status: "waiting",
        missingEvidence: ["clean-critique", "acceptance-criteria", "tests-evidence", "extra-one"],
      },
    ],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.ok(items[0].detail.includes("clean-critique"), `expected named evidence in "${items[0].detail}"`);
  assert.ok(items[0].detail.includes("(+1 more)"), `expected overflow note in "${items[0].detail}"`);
});

test("deriveAttentionItems: multiple open gates on one run collapse to a single paused-run item", () => {
  const state: OperatingState = {
    gates: [
      { id: "g1", label: "verify", status: "waiting", processRef: { id: "run-1" } },
      { id: "g2", label: "merge-ready", status: "waiting", processRef: { id: "run-1" } },
    ],
  };
  const items = deriveAttentionItems(state, null).filter((i) => i.kind === "paused-run");
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "run-1");
});

test("deriveAttentionItems leads with paused runs before blocked gates", () => {
  const state: OperatingState = {
    gates: [
      { id: "g-failed", label: "review", status: "failed", routeBack: { reason: "nope" } },
      { id: "g-waiting", label: "verify", status: "waiting", processRef: { id: "run-2" } },
    ],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items[0].kind, "paused-run");
  assert.equal(items[1].kind, "blocked-gate");
});

test("deriveAttentionItems flags stale claims", () => {
  const state: OperatingState = {
    claims: [
      { id: "c1", label: "Audit Claim", freshness: { status: "stale", expiresAt: "2026-01-01T00:00:00Z" } },
      { id: "c2", status: "ok" }, // fine
    ],
  };
  const items = deriveAttentionItems(state, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "stale-claim");
  assert.equal(items[0].id, "c1");
  assert.ok(items[0].detail.includes("ago"), `expected 'ago' in "${items[0].detail}"`);
});

test("deriveAttentionItems flags long-running processes", () => {
  const now = Date.now();
  const longAgo = new Date(now - LONG_RUNNING_PROCESS_MS - 1000).toISOString();
  const recentlyUpdated = new Date(now - 5000).toISOString();

  const state: OperatingState = {
    processes: [
      { id: "p1", label: "Stalled Process", status: "running", updatedAt: longAgo },
      { id: "p2", status: "running", updatedAt: recentlyUpdated }, // recent, not flagged
      { id: "p3", status: "complete", updatedAt: longAgo }, // complete, not flagged
    ],
  };
  const items = deriveAttentionItems(state, null, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "long-running-process");
  assert.equal(items[0].id, "p1");
});

test("deriveAttentionItems flags quiet telemetry sources", () => {
  const now = Date.now();
  const quietAt = new Date(now - QUIET_SOURCE_MS - 5000).toISOString();
  const recentAt = new Date(now - 1000).toISOString();

  const telemetry = makeTelemetry([
    { id: "src-a", recordCount: 10, lastObservedAt: quietAt } as any,
    { id: "src-b", recordCount: 5, lastObservedAt: recentAt } as any,
  ]);

  const items = deriveAttentionItems({}, telemetry, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "quiet-source");
  assert.equal(items[0].id, "src-a");
});

// ── isSourceQuiet ────────────────────────────────────────────────────────────

test("isSourceQuiet returns false when source has no lastObservedAt", () => {
  assert.equal(isSourceQuiet({ id: "s", recordCount: 10 }), false);
});

test("isSourceQuiet returns true when lastObservedAt exceeds threshold", () => {
  const now = Date.now();
  const quietAt = new Date(now - QUIET_SOURCE_MS - 1000).toISOString();
  assert.equal(isSourceQuiet({ id: "s", recordCount: 1, lastObservedAt: quietAt }, now), true);
});

test("isSourceQuiet returns false when lastObservedAt is recent", () => {
  const now = Date.now();
  const recentAt = new Date(now - 1000).toISOString();
  assert.equal(isSourceQuiet({ id: "s", recordCount: 1, lastObservedAt: recentAt }, now), false);
});

// ── formatAge ───────────────────────────────────────────────────────────────

test("formatAge formats seconds correctly", () => {
  assert.equal(formatAge(0), "0s");
  assert.equal(formatAge(45000), "45s");
});

test("formatAge formats minutes correctly", () => {
  assert.equal(formatAge(90 * 1000), "1m");
  assert.equal(formatAge(3 * 60 * 1000), "3m");
});

test("formatAge formats hours correctly", () => {
  assert.equal(formatAge(2 * 60 * 60 * 1000), "2h");
});

test("formatAge formats days correctly", () => {
  assert.equal(formatAge(3 * 24 * 60 * 60 * 1000), "3d");
});

test("formatAge handles negative values as 0s", () => {
  assert.equal(formatAge(-1000), "0s");
});

// ── deriveActivityBuckets ────────────────────────────────────────────────────

test("deriveActivityBuckets returns correct number of empty buckets with no records", () => {
  const buckets = deriveActivityBuckets([], 12, 60 * 60 * 1000, Date.now());
  assert.equal(buckets.length, 12);
  assert.ok(buckets.every((b) => b.count === 0));
});

test("deriveActivityBuckets bins records into correct buckets", () => {
  const now = 1000 * 60 * 60 * 2; // fixed reference time
  const windowMs = 60 * 60 * 1000; // 1 hour
  const bucketCount = 4;
  // Bucket 0: now - windowMs .. now - (3/4)*windowMs
  // Bucket 1: now - (3/4)*windowMs .. now - (2/4)*windowMs
  // Bucket 2: now - (2/4)*windowMs .. now - (1/4)*windowMs
  // Bucket 3: now - (1/4)*windowMs .. now
  const bucketMs = windowMs / bucketCount;
  const windowStart = now - windowMs;
  const records = [
    { eventId: "e1", eventType: "t", sourceId: "s", observedAt: new Date(windowStart + 5).toISOString() },     // bucket 0
    { eventId: "e2", eventType: "t", sourceId: "s", observedAt: new Date(windowStart + bucketMs + 5).toISOString() }, // bucket 1
    { eventId: "e3", eventType: "t", sourceId: "s", observedAt: new Date(windowStart + bucketMs + 10).toISOString() }, // bucket 1
    { eventId: "e4", eventType: "t", sourceId: "s", observedAt: new Date(now - 5).toISOString() }, // bucket 3
  ] as ConsoleTelemetryResponse["records"];

  const buckets = deriveActivityBuckets(records, bucketCount, windowMs, now);
  assert.equal(buckets.length, bucketCount);
  assert.equal(buckets[0].count, 1);
  assert.equal(buckets[1].count, 2);
  assert.equal(buckets[2].count, 0);
  assert.equal(buckets[3].count, 1);
});

test("deriveActivityBuckets skips records outside the time window", () => {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const tooOld = new Date(now - windowMs - 1000).toISOString();
  const future = new Date(now + 1000).toISOString();

  const records = [
    { eventId: "e1", eventType: "t", sourceId: "s", observedAt: tooOld },
    { eventId: "e2", eventType: "t", sourceId: "s", observedAt: future },
  ] as ConsoleTelemetryResponse["records"];

  const buckets = deriveActivityBuckets(records, 4, windowMs, now);
  assert.ok(buckets.every((b) => b.count === 0));
});

test("deriveActivityBuckets degrades gracefully when records have no observedAt", () => {
  const records = [
    { eventId: "e1", eventType: "t", sourceId: "s" }, // no observedAt
  ] as ConsoleTelemetryResponse["records"];
  const buckets = deriveActivityBuckets(records, 6, 60 * 60 * 1000, Date.now());
  assert.ok(buckets.every((b) => b.count === 0));
});

// ── deriveTopWorkloads ───────────────────────────────────────────────────────

test("deriveTopWorkloads returns empty lists when telemetry is null", () => {
  const workloads = deriveTopWorkloads(null);
  assert.deepEqual(workloads, { projects: [], tools: [], agents: [] });
});

test("deriveTopWorkloads uses facet summaries when available", () => {
  const telemetry = makeTelemetry([], {
    facets: [
      { id: "projects", label: "Projects", counts: [{ name: "proj-a", count: 20 }, { name: "proj-b", count: 10 }] },
      { id: "tools", label: "Tools", counts: [{ name: "bash", count: 15 }] },
      { id: "agents", label: "Agents", counts: [{ name: "agent-1", count: 8 }] },
    ],
    flows: [],
  });

  const workloads = deriveTopWorkloads(telemetry, 5);
  assert.equal(workloads.projects.length, 2);
  assert.equal(workloads.projects[0].name, "proj-a");
  assert.equal(workloads.projects[0].count, 20);
  assert.equal(workloads.tools[0].name, "bash");
  assert.equal(workloads.agents[0].name, "agent-1");
});

test("deriveTopWorkloads falls back to counting record fields when no facets", () => {
  const telemetry = makeTelemetry([], {
    facets: [],
    flows: [],
  }, [
    { eventId: "e1", eventType: "t", sourceId: "s", project: "proj-x", toolName: "bash", agentName: "agent-z" },
    { eventId: "e2", eventType: "t", sourceId: "s", project: "proj-x", toolName: "bash", agentName: "agent-z" },
    { eventId: "e3", eventType: "t", sourceId: "s", project: "proj-y", toolName: "read", agentName: "agent-z" },
  ] as ConsoleTelemetryResponse["records"]);

  const workloads = deriveTopWorkloads(telemetry, 5);
  assert.equal(workloads.projects[0].name, "proj-x");
  assert.equal(workloads.projects[0].count, 2);
  assert.equal(workloads.tools[0].name, "bash");
  assert.equal(workloads.tools[0].count, 2);
  assert.equal(workloads.agents[0].name, "agent-z");
  assert.equal(workloads.agents[0].count, 3);
});

test("deriveTopWorkloads respects the limit parameter", () => {
  const telemetry = makeTelemetry([], {
    facets: [
      {
        id: "projects", label: "Projects",
        counts: Array.from({ length: 10 }, (_, i) => ({ name: `proj-${i}`, count: 10 - i }))
      },
    ],
    flows: [],
  });

  const workloads = deriveTopWorkloads(telemetry, 3);
  assert.equal(workloads.projects.length, 3);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTelemetry(
  sources: ConsoleTelemetryResponse["sources"] = [],
  analytics: ConsoleTelemetryResponse["analytics"] = { facets: [], flows: [] },
  records: ConsoleTelemetryResponse["records"] = [],
): ConsoleTelemetryResponse {
  return {
    generatedAt: new Date().toISOString(),
    sources,
    totals: { recordCount: records.length, sessionCount: 0, eventTypeCounts: {}, productRecordCount: 0 },
    analytics,
    records,
    warnings: [],
  };
}
