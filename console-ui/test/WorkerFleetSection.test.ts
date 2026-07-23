import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import { WorkerFleetSection } from "../src/sections/WorkerFleetSection";
import { STALL_THRESHOLD_MS } from "../src/sections/workers/derive";

// #251 component-render contract: (state, now?) in, DOM out. Mirrors the
// renderToStaticMarkup convention already used for BoardView (test/BoardView.test.ts)
// and FleetSection (test/fleetSection.test.ts) — no jsdom/testing-library in this repo.

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
}

function render(props: Parameters<typeof WorkerFleetSection>[0]): string {
  return renderToStaticMarkup(React.createElement(WorkerFleetSection, props));
}

const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();

test("WorkerFleetSection: fleet header counts derive from a mixed fixture OperatingState", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [
        proc({ id: "p1", label: "Active worker", status: "running", updatedAt: new Date(NOW - 1000).toISOString() }),
        proc({ id: "p2", label: "Paused worker", status: "paused", updatedAt: new Date(NOW - 2000).toISOString() }),
        proc({ id: "p3", label: "Stalled worker", status: "running", updatedAt: new Date(NOW - STALL_THRESHOLD_MS - 1000).toISOString() }),
        proc({ id: "p4", label: "Done worker", status: "complete", updatedAt: new Date(NOW - 3000).toISOString() }),
      ],
    }),
  });
  assert.match(markup, /class="wf-count wf-count-active"[^>]*>[\s\S]*?<span class="wf-count-value">1<\/span>/);
  assert.match(markup, /class="wf-count wf-count-waiting-on-you"[^>]*>[\s\S]*?<span class="wf-count-value">1<\/span>/);
  assert.match(markup, /class="wf-count wf-count-stalled"[^>]*>[\s\S]*?<span class="wf-count-value">1<\/span>/);
  assert.match(markup, /wf-count-archived[^>]*>[\s\S]*?<span class="wf-count-value">1<\/span>/);
  assert.match(markup, /4 workers tracked/);
});

// Regression (console#251): the old "Needs you" triage rendered a paused-run
// card with NO timestamp at all. Every fleet-card status variant must render
// a <time> element for its updatedAt.
test("WorkerFleetSection: every card status variant renders its updatedAt as a <time> element", () => {
  const updatedAt = "2026-07-20T11:55:00.000Z"; // 5 minutes before NOW
  const statuses = ["running", "paused", "blocked", "waiting", "needs_input", "review_pending"];
  const markup = render({
    now: NOW,
    state: state({
      processes: statuses.map((status, i) => proc({ id: `p-${i}`, label: `Worker ${status}`, status, updatedAt })),
    }),
  });
  const timeMatches = markup.match(/<time class="wf-card-time" dateTime="2026-07-20T11:55:00\.000Z">5m ago<\/time>/g) || [];
  assert.equal(timeMatches.length, statuses.length, `expected a <time> for every status variant in:\n${markup}`);
});

