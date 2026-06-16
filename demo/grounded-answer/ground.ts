/**
 * The grounding lab (gallery edition).
 *
 * Given a structured SourceRecord + the requested claim binding, this builds a REAL
 * SurveyInput and calls the REAL buildSurveyTrustBundle() from @kontourai/survey and
 * buildTrustReport() from @kontourai/surface. NOT stubs.
 *
 * The returned GroundedClaim carries the bundle/report PLUS the structural binding
 * facts the gate checks: the qualifier the value is actually bound to, the source
 * locator the value was extracted from, and the content-hash snapshot taken at
 * grounding time. The gate compares these against what the QUERY requested.
 *
 * WHAT IS REAL: buildSurveyTrustBundle(), buildTrustReport() — verbatim.
 * WHAT IS MOCKED: the SourceRecord the SurveyInput is built from.
 */

import { buildSurveyTrustBundle } from "@kontourai/survey";
import { buildTrustReport } from "@kontourai/surface";
import type { SurveyInput } from "@kontourai/survey";
import type { TrustBundle, TrustReport } from "@kontourai/surface";
import type { SourceRecord } from "./corpus.js";

/** What the query asked to be grounded — the requested binding. */
export interface ClaimBinding {
  subjectType: string;
  subjectId: string;
  /** The qualifier the ANSWER is being asserted for (e.g. requested period Q3-2025). */
  requestedQualifier: string;
  fieldOrBehavior: string;
  claimType: string;
}

/**
 * A grounded claim: the real bundle + report, plus the structural binding facts
 * the gate inspects. `groundedQualifier`, `groundedLocator`, and
 * `groundingHashSnapshot` come straight from the source record that backed the
 * grounding — they describe what the bundle ACTUALLY proves, which the gate then
 * checks against the request.
 */
export interface GroundedClaim {
  bundle: TrustBundle;
  report: TrustReport;
  value: number;
  /** The qualifier the grounded value is bound to (from the source record). */
  groundedQualifier: string;
  /** The source locator the value was extracted from. */
  groundedLocator: string;
  /** Content-hash captured when this claim was grounded (ETag snapshot). */
  groundingHashSnapshot: string;
  /** The doc the value traces to. */
  docId: string;
}

/**
 * Ground a single value from a structured record.
 *
 * `extractLocator` overrides which locator the grounding binds to. This models the
 * citation-theater case: the producer can ground a value while CLAIMING it came from
 * a locator that does not actually hold it. We still bind to the real source record's
 * value, but record the (mis)cited locator so the gate can detect the mismatch.
 */
export function groundValue(
  binding: ClaimBinding,
  record: SourceRecord,
  opts?: {
    /** Override the locator the grounding cites (citation-theater). */
    citedLocator?: string;
    /** Override the integrity-ref snapshot (stale grounding). */
    snapshotHash?: string;
  }
): GroundedClaim {
  const now = new Date().toISOString();
  const claimId = `claim.${binding.subjectId}.${record.period}.${record.field}`;
  const sourceId = `source.${record.docId}`;
  const extractionId = `ext.${record.docId}.${record.field}`;
  const candidateSetId = `cset.${record.docId}.${record.field}`;
  const candidateId = `cand.${record.docId}.${record.field}`;
  const reviewOutcomeId = `review.${record.docId}.${record.field}`;

  const citedLocator = opts?.citedLocator ?? record.fieldLocator;
  const snapshotHash = opts?.snapshotHash ?? record.contentHash;

  const surveyInput: SurveyInput = {
    source: `internal-sales-system/${record.docId}`,
    generatedAt: now,

    rawSources: [
      {
        id: sourceId,
        kind: "api-record",
        sourceRef: `internal://sales-system/docs/${record.docId}`,
        observedAt: record.observedAt,
        fetchedAt: now,
        // The integrity-ref snapshot taken at grounding time (ETag analogue).
        checksum: snapshotHash,
        locatorScheme: "structured-field",
        metadata: {
          accountId: record.accountId,
          accountName: record.accountName,
          // The qualifier the source value is BOUND to — first-class, not inferred.
          period: record.period,
          field: record.field,
          docId: record.docId,
        },
      },
    ],

    extractions: [
      {
        id: extractionId,
        sourceId,
        target: record.field,
        value: record.value,
        confidence: 0.98,
        // The cited locator — usually the real one, overridden in citation-theater.
        locator: citedLocator,
        excerpt: `${record.value} ${record.currency} for ${record.period}`,
        extractor: "sales-system-extractor-v1",
        extractedAt: now,
        metadata: { currency: record.currency, period: record.period },
      },
    ],

    candidateSets: [
      {
        id: candidateSetId,
        target: record.field,
        candidates: [{ id: candidateId, extractionId, value: record.value, confidence: 0.98 }],
        selectedCandidateId: candidateId,
        status: "resolved",
        rationale: `Authoritative record from internal sales system for ${record.period}.`,
      },
    ],

    reviewOutcomes: [
      {
        id: reviewOutcomeId,
        candidateSetId,
        candidateId,
        status: "verified",
        actor: record.recordedBy,
        reviewedAt: record.observedAt,
        rationale: `${record.field} verified against record ${record.docId}.`,
        evidenceIds: [`${extractionId}.evidence`],
        authorizing: {
          kind: "explicit-statement",
          statement: `Record ${record.docId} recorded by ${record.recordedBy}.`,
          source: `internal://sales-system/docs/${record.docId}`,
        },
      },
    ],

    claims: [
      {
        id: claimId,
        candidateSetId,
        candidateId,
        subjectType: binding.subjectType,
        subjectId: binding.subjectId,
        surface: "grounded-answer-gallery",
        claimType: binding.claimType,
        fieldOrBehavior: binding.fieldOrBehavior,
        value: record.value,
        status: "verified",
        impactLevel: "high",
        createdAt: record.observedAt,
        updatedAt: record.observedAt,
        evidenceType: "attestation",
        evidenceMethod: "extraction",
        collectedBy: "grounded-answer-conductor",
        actor: record.recordedBy,
        metadata: {
          currency: record.currency,
          // The grounded qualifier surfaced on the claim for the panel + gate.
          period: record.period,
          field: record.field,
          sourceDocId: record.docId,
        },
      },
    ],
  };

  // REAL call. Throws if producer discipline is violated (verified w/o actor+reviewedAt+locator).
  const bundle = buildSurveyTrustBundle(surveyInput);
  const report = buildTrustReport(bundle, { id: `report.${claimId}`, now: new Date() });

  return {
    bundle,
    report,
    value: record.value,
    groundedQualifier: record.period,
    groundedLocator: citedLocator,
    groundingHashSnapshot: snapshotHash,
    docId: record.docId,
  };
}
