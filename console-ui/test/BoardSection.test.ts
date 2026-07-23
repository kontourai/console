import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsoleProcess, OperatingState } from "@kontourai/console-core";
import { BoardSection } from "../src/sections/BoardSection";

// console#252: `/run/:id` deep-links into the Board's existing card-selection +
// drill-down mechanism (#178) via BoardSection's new controlled `selectedId`
// prop. Mirrors the renderToStaticMarkup convention used elsewhere in this repo
// (no jsdom/testing-library) — SSR never runs effects, so the drill-down's own
// fetch never fires here; this only exercises the (state, selectedId) -> DOM
// selection/render contract.
//
// console#253: the drill-down itself now derives a full run-detail read model
// (deriveRunDetail.ts) — these tests fix `now` for deterministic relative-time
// rendering and cover the "no matching process" case, which now renders an
// honest not-found panel instead of nothing (see BoardDrilldown's docstring).

const FIXED_NOW = Date.parse("2026-07-20T12:00:00.000Z");

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function state(input: Partial<OperatingState>): OperatingState {
  return input as OperatingState;
}

function render(props: Parameters<typeof BoardSection>[0]): string {
  return renderToStaticMarkup(React.createElement(BoardSection, props));
}

const neverResolves = () => new Promise<unknown>(() => undefined);

test("BoardSection: no selectedId renders the board with no drill-down open", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-42", label: "Checkout retry banner", status: "running" })] }),
    fetchProjection: neverResolves,
  });
  assert.match(markup, /Checkout retry banner/);
  assert.doesNotMatch(markup, /board-drilldown/);
});

test("BoardSection: selectedId matching a rendered card opens its drill-down (console#252 /run/:id)", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-42", label: "Checkout retry banner", status: "running", updatedAt: "2026-07-20T11:59:00.000Z" })] }),
    fetchProjection: neverResolves,
    selectedId: "run-42",
    now: FIXED_NOW,
  });
  assert.match(markup, /class="board-drilldown"/);
  assert.match(markup, /Checkout retry banner/);
  assert.match(markup, /run 42/); // the "run-" prefix is stripped for the ingest runId
});

// console#253: a `/run/:id` deep link whose process is absent from the
// current operating state (e.g. it completed and was pruned, or the id in
// the address bar is simply wrong) must render an honest "not found" panel —
// never silently nothing, and never a stale/fabricated drill-down.
test("BoardSection: a selectedId with no matching process renders an honest 'run not found' panel", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-42", label: "Checkout retry banner", status: "running" })] }),
    fetchProjection: neverResolves,
    selectedId: "run-does-not-exist",
  });
  const drilldownMatch = markup.match(/<section class="board-drilldown"[^]*$/);
  assert.ok(drilldownMatch, "expected a .board-drilldown panel to render");
  const drilldown = drilldownMatch![0];
  assert.match(drilldown, /not found in current operating state/i);
  // The stale/unmatched id is echoed honestly, not silently swapped for an
  // unrelated existing card's data.
  assert.match(drilldown, /run-does-not-exist/);
  assert.doesNotMatch(drilldown, /Checkout retry banner/);
});

test("BoardSection: omitting selectedId/onSelectedIdChange keeps the original uncontrolled render (no crash, no drill-down)", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-1", label: "Uncontrolled worker", status: "running" })] }),
  });
  assert.match(markup, /Uncontrolled worker/);
  assert.doesNotMatch(markup, /board-drilldown/);
});

// console#253 review finding 1 (probe): a stage matching the pipeline's own
// currentStageId must be marked as the run's current position (aria-current)
// even when that stage's own status is "blocked" — not silently un-marked.
test("BoardSection: a pipeline stage's own currentStageId gets aria-current even when its status is 'blocked'", () => {
  const markup = render({
    state: state({
      processes: [proc({ id: "run-abc", label: "Blocked run" })],
      pipeline: {
        runId: "run-abc",
        runLabel: "",
        runStatus: "running",
        edges: [],
        currentStageId: "build",
        stages: [
          { id: "plan", label: "plan", order: 0, status: "passed", gates: [] },
          { id: "build", label: "build", order: 1, status: "blocked", gates: [] },
        ],
      } as unknown as OperatingState["pipeline"],
    }),
    fetchProjection: neverResolves,
    selectedId: "run-abc",
    now: FIXED_NOW,
  });
  assert.match(markup, /aria-current="step"/);
  // Exactly one stage carries it, and it is the blocked "build" stage — not
  // silently dropped just because the position isn't "passed"/"current".
  assert.equal((markup.match(/aria-current="step"/g) || []).length, 1);
  const buildMatch = markup.match(/<li class="run-stage[^"]*"[^>]*>[^]*?build[^]*?<\/li>/);
  assert.ok(buildMatch);
  assert.match(buildMatch![0], /aria-current="step"/);
});

// console#253 review finding 2 (probe): a failed run's earlier board columns
// must never render the green-check "completed" outcome.
test("BoardSection: a failed run's earlier stages render 'earlier', never 'completed'", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-1", label: "Failed run", status: "failed", currentStep: "verify" })] }),
    fetchProjection: neverResolves,
    selectedId: "run-1",
    now: FIXED_NOW,
  });
  assert.match(markup, /run-stage-earlier/);
  assert.doesNotMatch(markup, /run-stage-completed/);
});

// console#253 review finding 6 (probe): an XSS-style sourceOfTruthRefs URL
// must never render as a live href.
test("BoardSection: a javascript: sourceOfTruthRefs URL is never rendered as a link (XSS probe)", () => {
  const withRefs = {
    id: "run-1",
    label: "Run with an unsafe link",
    sourceOfTruthRefs: [{ label: "evil", url: "javascript:alert(1)" }],
  } as unknown as ConsoleProcess;
  const markup = render({
    state: state({ processes: [withRefs] }),
    fetchProjection: neverResolves,
    selectedId: "run-1",
    now: FIXED_NOW,
  });
  assert.doesNotMatch(markup, /javascript:/);
});

// console#253 review finding 7 (probe): a truthy-but-unparsable gate/timeline
// timestamp must never render as an invalid <time dateTime="not-a-date">.
test("BoardSection: a gate with a garbage updatedAt renders it as raw text, never an invalid <time dateTime>", () => {
  const markup = render({
    state: state({
      processes: [proc({ id: "run-1", label: "Run with a garbage gate timestamp" })],
      gates: [{ id: "g1", label: "Odd gate", status: "waiting", processRef: { id: "run-1" }, updatedAt: "not-a-date" } as OperatingState["gates"] extends (infer T)[] ? T : never],
    }),
    fetchProjection: neverResolves,
    selectedId: "run-1",
    now: FIXED_NOW,
  });
  assert.doesNotMatch(markup, /dateTime="not-a-date"/);
  assert.match(markup, />not-a-date</);
});

test("BoardSection: a timeline item with a garbage occurredAt renders it as raw text, never an invalid <time dateTime>", () => {
  const markup = render({
    state: state({
      processes: [proc({ id: "run-1", label: "Run with a garbage timeline timestamp" })],
      timeline: [{ id: "t1", type: "process.started", occurredAt: "not-a-date", subjectRef: { id: "run-1" } } as OperatingState["timeline"] extends (infer T)[] ? T : never],
    }),
    fetchProjection: neverResolves,
    selectedId: "run-1",
    now: FIXED_NOW,
  });
  assert.doesNotMatch(markup, /dateTime="not-a-date"/);
  assert.match(markup, />not-a-date</);
});