test("WorkerFleetSection: a process with no updatedAt renders an honest 'no activity recorded' label, not a fabricated time", () => {
  const markup = render({
    now: NOW,
    state: state({ processes: [proc({ id: "p1", label: "No timestamp worker", status: "paused" })] }),
  });
  assert.match(markup, /wf-card-time-unknown">no activity recorded</);
  assert.doesNotMatch(markup, /<time/);
});

// console#251 review finding 2: a garbage `updatedAt` must never render an
// invalid `<time dateTime="not-a-date">` — it must fall back to the same
// honest "no activity recorded" text as a missing timestamp, with no <time>
// element at all.
test("WorkerFleetSection: a garbage updatedAt string renders 'no activity recorded', never an invalid <time dateTime>", () => {
  const markup = render({
    now: NOW,
    state: state({ processes: [proc({ id: "p1", label: "Garbage timestamp worker", status: "running", updatedAt: "not-a-date" })] }),
  });
  assert.match(markup, /wf-card-time-unknown">no activity recorded</);
  assert.doesNotMatch(markup, /<time/);
  assert.doesNotMatch(markup, /dateTime="not-a-date"/);
});

test("WorkerFleetSection: an empty-string updatedAt renders 'no activity recorded', never an empty <time dateTime>", () => {
  const markup = render({
    now: NOW,
    state: state({ processes: [proc({ id: "p1", label: "Empty timestamp worker", status: "running", updatedAt: "" })] }),
  });
  assert.match(markup, /wf-card-time-unknown">no activity recorded</);
  assert.doesNotMatch(markup, /<time/);
});

// console#251 review finding 2: a clearly-future timestamp (beyond the 5min
// clock-skew tolerance) must never be silently classified as fresh/active —
// it renders its raw ISO text (a valid dateTime), not a nonsensical relative
// time, and its freshness badge reads "no activity data", not "fresh".
test("WorkerFleetSection: a clearly-future updatedAt (+24h) renders the raw timestamp, tagged 'no activity data' — never silently fresh", () => {
  const future = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();
  const markup = render({
    now: NOW,
    state: state({ processes: [proc({ id: "p1", label: "Future timestamp worker", status: "running", updatedAt: future })] }),
  });
  assert.match(markup, new RegExp(`<time class="wf-card-time wf-card-time-raw" dateTime="${future}"[^>]*>${future}</time>`));
  assert.match(markup, /wf-freshness-unknown">no activity data</);
  assert.doesNotMatch(markup, /wf-freshness-fresh/);
  // Conservative bucket too: never counted/rendered as the "active" card class.
  assert.doesNotMatch(markup, /wf-card-active/);
});

// A small future timestamp (ordinary clock skew, <=5min) is still treated as
// fresh/active — only timestamps clearly beyond skew tolerance are suspect.
test("WorkerFleetSection: a small future updatedAt (+2min, clock skew) still renders as fresh/active with a normal relative time", () => {
  const nearFuture = new Date(NOW + 2 * 60 * 1000).toISOString();
  const markup = render({
    now: NOW,
    state: state({ processes: [proc({ id: "p1", label: "Slightly-ahead worker", status: "running", updatedAt: nearFuture })] }),
  });
  assert.match(markup, new RegExp(`<time class="wf-card-time" dateTime="${nearFuture}">just now</time>`));
  assert.match(markup, /wf-card-active[\s\S]*?wf-freshness-fresh">fresh</);
});

test("WorkerFleetSection: freshness tiers reflect the injected now (fresh / idle / stalled)", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [
        proc({ id: "fresh", status: "running", updatedAt: new Date(NOW - 5000).toISOString() }), // 5s ago
        proc({ id: "idle", status: "running", updatedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() }), // 2h ago
        proc({ id: "stalled", status: "running", updatedAt: new Date(NOW - STALL_THRESHOLD_MS - 1000).toISOString() }),
      ],
    }),
  });
  assert.match(markup, /wf-card-active[\s\S]*?wf-freshness-fresh">fresh</);
  assert.match(markup, /wf-freshness-idle">idle</);
  assert.match(markup, /wf-card-stalled[\s\S]*?wf-freshness-stalled">stalled</);
});

test("WorkerFleetSection: archive partitioning — terminal work is out of the main grid by default, but counted", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [
        proc({ id: "p1", label: "Active worker", status: "running", updatedAt: new Date(NOW).toISOString() }),
        proc({ id: "p2", label: "Completed worker", status: "complete", updatedAt: new Date(NOW).toISOString() }),
      ],
    }),
  });
  const mainGridMatch = markup.match(/<ul class="wf-grid" aria-label="Active workers">([\s\S]*?)<\/ul>/);
  assert.ok(mainGridMatch, "expected the main fleet grid to render");
  assert.match(mainGridMatch![1], /Active worker/);
  assert.doesNotMatch(mainGridMatch![1], /Completed worker/);
  // Archived collapsed by default: no archived list rendered, but the toggle names its count.
  assert.doesNotMatch(markup, /wf-grid-archived/);
  assert.match(markup, /Show archive · 1 archived/);
});

// console#251 review finding 3: the archive holds failed/cancelled/abandoned
// work too, not just successfully completed work — "N completed" was a false
// claim for a failed-only archive.
test("WorkerFleetSection: archive toggle says 'N archived', not 'N completed', for a failed-only archive", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [proc({ id: "p1", label: "Failed worker", status: "failed", updatedAt: new Date(NOW).toISOString() })],
    }),
  });
  assert.match(markup, /Show archive · 1 archived/);
  assert.doesNotMatch(markup, /completed/);
});

test("WorkerFleetSection: main grid sorts most-recently-updated first", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [
        proc({ id: "p1", label: "Older worker", status: "running", updatedAt: new Date(NOW - 30000).toISOString() }),
        proc({ id: "p2", label: "Newer worker", status: "running", updatedAt: new Date(NOW - 1000).toISOString() }),
      ],
    }),
  });
  const olderIndex = markup.indexOf("Older worker");
  const newerIndex = markup.indexOf("Newer worker");
  assert.ok(newerIndex >= 0 && olderIndex >= 0);
  assert.ok(newerIndex < olderIndex, "expected the more-recently-updated card to render first");
});

test("WorkerFleetSection: an empty fleet renders an honest empty state, not fake cards", () => {
  const markup = render({ now: NOW, state: state({}) });
  assert.match(markup, /No active workers/);
  assert.doesNotMatch(markup, /<ul class="wf-grid"/);
  assert.match(markup, /0 workers tracked/);
});

test("WorkerFleetSection: renders the current step as a visible stage line", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [proc({ id: "p1", label: "Gate worker", status: "running", currentStep: { id: "verify-gate", label: "Verify gate" }, updatedAt: new Date(NOW).toISOString() })],
    }),
  });
  assert.match(markup, /class="wf-card-step">at Verify gate</);
});

