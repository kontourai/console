const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  KontourEmitter,
  LocalFileSink,
  inspectLocalKontour,
  getFlowProcessStatus,
  validateEvent,
  validateProjection,
  flowProcessStateToProjection,
  flowGateTransitionToEvent
} = require("../src/console-foundation");

test("flow process helper emits local process and gate status without selected Surface or live Flow state", async () => {
  const rootDir = tempRoot();
  const state = flowProcessState();
  Object.defineProperty(state.gates[0], "__proto__", {
    value: { polluted: true },
    enumerable: true
  });
  const projection = flowProcessStateToProjection(state);
  const validationErrors = validateProjection(projection, "flow-projection")
    .filter((item: any) => item.severity === "error");
  const emitter = new KontourEmitter({
    sink: new LocalFileSink({ root: path.join(rootDir, ".kontour") })
  });

  const result = await emitter.emitProjection(projection);
  const report = inspectLocalKontour({ rootDir });
  const statuses = getFlowProcessStatus(report.projections, { processId: "run-provider-onboarding-42" });

  assert.equal(validationErrors.length, 0);
  assert.equal(result.outcome, "accepted");
  assert.equal(report.validation.errors.length, 0);
  assert.equal(report.projections.length, 1);
  assert.equal(report.projections[0].snapshot.producer.product, "flow");
  assert.equal(Object.getPrototypeOf(report.projections[0].snapshot.gates[0]).polluted, undefined);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, "running");
  assert.deepEqual(statuses[0].currentStep, { id: "review-provider-fields", label: "Review provider fields" });
  assert.equal(statuses[0].percentComplete, 62);
  assert.equal(statuses[0].openGateRefs[0].id, "gate-provider-review");
  assert.equal(statuses[0].openGateRefs[0].uid, "flow-gate-provider-review");
  assert.equal(statuses[0].gates.length, 2);
  assert.deepEqual(statuses[0].gates.map((gate: any) => gate.status).sort(), ["open", "passed"]);
  assert.equal(statuses[0].gates[0].gateRef.uid, "flow-gate-provider-review");
  assert.equal(statuses[0].gates[0].processRef.uid, "flow-run-provider-onboarding-42");
  assert.equal(statuses[0].gates[0].expectationRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(statuses[0].openGates.length, 1);
  assert.equal(statuses[0].nextActionRefs[0].id, "action-resume-provider-onboarding");
  assert.equal(statuses[0].nextActionRefs[0].uid, "flow-action-resume-provider-onboarding");
  assert.equal(statuses[0].claimRefs[0].product, "surface");
  assert.equal(statuses[0].reviewItemRefs[0].product, "survey");
  assert.equal(statuses[0].actions.length, 1);
  assert.equal(statuses[0].actions[0].readOnly, true);
  assert.equal(statuses[0].actions[0].authority.command, "flow.run.resume");
  assert.equal(statuses[0].actions[0].warnings[0].message, "authority.command is an inert descriptor only");
});

test("flow gate transition helper emits a stable local gate event", async () => {
  const rootDir = tempRoot();
  const event = flowGateTransitionToEvent({
    processId: "run-provider-onboarding-42",
    gateId: "gate-provider-review",
    occurredAt: "2026-06-01T18:15:00Z",
    gateResource: {
      apiVersion: "flow.kontour.ai/v1alpha1",
      metadata: {
        name: "provider-review",
        uid: "flow-gate-provider-review"
      }
    },
    processResource: {
      apiVersion: "flow.kontour.ai/v1alpha1",
      metadata: {
        name: "provider-onboarding-42",
        uid: "flow-run-provider-onboarding-42"
      }
    },
    before: { status: "waiting", reason: "needs-review" },
    after: { status: "open", reason: "review-requested" },
    refs: [
      { product: "surface", kind: "claim", id: "claim-provider-directory-current" },
      { product: "flow", kind: "evidence", id: "evidence-provider-review-ready" }
    ],
    correlationId: "corr-provider-onboarding-42",
    causationId: "event-provider-fields-loaded",
    sequence: 7
  });
  const validationErrors = validateEvent(event, "flow-event")
    .filter((item: any) => item.severity === "error");
  const emitter = new KontourEmitter({
    sink: new LocalFileSink({ root: path.join(rootDir, ".kontour") })
  });

  const result = await emitter.emitEvent(event);
  const report = inspectLocalKontour({ rootDir });
  const loaded = report.eventStreams[0].events[0];

  assert.equal(validationErrors.length, 0);
  assert.equal(result.outcome, "accepted");
  assert.equal(report.validation.errors.length, 0);
  assert.equal(report.eventStreams.length, 1);
  assert.equal(loaded.id, "flow:run-provider-onboarding-42:gate:gate-provider-review:gate.opened:waiting->open");
  assert.equal(loaded.type, "gate.opened");
  assert.equal(loaded.subject.id, "gate-provider-review");
  assert.equal(loaded.subject.apiVersion, "flow.kontour.ai/v1alpha1");
  assert.equal(loaded.subject.uid, "flow-gate-provider-review");
  assert.deepEqual(loaded.payload.before, { status: "waiting", reason: "needs-review" });
  assert.deepEqual(loaded.payload.after, { status: "open", reason: "review-requested" });
  assert.equal(loaded.payload.refs[0].id, "gate-provider-review");
  assert.equal(loaded.payload.refs[1].id, "claim-provider-directory-current");
  assert.equal(loaded.payload.refs[2].id, "evidence-provider-review-ready");
  assert.equal(loaded.payload.refs[3].id, "run-provider-onboarding-42");
  assert.equal(loaded.payload.refs[3].uid, "flow-run-provider-onboarding-42");
  assert.equal(loaded.correlationId, "corr-provider-onboarding-42");
  assert.equal(loaded.causationId, "event-provider-fields-loaded");
  assert.equal(loaded.sequence, 7);
});

