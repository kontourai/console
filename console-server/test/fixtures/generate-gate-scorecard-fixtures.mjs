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
//   node test/fixtures/generate-gate-scorecard-fixtures.mjs [outDir]
//
// `outDir` defaults to test/fixtures/gate-scorecard/. The regenerate-and-compare
// test runs this script against the INSTALLED @kontourai/flow into a temp dir and
// diffs (timestamp-normalized) against the checked-in fixtures, so a Flow upgrade
// that changes the wire shape reds that test instead of silently rotting these files.
//
// Deterministic apart from producer-written timestamps; regenerate only when Flow's
// projection contract changes, and re-read the diff when you do.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectFlowRun } from "@kontourai/flow/console-contract";
import { applyEvaluation, evaluateGate, initialState } from "@kontourai/flow";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, "gate-scorecard");
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

// THE INDETERMINATE PAIR (round-2 finding HIGH-1, reproducing the reviewer's
// scenario): one gate with a REAL persisted "block" gate_outcome that the run
// advanced past (evidence-less — its failing evaluation attached nothing), and
// one gate on a FUTURE step whose "block" is only the producer's lazy computation.
// Their projections are byte-identical on every field the fold can consume
// (asserted below), which is exactly why the fold must classify BOTH as
// `indeterminate` rather than guess refusal or never_invoked.
const indeterminateDefinition = {
  id: "indeterminate.demo",
  version: "1",
  steps: [
    { id: "plan", label: "Plan", next: "build" },
    { id: "build", label: "Build", next: "done" },
    { id: "done", label: "Done", next: null }
  ],
  gates: {
    "checks.static": {
      step: "plan",
      expects: [{ id: "static.clean", kind: "trust.bundle", required: true, description: "Static checks ran clean.", bundle_claim: { claimType: "static.clean" } }]
    },
    "review.approve": {
      step: "plan",
      expects: [{ id: "review.approved", kind: "trust.bundle", required: true, description: "Reviewer approved the plan.", bundle_claim: { claimType: "review.approved" } }]
    },
    "future.check": {
      step: "done",
      expects: [{ id: "future.report", kind: "trust.bundle", required: true, description: "Final report collected.", bundle_claim: { claimType: "future.report" } }]
    }
  }
};
const indeterminateState = initialState(indeterminateDefinition, "run-indeterminate-1", { subject: "indeterminate-subject" });
const indeterminateManifest = { evidence: [] };

// 1. REALLY evaluate checks.static with no evidence: a persisted "block" outcome.
const persistedBlock = evaluateGate(indeterminateDefinition, indeterminateState, indeterminateManifest, "checks.static");
if (persistedBlock.status !== "block") {
  throw new Error(`expected a block outcome for checks.static, got ${persistedBlock.status}`);
}
applyEvaluation(indeterminateDefinition, indeterminateState, persistedBlock);

// 2. Pass review.approve via an accepted exception so the run ADVANCES past the
//    blocked gate's step (is_open goes false for checks.static).
indeterminateState.exceptions.push({
  id: "exc-review-1",
  gate_id: "review.approve",
  reason: "owner-accepted demo exception",
  authority: "owner",
  accepted_at: new Date().toISOString(),
  evidence_refs: []
});
const advanceOutcome = evaluateGate(indeterminateDefinition, indeterminateState, indeterminateManifest, "review.approve");
if (advanceOutcome.status !== "pass") {
  throw new Error(`expected a pass outcome for review.approve, got ${advanceOutcome.status}`);
}
applyEvaluation(indeterminateDefinition, indeterminateState, advanceOutcome);

// Ground truth: the state PROVES only checks.static was really evaluated.
if (!indeterminateState.gate_outcomes.some((o) => o.gate_id === "checks.static" && o.status === "block")) {
  throw new Error("expected a persisted block gate_outcome for checks.static");
}
if (indeterminateState.gate_outcomes.some((o) => o.gate_id === "future.check")) {
  throw new Error("future.check must have NO persisted outcome (its block is lazily computed)");
}

