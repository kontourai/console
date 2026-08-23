import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OperatingState } from "@kontourai/console-core";
import { buildProcessFlow } from "@kontourai/console-core";
// Dev-time only, monorepo-internal: the fixture PROJECTION is a real
// producer-shaped workflow-trust envelope (fixtures/workflow-trust-projection.json,
// mirroring flow-agents#891 field-for-field like console-server's own bridge
// tests), translated and folded through the SAME console#254 pipeline every
// live record takes — so the graph under test is generated from the fixture
// projection with NO hand-edits (console#274 acceptance).
import {
  translateWorkflowTrustProjectionEnvelope,
  buildCurrentOperatingState,
} from "../../console-server/src/console-foundation/index";
import { NodeDetailDrawer } from "../src/components/NodeDetailDrawer";
import { ProcessFlowDiagram } from "../src/components/ProcessFlowDiagram";
import { isSafeExternalUrl } from "../src/utils/safeUrl";

// console#274: the evidence graph — evidence nodes generated from the trust
// projection, provenance-kind borders keyed on the raw Surface enums, dead
// nodes for clauses with no evidence, and the drawer's layered panel
// (gleaned → answer impact → how determined → collapsed raw). SSR-only
// (renderToStaticMarkup, this repo's component-test convention — see
// BoardSection.test.ts): effects never run, so the drawer's Escape listener
// never binds here.

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "workflow-trust-projection.json");

function foldedFixtureState(): OperatingState {
  const envelope = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const { events, warnings } = translateWorkflowTrustProjectionEnvelope(envelope);
  assert.deepEqual(warnings, [], "the fixture envelope must translate clean — a warning means the fixture no longer matches the producer contract");
  return buildCurrentOperatingState([{ relativePath: "fixture-trust.jsonl", events }]) as unknown as OperatingState;
}

const WORKFLOW_ID = "flow-agents:repo:flow-agents:checkout-banner";
const EVIDENCE_NODE_ID = `evidence:${WORKFLOW_ID}:evidence:ev-tests`;
const REVIEW_CLAIM_ID = `${WORKFLOW_ID}:claim:claim-review`;
const DEAD_NODE_ID = `evidence:absent:${REVIEW_CLAIM_ID}`;

function renderDrawer(state: OperatingState, nodeId: string): string {
  const flow = buildProcessFlow(state);
  return renderToStaticMarkup(
    React.createElement(NodeDetailDrawer, { nodeId, nodes: flow.nodes, state, onClose: () => undefined }),
  );
}

test("the graph is generated from the fixture projection without hand-edits: evidence node, provenance enum, and dead node all present", () => {
  const state = foldedFixtureState();
  const flow = buildProcessFlow(state);

  const evidenceNode = flow.nodes.find((node) => node.id === EVIDENCE_NODE_ID);
  assert.ok(evidenceNode, "expected the folded evidence record to become an evidence node");
  assert.equal(evidenceNode!.kind, "evidence");
  // The raw Surface enum, relayed verbatim (kontourai/surface#224 owns display names).
  assert.equal(evidenceNode!.provenanceKind, "test_output");

  // The claim clause with no evidence (claim-review) renders as a first-class
  // dead node — never omitted.
  const deadNode = flow.nodes.find((node) => node.id === DEAD_NODE_ID);
  assert.ok(deadNode, "expected a dead node for the evidence-less claim clause");
  assert.equal(deadNode!.dead, true);

  // Gate → evidence and claim → evidence edges come from the projection's own
  // refs (gateAssociations folded to evidenceRefs/claimRefs), not invention.
  assert.ok(flow.edges.some((edge) => edge.id === `gate:${WORKFLOW_ID}:gate:tests-evidence-${EVIDENCE_NODE_ID}`));
  assert.ok(flow.edges.some((edge) => edge.id === `claim:${WORKFLOW_ID}:claim:claim-tests-${EVIDENCE_NODE_ID}`));
});