// console#252: controlled filter/archiveOpen — App owns this state so it can
// sync to the URL (`?filter=`, `/archive`). Both are OPTIONAL: omitting them
// (as every test above does) preserves the original uncontrolled behavior.
test("WorkerFleetSection: a controlled `filter` renders only that bucket, pre-applied (no click needed)", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [
        proc({ id: "p1", label: "Active worker", status: "running", updatedAt: new Date(NOW).toISOString() }),
        proc({ id: "p2", label: "Stalled worker", status: "running", updatedAt: new Date(NOW - STALL_THRESHOLD_MS - 1000).toISOString() }),
      ],
    }),
    filter: "stalled",
  });
  const mainGridMatch = markup.match(/<ul class="wf-grid" aria-label="Active workers">([\s\S]*?)<\/ul>/);
  assert.ok(mainGridMatch, "expected the main fleet grid to render");
  assert.match(mainGridMatch![1], /Stalled worker/);
  assert.doesNotMatch(mainGridMatch![1], /Active worker/);
  assert.match(markup, /wf-count-stalled is-active"/);
});

test("WorkerFleetSection: a controlled `filter` of null renders everything, unfiltered", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [proc({ id: "p1", label: "Active worker", status: "running", updatedAt: new Date(NOW).toISOString() })],
    }),
    filter: null,
  });
  assert.match(markup, /Active worker/);
});

test("WorkerFleetSection: a controlled `archiveOpen=true` renders the archived list pre-expanded (no click needed)", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [proc({ id: "p1", label: "Done worker", status: "complete", updatedAt: new Date(NOW).toISOString() })],
    }),
    archiveOpen: true,
  });
  assert.match(markup, /wf-grid-archived/);
  assert.match(markup, /Done worker/);
  assert.match(markup, /aria-expanded="true"/);
});

test("WorkerFleetSection: a controlled `archiveOpen=false` keeps the archive collapsed even with archived work present", () => {
  const markup = render({
    now: NOW,
    state: state({
      processes: [proc({ id: "p1", label: "Done worker", status: "complete", updatedAt: new Date(NOW).toISOString() })],
    }),
    archiveOpen: false,
  });
  assert.doesNotMatch(markup, /wf-grid-archived/);
});

test("WorkerFleetSection: omitting `now` still renders (falls back to the live wall clock)", () => {
  const markup = render({
    state: state({
      processes: [proc({ id: "p1", label: "Live item", status: "running", updatedAt: new Date().toISOString() })],
    }),
  });
  assert.match(markup, /<time class="wf-card-time" dateTime="[^"]+">just now<\/time>/);
});

// ── console#256: source-of-truth work-item chip on the fleet card ──────────

test("WorkerFleetSection: a process carrying a work-item sourceOfTruthRefs entry shows a linked chip on its card", () => {
  const withRefs = {
    id: "p1",
    label: "Checkout retry banner",
    status: "running",
    updatedAt: new Date(NOW).toISOString(),
    sourceOfTruthRefs: [
      { kind: "work-item", id: "github:kontourai/flow-agents#891", label: "#891", url: "https://github.com/kontourai/flow-agents/issues/891" },
      { kind: "assignment-branch", id: "branch-checkout-banner", label: "feature/checkout-banner" },
    ],
  } as unknown as ConsoleProcess;
  const markup = render({ now: NOW, state: state({ processes: [withRefs] }) });
  assert.match(markup, /class="source-ref-links wf-card-source-refs"/);
  assert.match(markup, /<a[^>]*href="https:\/\/github\.com\/kontourai\/flow-agents\/issues\/891"[^>]*>#891<\/a>/);
  // Only the work-item kind renders on the compact fleet card -- the
  // assignment-branch ref is present in state but filtered out here.
  assert.doesNotMatch(markup, /feature\/checkout-banner/);
});

test("WorkerFleetSection: a process with no sourceOfTruthRefs renders no source-ref chip row at all", () => {
  const markup = render({
    now: NOW,
    state: state({ processes: [proc({ id: "p1", label: "No refs", status: "running", updatedAt: new Date(NOW).toISOString() })] }),
  });
  assert.doesNotMatch(markup, /source-ref-links/);
});

// XSS probe: an unsafe javascript: url on a work-item ref never becomes a
// live link on the fleet card.
test("WorkerFleetSection: a javascript: sourceOfTruthRefs url on a fleet card is never rendered as a link (XSS probe)", () => {
  const withRefs = {
    id: "p1",
    label: "Unsafe ref worker",
    status: "running",
    updatedAt: new Date(NOW).toISOString(),
    sourceOfTruthRefs: [{ kind: "work-item", id: "evil-work-item", label: "evil", url: "javascript:alert(1)" }],
  } as unknown as ConsoleProcess;
  const markup = render({ now: NOW, state: state({ processes: [withRefs] }) });
  assert.doesNotMatch(markup, /javascript:/);
  assert.match(markup, /<code[^>]*>evil<\/code>/);
});
