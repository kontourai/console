/**
 * The grounding lab.
 *
 * Given a claim request + retrieval result from the sales system, this module:
 *   1. Builds a real SurveyInput (rawSources / extractions / candidateSets / reviewOutcomes / claims)
 *   2. Calls the REAL buildSurveyTrustBundle() from @kontourai/survey — NOT a fake
 *   3. Returns the Hachure TrustBundle + TrustReport for the conductor to gate on
 *
 * WHAT IS REAL: buildSurveyTrustBundle(), buildTrustReport() — called verbatim.
 * WHAT IS MOCKED: The SurveyInput is constructed from the mocked SalesRecord.
 *   In production, this data would come from a real extraction pipeline.
 */

import { buildSurveyTrustBundle } from "@kontourai/survey";
import { buildTrustReport } from "@kontourai/surface";
import type { SurveyInput } from "@kontourai/survey";
import type { TrustBundle, TrustReport } from "@kontourai/surface";
import type { SalesRecord } from "./sales-system.js";

export interface ClaimRequest {
  claimType: string; // e.g. "sales.quarterly"
  subjectId: string; // account id
  subjectType: string; // "account"
  qualifier: string; // period, e.g. "Q3-2025"
  fieldOrBehavior: string; // e.g. "revenue_usd"
}

export interface GroundingResult {
  bundle: TrustBundle;
  report: TrustReport;
  /** The verified amount from the source. */
  amount: number;
}

/**
 * Ground a claim against a retrieved SalesRecord.
 *
 * If record is undefined → return undefined (no grounding produced).
 * The conductor gate then REFUSES — there is no code path to a verified answer.
 *
 * This uses the REAL @kontourai/survey buildSurveyTrustBundle() and
 * @kontourai/surface buildTrustReport(). Not faked.
 */
export function groundClaim(
  request: ClaimRequest,
  record: SalesRecord | undefined
): GroundingResult | undefined {
  if (!record) {
    // No retrieval result → no grounding possible → conductor must refuse.
    return undefined;
  }

  const now = new Date().toISOString();
  const claimId = `claim.${request.subjectId}.${request.qualifier}.revenue_usd`;
  const sourceId = `source.${record.docId}`;
  const extractionId = `ext.${record.docId}.amount`;
  const candidateSetId = `cset.${record.docId}.amount`;
  const candidateId = `cand.${record.docId}.amount`;
  const reviewOutcomeId = `review.${record.docId}.amount`;

  const surveyInput: SurveyInput = {
    source: `internal-sales-system/${record.docId}`,
    generatedAt: now,

    rawSources: [
      {
        id: sourceId,
        kind: "api-record",
        sourceRef: `internal://sales-system/docs/${record.docId}`,
        observedAt: record.recordedAt,
        fetchedAt: now,
        locatorScheme: "structured-field",
        metadata: {
          accountId: record.accountId,
          accountName: record.accountName,
          period: record.period,
          docId: record.docId,
        },
      },
    ],

    extractions: [
      {
        id: extractionId,
        sourceId,
        target: "revenue_usd",
        value: record.amount,
        confidence: 0.98,
        locator: record.fieldLocator,
        excerpt: `${record.amount} ${record.currency} for ${record.period}`,
        extractor: "sales-system-extractor-v1",
        extractedAt: now,
        metadata: {
          currency: record.currency,
          period: record.period,
        },
      },
    ],

    candidateSets: [
      {
        id: candidateSetId,
        target: "revenue_usd",
        candidates: [
          {
            id: candidateId,
            extractionId,
            value: record.amount,
            confidence: 0.98,
          },
        ],
        selectedCandidateId: candidateId,
        status: "resolved",
        rationale: `Single authoritative record from internal sales system for ${record.period}.`,
      },
    ],

    reviewOutcomes: [
      {
        id: reviewOutcomeId,
        candidateSetId,
        candidateId,
        status: "verified",
        actor: record.recordedBy,
        reviewedAt: record.recordedAt,
        rationale: `Revenue figure verified against internal sales system record ${record.docId}.`,
        evidenceIds: [`${extractionId}.evidence`],
        authorizing: {
          kind: "explicit-statement",
          statement: `Revenue record ${record.docId} recorded by ${record.recordedBy} in the internal sales system.`,
          source: `internal://sales-system/docs/${record.docId}`,
        },
      },
    ],

    claims: [
      {
        id: claimId,
        candidateSetId,
        candidateId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        surface: "sales-grounding-demo",
        claimType: request.claimType,
        fieldOrBehavior: request.fieldOrBehavior,
        value: record.amount,
        status: "verified",
        impactLevel: "high",
        createdAt: record.recordedAt,
        updatedAt: record.recordedAt,
        evidenceType: "attestation",
        evidenceMethod: "extraction",
        collectedBy: "grounded-answer-conductor",
        actor: record.recordedBy,
        metadata: {
          currency: record.currency,
          period: record.period,
          sourceDocId: record.docId,
        },
      },
    ],
  };

  // REAL call — not faked. buildSurveyTrustBundle asserts producer discipline:
  // a "verified" claim CANNOT be produced without a review outcome with actor + reviewedAt.
  const bundle = buildSurveyTrustBundle(surveyInput);

  // REAL surface report — derives the TrustReport from the Hachure TrustBundle.
  const report = buildTrustReport(bundle, {
    id: `report.${claimId}`,
    now: new Date(),
  });

  return {
    bundle,
    report,
    amount: record.amount,
  };
}