test("ProcessFlowDiagram keys the border on the raw provenance enum and renders the dead node dashed-class, in the evidence lane", () => {
  const state = foldedFixtureState();
  const flow = buildProcessFlow(state);
  const markup = renderToStaticMarkup(
    React.createElement(ProcessFlowDiagram, { nodes: flow.nodes, edges: flow.edges }),
  );

  // The data attribute carries the producer's enum VERBATIM — the CSS border
  // key and the display text both stay the raw enum (kontourai/surface#224).
  assert.match(markup, /data-provenance="test_output"/);
  assert.match(markup, /test_output · validation/);
  assert.match(markup, /flow-node-dead/);
  // The evidence lane exists as its own labeled lane.
  assert.match(markup, />evidence</);
});

test("no raw block is open on initial render (drawer + diagram over the fixture projection)", () => {
  const state = foldedFixtureState();
  for (const nodeId of [EVIDENCE_NODE_ID, DEAD_NODE_ID]) {
    const markup = renderDrawer(state, nodeId);
    assert.match(markup, /<details/, `expected a collapsed raw block for ${nodeId}`);
    assert.doesNotMatch(markup, /<details[^>]*\sopen/, `raw block must not be open on initial render for ${nodeId}`);
  }
});

test("the drawer's evidence panel layers render in order: gleaned → answer impact → how determined → raw", () => {
  const state = foldedFixtureState();
  const markup = renderDrawer(state, EVIDENCE_NODE_ID);

  const gleanedAt = markup.indexOf("What was gleaned");
  const impactAt = markup.indexOf("How it moved the answer");
  const determinedAt = markup.indexOf("How it was determined");
  const rawAt = markup.indexOf("Raw JSON");
  assert.ok(gleanedAt >= 0 && impactAt >= 0 && determinedAt >= 0 && rawAt >= 0, "all four layers must render");
  assert.ok(gleanedAt < impactAt && impactAt < determinedAt && determinedAt < rawAt, "layer order is the finding — gleaned first, raw last");

  // The gleaned layer is the PRODUCER's text, verbatim (the trust report's
  // excerptOrSummary) — never Console-authored.
  assert.match(markup, /node --test passes: 42 tests, 0 failures/);
  // Impact relays Surface's own verification event fields verbatim.
  assert.match(markup, /Surface status/);
  assert.match(markup, /verified/);
  // The raw leaf says plainly where belief bottoms out, and names where the
  // evidence lives.
  assert.match(markup, /Belief bottoms out here/);
  assert.match(markup, /checkout-banner\/evidence\.json/);
});

test("a dead node's panel renders the absence explicitly — never a synthesized interpretation", () => {
  const state = foldedFixtureState();
  const markup = renderDrawer(state, DEAD_NODE_ID);
  assert.match(markup, /No producer interpretation recorded/);
  assert.match(markup, /no evidence exists for this clause/);
  // Nothing borrowed from the sibling evidence record.
  assert.doesNotMatch(markup, /node --test passes/);
});

test("'How determined' links are resolvable: every href passes safeUrl; every ref chip's id exists in the rendered OperatingState", () => {
  const state = foldedFixtureState();
  const markup = renderDrawer(state, EVIDENCE_NODE_ID);

  // (a) every live anchor's href passes the safeUrl allow-list — and the
  // check is NON-vacuous (console#274 review LOW finding 5): the fixture's
  // evidence record carries an https sourceLocator, so a real anchor MUST
  // render here.
  const hrefs = [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length > 0, "positive control: at least one real determination anchor must render");
  assert.ok(hrefs.includes("https://ci.example.com/kontourai/console/runs/4242"));
  for (const href of hrefs) {
    assert.ok(isSafeExternalUrl(href), `rendered href must pass safeUrl: ${href}`);
  }

  // (b) every non-anchor ref chip resolves against the rendered OperatingState.
  const knownIds = new Set<string>([
    ...(state.claims || []).map((claim) => claim.id),
    ...(state.gates || []).map((gate) => gate.id),
    ...(state.evidence || []).map((item) => item.id),
    ...(state.processes || []).map((process) => process.id),
  ]);
  const claimChips = [...markup.matchAll(/source-ref-chip-claim[^>]*>[\s\S]*?<code[^>]*>([^<]+)<\/code>/g)].map((match) => match[1]);
  assert.ok(claimChips.length > 0, "expected at least one claim determination chip");
  for (const chip of claimChips) {
    assert.ok(knownIds.has(chip), `claim chip must resolve to a rendered OperatingState id: ${chip}`);
  }
});

