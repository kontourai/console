const assert = require("node:assert/strict");
const test = require("node:test");
const {
  inspectFixtures,
  getSurfaceClaimStatus,
  getFlowProcessStatus,
  getSurveyReviewState,
  validateEvent,
  validateProjection
} = require("../src/console-foundation");

const rootDir = process.env.KONTOUR_REPO_ROOT || process.cwd();

test("inspects checked-in event streams and projections", () => {
  const report = inspectFixtures({ rootDir });

  assert.equal(report.eventStreams.length, 4);
  assert.equal(report.projections.length, 3);
  assert.equal(report.validation.errors.length, 0);

  const eventCount = report.eventStreams.reduce((sum: any, stream: any) => sum + stream.events.length, 0);
  assert.equal(eventCount, 19);

  const surface = report.projections.find((projection: any) => projection.relativePath.endsWith("surface-current-claim-status.json"));
  assert.equal(report.eventStreams[0].sourceKind, "fixture");
  assert.equal(surface.sourceKind, "fixture");
  assert.match(surface.relativePath, /^docs\/examples\/projections\//);
  assert.equal(surface.summary.objectCounts.claims, 1);
  assert.equal(surface.summary.objectCounts.actions, 1);
  assert.equal(surface.summary.objectCounts.links, 3);
});

test("surface and flow handoff fixture preserves enriched refs and inert actions", () => {
  const report = inspectFixtures({ rootDir });
  const stream = report.eventStreams.find((item: any) => item.relativePath.endsWith("surface-flow-handoff.jsonl"));
  const projection = report.projections.find((item: any) => item.relativePath.endsWith("surface-flow-handoff-current.json"));
  const statuses = getFlowProcessStatus(report.projections, { processId: "run-provider-directory-refresh" });
  const action = projection.actions[0];

  assert.equal(stream.events.length, 6);
  assert.equal(stream.events[0].subject.uid, "flow-run-provider-directory-refresh");
  assert.equal(stream.events[1].subject.scope.id, "run-provider-directory-refresh");
  assert.equal(stream.events[2].payload.refs[0].uid, "flow-gate-provider-directory-freshness");
  assert.equal(projection.snapshot.claims[0].sourceRef.apiVersion, "surface.kontour.ai/v1alpha1");
  assert.equal(projection.snapshot.claims[0].sourceRef.uid, "surface-claim-provider-directory-current");
  assert.equal(projection.snapshot.gates[0].processRef.uid, "flow-run-provider-directory-refresh");
  assert.equal(projection.snapshot.gates[0].expectationRefs[0].uid, "surface-claim-provider-directory-current");
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, "running");
  assert.equal(statuses[0].gates[0].status, "passed");
  assert.equal(action.id, "action-resume-provider-directory-refresh");
  assert.equal(action.readOnly, true);
  assert.equal(action.authority.command, "flow.run.resume");
  assert.equal(action.warnings[0].message, "authority.command is an inert descriptor only");
});

test("projection loading preserves v0 boundaries and original objects", () => {
  const report = inspectFixtures({ rootDir });
  const surface = report.projections.find((projection: any) => projection.relativePath.endsWith("surface-current-claim-status.json"));
  const survey = report.projections.find((projection: any) => projection.relativePath.endsWith("survey-field-review.json"));

  assert.equal(surface.snapshot.derivedFrom.directSnapshot.sourceRef.product, "surface");
  assert.equal(surface.snapshot.claims[0].extensions.authority.product, "surface");
  assert.equal(surface.snapshot.actions[0].authority.command, "flow.run.start");
  assert.equal(surface.snapshot.actions[0].authority.externalUrl, "https://example.test/flow/definitions/refresh-provider-directory");
  assert.equal(surface.snapshot.links[2].relation, "updates");

  assert.equal(survey.snapshot.claims[0].sourceRef.product, "survey");
  assert.equal(survey.snapshot.processes[0].extensions.authority.product, "flow");
  assert.equal(survey.snapshot.reviewItems[0].subjectRef.id, "provider-118:npi");
  assert.equal(survey.snapshot.links.some((link: any) => link.relation === "reviews"), true);
});

