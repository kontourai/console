// Regenerates the gate-scorecard REAL-PRODUCER fixtures (console#277/#278 review
// round 1, finding HIGH-7: fixture-vs-reality).
//
// The projections under test/fixtures/gate-scorecard/ are NOT hand-written: this
// script drives Flow's OWN state machinery (`initialState`, `evaluateGate`,
// `applyEvaluation`) through a small run and captures what the actual
// `projectFlowRun` producer emits at two snapshots. Hand-written fixtures are what
// masked review findings 1/4/5 (flat run identity, singular expectation_id, no
// canonical route_backs[]) — anything the fold reads must come out of the producer.
//
//   node test/fixtures/generate-gate-scorecard-fixtures.mjs
//
// Deterministic apart from producer-written timestamps; regenerate only when Flow's
// projection contract changes, and re-read the diff when you do.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectFlowRun } from "@kontourai/flow/console-contract";
import { applyEvaluation, evaluateGate, initialState } from "@kontourai/flow";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "gate-scorecard");
mkdirSync(outDir, { recursive: true });

// A three-step flow: a route-back-configured gate, a plain blocking gate, and an
// idle `wait` gate (no expectations) the run never reaches. `verify.tests` and
// `publish.window` exist precisely because the reviewer reproduced the fold
// counting every DECLARED gate (including idle wait gates) as invoked.
const definition = {
  id: "builder.demo",
  version: "1",
  title: "Builder demo flow",
  steps: [
    { id: "plan", label: "Plan", next: "build" },
    { id: "build", label: "Build", next: "verify" },
    { id: "verify", label: "Verify", next: null }
  ],
  gates: {
    "plan.review": {
      step: "plan",
      expects: [{ id: "plan.approved", kind: "trust.bundle", required: true, description: "Plan approved by an owner-authorized reviewer.", bundle_claim: { claimType: "plan.approved" } }],
      on_route_back: { default: "plan" }
    },
    "verify.tests": {
      step: "build",
      expects: [{ id: "tests.green", kind: "trust.bundle", required: true, description: "Test suite ran green on the candidate tree.", bundle_claim: { claimType: "tests.green" } }]
    },
    "publish.window": {
      step: "verify",
      expects: []
    }
  }
};

const state = initialState(definition, "run-builder-demo-1", { subject: "demo-slice" });
const manifest = { evidence: [] };

// 1. Failing evidence on plan.review -> Flow's own routeBackDecision produces a
//    route-back outcome, and applyEvaluation writes BOTH the gate_outcome and the
//    paired route_back transition. The canonical route_backs[] array therefore
//    carries the same event under two sources — the double-count trap HIGH-5 names.
manifest.evidence.push({
  id: "ev-plan-1",
  gate_id: "plan.review",
  kind: "trust.bundle",
  status: "failed",
  route_reason: "default",
  expectation_ids: ["plan.approved"]
});
const routeBackOutcome = evaluateGate(definition, state, manifest, "plan.review");
if (routeBackOutcome.status !== "route-back") {
  throw new Error(`expected a route-back outcome, got ${routeBackOutcome.status}`);
}
applyEvaluation(definition, state, routeBackOutcome);

// SNAPSHOT A (mid-run): plan.review routed back; verify.tests is UNREACHED but the
// producer computes "block" for it (required evidence missing); publish.window is
// an idle "wait" gate. A fold reading bare statuses counts both as invoked.
const snapshotA = projectFlowRun({ definition, state, manifest });

// 2. Recover: supersede the failing evidence and accept an exception for
//    plan.review — the REAL pass path in evaluateGate that needs no Surface
//    bundle. The gate passes and the run advances to `build`.
manifest.evidence[0].superseded_by = "exc-plan-1";
state.exceptions.push({
  id: "exc-plan-1",
  gate_id: "plan.review",
  reason: "owner-accepted demo exception",
  authority: "owner",
  accepted_at: new Date().toISOString(),
  evidence_refs: []
});
const passOutcome = evaluateGate(definition, state, manifest, "plan.review");
if (passOutcome.status !== "pass") {
  throw new Error(`expected a pass outcome, got ${passOutcome.status}`);
}
applyEvaluation(definition, state, passOutcome);

// 3. verify.tests: attach evidence that names BOTH a declared expectation and one
//    no gate in this flow declares ("ghost.expectation") — the HIGH-4 orphan case,
//    emitted by the real producer with PLURAL `expectation_ids`. The evidence does
//    not satisfy the trust.bundle expectation, so the reached gate blocks.
manifest.evidence.push({
  id: "ev-verify-1",
  gate_id: "verify.tests",
  kind: "note",
  status: "collected",
  expectation_ids: ["tests.green", "ghost.expectation"]
});
const blockOutcome = evaluateGate(definition, state, manifest, "verify.tests");
if (blockOutcome.status !== "block") {
  throw new Error(`expected a block outcome, got ${blockOutcome.status}`);
}
applyEvaluation(definition, state, blockOutcome);

// SNAPSHOT B (later snapshot of the SAME run): plan.review passed, verify.tests
// reached-and-blocked (is_open, evidence attached), publish.window still idle.
// Ingesting A then B must supersede, not double-count (MED-8).
const snapshotB = projectFlowRun({ definition, state, manifest });

// A SECOND flow that declares the same expectation id ("plan.approved") as
// builder.demo — the HIGH-4 declaration collision, again producer-emitted.
const otherDefinition = {
  id: "other.flow",
  version: "1",
  steps: [{ id: "intake", label: "Intake", next: null }],
  gates: {
    "intake.review": {
      step: "intake",
      expects: [{ id: "plan.approved", kind: "trust.bundle", required: true, description: "Plan approved by an owner-authorized reviewer.", bundle_claim: { claimType: "plan.approved" } }]
    }
  }
};
const otherState = initialState(otherDefinition, "run-other-flow-1", { subject: "other-subject" });
const otherProjection = projectFlowRun({ definition: otherDefinition, state: otherState, manifest: { evidence: [] } });

const write = (name, value) => {
  writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${name}`);
};
write("builder-demo.snapshot-a.json", snapshotA);
write("builder-demo.snapshot-b.json", snapshotB);
write("other-flow.json", otherProjection);
