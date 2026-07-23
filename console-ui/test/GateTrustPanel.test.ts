import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsoleGate, ConsoleProcess } from "@kontourai/console-core";
import { GateTrustPanel, findOwningProcess, selectGateTrustReport } from "../src/components/GateTrustPanel";

// console#255 component-render contract: (gate, processes) in, DOM out.
// Mirrors the renderToStaticMarkup convention used throughout this repo (no
// jsdom/testing-library — see test/BoardSection.test.ts's module doc comment).
// SSR never runs effects, so `.report` is never actually assigned to the
// element here — that live property-wiring contract is covered by the
// Playwright spec (tests/browser/gate-trust-panel.spec.ts), which reads the
// element's `.report` property in a real browser after the effect runs.

function gate(g: Partial<ConsoleGate> & { id: string }): ConsoleGate {
  return g as ConsoleGate;
}

function proc(p: Partial<ConsoleProcess> & { id: string }): ConsoleProcess {
  return p as ConsoleProcess;
}

function render(props: Parameters<typeof GateTrustPanel>[0]): string {
  return renderToStaticMarkup(React.createElement(GateTrustPanel, props));
}

const gateReport = { schemaVersion: 5, source: "gate-report", claims: [{ id: "c1", status: "verified" }] };
const processReport = { schemaVersion: 5, source: "process-report", claims: [{ id: "c2", status: "verified" }] };

// ── selectGateTrustReport precedence: gate > process > none ────────────────

test("selectGateTrustReport: prefers the gate's own trustReport when present", () => {
  const g = gate({ id: "g1", trustReport: gateReport, processRef: { id: "p1" } });
  const processes = [proc({ id: "p1", trustReport: processReport })];
  const selection = selectGateTrustReport(g, processes);
  assert.equal(selection.source, "gate");
  assert.deepEqual(selection.report, gateReport);
});

test("selectGateTrustReport: falls back to the owning process's trustReport when the gate has none", () => {
  const g = gate({ id: "g1", processRef: { id: "p1" } });
  const processes = [proc({ id: "p1", trustReport: processReport })];
  const selection = selectGateTrustReport(g, processes);
  assert.equal(selection.source, "process");
  assert.deepEqual(selection.report, processReport);
});

test("selectGateTrustReport: no report at all when neither the gate nor its process carries one", () => {
  const g = gate({ id: "g1", processRef: { id: "p1" } });
  const processes = [proc({ id: "p1" })];
  const selection = selectGateTrustReport(g, processes);
  assert.equal(selection.source, "none");
  assert.equal(selection.report, undefined);
});

test("selectGateTrustReport: no report when the gate has no processRef at all (no process to fall back to)", () => {
  const g = gate({ id: "g1" });
  const selection = selectGateTrustReport(g, [proc({ id: "unrelated", trustReport: processReport })]);
  assert.equal(selection.source, "none");
  assert.equal(selection.report, undefined);
});

test("selectGateTrustReport: a processRef pointing at an id absent from processes[] is honestly 'none', never fabricated", () => {
  const g = gate({ id: "g1", processRef: { id: "p-does-not-exist" } });
  const selection = selectGateTrustReport(g, [proc({ id: "p1", trustReport: processReport })]);
  assert.equal(selection.source, "none");
  assert.equal(selection.report, undefined);
});

// ── findOwningProcess ───────────────────────────────────────────────────────

test("findOwningProcess: matches gate.processRef.id against process.id", () => {
  const g = gate({ id: "g1", processRef: { id: "p1" } });
  const p1 = proc({ id: "p1" });
  const p2 = proc({ id: "p2" });
  assert.equal(findOwningProcess(g, [p2, p1]), p1);
});

test("findOwningProcess: undefined when the gate has no processRef", () => {
  const g = gate({ id: "g1" });
  assert.equal(findOwningProcess(g, [proc({ id: "p1" })]), undefined);
});

// ── Component: report selection drives rendered output ─────────────────────

test("GateTrustPanel: renders <surface-trust-panel> and an aria-label naming the gate when a report is available", () => {
  const markup = render({ gate: gate({ id: "gate-tests", trustReport: gateReport }), processes: [] });
  assert.match(markup, /<surface-trust-panel/);
  assert.match(markup, /aria-label="Trust panel for gate gate-tests"/);
  assert.doesNotMatch(markup, /trust-panel-no-data/);
});

test("GateTrustPanel: process-fallback report renders an honest 'workflow's full trust report' note", () => {
  const markup = render({
    gate: gate({ id: "gate-tests", processRef: { id: "p1" } }),
    processes: [proc({ id: "p1", trustReport: processReport })],
  });
  assert.match(markup, /<surface-trust-panel/);
  assert.match(markup, /workflow&#x27;s full trust report/);
});

test("GateTrustPanel: honest empty state when no report is available anywhere, no <surface-trust-panel> mounted", () => {
  const markup = render({ gate: gate({ id: "gate-tests" }), processes: [] });
  assert.match(markup, /No trust data yet for this gate\./);
  assert.doesNotMatch(markup, /<surface-trust-panel/);
});

test("GateTrustPanel: empty state falls back to listing evidenceRefs/expectationRefs when present", () => {
  const markup = render({
    gate: gate({
      id: "gate-tests",
      evidenceRefs: [{ product: "surface", kind: "evidence", id: "ev-1", label: "node --test passes" }],
      expectationRefs: [{ product: "surface", kind: "claim", id: "claim-1", label: "required tests pass" }],
    }),
    processes: [],
  });
  assert.match(markup, /No trust data yet for this gate\./);
  assert.match(markup, /Evidence references/);
  assert.match(markup, /node --test passes/);
  assert.match(markup, /Expectation references/);
  assert.match(markup, /required tests pass/);
});

test("GateTrustPanel: empty state with no refs either shows no reference sections", () => {
  const markup = render({ gate: gate({ id: "gate-tests" }), processes: [] });
  assert.doesNotMatch(markup, /Evidence references/);
  assert.doesNotMatch(markup, /Expectation references/);
});

// ── SSR-safety (no jsdom in this repo — see module doc comment) ────────────

test("GateTrustPanel: renders without throwing under renderToStaticMarkup (no `document`/`customElements` in Node)", () => {
  assert.doesNotThrow(() => render({ gate: gate({ id: "gate-tests", trustReport: gateReport }), processes: [] }));
});
