const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  KontourEmitter,
  LocalFileSink,
  inspectLocalKontour,
  getSurfaceClaimStatus,
  validateEvent,
  validateProjection,
  surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent
} = require("../src/console-foundation");

test("surface claim helper emits a local projection queryable without a Flow run", async () => {
  const rootDir = tempRoot();
  const projection = surfaceClaimStateToProjection(surfaceClaimState());
  const validationErrors = validateProjection(projection, "surface-projection")
    .filter((item: any) => item.severity === "error");
  const emitter = new KontourEmitter({
    sink: new LocalFileSink({ root: path.join(rootDir, ".kontour") })
  });

  const result = await emitter.emitProjection(projection);
  const report = inspectLocalKontour({ rootDir });
  const claims = getSurfaceClaimStatus(report.projections, { claimId: "claim-provider-directory-current" });

  assert.equal(validationErrors.length, 0);
  assert.equal(result.outcome, "accepted");
  assert.equal(report.validation.errors.length, 0);
  assert.equal(report.projections.length, 1);
  assert.equal(report.projections[0].snapshot.producer.product, "surface");
  assert.equal(report.projections[0].snapshot.actions[0].kind, "refresh");
  assert.equal(claims.length, 1);
  assert.equal(claims[0].status, "verified");
  assert.equal(claims[0].freshness.status, "fresh");
  assert.equal(claims[0].validFrom, "2026-06-01T16:00:00Z");
  assert.equal(claims[0].validUntil, "2026-06-30T16:00:00Z");
  assert.equal(claims[0].lastUpdatedAt, "2026-06-01T16:05:00Z");
  assert.equal(claims[0].evidenceRefs[0].id, "evidence-provider-directory-crawl-2026-06-01");
  assert.equal(claims[0].evidenceRefs[0].apiVersion, "surface.kontour.ai/v1alpha1");
  assert.equal(claims[0].evidenceRefs[0].uid, "surface-evidence-provider-directory-crawl-2026-06-01");
  assert.equal(claims[0].actionRefs[0].kind, "action");
  assert.equal(claims[0].actionRefs[0].id, "action-refresh-provider-directory");
  assert.equal(claims[0].actionRefs[0].uid, "surface-action-refresh-provider-directory");
  assert.equal(claims[0].requiresSelectedFlowRun, false);
  assert.equal(report.projections[0].snapshot.claims[0].sourceRef.apiVersion, "surface.kontour.ai/v1alpha1");
  assert.equal(report.projections[0].snapshot.claims[0].sourceRef.name, "provider-directory-current");
  assert.equal(report.projections[0].snapshot.claims[0].sourceRef.uid, "surface-claim-provider-directory-current");
  assert.equal(report.projections[0].actions[0].readOnly, true);
  assert.equal(report.projections[0].actions[0].authority.command, "surface.claim.refresh");
});

test("surface freshness helper emits a stable local freshness changed event", async () => {
  const rootDir = tempRoot();
  const event = surfaceFreshnessTransitionToEvent({
    claimId: "claim-provider-directory-current",
    occurredAt: "2026-06-01T16:10:00Z",
    before: { status: "stale", asOf: "2026-05-31T16:00:00Z" },
    after: { status: "fresh", asOf: "2026-06-01T16:05:00Z" },
    refs: [
      { product: "surface", kind: "evidence", id: "evidence-provider-directory-crawl-2026-06-01" },
      { product: "surface", kind: "action", id: "action-refresh-provider-directory" }
    ]
  });
  const validationErrors = validateEvent(event, "surface-event")
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
  assert.equal(loaded.id, "surface:claim-provider-directory-current:freshness:stale->fresh");
  assert.equal(loaded.type, "claim.freshness.changed");
  assert.deepEqual(loaded.subject, { product: "surface", kind: "claim", id: "claim-provider-directory-current" });
  assert.deepEqual(loaded.payload.before, { status: "stale", asOf: "2026-05-31T16:00:00Z" });
  assert.deepEqual(loaded.payload.after, { status: "fresh", asOf: "2026-06-01T16:05:00Z" });
  assert.equal(loaded.payload.refs[0].id, "claim-provider-directory-current");
  assert.equal(loaded.payload.refs[1].id, "evidence-provider-directory-crawl-2026-06-01");
  assert.equal(loaded.payload.refs[2].id, "action-refresh-provider-directory");
});

test("surface helpers preserve lightweight refs and validate malformed enriched refs", () => {
  const lightweight = surfaceClaimStateToProjection({
    claimId: "claim-lightweight",
    status: "verified",
    generatedAt: "2026-06-01T16:00:00Z"
  });
  const invalid = surfaceFreshnessTransitionToEvent({
    claimId: "claim-invalid",
    occurredAt: "2026-06-01T16:10:00Z",
    before: { status: "fresh" },
    after: { status: "stale" },
    claimUid: ""
  });

  assert.deepEqual(lightweight.claims[0].sourceRef, { product: "surface", kind: "claim", id: "claim-lightweight" });
  assert.equal(validateProjection(lightweight, "lightweight").filter((item: any) => item.severity === "error").length, 0);
  assert.equal(validateEvent(invalid, "invalid").some((item: any) => item.path === "invalid.subject.uid"), true);
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kontour-console-surface-"));
}

function surfaceClaimState() {
  return {
    claimId: "claim-provider-directory-current",
    label: "Provider directory freshness",
    status: "verified",
    currentValue: { providerCount: 1243 },
    freshness: { status: "fresh", asOf: "2026-06-01T16:05:00Z" },
    validFrom: "2026-06-01T16:00:00Z",
    validUntil: "2026-06-30T16:00:00Z",
    lastUpdatedAt: "2026-06-01T16:05:00Z",
    generatedAt: "2026-06-01T16:06:00Z",
    claimResource: {
      apiVersion: "surface.kontour.ai/v1alpha1",
      metadata: {
        name: "provider-directory-current",
        uid: "surface-claim-provider-directory-current"
      }
    },
    evidenceRefs: [
      {
        product: "surface",
        kind: "evidence",
        id: "evidence-provider-directory-crawl-2026-06-01",
        resource: {
          apiVersion: "surface.kontour.ai/v1alpha1",
          metadata: {
            uid: "surface-evidence-provider-directory-crawl-2026-06-01"
          }
        }
      }
    ],
    actionRefs: [
      { product: "surface", kind: "action", id: "action-refresh-provider-directory" }
    ],
    actions: [
      {
        id: "action-refresh-provider-directory",
        label: "Refresh provider directory",
        kind: "refresh",
        status: "available",
        authority: {
          product: "surface",
          command: "surface.claim.refresh"
        },
        resource: {
          apiVersion: "surface.kontour.ai/v1alpha1",
          metadata: {
            uid: "surface-action-refresh-provider-directory"
          }
        },
        subjectRefs: [
          { product: "surface", kind: "claim", id: "claim-provider-directory-current" }
        ]
      }
    ]
  };
}
