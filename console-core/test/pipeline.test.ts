import assert from "node:assert/strict";
import test from "node:test";
import { buildPipeline } from "../src/pipeline";

const trustBundleExpect = (id: string, claimType: string, description: string, required = true) => ({
  id,
  kind: "trust.bundle",
  required,
  description,
  bundle_claim: {
    claimType,
    subjectType: "flow-step",
    subjectId: `builder.${id}`,
    accepted_statuses: ["verified"],
  },
});

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
          trustBundleExpect("acceptance-criteria", "builder.acceptance", "Acceptance criteria ready"),
        ],
      },
      "implement-gate": {
        step: "implement",
        expects: [
          trustBundleExpect("scoped-diff", "implementation.scoped-diff", "Scoped diff ready"),
        ],
      },
      "verify-gate": {
        step: "verify",
        expects: [
          trustBundleExpect("tests-passed", "quality.tests", "Tests passed"),
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
  assert.equal(plan.gates[0].expects[0].kind, "builder.acceptance");
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

// ── DAG tests ────────────────────────────────────────────────────────────────

// Definition: plan + shape (parallel roots) → implement (needs both) → verify → publish
const dagDefinition = {
  spec: {
    steps: [
      { id: "plan", next: "implement" },
      { id: "shape", next: "implement" },
      { id: "implement", next: "verify", needs: ["plan", "shape"] },
      { id: "verify", next: "publish" },
      { id: "publish", next: null },
    ],
    gates: {
      "plan-gate": { step: "plan", expects: [trustBundleExpect("plan-done", "builder.acceptance", "Plan ready")] },
      "shape-gate": { step: "shape", expects: [trustBundleExpect("shape-done", "builder.acceptance", "Shape ready")] },
      "implement-gate": { step: "implement", expects: [trustBundleExpect("impl-done", "implementation.scoped-diff", "Implementation done")] },
      "verify-gate": { step: "verify", expects: [trustBundleExpect("tests-passed", "quality.tests", "Tests passed")] },
      "publish-gate": { step: "publish", expects: [trustBundleExpect("publish-ready", "release.readiness", "Publish readiness", false)] },
    },
  },
};

// State: plan passed, shape passed, implement is current
const dagState = {
  run_id: "dag-run-1",
  subject: "dag-feature",
  status: "running",
  current_step: "implement",
  gate_outcomes: [
    { gate_id: "plan-gate", status: "passed" },
    { gate_id: "shape-gate", status: "passed" },
    { gate_id: "implement-gate", status: "pending" },
  ],
  transitions: [
    { type: "step", from_step: "plan", to_step: "implement", at: "2026-06-10T10:00:00Z" },
    { type: "step", from_step: "shape", to_step: "implement", at: "2026-06-10T10:01:00Z" },
  ],
};

test("buildPipeline DAG: isDag is true when any step has needs", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  assert.equal(pipeline.isDag, true);
});

test("buildPipeline DAG: isDag is undefined for pure linear definitions", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  assert.equal(pipeline.isDag, undefined);
});

test("buildPipeline DAG: stage sequence matches spec.steps order", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  assert.deepEqual(pipeline.stages.map((s) => s.id), ["plan", "shape", "implement", "verify", "publish"]);
});

test("buildPipeline DAG: fan-in edges from needs predecessors", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  const nextEdges = pipeline.edges.filter((e) => e.kind === "next");
  // implement needs [plan, shape] → two fan-in edges: plan→implement, shape→implement
  const planToImpl = nextEdges.find((e) => e.from === "plan" && e.to === "implement");
  const shapeToImpl = nextEdges.find((e) => e.from === "shape" && e.to === "implement");
  assert.ok(planToImpl, "should have plan→implement edge");
  assert.ok(shapeToImpl, "should have shape→implement edge");
});

test("buildPipeline DAG: next edges still present for non-needs steps", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  const nextEdges = pipeline.edges.filter((e) => e.kind === "next");
  const verifyToPublish = nextEdges.find((e) => e.from === "verify" && e.to === "publish");
  assert.ok(verifyToPublish, "should have verify→publish edge");
});

test("buildPipeline DAG: plan=passed, shape=passed, implement=current", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  const byId = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.status]));
  assert.equal(byId["plan"], "passed");
  assert.equal(byId["shape"], "passed");
  assert.equal(byId["implement"], "current");
});

test("buildPipeline DAG: verify is ready when predecessors passed (but not started)", () => {
  // Make implement also passed, so verify should be ready
  const state = {
    ...dagState,
    current_step: "verify",
    gate_outcomes: [
      { gate_id: "plan-gate", status: "passed" },
      { gate_id: "shape-gate", status: "passed" },
      { gate_id: "implement-gate", status: "passed" },
    ],
  };
  const pipeline = buildPipeline(dagDefinition, state);
  const byId = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.status]));
  assert.equal(byId["implement"], "passed");
  assert.equal(byId["verify"], "current");
  assert.equal(byId["publish"], "blocked");
});

