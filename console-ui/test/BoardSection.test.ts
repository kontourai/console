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
    state: state({ processes: [proc({ id: "run-42", label: "Checkout retry banner", status: "running" })] }),
    fetchProjection: neverResolves,
    selectedId: "run-42",
  });
  assert.match(markup, /class="board-drilldown"/);
  assert.match(markup, /Checkout retry banner/);
  assert.match(markup, /run 42/); // the "run-" prefix is stripped for the ingest runId
});

test("BoardSection: a selectedId with no matching card renders no drill-down (never a stale/fabricated one)", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-42", label: "Checkout retry banner", status: "running" })] }),
    fetchProjection: neverResolves,
    selectedId: "run-does-not-exist",
  });
  assert.doesNotMatch(markup, /board-drilldown/);
});

test("BoardSection: omitting selectedId/onSelectedIdChange keeps the original uncontrolled render (no crash, no drill-down)", () => {
  const markup = render({
    state: state({ processes: [proc({ id: "run-1", label: "Uncontrolled worker", status: "running" })] }),
  });
  assert.match(markup, /Uncontrolled worker/);
  assert.doesNotMatch(markup, /board-drilldown/);
});
