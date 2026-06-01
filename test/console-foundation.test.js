const assert = require("node:assert/strict");
const test = require("node:test");
const {
  inspectFixtures,
  getSurfaceClaimStatus,
  getCampfitFieldReviewState,
  validateProjection
} = require("../src/console-foundation");

const rootDir = process.cwd();

test("inspects checked-in event streams and projections", () => {
  const report = inspectFixtures({ rootDir });

  assert.equal(report.eventStreams.length, 3);
  assert.equal(report.projections.length, 2);
  assert.equal(report.validation.errors.length, 0);

  const eventCount = report.eventStreams.reduce((sum, stream) => sum + stream.events.length, 0);
  assert.equal(eventCount, 13);

  const surface = report.projections.find((projection) => projection.relativePath.endsWith("surface-current-claim-status.json"));
  assert.equal(report.eventStreams[0].sourceKind, "fixture");
  assert.equal(surface.sourceKind, "fixture");
  assert.match(surface.relativePath, /^docs\/examples\/projections\//);
  assert.equal(surface.summary.objectCounts.claims, 1);
  assert.equal(surface.summary.objectCounts.actions, 1);
  assert.equal(surface.summary.objectCounts.links, 3);
});

test("projection loading preserves v0 boundaries and original objects", () => {
  const report = inspectFixtures({ rootDir });
  const surface = report.projections.find((projection) => projection.relativePath.endsWith("surface-current-claim-status.json"));
  const campfit = report.projections.find((projection) => projection.relativePath.endsWith("campfit-field-review.json"));

  assert.equal(surface.snapshot.derivedFrom.directSnapshot.sourceRef.product, "surface");
  assert.equal(surface.snapshot.claims[0].extensions.authority.product, "surface");
  assert.equal(surface.snapshot.actions[0].authority.command, "flow.run.start");
  assert.equal(surface.snapshot.actions[0].authority.externalUrl, "https://example.test/flow/definitions/refresh-provider-directory");
  assert.equal(surface.snapshot.links[2].relation, "updates");

  assert.equal(campfit.snapshot.claims[0].sourceRef.product, "campfit");
  assert.equal(campfit.snapshot.processes[0].extensions.authority.product, "flow");
  assert.equal(campfit.snapshot.reviewItems[0].subjectRef.id, "provider-118:npi");
  assert.equal(campfit.snapshot.links.some((link) => link.relation === "reviews"), true);
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

test("campfit review query composes claim, review, evidence, decision, action, and links", () => {
  const report = inspectFixtures({ rootDir });
  const reviews = getCampfitFieldReviewState(report.projections, { reviewId: "review-provider-118-npi" });

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].reviewItem.id, "review-provider-118-npi");
  assert.equal(reviews[0].claim.id, "claim-provider-118-npi");
  assert.equal(reviews[0].evidence[0].id, "evidence-provider-118-npi-source");
  assert.equal(reviews[0].decisions[0].id, "decision-provider-118-npi-approved");
  assert.equal(reviews[0].actions[0].id, "action-apply-provider-118-npi");

  const relations = new Set(reviews[0].links.map((link) => link.relation));
  assert.equal(relations.has("reviews"), true);
  assert.equal(relations.has("evidenced_by"), true);
  assert.equal(relations.has("updates"), true);
  assert.equal(relations.has("produced_by"), true);
});

test("action descriptors are inert read-only data", () => {
  const report = inspectFixtures({ rootDir });
  const surface = report.projections.find((projection) => projection.relativePath.endsWith("surface-current-claim-status.json"));
  const action = surface.actions[0];

  assert.equal(action.id, "action-refresh-provider-directory");
  assert.equal(action.readOnly, true);
  assert.equal(action.authority.command, "flow.run.start");
  assert.equal(action.authority.externalUrl, "https://example.test/flow/definitions/refresh-provider-directory");
  assert.equal(action.warnings.some((warning) => warning.message.includes("authority.command is an inert descriptor only")), true);
  assert.equal(action.warnings.some((warning) => warning.message.includes("authority.externalUrl is an inert descriptor only")), true);
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
        sourceRef: { product: "campfit", kind: "provider_field" }
      }
    ],
    processes: [
      {
        id: "process-1",
        status: "active",
        reviewItemRefs: [{ product: "campfit", kind: "review_item", id: "review-1" }],
        claimRefs: [null],
        nextActionRefs: [{ product: "campfit", kind: "action" }]
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
        subjectRef: { product: "campfit", kind: "provider_field" },
        claimRefs: [{ product: "surface", kind: "claim" }],
        processRefs: [{ product: "flow", kind: "run", id: "process-1" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }],
        actionRefs: [{ product: "campfit", kind: "action" }]
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
        subjectRefs: [{ product: "campfit", kind: "review_item" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }]
      }
    ],
    exceptions: [
      {
        id: "exception-1",
        status: "open",
        subjectRefs: [{ product: "campfit", kind: "review_item" }],
        evidenceRefs: [{ product: "surface", kind: "evidence" }]
      }
    ]
  };

  const errors = validateProjection(invalidProjection, "invalid-projection.json")
    .filter((item) => item.severity === "error");
  const paths = new Set(errors.map((item) => item.path));

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