test("surface claim query does not require a selected Flow run", () => {
  const report = inspectFixtures({ rootDir });
  const claims = getSurfaceClaimStatus(report.projections, { claimId: "claim-provider-directory-current" });

  assert.equal(claims.length, 1);
  assert.equal(claims[0].status, "verified");
  assert.equal(claims[0].freshness.status, "fresh");
  assert.equal(claims[0].validFrom, "2026-05-31T15:12:00Z");
  assert.equal(claims[0].validUntil, "2026-06-30T15:12:00Z");
  assert.equal(claims[0].evidenceRefs[0].id, "evidence-provider-directory-crawl-2026-05-31");
  assert.equal(claims[0].actionRefs[0].id, "action-refresh-provider-directory");
  assert.equal(claims[0].requiresSelectedFlowRun, false);
});

test("survey review query composes claim, review, evidence, decision, action, and links", () => {
  const report = inspectFixtures({ rootDir });
  const reviews = getSurveyReviewState(report.projections, { reviewId: "review-provider-118-npi" });

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reviewItem.id, "review-provider-118-npi");
  assert.equal(reviews[0].claim.id, "claim-provider-118-npi");
  assert.equal(reviews[0].evidence[0].id, "evidence-provider-118-npi-source");
  assert.equal(reviews[0].decisions[0].id, "decision-provider-118-npi-approved");
  assert.equal(reviews[0].actions[0].id, "action-apply-provider-118-npi");

  const relations = new Set(reviews[0].links.map((link: any) => link.relation));
  assert.equal(relations.has("reviews"), true);
  assert.equal(relations.has("evidenced_by"), true);
  assert.equal(relations.has("updates"), true);
  assert.equal(relations.has("produced_by"), true);
});

test("action descriptors are inert read-only data", () => {
  const report = inspectFixtures({ rootDir });
  const surface = report.projections.find((projection: any) => projection.relativePath.endsWith("surface-current-claim-status.json"));
  const action = surface.actions[0];

  assert.equal(action.id, "action-refresh-provider-directory");
  assert.equal(action.readOnly, true);
  assert.equal(action.authority.command, "flow.run.start");
  assert.equal(action.authority.externalUrl, "https://example.test/flow/definitions/refresh-provider-directory");
  assert.equal(action.warnings.some((warning: any) => warning.message.includes("authority.command is an inert descriptor only")), true);
  assert.equal(action.warnings.some((warning: any) => warning.message.includes("authority.externalUrl is an inert descriptor only")), true);
});

test("projection validation reports malformed nested object refs", () => {
  const invalidProjection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-05-31T17:09:05Z",
    derivedFrom: {},
    producer: {},
    scope: {},
    claims: [
      {
        id: "claim-1",
        status: "verified",
        evidenceRefs: [{ product: "surface", kind: "evidence" }],
        actionRefs: "action-1",
        sourceRef: { product: "survey", kind: "provider_field" }
      }
    ],
    processes: [
      {
        id: "process-1",
        status: "active",
        reviewItemRefs: [{ product: "survey", kind: "review_item", id: "review-1" }],
        claimRefs: [null],
        nextActionRefs: [{ product: "survey", kind: "action" }]
      }
    ],
    gates: [
      {
        id: "gate-1",
        status: "blocked",
        processRef: null,
        expectationRefs: [{ product: "surface", kind: "claim", id: "claim-1" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }]
      }
    ],
    reviewItems: [
      {
        id: "review-1",
        kind: "field_change",
        status: "open",
        subjectRef: { product: "survey", kind: "provider_field" },
        claimRefs: [{ product: "surface", kind: "claim" }],
        processRefs: [{ product: "flow", kind: "run", id: "process-1" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }],
        actionRefs: [{ product: "survey", kind: "action" }]
      }
    ],
    evidence: [
      {
        id: "evidence-1",
        producerRef: { product: "surface", kind: "verifier" },
        claimRefs: [{ product: "surface", kind: "claim" }],
        processRefs: [{ product: "flow", kind: "run" }]
      }
    ],
    decisions: [
      {
        id: "decision-1",
        kind: "approval",
        decidedAt: "2026-05-31T17:08:05Z",
        subjectRefs: [{ product: "survey", kind: "review_item" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }]
      }
    ],
    exceptions: [
      {
        id: "exception-1",
        status: "open",
        subjectRefs: [{ product: "survey", kind: "review_item" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }]
      }
    ]
  };

  const errors = validateProjection(invalidProjection, "invalid-projection.json")
    .filter((item: any) => item.severity === "error");
  const paths = new Set(errors.map((item: any) => item.path));

  assert.equal(paths.has("invalid-projection.json.claims[0].evidenceRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.claims[0].actionRefs"), true);
  assert.equal(paths.has("invalid-projection.json.claims[0].sourceRef.id"), true);
  assert.equal(paths.has("invalid-projection.json.processes[0].claimRefs[0]"), true);
  assert.equal(paths.has("invalid-projection.json.processes[0].nextActionRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.gates[0].processRef"), true);
  assert.equal(paths.has("invalid-projection.json.gates[0].evidenceRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.reviewItems[0].subjectRef.id"), true);
  assert.equal(paths.has("invalid-projection.json.reviewItems[0].claimRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.reviewItems[0].evidenceRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.reviewItems[0].actionRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.evidence[0].producerRef.id"), true);
  assert.equal(paths.has("invalid-projection.json.evidence[0].claimRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.evidence[0].processRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.decisions[0].subjectRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.decisions[0].evidenceRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.exceptions[0].subjectRefs[0].id"), true);
  assert.equal(paths.has("invalid-projection.json.exceptions[0].evidenceRefs[0].id"), true);
});

