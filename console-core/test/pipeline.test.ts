import assert from "node:assert/strict";
import test from "node:test";
import { buildPipeline } from "../src/pipeline";

const sampleDefinition = {
  spec: {
    steps: [
      { id: "plan", next: "implement" },
      { id: "implement", next: "verify" },
      { id: "verify", next: null },
    ],
    gates: {
      "plan-gate": {
        step: "plan",
        expects: [
          { id: "acceptance-criteria", kind: "surface.claim", required: true, description: "Acceptance criteria ready" },
        ],
      },
      "implement-gate": {
        step: "implement",
        expects: [
          { id: "scoped-diff", kind: "surface.claim", required: true, description: "Scoped diff ready" },
        ],
      },
      "verify-gate": {
        step: "verify",
        expects: [
          { id: "tests-passed", kind: "surface.claim", required: true, description: "Tests passed" },
        ],
      },
    },
  },
};

const sampleState = {
  run_id: "dev-7",
  subject: "checkout-banner",
  status: "running",
  current_step: "verify",
  gate_outcomes: [
    { gate_id: "plan-gate", status: "passed" },
    { gate_id: "implement-gate", status: "passed" },
    { gate_id: "verify-gate", status: "waiting" },
  ],
  transitions: [
    { type: "step", from_step: "plan", to_step: "implement", at: "2026-06-10T10:00:00Z" },
    { type: "step", from_step: "implement", to_step: "verify", at: "2026-06-10T11:00:00Z" },
  ],
};

test("buildPipeline: stage sequence matches spec.steps order", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  assert.deepEqual(pipeline.stages.map((s) => s.id), ["plan", "implement", "verify"]);
  assert.deepEqual(pipeline.stages.map((s) => s.order), [0, 1, 2]);
});

test("buildPipeline: next edges from spec.steps.next", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  const nextEdges = pipeline.edges.filter((e) => e.kind === "next");
  assert.equal(nextEdges.length, 2);
  assert.equal(nextEdges[0].from, "plan");
  assert.equal(nextEdges[0].to, "implement");
  assert.equal(nextEdges[1].from, "implement");
  assert.equal(nextEdges[1].to, "verify");
});

test("buildPipeline: per-stage status derivation", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  const byId = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.status]));
  assert.equal(byId["plan"], "passed");
  assert.equal(byId["implement"], "passed");
  // verify has a waiting gate, so it's blocked (not "current")
  assert.equal(byId["verify"], "blocked");
});

test("buildPipeline: blocked when runStatus is blocked", () => {
  const state = { ...sampleState, status: "blocked", current_step: "implement" };
  const pipeline = buildPipeline(sampleDefinition, state);
  const implement = pipeline.stages.find((s) => s.id === "implement");
  assert.equal(implement?.status, "blocked");
});

test("buildPipeline: route-back edge added when transition.type=route_back", () => {
  const state = {
    ...sampleState,
    current_step: "implement",
    transitions: [
      ...sampleState.transitions,
      { type: "route_back", from_step: "verify", to_step: "implement", gate_id: "verify-gate", route_reason: "tests_failed", at: "2026-06-10T12:00:00Z" },
    ],
  };
  const pipeline = buildPipeline(sampleDefinition, state);
  const routeBack = pipeline.edges.filter((e) => e.kind === "route-back");
  assert.equal(routeBack.length, 1);
  assert.equal(routeBack[0].from, "verify");
  assert.equal(routeBack[0].to, "implement");
});

test("buildPipeline: stage with route-back gate gets status failed", () => {
  const state = {
    ...sampleState,
    current_step: "implement",
    gate_outcomes: [
      { gate_id: "plan-gate", status: "passed" },
      { gate_id: "implement-gate", status: "passed" },
      { gate_id: "verify-gate", status: "failed" },
    ],
    transitions: [
      { type: "step", from_step: "plan", to_step: "implement", at: "2026-06-10T10:00:00Z" },
      { type: "step", from_step: "implement", to_step: "verify", at: "2026-06-10T11:00:00Z" },
      { type: "route_back", from_step: "verify", to_step: "implement", gate_id: "verify-gate", route_reason: "tests_failed", at: "2026-06-10T12:00:00Z" },
    ],
  };
  const pipeline = buildPipeline(sampleDefinition, state);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.equal(verify?.status, "failed");
});

test("buildPipeline: gate grouping under their step", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  const plan = pipeline.stages.find((s) => s.id === "plan");
  assert.ok(plan);
  assert.equal(plan.gates.length, 1);
  assert.equal(plan.gates[0].id, "plan-gate");
  assert.equal(plan.gates[0].status, "passed");
  assert.equal(plan.gates[0].expects.length, 1);
  assert.equal(plan.gates[0].expects[0].id, "acceptance-criteria");
  assert.equal(plan.gates[0].expects[0].required, true);
  assert.equal(plan.gates[0].expects[0].kind, "surface.claim");
});

test("buildPipeline: gate status from gate_outcomes", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify);
  assert.equal(verify.gates[0].status, "waiting");
});

test("buildPipeline: empty fallback when definition has no steps", () => {
  const pipeline = buildPipeline({ spec: { steps: [] } }, sampleState);
  assert.deepEqual(pipeline.stages, []);
  assert.deepEqual(pipeline.edges, []);
  assert.equal(pipeline.currentStageId, null);
});

test("buildPipeline: empty fallback when definition is missing", () => {
  const pipeline = buildPipeline(null, sampleState);
  assert.deepEqual(pipeline.stages, []);
  assert.deepEqual(pipeline.edges, []);
});

test("buildPipeline: empty fallback when definition is undefined", () => {
  const pipeline = buildPipeline(undefined, undefined);
  assert.deepEqual(pipeline.stages, []);
  assert.deepEqual(pipeline.edges, []);
  assert.equal(pipeline.runId, "");
});

test("buildPipeline: runId and runLabel from state", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  assert.equal(pipeline.runId, "run-dev-7");
  assert.match(pipeline.runLabel, /checkout-banner/);
  assert.match(pipeline.runLabel, /dev-7/);
});

test("buildPipeline: pending stages beyond current step", () => {
  const state = { ...sampleState, current_step: "plan", gate_outcomes: [] };
  const pipeline = buildPipeline(sampleDefinition, state);
  const implement = pipeline.stages.find((s) => s.id === "implement");
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.equal(implement?.status, "pending");
  assert.equal(verify?.status, "pending");
});

test("buildPipeline: deduplicated route-back edges", () => {
  const state = {
    ...sampleState,
    transitions: [
      { type: "route_back", from_step: "verify", to_step: "implement", gate_id: "verify-gate", route_reason: "r1" },
      { type: "route_back", from_step: "verify", to_step: "implement", gate_id: "verify-gate", route_reason: "r2" },
    ],
  };
  const pipeline = buildPipeline(sampleDefinition, state);
  const routeBack = pipeline.edges.filter((e) => e.kind === "route-back");
  assert.equal(routeBack.length, 1);
});
