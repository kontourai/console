#!/usr/bin/env node

const {
  inspectFixtures,
  inspectLocalKontour,
  getSurfaceClaimStatus,
  getSurveyReviewState
} = require("../src/console-foundation");

function main(argv) {
  const command = argv[2] || "inspect";
  const rootDir = process.cwd();

  if (command === "inspect") {
    const report = inspectFixtures({ rootDir });
    printInspection(report, { title: "Kontour Console fixture inspection" });
    exitForValidation(report);
    return;
  }

  if (command === "local") {
    const report = inspectLocalKontour({ rootDir, kontourRoot: argv[3] });
    printInspection(report, { title: "Kontour Console local inspection" });
    exitForValidation(report);
    return;
  }

  if (command === "surface-claim") {
    const report = inspectFixtures({ rootDir });
    const claimId = argv[3];
    const claims = getSurfaceClaimStatus(report.projections, { claimId });
    for (const claim of claims) {
      console.log(`${claim.id}: ${claim.status} freshness=${claim.freshness && claim.freshness.status}`);
      console.log(`  requiresSelectedFlowRun: ${claim.requiresSelectedFlowRun}`);
      console.log(`  evidenceRefs: ${claim.evidenceRefs.length}`);
      console.log(`  actionRefs: ${claim.actionRefs.length}`);
    }
    exitForValidation(report);
    return;
  }

  if (command === "survey-review") {
    const report = inspectFixtures({ rootDir });
    const reviewId = argv[3];
    const reviews = getSurveyReviewState(report.projections, { reviewId });
    for (const review of reviews) {
      console.log(`${review.reviewItem.id}: ${review.reviewItem.status}`);
      console.log(`  claim: ${review.claim && review.claim.id} (${review.claim && review.claim.status})`);
      console.log(`  evidence: ${review.evidence.map((item) => item.id).join(", ")}`);
      console.log(`  decisions: ${review.decisions.map((item) => item.id).join(", ")}`);
      console.log(`  actions: ${review.actions.map((item) => item.id).join(", ")}`);
      console.log(`  links: ${review.links.map((item) => item.relation).join(", ")}`);
    }
    exitForValidation(report);
    return;
  }

  console.error("Usage: kontour-console-inspect [inspect|local [kontourRoot]|surface-claim [claimId]|survey-review [reviewId]]");
  process.exitCode = 2;
}

function printInspection(report, options = {}) {
  console.log(options.title || "Kontour Console inspection");
  console.log("");
  console.log(`Event streams: ${report.eventStreams.length}`);
  for (const stream of report.eventStreams) {
    console.log(`- ${formatSource(stream)}: events=${stream.events.length} accepted=${stream.summary.acceptedEventCount}`);
    console.log(`  types: ${formatCounts(stream.summary.eventTypeCounts)}`);
  }

  console.log("");
  console.log(`Projection snapshots: ${report.projections.length}`);
  for (const projection of report.projections) {
    const counts = projection.summary.objectCounts;
    console.log(`- ${formatSource(projection)}: claims=${counts.claims} processes=${counts.processes} gates=${counts.gates} reviewItems=${counts.reviewItems} evidence=${counts.evidence} decisions=${counts.decisions} actions=${counts.actions} links=${counts.links}`);
    console.log(`  derivedFrom: ${projection.snapshot.derivedFrom && projection.snapshot.derivedFrom.mode}; producer=${projection.snapshot.producer && projection.snapshot.producer.id}`);
    printCurrentState(projection.summary.currentState);
  }

  const errors = report.validation.errors;
  const warnings = report.validation.warnings;
  console.log("");
  console.log(`Validation: errors=${errors.length} warnings=${warnings.length}`);
  for (const issue of errors.concat(warnings)) {
    console.log(`- ${issue.severity}: ${issue.path} ${issue.message}`);
  }
}

function printCurrentState(state) {
  for (const claim of state.claims) {
    console.log(`  claim ${claim.id}: ${claim.status} freshness=${claim.freshnessStatus || "unknown"}`);
  }
  for (const processState of state.processes) {
    console.log(`  process ${processState.id}: ${processState.status}`);
  }
  for (const gate of state.gates) {
    console.log(`  gate ${gate.id}: ${gate.status}`);
  }
  for (const review of state.reviewItems) {
    console.log(`  review ${review.id}: ${review.status}`);
  }
  for (const action of state.actions) {
    console.log(`  action ${action.id}: ${action.status} authority=${action.authorityProduct || "unknown"} readOnly=true`);
  }
}

function formatCounts(counts) {
  return Object.keys(counts).sort().map((key) => `${key}=${counts[key]}`).join(", ");
}

function formatSource(item) {
  if (!item.sourceKind) return item.relativePath;
  return `${item.sourceKind}:${item.relativePath}`;
}

function exitForValidation(report) {
  if (report.validation.errors.length > 0) {
    process.exitCode = 1;
  }
}

main(process.argv);
