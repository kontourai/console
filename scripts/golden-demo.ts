#!/usr/bin/env -S node --import tsx
// Golden demo: one real run across the Kontour suite, using the published
// packages. A Flow run gates the work, a failed verification routes back,
// a Survey review outcome (projected through @kontourai/survey's Flow
// adapter) replaces the failed evidence, and every transition is emitted to
// the local Console hub as it happens — derived from the real run files,
// never invented.
//
// Prereqs: `npm run dev:local` in another terminal (hub on 127.0.0.1:3737).
// Run: node --import tsx scripts/golden-demo.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  say(`[36m== ${title} ==[0m`);
  await sleep(slow);
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

  say("");
  say(`[32mGolden demo complete: ${sequence} events streamed to the Console hub.[0m`);
  say(`run directory: ${join(dir, ".flow", "runs", runId)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
