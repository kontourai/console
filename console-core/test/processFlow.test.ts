import assert from "node:assert/strict";
import test from "node:test";
import { buildProcessFlow, type OperatingState } from "../src/index";

// Regression (console#182): the Operate tab white-screened with
// "Cannot read properties of undefined (reading 'processes')" when no operating
// state had arrived yet. buildProcessFlow must return an empty flow, not throw.
test("buildProcessFlow tolerates undefined/null/empty state", () => {
  for (const input of [undefined, null, {}]) {
    const flow = buildProcessFlow(input as OperatingState | null | undefined);
    // A stage node is always synthesized; no processes/gates/etc. means no more.
    assert.deepEqual(flow.nodes.map((n) => n.id), ["stage"]);
    assert.deepEqual(flow.edges, []);
  }
});

test("buildProcessFlow keeps unreferenced lane items visible without invented edges", () => {
  const flow = buildProcessFlow({
    currentStage: "Checking gate",
    processes: [{ id: "run-1", status: "running", currentStep: "verify", label: "Run 1" }],
    gates: [{ id: "gate-unlinked", status: "waiting", label: "Unlinked gate" }],
    claims: [{ id: "claim-unlinked", status: "verified", label: "Unlinked claim" }],
    actions: [{ id: "action-unlinked", status: "available", label: "Unlinked action" }],
    timeline: [{ id: "evt-1", type: "gate.opened", subjectRef: { kind: "gate", id: "gate-unlinked" } }]
  });

  // console#274: the claim with no evidence now yields a first-class DEAD
  // evidence node (never omitted) — the only structural addition here; the
  // dead node's edge is claim→dead, still ref-backed, not invented.
  assert.deepEqual(flow.nodes.map((node) => node.id), [
    "stage",
    "process:run-1",
    "step:run-1",
    "gate:gate-unlinked",
    "claim:claim-unlinked",
    "evidence:absent:claim-unlinked",
    "action:action-unlinked",
    "timeline:evt-1"
  ]);
  assert.deepEqual(flow.edges.map((edge) => edge.id), [
    "stage-process",
    "process-step",
    "claim:claim-unlinked-evidence:absent:claim-unlinked"
  ]);
});

test("buildProcessFlow links gates, claims, and actions only through explicit refs", () => {
  const state: OperatingState = {
    currentStage: "Waiting on gate",
    processes: [{
      id: "run-1",
      status: "running",
      currentStep: "verify",
      label: "Run 1",
      claimRefs: [{ kind: "claim", id: "claim-1" }],
      nextActionRefs: [{ kind: "action", id: "action-1" }]
    }],
    gates: [{
      id: "gate-1",
      status: "waiting",
      processRef: { kind: "run", id: "run-1" },
      expectationRefs: [{ kind: "claim", id: "claim-1" }]
    }],
    claims: [{ id: "claim-1", status: "verified" }],
    actions: [{ id: "action-1", status: "available" }]
  };

  const flow = buildProcessFlow(state);

  assert.deepEqual(flow.edges.map((edge) => edge.id), [
    "stage-process",
    "process-step",
    "process:run-1-gate:gate-1",
    "process:run-1-claim:claim-1",
    // console#274: claim-1 has no evidence — its dead-node edge renders the
    // absence rather than omitting it.
    "claim:claim-1-evidence:absent:claim-1",
    "process:run-1-action:action-1",
    "gate:gate-1-claim:claim-1"
  ]);
});

// ── console#274: evidence nodes, provenance relay, dead nodes ───────────────