test("buildPipeline DAG: publish is blocked when verify not yet passed", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  const byId = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.status]));
  assert.equal(byId["verify"], "blocked");
  assert.equal(byId["publish"], "blocked");
});

test("buildPipeline DAG: root steps (plan, shape) with no predecessors", () => {
  // At start, before any step runs
  const state = {
    ...dagState,
    current_step: "plan",
    gate_outcomes: [],
    transitions: [],
  };
  const pipeline = buildPipeline(dagDefinition, state);
  const byId = Object.fromEntries(pipeline.stages.map((s) => [s.id, s.status]));
  assert.equal(byId["plan"], "current");
  // shape is a root too, so it would be pending (no predecessors and not current)
  // implement is blocked (predecessors not passed)
  assert.equal(byId["implement"], "blocked");
});

// ── reason and configWarning tests ─────────────────────────────────────────

test("buildPipeline: reason=Complete for passed stage", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  const plan = pipeline.stages.find((s) => s.id === "plan");
  assert.ok(plan);
  assert.equal(plan.reason, "Complete");
});

test("buildPipeline: reason contains gate id for current+waiting stage", () => {
  // verify is current but has a waiting gate → "Awaiting evidence for verify-gate"
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify);
  // verify status is "blocked" in the sample (waiting gate) — not "current"
  // so reason should explain blocked state. But actually verify is "blocked" per existing test.
  // Let's use a state where verify is current with no waiting gate first:
  const currentNoWait = {
    ...sampleState,
    current_step: "verify",
    gate_outcomes: [
      { gate_id: "plan-gate", status: "passed" },
      { gate_id: "implement-gate", status: "passed" },
    ],
  };
  const p2 = buildPipeline(sampleDefinition, currentNoWait);
  const v2 = p2.stages.find((s) => s.id === "verify");
  assert.ok(v2);
  assert.equal(v2.status, "current");
  assert.equal(v2.reason, "Awaiting evidence for verify-gate");
});

test("buildPipeline: reason=In progress for current with no gate and no waiting", () => {
  // A definition with no gates on verify, current_step=verify
  const defNoGates = {
    spec: {
      steps: [
        { id: "plan", next: "verify" },
        { id: "verify", next: null },
      ],
      gates: {
        "plan-gate": {
          step: "plan",
          expects: [trustBundleExpect("acceptance-criteria", "builder.acceptance", "Acceptance criteria ready")],
        },
      },
    },
  };
  const st = { run_id: "r1", status: "running", current_step: "verify", gate_outcomes: [{ gate_id: "plan-gate", status: "passed" }], transitions: [] };
  const pipeline = buildPipeline(defNoGates, st);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify);
  assert.equal(verify.status, "current");
  assert.equal(verify.reason, "In progress");
});

test("buildPipeline: reason=Not yet reachable for pending stage", () => {
  const state = { ...sampleState, current_step: "plan", gate_outcomes: [] };
  const pipeline = buildPipeline(sampleDefinition, state);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify);
  assert.equal(verify.status, "pending");
  assert.equal(verify.reason, "Not yet reachable");
});

test("buildPipeline: reason includes gate id for failed stage", () => {
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
  assert.ok(verify);
  assert.equal(verify.status, "failed");
  assert.match(verify.reason ?? "", /verify-gate/);
  assert.match(verify.reason ?? "", /tests_failed/);
});

test("buildPipeline: configWarning set for non-terminal gateless stage", () => {
  // implement has no gate and has a successor (verify)
  const defPartial = {
    spec: {
      steps: [
        { id: "plan", next: "implement" },
        { id: "implement", next: "verify" },  // NO gate
        { id: "verify", next: null },
      ],
      gates: {
        "plan-gate": { step: "plan", expects: [trustBundleExpect("ac", "builder.acceptance", "AC")] },
        "verify-gate": { step: "verify", expects: [trustBundleExpect("tests", "quality.tests", "Tests")] },
      },
    },
  };
  const st = { run_id: "r1", status: "running", current_step: "implement", gate_outcomes: [{ gate_id: "plan-gate", status: "passed" }], transitions: [] };
  const pipeline = buildPipeline(defPartial, st);
  const implement = pipeline.stages.find((s) => s.id === "implement");
  assert.ok(implement);
  assert.ok(implement.configWarning, "should have configWarning");
  assert.match(implement.configWarning ?? "", /No gate defined/);
});

test("buildPipeline: no configWarning for terminal gateless stage", () => {
  // The last stage (publish) has no gate and no successor → no configWarning
  const defTerminal = {
    spec: {
      steps: [
        { id: "plan", next: "publish" },
        { id: "publish", next: null },  // terminal, no gate — fine
      ],
      gates: {
        "plan-gate": { step: "plan", expects: [trustBundleExpect("ac", "builder.acceptance", "AC")] },
      },
    },
  };
  const st = { run_id: "r1", status: "running", current_step: "plan", gate_outcomes: [], transitions: [] };
  const pipeline = buildPipeline(defTerminal, st);
  const publish = pipeline.stages.find((s) => s.id === "publish");
  assert.ok(publish);
  assert.equal(publish.configWarning, undefined);
});

