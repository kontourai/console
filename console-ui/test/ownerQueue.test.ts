import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import { OwnerQueueSection } from "../src/sections/OwnerQueueSection";
import { OverviewSection } from "../src/sections/OverviewSection";
import {
  QUEUE_LEVEL_ONE_STRINGS,
  deriveAcceptItems,
  deriveOwnerQueue,
} from "../src/sections/queue/derive";

// console#273: the owner-verb queue as the default surface. SSR convention
// (renderToStaticMarkup, see BoardSection.test.ts's module doc) — effects
// never run, so no live fetch/scroll fires here. Fixed `now` for
// deterministic aging.

const FIXED_NOW = Date.parse("2026-07-20T12:00:00.000Z");

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
}

// A report-shaped trustReport (the console#254 fold's verbatim Surface
// output), carrying one standing transparency gap.
const REPORT_WITH_GAP = {
  id: "report-a",
  generatedAt: "2026-07-20T11:58:00Z",
  claims: [{ id: "claim-review", status: "unverified" }],
  evidence: [],
  events: [],
  transparencyGaps: [
    {
      id: "gap-review",
      claimId: "claim-review",
      type: "unverified_claim",
      severity: "high",
      message: "independent review claim has no verification event or evidence",
      createdAt: "2026-07-19T09:00:00Z",
    },
  ],
};

const QUEUE_STATE = state({
  generatedAt: "2026-07-20T11:59:00Z",
  source: { acceptedEventCount: 12 },
  processes: [
    proc({ id: "run-1", label: "Checkout retry banner", status: "needs_input", blockedReason: "Waiting for an owner answer on the flag default", updatedAt: "2026-07-20T11:00:00Z" }),
    proc({ id: "run-2", label: "Nightly importer", status: "review_pending", updatedAt: "2026-07-20T10:00:00Z" }),
    proc({ id: "run-3", label: "Docs sweep", status: "completed", updatedAt: "2026-07-20T09:00:00Z", trustReport: REPORT_WITH_GAP }),
    proc({ id: "run-4", label: "Legacy cleanup", status: "completed", updatedAt: "2026-07-20T08:00:00Z" }),
    proc({ id: "run-5", label: "Steady worker", status: "running", updatedAt: "2026-07-20T11:55:00Z" }),
  ],
});

function renderQueue(input: OperatingState = QUEUE_STATE): string {
  return renderToStaticMarkup(
    React.createElement(OwnerQueueSection, {
      state: input,
      telemetry: null,
      onOpen: () => undefined,
      now: FIXED_NOW,
    }),
  );
}

// ── Acceptance: counts reconcile ─────────────────────────────────────────────