const indeterminateProjection = projectFlowRun({
  definition: indeterminateDefinition,
  state: indeterminateState,
  manifest: indeterminateManifest
});

// The projection must NOT be able to tell them apart on any consumed field —
// if this ever throws, Flow gained an evaluation-provenance marker and the
// fold's `indeterminate` state can finally be split honestly.
const consumed = (gate) => JSON.stringify({
  status: gate.status,
  is_open: gate.is_open,
  evidence: gate.evidence,
  evidence_refs: gate.evidence_refs,
  matched_expectations: gate.matched_expectations,
  accepted_exception_id: gate.accepted_exception_id ?? null
});
const projectedReal = indeterminateProjection.gates.find((gate) => gate.id === "checks.static");
const projectedLazy = indeterminateProjection.gates.find((gate) => gate.id === "future.check");
if (consumed(projectedReal) !== consumed(projectedLazy)) {
  throw new Error(`persisted-block and computed-block projections diverged on consumed fields:\n${consumed(projectedReal)}\n${consumed(projectedLazy)}`);
}

// ── THE COST-ENRICHMENT JOIN TARGET (console#277 layer 2) ─────────────────────
//
// The transition fixtures under test/fixtures/flow-agents-transitions/ are REAL
// records copied out of a live `.flow-agents/telemetry/transitions.jsonl`, and
// they name real expectation ids of the real `builder.shape` flow. So the flow
// side of the join must be that same real flow, not a stand-in: `builder-shape.flow.json`
// is `kits/builder/flows/shape.flow.json` copied VERBATIM out of kontourai/flow-agents,
// and the projection below is what Flow's own producer emits for a run of it.
//
// Both halves of the join are therefore producer-emitted: the fixture cannot
// agree with a shape no producer writes, which is the #278 round-1 defect
// (fixture-vs-reality) applied to layer 2's new record kind.
const shapeDefinition = JSON.parse(readFileSync(path.join(here, "gate-scorecard", "builder-shape.flow.json"), "utf8"));
const shapeState = initialState(shapeDefinition, "run-builder-shape-1", { subject: "shape-subject" });
const shapeProjection = projectFlowRun({ definition: shapeDefinition, state: shapeState, manifest: { evidence: [] } });

// A SECOND flow declaring `shaped-problem` — the expectation-id collision, on
// the transition side this time. flow-agents' own transition log carries the
// hazard in its module doc ("expectation ids are unique within a flow but not
// across flows — the shipped kits share one"), which is why the producer derives
// `targets.flow` from run state at all. A transition naming a shared id with no
// `--flow` to disambiguate must be reported, never posted to a gate that may not
// have seen it. Mirrors `other-flow` on the layer-1 (evidence) side.
const shapeRivalDefinition = {
  id: "other.shape",
  version: "1",
  steps: [{ id: "shape", next: null }],
  gates: {
    "rival-shape-gate": {
      step: "shape",
      expects: [{ id: "shaped-problem", kind: "trust.bundle", required: true, description: "A rival flow declaring the same expectation id.", bundle_claim: { claimType: "builder.shape.problem" } }]
    }
  }
};
const shapeRivalState = initialState(shapeRivalDefinition, "run-other-shape-1", { subject: "rival-subject" });
const shapeRivalProjection = projectFlowRun({ definition: shapeRivalDefinition, state: shapeRivalState, manifest: { evidence: [] } });

const write = (name, value) => {
  writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${name}`);
};
write("builder-demo.snapshot-a.json", snapshotA);
write("builder-demo.snapshot-b.json", snapshotB);
write("other-flow.json", otherProjection);
write("indeterminate-demo.json", indeterminateProjection);
write("builder-shape.json", shapeProjection);
write("other-shape.json", shapeRivalProjection);
