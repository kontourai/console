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