test("section count badges reconcile with the rows actually rendered (decide/accept/risks)", () => {
  const markup = renderQueue();

  // Split the markup into the three queue blocks by their aria-labels; within
  // each block, the badge count must equal the number of rendered rows.
  const blocks = [...markup.matchAll(/aria-label="(Decide|Accept|Risks standing) \((\d+)\)"([\s\S]*?)<\/section>/g)];
  assert.equal(blocks.length, 3, "expected all three queue sections");
  let badgeSum = 0;
  let rowSum = 0;
  for (const [, title, count, body] of blocks) {
    const rows = (body.match(/class="oq-row /g) || []).length;
    assert.equal(rows, Number(count), `${title}: badge says ${count}, rendered ${rows} rows`);
    badgeSum += Number(count);
    rowSum += rows;
  }
  // The queue fixture is non-trivial: 2 decide + 2 accept + 1 risk.
  assert.equal(badgeSum, 5);
  assert.equal(rowSum, 5);

  // The pulse line carries the SAME reconciled numbers.
  assert.match(markup, /<b>2<\/b> to decide/);
  assert.match(markup, /<b>2<\/b> to accept/);
  assert.match(markup, /<b>1<\/b> risks standing/);
});

// ── Acceptance: level-one word budget ────────────────────────────────────────

test("every authored level-one queue string stays within the 10-word budget", () => {
  assert.ok(QUEUE_LEVEL_ONE_STRINGS.length > 0);
  for (const value of QUEUE_LEVEL_ONE_STRINGS) {
    const words = value.trim().split(/\s+/).filter(Boolean);
    assert.ok(
      words.length <= 10,
      `authored level-one string exceeds the 10-word budget (${words.length}): "${value}"`,
    );
  }
});

// ── Acceptance: every quantity names its producing instrument in the DOM ─────

test("every rendered quantity names its producing instrument (title/aria)", () => {
  const markup = renderQueue();

  // Section count badges: title names the instrument.
  const counts = [...markup.matchAll(/class="oq-count" title="([^"]*)"/g)];
  assert.equal(counts.length, 3);
  for (const [, title] of counts) {
    assert.ok(title.length > 0, "count badge must carry a non-empty instrument title");
  }
  assert.match(markup, /title="Counted from operating-state processes in the waiting-on-you bucket[^"]*"/);
  assert.match(markup, /title="Counted from transparencyGaps in the Surface trust reports folded by the workflow-trust bridge \(console#254\)"/);

  // Pulse segments: same instruments, on the segment carrying the number.
  const pulseSegs = [...markup.matchAll(/class="oq-pulse-seg" title="([^"]*)"/g)];
  assert.equal(pulseSegs.length, 3);

  // Aging quantities: named to the producer field they're computed from.
  assert.match(markup, /class="oq-age" title="Computed from this process&#x27;s own updatedAt \(2026-07-20T11:00:00Z\)"/);
  assert.match(markup, /title="Computed from this gap&#x27;s own createdAt \(2026-07-19T09:00:00Z\)"/);

  // The computed risk badge names the trust-report instrument.
  assert.match(markup, /title="Counted from transparencyGaps in this process&#x27;s folded Surface trust report \(console#254\)"/);
});

// ── No uncomputed quantities, ever ───────────────────────────────────────────

test("a deliverable with NO trust report renders the absence in red vocabulary — never a placeholder number", () => {
  const markup = renderQueue();
  // run-4 has no trustReport: its badge is the absence, not "0 gaps standing".
  assert.match(markup, /oq-badge-absent[^>]*>no trust report</);
  // run-3 HAS a report: computed badge with its real count.
  assert.match(markup, /1 gaps standing/);
  // No fabricated zero for run-4.
  const zeroBadges = markup.match(/0 gaps standing/g) || [];
  assert.equal(zeroBadges.length, 0);
});

test("accept items are risk-sorted: no-trust-report (unverifiable) first, then most gaps first", () => {
  const items = deriveAcceptItems(QUEUE_STATE);
  assert.deepEqual(items.map((item) => item.id), ["run-4", "run-3"]);
  assert.equal(items[0].gapCount, null);
  assert.equal(items[1].gapCount, 1);
});

// ── DECIDE: the console#229 vocabulary, producer reason relayed verbatim ─────

test("a needs_input process renders its authored question and relays blockedReason verbatim in the receipt", () => {
  const markup = renderQueue();
  assert.match(markup, /Answer what this run is waiting on/);
  assert.match(markup, /Review the output waiting on you/);
  // Producer text, verbatim, behind the receipt click.
  assert.match(markup, /Waiting for an owner answer on the flag default/);
  // Receipt slots with no producing feed render the absence, never prose.
  assert.match(markup, /If approved/);
  assert.match(markup, /No producer record\./);
  // The receipt is behind a click: collapsed details, never open on render.
  assert.doesNotMatch(markup, /<details[^>]*\sopen/);
});

// ── RISKS STANDING: producer gap text verbatim, one aging row ────────────────

test("a standing transparency gap renders as one aging row with the producer's message verbatim", () => {
  const markup = renderQueue();
  assert.match(markup, /independent review claim has no verification event or evidence/);
  // Aging computed from the gap's own createdAt (1d 3h before FIXED_NOW → "1d").
  assert.match(markup, /standing 1d/);
  assert.match(markup, /unverified_claim/);
});

// ── Data-feed strip: wired vs missing, absence in red ────────────────────────

test("the feed strip renders missing feeds red and wired feeds with their instrument named", () => {
  const markup = renderQueue();
  // telemetry is null here: a missing (red) chip, not a hidden one.
  assert.match(markup, /oq-feed-missing[^>]*title="the hub&#x27;s \/telemetry read-model"/);
  // operating state is wired, with the counting instrument named.
  assert.match(markup, /oq-feed-wired[^>]*title="state\.source\.acceptedEventCount from the hub&#x27;s operating-state stream — 12 events accepted"/);
  // trust reports feed is wired (run-3 carries one) — assert the chip's state
  // class directly, not just the label's presence.
  assert.match(markup, /oq-feed-wired"[^>]*title="Surface trust reports folded by the workflow-trust bridge \(console#254\)"/);
});

// console#273 review MED finding 4 (pin): an operating state with ZERO folded
// trust reports has no risks FEED — the section and pulse must render that
// absence (red, like the feed strip), never a computed-looking 0 under an
// instrument title citing reports that don't exist.
test("with a state but zero trust reports, the risks section and pulse render the feed absence — never 0", () => {
  const noReports = state({
    generatedAt: "2026-07-20T11:59:00Z",
    source: { acceptedEventCount: 3 },
    processes: [
      proc({ id: "run-1", label: "Worker", status: "running", updatedAt: "2026-07-20T11:55:00Z" }),
      proc({ id: "run-2", label: "Done worker", status: "completed", updatedAt: "2026-07-20T11:00:00Z" }),
    ],
  });
  const markup = renderQueue(noReports);

  // No computed-looking zero anywhere in the risks surfaces.
  assert.doesNotMatch(markup, /<b>0<\/b> risks standing/);
  assert.doesNotMatch(markup, /aria-label="Risks standing \(0\)"/);
  // The absence renders instead, red-classed, with an honest instrument title.
  assert.match(markup, /aria-label="Risks standing \(no trust reports feed\)"/);
  assert.match(markup, /oq-count-absent[^>]*title="No Surface trust reports are folded into the operating state \(console#254\) — the risks count has no producing feed"/);
  assert.match(markup, /oq-pulse-seg oq-absent/);
  assert.match(markup, /risks standing: no trust reports feed/);
  // The decide/accept counts, which DO have feeds, stay computed.
  assert.match(markup, /<b>0<\/b> to decide/);
});

test("with no operating state at all, the pulse renders that absence — never zeros pretending to be computed", () => {
  const markup = renderQueue(state({}));
  assert.match(markup, /No operating state received yet\./);
  assert.doesNotMatch(markup, /<b>0<\/b> to decide/);
});

// ── Default surface ordering ─────────────────────────────────────────────────

test("the Overview renders the owner queue FIRST and the fleet content below it; the board stays its own view", () => {
  const markup = renderToStaticMarkup(
    React.createElement(OverviewSection, {
      state: QUEUE_STATE,
      telemetry: null,
      liveStatus: "live",
      onOpen: () => undefined,
      now: FIXED_NOW,
    }),
  );
  const queueAt = markup.indexOf('aria-label="Owner queue"');
  const fleetAt = markup.indexOf("The fleet");
  const needsYouAt = markup.indexOf("Needs you");
  assert.ok(queueAt >= 0, "owner queue must render on the default surface");
  assert.ok(fleetAt === -1 || queueAt < fleetAt, "owner queue renders before the fleet grid");
  assert.ok(needsYouAt === -1 || queueAt < needsYouAt, "owner queue renders before the triage wall");
});

test("deriveOwnerQueue treats an empty state as absent and a populated state as computed", () => {
  assert.equal(deriveOwnerQueue(state({}), null, FIXED_NOW).stateAbsent, true);
  assert.equal(deriveOwnerQueue(QUEUE_STATE, null, FIXED_NOW).stateAbsent, false);
});