test("buildProcessFlow renders evidence records as their own lane with provenance relayed verbatim from the folded trust report", () => {
  const trustReport = {
    id: "report-1",
    generatedAt: "2026-07-20T11:58:00Z",
    claims: [{ id: "claim-tests", status: "verified" }],
    evidence: [{ id: "ev-tests", claimId: "claim-tests", evidenceType: "test_output", method: "validation", excerptOrSummary: "node --test passes" }],
    transparencyGaps: []
  };
  const state: OperatingState = {
    gates: [{
      id: "wf-1:gate:tests-evidence",
      evidenceRefs: [{ product: "surface", kind: "evidence", id: "wf-1:evidence:ev-tests", label: "ev-tests" }],
      expectationRefs: [{ product: "surface", kind: "claim", id: "wf-1:claim:claim-tests", label: "claim-tests" }],
      trustReport
    }],
    claims: [{ id: "wf-1:claim:claim-tests", status: "verified" }],
    evidence: [{
      id: "wf-1:evidence:ev-tests",
      label: "node --test passes",
      summary: "node --test passes",
      claimRefs: [{ product: "surface", kind: "claim", id: "wf-1:claim:claim-tests", label: "claim-tests" }]
    }]
  };

  const flow = buildProcessFlow(state);
  const evidenceNode = flow.nodes.find((node) => node.id === "evidence:wf-1:evidence:ev-tests");
  assert.ok(evidenceNode, "expected an evidence node");
  assert.equal(evidenceNode!.kind, "evidence");
  // Provenance kind is the RAW Surface enum, joined via the bridge-qualified
  // id's raw suffix — relayed, never re-labeled (kontourai/surface#224 owns
  // display names).
  assert.equal(evidenceNode!.provenanceKind, "test_output");
  assert.equal(evidenceNode!.meta, "test_output · validation");
  assert.equal(evidenceNode!.dead, undefined);

  // Explicit-ref edges only: gate→evidence via evidenceRefs, claim→evidence
  // via the evidence record's claimRefs.
  assert.ok(flow.edges.some((edge) => edge.id === "gate:wf-1:gate:tests-evidence-evidence:wf-1:evidence:ev-tests"));
  assert.ok(flow.edges.some((edge) => edge.id === "claim:wf-1:claim:claim-tests-evidence:wf-1:evidence:ev-tests"));
  // The evidenced claim gets NO dead node.
  assert.equal(flow.nodes.some((node) => node.id === "evidence:absent:wf-1:claim:claim-tests"), false);
});

test("buildProcessFlow renders a gate's missingEvidence clauses as first-class dead nodes, never omitted", () => {
  const flow = buildProcessFlow({
    gates: [{ id: "gate-1", status: "blocked", missingEvidence: ["screenshot", "test run"] }]
  });

  const deadNodes = flow.nodes.filter((node) => node.dead);
  assert.deepEqual(deadNodes.map((node) => node.id), [
    "evidence:missing:gate-1:screenshot",
    "evidence:missing:gate-1:test run"
  ]);
  for (const node of deadNodes) {
    assert.equal(node.kind, "evidence");
    assert.equal(node.status, "missing");
  }
  // The clause name is the producer's own text, relayed as the label.
  assert.equal(deadNodes[0]!.label, "screenshot");
  assert.ok(flow.edges.some((edge) => edge.id === "gate:gate-1-evidence:missing:gate-1:screenshot"));
});

// console#274 review HIGH finding 1 (pin): dead-claim status derives from the
// STATE, never from the capped render set — a claim whose ONLY evidence is
// the 7th record (past the evidence lane's slice(0, 6) cap) is evidenced,
// and must NOT get a fabricated "No evidence recorded" node.
test("a claim whose only evidence sits past the render cap is NOT marked dead (state-derived absence)", () => {
  const evidence = Array.from({ length: 7 }, (_, index) => ({
    id: `ev-${index + 1}`,
    label: `evidence ${index + 1}`,
    // Only ev-7 — beyond the cap — backs claim-1.
    ...(index === 6 ? { claimRefs: [{ kind: "claim", id: "claim-1" }] } : {}),
  }));
  const flow = buildProcessFlow({
    claims: [{ id: "claim-1", status: "verified" }],
    evidence
  });

  // The render cap still applies to the lane…
  assert.equal(flow.nodes.filter((node) => node.kind === "evidence" && !node.dead).length, 6);
  assert.equal(flow.nodes.some((node) => node.id === "evidence:ev-7"), false);
  // …but absence is a STATE fact, and the state says claim-1 IS evidenced.
  assert.equal(
    flow.nodes.some((node) => node.id === "evidence:absent:claim-1"),
    false,
    "a truncated render set must never fabricate a false absence"
  );
});

// console#274 review MED finding 2 (pin): raw report ids are bundle-local —
// two folded workflows both carrying raw id "ev-1" must each join their OWN
// workflow's trust report, never first-report-wins.
test("provenance joins are scoped to the owning workflow's own trust report (two-workflow raw-id collision)", () => {
  const wfA = "flow-agents:repo:acme:wf-a";
  const wfB = "flow-agents:repo:acme:wf-b";
  const reportA = {
    id: "report-a",
    claims: [],
    evidence: [{ id: "ev-1", claimId: "c-1", evidenceType: "screenshot", method: "observation" }],
    transparencyGaps: []
  };
  const reportB = {
    id: "report-b",
    claims: [],
    evidence: [{ id: "ev-1", claimId: "c-1", evidenceType: "test_output", method: "validation" }],
    transparencyGaps: []
  };
  const flow = buildProcessFlow({
    processes: [
      { id: wfA, trustReport: reportA },
      { id: wfB, trustReport: reportB }
    ],
    evidence: [
      { id: `${wfA}:evidence:ev-1`, label: "A evidence" },
      { id: `${wfB}:evidence:ev-1`, label: "B evidence" }
    ]
  });

  const nodeA = flow.nodes.find((node) => node.id === `evidence:${wfA}:evidence:ev-1`);
  const nodeB = flow.nodes.find((node) => node.id === `evidence:${wfB}:evidence:ev-1`);
  assert.equal(nodeA?.provenanceKind, "screenshot");
  assert.equal(nodeB?.provenanceKind, "test_output");
});

