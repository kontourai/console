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
  assert.match(markup, /Show archive · 1 completed/);
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

test("WorkerFleetSection: omitting `now` still renders (falls back to the live wall clock)", () => {
  const markup = render({
    state: state({
      processes: [proc({ id: "p1", label: "Live item", status: "running", updatedAt: new Date().toISOString() })],
    }),
  });
  assert.match(markup, /<time class="wf-card-time" dateTime="[^"]+">just now<\/time>/);
});
