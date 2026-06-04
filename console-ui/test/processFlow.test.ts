import assert from "node:assert/strict";
import test from "node:test";
import { buildProcessFlow } from "../src/utils/processFlow";
import type { OperatingState } from "../src/types";

test("buildProcessFlow keeps unreferenced lane items visible without invented edges", () => {
  const flow = buildProcessFlow({
    currentStage: "Checking gate",
    processes: [{ id: "run-1", status: "running", currentStep: "verify", label: "Run 1" }],
    gates: [{ id: "gate-unlinked", status: "waiting", label: "Unlinked gate" }],
    claims: [{ id: "claim-unlinked", status: "verified", label: "Unlinked claim" }],
    actions: [{ id: "action-unlinked", status: "available", label: "Unlinked action" }],
    timeline: [{ id: "evt-1", type: "gate.opened", subjectRef: { kind: "gate", id: "gate-unlinked" } }]
  });

  assert.deepEqual(flow.nodes.map((node) => node.id), [
    "stage",
    "process:run-1",
    "step:run-1",
    "gate:gate-unlinked",
    "claim:claim-unlinked",
    "action:action-unlinked",
    "timeline:evt-1"
  ]);
  assert.deepEqual(flow.edges.map((edge) => edge.id), ["stage-process", "process-step"]);
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
    "process:run-1-action:action-1",
    "gate:gate-1-claim:claim-1"
  ]);
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
