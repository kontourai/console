#!/usr/bin/env -S node --import tsx
// Golden demo: one real run across the Kontour suite, using the published
// packages. A Flow run gates the work, a failed verification routes back,
// a Survey review outcome (projected through @kontourai/survey's Flow
// adapter) replaces the failed evidence, and every transition is emitted to
// the local Console hub as it happens — derived from the real run files,
// never invented.
//
// Also emits a fan-in DAG pipeline snapshot (plan + shape → implement →
// verify → publish) so the operate view shows the DAG renderer.
//
// Prereqs: `npm run dev:local` in another terminal (hub on 127.0.0.1:3737).
// Run: node --import tsx scripts/golden-demo.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPipeline } from "../console-core/src/pipeline";


const hubUrl = process.env.KONTOUR_HUB_URL ?? "http://127.0.0.1:3737";
const runId = "golden-1";
const subject = "checkout-retry-banner";
const slow = process.env.GOLDEN_DEMO_FAST ? 0 : 1400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0;

function say(line: string) {
  process.stdout.write(`${line}\n`);
}

function flow(args: string[], cwd: string): string {
  return execFileSync(join(cwd, "node_modules", ".bin", "flow"), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runState(cwd: string): { status: string; current_step: string; next_action: string } {
  return JSON.parse(readFileSync(join(cwd, ".flow", "runs", runId, "state.json"), "utf8"));
}

async function emit(type: string, summary: string, after: Record<string, unknown>) {
  sequence += 1;
  const event = {
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-golden-${sequence}`,
    type,
    occurredAt: new Date().toISOString(),
    producer: { id: "golden-demo", product: "flow", name: "Golden demo runner", runId: `run-${runId}` },
    scope: { kind: "project", id: "golden-demo", label: "Golden demo" },
    subject: { product: "flow", kind: "run", id: `run-${runId}`, label: `Agent dev run ${runId}` },
    actor: { kind: "agent", id: "demo-agent", product: "flow", label: "Demo agent" },
    correlationId: `corr-${runId}`,
    sequence,
    payload: { after, summary },
  };
  const response = await fetch(`${hubUrl}/records`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`hub rejected event ${event.id}: HTTP ${response.status}`);
}

async function stage(title: string) {
  say("");
  say(`[36m== ${title} ==[0m`);
  await sleep(slow);
}

/**
 * Builds a Hachure TrustBundle and derives a TrustReport from it via
 * buildTrustReport(). This exercises the SAME path a real Flow run uses:
 * Flow attaches a trust.bundle evidence entry, the bridge reads the bundle
 * from manifest.json, calls buildTrustReport, and attaches to the gate-expect.
 *
 * Uses dynamic import to avoid CJS-requires-ESM error in root tsconfig.
 */
async function buildTrustReportFromBundle(opts: {
  claimId: string;
  claimType: string;
  subjectType: string;
  subjectId: string;
  evidenceSummary: string;
  producer: string;
}): Promise<unknown> {
  const { buildTrustReport } = await import("@kontourai/surface");
  const now = new Date();
  // Build a Hachure-conformant TrustBundle (schemaVersion 3) — same shape
  // that Flow writes to evidence/manifest.json as a trust.bundle entry's
  // "bundle" field.
  const bundle = {
    schemaVersion: 3 as const,
    source: opts.producer,
    claims: [
      {
        id: opts.claimId,
        subjectType: opts.subjectType,
        subjectId: opts.subjectId,
        surface: opts.producer,
        claimType: opts.claimType,
        fieldOrBehavior: opts.claimType,
        value: "all checks passed",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ],
    evidence: [
      {
        id: `ev-${opts.claimId}-1`,
        claimId: opts.claimId,
        evidenceType: "test_output" as const,
        method: "validation" as const,
        sourceRef: opts.producer,
        excerptOrSummary: opts.evidenceSummary,
        observedAt: now.toISOString(),
        collectedBy: opts.producer,
        passing: true,
        supportStrength: "entails" as const,
      },
    ],
    policies: [],
    // A claim event with status="verified" is required by Surface's derivation
    // function (deriveTrustStatus) to produce a verified TrustStatus.
    events: [
      {
        id: `ev.${opts.claimId}.verified`,
        claimId: opts.claimId,
        status: "verified" as const,
        createdAt: now.toISOString(),
        actor: opts.producer,
        method: "automated-ci" as const,
        evidenceIds: [`ev-${opts.claimId}-1`],
      },
    ],
  };
  return buildTrustReport(bundle);
}

async function emitDagPipelineSnapshot() {
  // Fan-in DAG: plan + shape (parallel roots) → integrate (gateless, config-warning)
  //   → implement (needs plan+shape, current, awaiting gate) → verify (blocked) → publish
  // Demonstrates: blocked stage, current awaiting gate, configWarning on integrate.
  const dagRunId = "dag-demo-1";
  const dagDefinition = {
    spec: {
      steps: [
        { id: "plan", next: "integrate" },
        { id: "shape", next: "integrate" },
        // integrate has NO gate (configWarning will fire since it has a successor)
        { id: "integrate", next: "implement", needs: ["plan", "shape"] },
        { id: "implement", next: "verify" },
        { id: "verify", next: "publish" },
        { id: "publish", next: null },
      ],
      gates: {
        "plan-gate": {
          step: "plan",
          expects: [{
            id: "plan-done",
            kind: "trust.bundle",
            required: true,
            description: "Plan & acceptance criteria ready",
            bundle_claim: { claimType: "builder.acceptance", subjectType: "flow-step", subjectId: "builder.plan", accepted_statuses: ["verified"] },
          }],
        },
        "shape-gate": {
          step: "shape",
          expects: [{
            id: "shape-done",
            kind: "trust.bundle",
            required: true,
            description: "API shape & contract ready",
            bundle_claim: { claimType: "builder.acceptance", subjectType: "flow-step", subjectId: "builder.shape", accepted_statuses: ["verified"] },
          }],
        },
        // Note: no gate for "integrate" — intentional for config-warning demo
        "implement-gate": {
          step: "implement",
          expects: [
            {
              id: "impl-diff",
              kind: "trust.bundle",
              required: true,
              description: "Implementation scoped diff",
              bundle_claim: { claimType: "implementation.scoped-diff", subjectType: "flow-step", subjectId: "builder.implement", accepted_statuses: ["verified"] },
            },
            {
              id: "test-coverage",
              kind: "trust.bundle",
              required: false,
              description: "Test coverage report",
              bundle_claim: { claimType: "quality.coverage", subjectType: "flow-step", subjectId: "builder.implement", accepted_statuses: ["verified", "assumed"] },
            },
          ],
        },
        "verify-gate": {
          step: "verify",
          expects: [{
            id: "tests-pass",
            kind: "trust.bundle",
            required: true,
            description: "Tests passing",
            bundle_claim: { claimType: "quality.tests", subjectType: "flow-step", subjectId: "builder.verify", accepted_statuses: ["verified"] },
          }],
        },
        "publish-gate": {
          step: "publish",
          expects: [{
            id: "release-ready",
            kind: "trust.bundle",
            required: false,
            description: "Release readiness confirmed",
            bundle_claim: { claimType: "release.readiness", subjectType: "flow-step", subjectId: "builder.publish", accepted_statuses: ["verified", "assumed"] },
          }],
        },
      },
    },
  };
  const now = Date.now();
  const dagState = {
    run_id: dagRunId,
    subject: "checkout-retry-banner",
    status: "running",
    // implement is the current step; plan+shape passed; integrate passed (no gate, position-based)
    current_step: "implement",
    gate_outcomes: [
      { gate_id: "plan-gate", status: "passed" },
      { gate_id: "shape-gate", status: "passed" },
      { gate_id: "implement-gate", status: "waiting" },
    ],
    transitions: [
      { type: "step", from_step: "plan", to_step: "integrate", at: new Date(now - 3600000).toISOString() },
      { type: "step", from_step: "shape", to_step: "integrate", at: new Date(now - 3540000).toISOString() },
      { type: "step", from_step: "integrate", to_step: "implement", at: new Date(now - 3000000).toISOString() },
    ],
  };

  const dagPipeline = buildPipeline(dagDefinition, dagState);

  // Attach Surface TrustReports derived via buildTrustReport(bundle) — the same
  // path the flow-bridge uses for real runs: bundle → buildTrustReport → trustReport.
  // This exercises the REAL derivation pipeline, not a bespoke synthetic TrustReport.
  for (const stage of dagPipeline.stages) {
    for (const gate of stage.gates) {
      for (const expect of gate.expects) {
        if (expect.id === "impl-diff") {
          (expect as typeof expect & { trustReport?: unknown }).trustReport = await buildTrustReportFromBundle({
            claimId: "impl-diff",
            claimType: "implementation.scoped-diff",
            subjectType: "flow-step",
            subjectId: "builder.implement",
            evidenceSummary: "Scoped diff analysis: 14 files changed, all within the checkout module. No cross-cutting side effects detected. Coverage held at 87%.",
            producer: "ci/main",
          });
        } else if (expect.id === "plan-done") {
          (expect as typeof expect & { trustReport?: unknown }).trustReport = await buildTrustReportFromBundle({
            claimId: "plan-done",
            claimType: "builder.acceptance",
            subjectType: "flow-step",
            subjectId: "builder.plan",
            evidenceSummary: "Plan and acceptance criteria reviewed and approved by the team lead. All edge cases documented.",
            producer: "team/reviewer",
          });
        }
      }
    }
  }

  sequence += 1;
  const dagPipelineEvent = {
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-golden-dag-pipeline-${Date.now()}`,
    type: "flow.pipeline.snapshot",
    occurredAt: new Date().toISOString(),
    producer: { id: "golden-demo", product: "flow", name: "Golden demo runner", runId: `run-${dagRunId}` },
    scope: { kind: "project", id: "golden-demo", label: "Golden demo" },
    subject: { product: "flow", kind: "run", id: `run-${dagRunId}`, label: `checkout-retry-banner (${dagRunId})` },
    actor: { kind: "agent", id: "demo-agent", product: "flow", label: "Demo agent" },
    correlationId: `corr-${dagRunId}`,
    // Use sequence 2 so this event sorts after any earlier clarity-demo seq:1 events
    // and ensures the trust-report-carrying pipeline is the final state.
    sequence: 2,
    payload: {
      after: { pipeline: dagPipeline },
      summary: `DAG pipeline snapshot: ${dagPipeline.stages.length} stages, isDag=${String(dagPipeline.isDag)}, current=${dagPipeline.currentStageId ?? "none"}.`,
    },
  };
  const dagResp = await fetch(`${hubUrl}/records`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dagPipelineEvent),
  });
  if (dagResp.ok) {
    say(`DAG pipeline snapshot emitted: ${dagPipeline.stages.length} stages, isDag=${String(dagPipeline.isDag)}, current=${dagPipeline.currentStageId}`);
  } else {
    say(`DAG pipeline snapshot delivery failed: HTTP ${dagResp.status}`);
  }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "kontour-golden-"));

  await stage("Install the published packages");
  say("$ npm install @kontourai/flow @kontourai/survey");
  execFileSync("npm", ["install", "--no-fund", "--no-audit", "@kontourai/flow", "@kontourai/survey"], {
    cwd: dir, encoding: "utf8",
  });
  say("installed @kontourai/flow + @kontourai/survey from npm");

  await stage("Flow: start a gated agent-dev run");
  say("$ flow init && flow start agent-dev-flow --run-id golden-1");
  flow(["init"], dir);
  flow(["start", ".flow/definitions/agent-dev-flow.json", "--run-id", runId, "--params", `subject=${subject}`], dir);
  let state = runState(dir);
  await emit("process.started", "Agent dev run started; plan gate is open.", {
    status: "running", currentStep: state.current_step,
  });
  say(`current step: ${state.current_step}`);

  await stage("Plan gate: acceptance criteria as trusted evidence");
  const planArtifact = join(dir, "acceptance-claim.json");
  writeFileSync(planArtifact, JSON.stringify({
    schema_version: "0.1", artifact_type: "trust-report", subject: "builder.plan",
    producer: "team/reviewer", status: "trusted", issued_at: new Date().toISOString(),
    claims: [{ type: "builder.acceptance", subject: "builder.plan", status: "trusted" }],
  }));
  say("$ flow attach-evidence golden-1 --gate plan-gate --trust-artifact && flow evaluate");
  flow(["attach-evidence", runId, "--gate", "plan-gate", "--file", planArtifact, "--trust-artifact"], dir);
  say(flow(["evaluate", runId], dir).trim());
  state = runState(dir);
  await emit("process.progressed", "Plan gate passed; implementing.", {
    status: "running", currentStep: state.current_step,
  });

  await stage("Implement gate: scoped diff evidence");
  const implArtifact = join(dir, "scoped-diff-claim.json");
  writeFileSync(implArtifact, JSON.stringify({
    schema_version: "0.1", artifact_type: "trust-report", subject: "builder.implement",
    producer: "ci/main", status: "trusted", issued_at: new Date().toISOString(),
    claims: [{ type: "implementation.scoped-diff", subject: "builder.implement", status: "trusted" }],
  }));
  flow(["attach-evidence", runId, "--gate", "implement-gate", "--file", implArtifact, "--trust-artifact"], dir);
  say(flow(["evaluate", runId], dir).trim());
  state = runState(dir);
  await emit("process.progressed", "Implementation gate passed; verifying.", {
    status: "running", currentStep: state.current_step,
  });

  await stage("Verify gate: the tests fail — the gate holds");
  const failedTests = join(dir, "test-output.json");
  writeFileSync(failedTests, JSON.stringify({ suite: "unit", failed: 3 }));
  say("$ flow attach-evidence --status failed --route-reason implementation_defect");
  const failedAttach = flow(["attach-evidence", runId, "--gate", "verify-gate", "--file", failedTests,
    "--kind", "command", "--status", "failed", "--route-reason", "implementation_defect"], dir);
  const failedId = failedAttach.match(/attached evidence: (\S+)/)![1];
  say(flow(["evaluate", runId], dir).trim());
  state = runState(dir);
  await emit("gate.routed_back", "Verify gate failed; routed back to implement (attempt 1/3).", {
    status: "running", currentStep: state.current_step,
  });

  await stage("Survey: a real review outcome becomes Flow evidence");
  say("flowTrustArtifactFromReviewOutcome(reviewOutcome, { claimType: 'quality.tests', ... })");
  const survey = await import(join(dir, "node_modules", "@kontourai", "survey", "dist", "src", "index.js"));
  const reviewArtifact = survey.flowTrustArtifactFromReviewOutcome(
    { id: "review.golden-rerun", candidateSetId: "cs.tests", status: "verified",
      actor: "demo-reviewer", reviewedAt: new Date().toISOString() },
    { claimType: "quality.tests", subject: "builder.verify", producer: "ci/main" },
  );
  const reviewPath = join(dir, "review.trust.json");
  writeFileSync(reviewPath, JSON.stringify(reviewArtifact, null, 2));
  say(`survey adapter produced a ${reviewArtifact.status} quality.tests claim`);

  await stage("Flow: supersede the failed evidence and pass the gate");
  say(`$ flow attach-evidence --trust-artifact --supersede ${failedId}`);
  flow(["attach-evidence", runId, "--gate", "verify-gate", "--file", reviewPath,
    "--trust-artifact", "--supersede", failedId], dir);
  say(flow(["evaluate", runId, "--gate", "verify-gate"], dir).trim());
  state = runState(dir);
  await emit("process.progressed", "Verify gate passed on superseding Survey-reviewed evidence; ready to publish.", {
    status: "running", currentStep: state.current_step,
  });

  await stage("Resume contract: any session can pick this up");
  say(flow(["resume", runId], dir).trim());
  await emit("process.progressed", "Run is at publish with a complete evidence trail.", {
    status: "running", currentStep: state.current_step,
  });

  // Emit linear pipeline snapshot (from real Flow run files)
  await stage("Pipeline snapshot: emit CI-style pipeline to Console");
  const runDir = join(dir, ".flow", "runs", runId);
  const definitionPath = join(runDir, "definition.json");
  let pipelineEmitted = false;
  if (existsSync(definitionPath)) {
    try {
      const definition = JSON.parse(readFileSync(definitionPath, "utf8"));
      const finalState = runState(dir);
      const pipeline = buildPipeline(definition, { ...finalState, run_id: runId });
      sequence += 1;
      const pipelineEvent = {
        schema: "kontour.console.event",
        version: "0.1",
        id: `evt-golden-pipeline`,
        type: "flow.pipeline.snapshot",
        occurredAt: new Date().toISOString(),
        producer: { id: "golden-demo", product: "flow", name: "Golden demo runner", runId: `run-${runId}` },
        scope: { kind: "project", id: "golden-demo", label: "Golden demo" },
        subject: { product: "flow", kind: "run", id: `run-${runId}`, label: `Agent dev run ${runId}` },
        actor: { kind: "agent", id: "demo-agent", product: "flow", label: "Demo agent" },
        correlationId: `corr-${runId}`,
        sequence: 0,
        payload: {
          after: { pipeline },
          summary: `Pipeline snapshot: ${pipeline.stages.length} stages, currentStageId=${pipeline.currentStageId ?? "none"}.`,
        },
      };
      const pipelineResp = await fetch(`${hubUrl}/records`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pipelineEvent),
      });
      if (pipelineResp.ok) {
        say(`pipeline snapshot emitted: ${pipeline.stages.length} stages, current=${pipeline.currentStageId}`);
        pipelineEmitted = true;
      } else {
        say(`pipeline snapshot delivery failed: HTTP ${pipelineResp.status}`);
      }
    } catch (pipelineError) {
      say(`pipeline snapshot skipped: ${pipelineError instanceof Error ? pipelineError.message : String(pipelineError)}`);
    }
  } else {
    // Construct minimal honest pipeline from the steps exercised
    say("definition.json not found; constructing minimal pipeline from exercised steps");
    const finalState = runState(dir);
    const trustBundleExpect = (id: string, claimType: string, description: string, required = true) => ({
      id,
      kind: "trust.bundle",
      required,
      description,
      bundle_claim: { claimType, subjectType: "flow-step", subjectId: `builder.${id}`, accepted_statuses: ["verified"] },
    });
    const minimalDefinition = {
      spec: {
        steps: [
          { id: "plan", next: "implement" },
          { id: "implement", next: "verify" },
          { id: "verify", next: "publish" },
          { id: "publish", next: null },
        ],
        gates: {
          "plan-gate": { step: "plan", expects: [trustBundleExpect("acceptance-criteria", "builder.acceptance", "Acceptance criteria ready")] },
          "implement-gate": { step: "implement", expects: [trustBundleExpect("scoped-diff", "implementation.scoped-diff", "Implementation scoped diff")] },
          "verify-gate": { step: "verify", expects: [trustBundleExpect("tests-passed", "quality.tests", "Tests passed")] },
          "publish-gate": { step: "publish", expects: [trustBundleExpect("publish-ready", "release.readiness", "Publish readiness", false)] },
        }
      }
    };
    const pipeline = buildPipeline(minimalDefinition, { ...finalState, run_id: runId });
    sequence += 1;
    const pipelineEvent = {
      schema: "kontour.console.event",
      version: "0.1",
      id: `evt-golden-pipeline`,
      type: "flow.pipeline.snapshot",
      occurredAt: new Date().toISOString(),
      producer: { id: "golden-demo", product: "flow", name: "Golden demo runner", runId: `run-${runId}` },
      scope: { kind: "project", id: "golden-demo", label: "Golden demo" },
      subject: { product: "flow", kind: "run", id: `run-${runId}`, label: `Agent dev run ${runId}` },
      actor: { kind: "agent", id: "demo-agent", product: "flow", label: "Demo agent" },
      correlationId: `corr-${runId}`,
      sequence: 0,
      payload: {
        after: { pipeline },
        summary: `Pipeline snapshot: ${pipeline.stages.length} stages (minimal fallback), currentStageId=${pipeline.currentStageId ?? "none"}.`,
      },
    };
    const pipelineResp = await fetch(`${hubUrl}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pipelineEvent),
    });
    if (pipelineResp.ok) {
      say(`pipeline snapshot emitted (minimal fallback): ${pipeline.stages.length} stages, current=${pipeline.currentStageId}`);
      pipelineEmitted = true;
    }
  }
  say(pipelineEmitted ? "pipeline snapshot ready in the Console operate view" : "pipeline snapshot skipped");

  // Emit DAG pipeline snapshot (fan-in: plan + shape → implement → verify → publish)
  await stage("DAG pipeline snapshot: fan-in DAG pipeline to Console operate view");
  await emitDagPipelineSnapshot();

  say("");
  say(`[32mGolden demo complete: ${sequence} events streamed to the Console hub.[0m`);
  say(`run directory: ${join(dir, ".flow", "runs", runId)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