test("buildPipeline: no configWarning when gate is present", () => {
  const pipeline = buildPipeline(sampleDefinition, sampleState);
  for (const stage of pipeline.stages) {
    assert.equal(stage.configWarning, undefined, `stage ${stage.id} should not have configWarning`);
  }
});

// DAG reason tests
test("buildPipeline DAG: blocked reason names unmet predecessors", () => {
  const pipeline = buildPipeline(dagDefinition, dagState);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify);
  assert.equal(verify.status, "blocked");
  assert.ok(verify.reason?.includes("implement"), `reason should mention 'implement', got: ${verify.reason}`);
});

test("buildPipeline DAG: ready reason is 'Dependencies met — ready to run'", () => {
  const state = {
    ...dagState,
    current_step: "verify",
    gate_outcomes: [
      { gate_id: "plan-gate", status: "passed" },
      { gate_id: "shape-gate", status: "passed" },
      { gate_id: "implement-gate", status: "passed" },
    ],
  };
  // In this scenario verify is current, publish should be blocked (not ready yet)
  // Let's find a ready stage by making implement passed and not starting verify
  const stateReady = {
    ...dagState,
    current_step: "verify",
    gate_outcomes: [
      { gate_id: "plan-gate", status: "passed" },
      { gate_id: "shape-gate", status: "passed" },
      { gate_id: "implement-gate", status: "passed" },
      { gate_id: "verify-gate", status: "pending" },
    ],
  };
  const pipeline = buildPipeline(dagDefinition, stateReady);
  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify);
  assert.equal(verify.status, "current");
  // publish is blocked here (verify not passed)
  const publish = pipeline.stages.find((s) => s.id === "publish");
  assert.ok(publish);
  assert.equal(publish.status, "blocked");
});

// ── trust.bundle gate expect tests ───────────────────────────────────────────

test("buildPipeline: trust.bundle expect has kind=claimType from bundle_claim", () => {
  const def = {
    spec: {
      steps: [
        { id: "verify", next: null },
      ],
      gates: {
        "verify-gate": {
          step: "verify",
          expects: [
            {
              id: "tests-passed",
              kind: "trust.bundle",
              required: true,
              description: "Test results are ready for verification.",
              bundle_claim: {
                claimType: "quality.tests",
                subjectType: "flow-step",
                subjectId: "builder.verify",
                accepted_statuses: ["verified"],
              },
            },
          ],
        },
      },
    },
  };
  const state = { run_id: "r1", status: "running", current_step: "verify", gate_outcomes: [], transitions: [] };
  const pipeline = buildPipeline(def, state);

  const verify = pipeline.stages.find((s) => s.id === "verify");
  assert.ok(verify, "verify stage should exist");
  const gate = verify.gates[0];
  assert.ok(gate, "verify-gate should exist");
  const expect_ = gate.expects[0];
  assert.ok(expect_, "tests-passed expect should exist");
  assert.equal(expect_.id, "tests-passed");
  // kind should be the claimType (quality.tests) from bundle_claim
  assert.equal(expect_.kind, "quality.tests", "expect.kind should be bundle_claim.claimType");
  // label comes from description
  assert.equal(expect_.label, "Test results are ready for verification.");
  assert.equal(expect_.required, true);
});

test("buildPipeline: trust.bundle expect without bundle_claim falls back to raw kind", () => {
  const def = {
    spec: {
      steps: [{ id: "verify", next: null }],
      gates: {
        "verify-gate": {
          step: "verify",
          expects: [
            { id: "tb-expect", kind: "trust.bundle", required: true, description: "A trust bundle" },
          ],
        },
      },
    },
  };
  const state = { run_id: "r1", status: "running", current_step: "verify", gate_outcomes: [], transitions: [] };
  const pipeline = buildPipeline(def, state);
  const expect_ = pipeline.stages[0].gates[0].expects[0];
  // No bundle_claim → kind stays as "trust.bundle"
  assert.equal(expect_.kind, "trust.bundle");
});

test("buildPipeline: trust.bundle expect label falls back to claimType when no description", () => {
  const def = {
    spec: {
      steps: [{ id: "verify", next: null }],
      gates: {
        "verify-gate": {
          step: "verify",
          expects: [
            {
              id: "tests-passed",
              kind: "trust.bundle",
              required: true,
              // no description — should fall back to claimType
              bundle_claim: { claimType: "quality.tests", subjectId: "builder.verify", accepted_statuses: ["verified"] },
            },
          ],
        },
      },
    },
  };
  const state = { run_id: "r1", status: "running", current_step: "verify", gate_outcomes: [], transitions: [] };
  const pipeline = buildPipeline(def, state);
  const expect_ = pipeline.stages[0].gates[0].expects[0];
  assert.equal(expect_.kind, "quality.tests");
  // No description; label falls back to claimType (since claimType is defined)
  assert.equal(expect_.label, "quality.tests");
});