// console#274 review LOW finding 5 (negative control): an UNSAFE
// sourceLocator must never become an anchor — nor leak into the markup at all.
test("an unsafe (javascript:) sourceLocator never renders as a link", () => {
  const state: OperatingState = {
    claims: [{ id: "claim-x", status: "verified" }],
    evidence: [{ id: "ev-x", label: "ev-x", claimRefs: [{ kind: "claim", id: "claim-x" }] }],
    processes: [{
      id: "wf-x",
      trustReport: {
        id: "report-x",
        claims: [],
        evidence: [{ id: "ev-x", claimId: "claim-x", evidenceType: "test_output", method: "validation", excerptOrSummary: "gleaned text", sourceLocator: "javascript:alert(1)" }],
        transparencyGaps: [],
      },
    }],
  };
  const markup = renderDrawer(state, "evidence:ev-x");
  assert.match(markup, /gleaned text/); // the record joined — the control is not vacuous
  assert.doesNotMatch(markup, /javascript:/);
});

// console#274 review MED finding 2 (pin): raw report ids are bundle-local —
// two folded workflows both carrying raw id "ev-1" must each relay their OWN
// workflow's producer text in the drawer, never first-report-wins.
test("the drawer's interpretation layers join only the owning workflow's report (two-workflow raw-id collision)", () => {
  const wfA = "flow-agents:repo:acme:wf-a";
  const wfB = "flow-agents:repo:acme:wf-b";
  const report = (suffix: string, evidenceType: string, method: string) => ({
    id: `report-${suffix}`,
    claims: [],
    evidence: [{ id: "ev-1", claimId: "c-1", evidenceType, method, excerptOrSummary: `${suffix}'s own gleaned text` }],
    events: [],
    transparencyGaps: [],
  });
  const state: OperatingState = {
    processes: [
      { id: wfA, trustReport: report("wf-a", "screenshot", "observation") },
      { id: wfB, trustReport: report("wf-b", "test_output", "validation") },
    ],
    evidence: [
      { id: `${wfA}:evidence:ev-1`, label: "A evidence" },
      { id: `${wfB}:evidence:ev-1`, label: "B evidence" },
    ],
  };

  const markupA = renderDrawer(state, `evidence:${wfA}:evidence:ev-1`);
  assert.match(markupA, /wf-a&#x27;s own gleaned text/);
  assert.doesNotMatch(markupA, /wf-b&#x27;s own gleaned text/);

  const markupB = renderDrawer(state, `evidence:${wfB}:evidence:ev-1`);
  assert.match(markupB, /wf-b&#x27;s own gleaned text/);
  assert.doesNotMatch(markupB, /wf-a&#x27;s own gleaned text/);
});

test("an evidence node with no producer interpretation renders the explicit absence state", () => {
  // A minimal folded-shape state whose evidence record carries NO summary and
  // whose owning records carry NO trust report — nothing to relay, so both
  // interpretation layers must render their absence.
  const state: OperatingState = {
    claims: [{ id: "claim-bare", status: "verified" }],
    evidence: [{ id: "ev-bare", label: "ev-bare", claimRefs: [{ kind: "claim", id: "claim-bare" }] }],
  };
  const markup = renderDrawer(state, "evidence:ev-bare");
  const absences = markup.match(/No producer interpretation recorded\./g) || [];
  assert.ok(absences.length >= 2, "both the gleaned and impact layers must render the absence");
});