test("flow helpers preserve lightweight refs and validate malformed enriched refs", () => {
  const lightweight = flowProcessStateToProjection({
    processId: "run-lightweight",
    status: "running",
    generatedAt: "2026-06-01T18:00:00Z"
  });
  const invalid = flowGateTransitionToEvent({
    processId: "run-invalid",
    gateId: "gate-invalid",
    occurredAt: "2026-06-01T18:15:00Z",
    after: { status: "open" },
    gateUid: ""
  });

  assert.deepEqual(lightweight.processes[0].nextActionRefs, []);
  assert.deepEqual(lightweight.gates, []);
  assert.equal(validateProjection(lightweight, "lightweight-flow").filter((item: any) => item.severity === "error").length, 0);
  assert.equal(validateEvent(invalid, "invalid-flow").some((item: any) => item.path === "invalid-flow.subject.uid"), true);
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-console-flow-"));
}

function flowProcessState() {
  return {
    processId: "run-provider-onboarding-42",
    definitionId: "provider-onboarding",
    label: "Provider onboarding",
    status: "running",
    currentStep: { id: "review-provider-fields", label: "Review provider fields" },
    startedAt: "2026-06-01T17:00:00Z",
    updatedAt: "2026-06-01T18:12:00Z",
    generatedAt: "2026-06-01T18:12:30Z",
    processResource: {
      apiVersion: "flow.kontour.ai/v1alpha1",
      metadata: {
        name: "provider-onboarding-42",
        uid: "flow-run-provider-onboarding-42"
      }
    },
    percentComplete: 62,
    openGateRefs: [
      {
        product: "flow",
        kind: "gate",
        id: "gate-provider-review",
        apiVersion: "flow.kontour.ai/v1alpha1",
        name: "provider-review",
        uid: "flow-gate-provider-review"
      }
    ],
    claimRefs: [
      {
        product: "surface",
        kind: "claim",
        id: "claim-provider-directory-current",
        apiVersion: "surface.kontour.ai/v1alpha1",
        name: "provider-directory-current",
        uid: "surface-claim-provider-directory-current"
      }
    ],
    reviewItemRefs: [
      { product: "survey", kind: "review_item", id: "review-provider-npi" }
    ],
    gates: [
      {
        id: "gate-provider-review",
        label: "Provider review",
        status: "open",
        gateResource: {
          apiVersion: "flow.kontour.ai/v1alpha1",
          metadata: {
            name: "provider-review",
            uid: "flow-gate-provider-review"
          }
        },
        expectationRefs: [
          {
            product: "surface",
            kind: "claim",
            id: "claim-provider-directory-current",
            resource: {
              apiVersion: "surface.kontour.ai/v1alpha1",
              metadata: {
                uid: "surface-claim-provider-directory-current"
              }
            }
          }
        ],
        evidenceRefs: [
          { product: "flow", kind: "evidence", id: "evidence-provider-review-ready" }
        ]
      },
      {
        id: "gate-directory-loaded",
        label: "Directory loaded",
        status: "passed"
      }
    ],
    evidence: [
      {
        id: "evidence-provider-review-ready",
        kind: "snapshot",
        producerRef: { product: "flow", kind: "runner", id: "flow-runner-local" },
        processRefs: [
          { product: "flow", kind: "run", id: "run-provider-onboarding-42" }
        ]
      }
    ],
    decisions: [
      {
        id: "decision-provider-review-required",
        kind: "gate-routing",
        status: "pending",
        decidedAt: "2026-06-01T18:10:00Z",
        subjectRefs: [
          { product: "flow", kind: "gate", id: "gate-provider-review" }
        ]
      }
    ],
    actions: [
      {
        id: "action-resume-provider-onboarding",
        label: "Resume provider onboarding",
        kind: "resume",
        status: "available",
        authority: {
          product: "flow",
          command: "flow.run.resume"
        },
        resource: {
          apiVersion: "flow.kontour.ai/v1alpha1",
          metadata: {
            uid: "flow-action-resume-provider-onboarding"
          }
        },
        subjectRefs: [
          { product: "flow", kind: "run", id: "run-provider-onboarding-42" },
          { product: "flow", kind: "gate", id: "gate-provider-review" }
        ]
      }
    ],
    links: [
      {
        from: { product: "flow", kind: "gate", id: "gate-provider-review" },
        to: { product: "surface", kind: "claim", id: "claim-provider-directory-current" },
        relation: "expects"
      }
    ],
    actor: { product: "flow", kind: "runner", id: "flow-runner-local" },
    provenance: {
      runner: { id: "flow-runner-local", mode: "example" },
      control: { selectedSurfaceClaimRequired: false }
    }
  };
}