// console#274 review MED finding 3 (pin): the missingEvidence render cap must
// never SILENTLY drop dead nodes — clauses past the cap surface as a dead
// truncation indicator carrying the exact dropped count.
test("a gate with 4 missingEvidence clauses renders 3 dead nodes plus a '+1 more missing' indicator", () => {
  const flow = buildProcessFlow({
    gates: [{ id: "gate-1", status: "blocked", missingEvidence: ["a", "b", "c", "d"] }]
  });

  const deadNodes = flow.nodes.filter((node) => node.dead);
  assert.deepEqual(deadNodes.map((node) => node.label), ["a", "b", "c", "+1 more missing"]);
  const indicator = deadNodes[3]!;
  assert.equal(indicator.id, "evidence:missing-more:gate-1");
  assert.equal(indicator.kind, "evidence");
  assert.ok(flow.edges.some((edge) => edge.id === "gate:gate-1-evidence:missing-more:gate-1"));
});

// console#274 review MED finding 3, claims side (pin): evidence-less claims
// past the claims-lane cap surface as one dead indicator with the count.
test("evidence-less claims beyond the claims render cap surface as a dead truncation indicator", () => {
  const flow = buildProcessFlow({
    claims: Array.from({ length: 6 }, (_, index) => ({ id: `claim-${index + 1}`, status: "unverified" }))
  });

  // 4 rendered claims each get their own dead node; the 2 dropped
  // evidence-less claims surface as one indicator.
  const indicator = flow.nodes.find((node) => node.id === "evidence:absent-more");
  assert.ok(indicator, "expected a dead truncation indicator for dropped claims");
  assert.equal(indicator!.dead, true);
  assert.equal(indicator!.label, "+2 more missing");
});

test("buildProcessFlow gives an evidence node no provenanceKind when no folded trust report carries the record (absence, not a guess)", () => {
  const flow = buildProcessFlow({
    claims: [{ id: "claim-1", status: "verified" }],
    evidence: [{ id: "ev-1", label: "some evidence", claimRefs: [{ kind: "claim", id: "claim-1" }] }]
  });
  const evidenceNode = flow.nodes.find((node) => node.id === "evidence:ev-1");
  assert.ok(evidenceNode);
  assert.equal(evidenceNode!.provenanceKind, undefined);
});

test("buildProcessFlow keeps recent timeline nodes but does not draw timeline relationship edges", () => {
  const flow = buildProcessFlow({
    processes: [{ id: "run-1", status: "running", currentStep: "verify" }],
    timeline: [
      { id: "evt-1", type: "process.started", subjectRef: { kind: "run", id: "run-1" } },
      { id: "evt-2", type: "gate.opened", subjectRef: { kind: "gate", id: "gate-1" } },
      { id: "evt-3", type: "process.progressed", subjectRef: { kind: "run", id: "run-1" } },
      { id: "evt-4", type: "gate.routed_back", subjectRef: { kind: "gate", id: "gate-1" } }
    ]
  });

  assert.deepEqual(flow.nodes.filter((node) => node.kind === "timeline").map((node) => node.id), [
    "timeline:evt-2",
    "timeline:evt-3",
    "timeline:evt-4"
  ]);
  assert.equal(flow.nodes.find((node) => node.id === "timeline:evt-4")?.active, true);
  assert.equal(flow.edges.some((edge) => edge.to.startsWith("timeline:")), false);
});

test("a claim whose only evidenceRef targets nothing in the state still gets its dead node (delta review: pointers are not evidence)", () => {
  const state: OperatingState = {
    currentStage: "verify",
    processes: [{
      id: "wf", status: "running", currentStep: "verify", label: "WF",
      claimRefs: [{ kind: "claim", id: "wf:claim:dangling" }]
    }],
    gates: [],
    claims: [{
      id: "wf:claim:dangling", label: "Dangling ref claim", status: "proposed",
      evidenceRefs: [{ kind: "evidence", id: "wf:evidence:ghost" }]
    }],
    evidence: []
  };
  const flow = buildProcessFlow(state);
  const dead = flow.nodes.find((n) => n.id === "evidence:absent:wf:claim:dangling");
  assert.ok(dead, "expected a dead node: the ref target exists nowhere in the state");
  assert.equal(dead?.dead, true);
});