test("projection validation reports malformed enriched ref fields", () => {
  const invalidProjection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-06-03T10:01:45Z",
    derivedFrom: {},
    producer: { product: "flow", id: "flow-local" },
    scope: { kind: "project", id: "provider-directory-refresh" },
    claims: [
      {
        id: "claim-provider-directory-current",
        status: "verified",
        evidenceRefs: [
          {
            product: "surface",
            kind: "evidence",
            id: "evidence-provider-directory-crawl",
            uid: "",
            scope: "project"
          }
        ]
      }
    ]
  };

  const errors = validateProjection(invalidProjection, "invalid-enriched.json")
    .filter((item: any) => item.severity === "error");
  const paths = new Set(errors.map((item: any) => item.path));

  assert.equal(paths.has("invalid-enriched.json.claims[0].evidenceRefs[0].uid"), true);
  assert.equal(paths.has("invalid-enriched.json.claims[0].evidenceRefs[0].scope"), true);
});

// console#229: interactive-session process states (needs_input, review_pending)
// and the optional blockedReason field.
test("validateEvent accepts a process.blocked event carrying the needs_input interactive state", () => {
  const event = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-process-blocked-001",
    type: "process.blocked",
    occurredAt: "2026-07-20T12:00:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "run", id: "run-interactive-1" },
    payload: {
      reason: "Agent asked a clarifying question about scope.",
      after: { status: "needs_input" }
    }
  };

  const errors = validateEvent(event, "process.jsonl:1").filter((item: any) => item.severity === "error");
  assert.deepEqual(errors, []);
});

test("validateProjection accepts needs_input and review_pending processes with blockedReason", () => {
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-07-20T12:00:05Z",
    derivedFrom: {},
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    processes: [
      { id: "run-needs-input", status: "needs_input", blockedReason: "Waiting on operator input." },
      { id: "run-review-pending", status: "review_pending", blockedReason: "Waiting on reviewer approval." },
      // Interactive states are optional — a process may carry them without a blockedReason.
      { id: "run-needs-input-no-reason", status: "needs_input" }
    ]
  };

  const errors = validateProjection(projection, "interactive-processes.json")
    .filter((item: any) => item.severity === "error");
  assert.deepEqual(errors, []);
});

test("validateProjection still accepts an old-shape process record unchanged (backward compat)", () => {
  // Exact shape a pre-#229 producer already emits: no blockedReason, a
  // pre-existing status. Must validate with zero errors, proving existing
  // producers are unaffected by the new interactive vocabulary.
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-05-31T17:09:05Z",
    derivedFrom: {},
    producer: { product: "flow", id: "flow-local" },
    scope: { kind: "project", id: "provider-directory-refresh" },
    processes: [
      {
        id: "run-provider-directory-refresh",
        status: "running",
        currentStep: "verify",
        percentComplete: 40,
        openGateRefs: [{ product: "flow", kind: "gate", id: "gate-provider-directory-freshness" }],
        claimRefs: [{ product: "surface", kind: "claim", id: "claim-provider-directory-current" }],
        nextActionRefs: [{ product: "flow", kind: "action", id: "action-resume-provider-directory-refresh" }]
      }
    ]
  };

  const errors = validateProjection(projection, "old-shape-projection.json")
    .filter((item: any) => item.severity === "error");
  assert.deepEqual(errors, []);
});

test("validateProjection rejects a non-string blockedReason", () => {
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-07-20T12:00:10Z",
    derivedFrom: {},
    producer: {},
    scope: {},
    processes: [
      { id: "run-bad-reason", status: "needs_input", blockedReason: 42 }
    ]
  };

  const errors = validateProjection(projection, "bad-reason.json")
    .filter((item: any) => item.severity === "error");
  const paths = new Set(errors.map((item: any) => item.path));
  assert.equal(paths.has("bad-reason.json.processes[0].blockedReason"), true);
});

test("learning event validation accepts thin non-authoritative payloads", () => {
  const event = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-001",
    type: "learning.recorded",
    occurredAt: "2026-06-04T12:00:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-001" },
    payload: {
      summary: "Route-back outcomes need a short operator-facing reason.",
      refs: [{ product: "flow", kind: "run", id: "run-001" }],
      links: [
        {
          from: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-001" },
          relation: "derived_from",
          to: { product: "flow", kind: "run", id: "run-001" }
        }
      ],
      data: {
        family: "workflow",
        nonAuthority: true,
        confidence: 0.82
      }
    }
  };

  const errors = validateEvent(event, "learning.jsonl:1").filter((item: any) => item.severity === "error");

  assert.equal(errors.length, 0);
});

test("learning projection validation accepts thin non-authoritative objects", () => {
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-06-04T12:00:00Z",
    derivedFrom: {},
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    learnings: [
      {
        id: "learning-route-back-reason",
        subjectRef: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-001" },
        family: "workflow",
        nonAuthority: true,
        summary: "Route-back outcomes need a short operator-facing reason.",
        confidence: 0.82,
        sourceRef: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-001" },
        refs: [{ product: "flow", kind: "run", id: "run-001" }],
        links: [
          {
            from: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-001" },
            relation: "derived_from",
            to: { product: "flow", kind: "run", id: "run-001" }
          }
        ],
        extensions: {
          "flow-agents": {
            sourceKind: "workflow-learning"
          }
        }
      }
    ]
  };

  const errors = validateProjection(projection, "learning-projection.json").filter((item: any) => item.severity === "error");

  assert.equal(errors.length, 0);
});

test("learning validation rejects missing family and non-authority fields", () => {
  const event = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-invalid",
    type: "learning.recorded",
    occurredAt: "2026-06-04T12:00:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-invalid" },
    payload: {
      summary: "Invalid learning.",
      data: {
        nonAuthority: false
      }
    }
  };
  const projection = {
    schema: "kontour.console.projection",
    version: "0.1",
    generatedAt: "2026-06-04T12:00:00Z",
    derivedFrom: {},
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    learnings: [
      {
        id: "learning-invalid",
        subjectRef: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-invalid" },
        family: "source-owned",
        nonAuthority: false,
        summary: "Invalid learning."
      }
    ]
  };

  const eventPaths = new Set(validateEvent(event, "learning.jsonl:2")
    .filter((item: any) => item.severity === "error")
    .map((item: any) => item.path));
  const projectionPaths = new Set(validateProjection(projection, "learning-projection.json")
    .filter((item: any) => item.severity === "error")
    .map((item: any) => item.path));

  assert.equal(eventPaths.has("learning.jsonl:2.payload.data.family"), true);
  assert.equal(eventPaths.has("learning.jsonl:2.payload.data.nonAuthority"), true);
  assert.equal(projectionPaths.has("learning-projection.json.learnings[0].family"), true);
  assert.equal(projectionPaths.has("learning-projection.json.learnings[0].nonAuthority"), true);
});

test("learning event validation rejects invalid optional id and sourceRef fields", () => {
  const event = {
    schema: "kontour.console.event",
    version: "0.1",
    id: "evt-learning-invalid-ref",
    type: "learning.recorded",
    occurredAt: "2026-06-04T12:00:00Z",
    producer: { product: "flow-agents", id: "flow-agents-local" },
    scope: { kind: "repo", id: "console" },
    subject: { product: "flow-agents", kind: "workflow-learning", id: "workflow-learning-invalid-ref" },
    payload: {
      summary: "Invalid optional fields.",
      data: {
        id: "",
        family: "workflow",
        nonAuthority: true,
        sourceRef: { product: "flow-agents", kind: "workflow-learning" }
      }
    }
  };

  const paths = new Set(validateEvent(event, "learning.jsonl:3")
    .filter((item: any) => item.severity === "error")
    .map((item: any) => item.path));

  assert.equal(paths.has("learning.jsonl:3.payload.data.id"), true);
  assert.equal(paths.has("learning.jsonl:3.payload.data.sourceRef.id"), true);
});
