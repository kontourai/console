/**
 * The conductor.
 *
 * answer(query) orchestrates the full grounding loop:
 *   1. Decomposes the query into a required claim (claimType, subject, qualifier)
 *   2. Dispatches to the lab to ground it against the mocked sales system
 *   3. GATES: if grounding produced a verified claim → GROUNDED answer
 *              if no source was found → REFUSAL
 *
 * THE STRUCTURAL HONESTY POINT:
 *   The conductor cannot emit a "grounded" answer without a GroundingResult.
 *   The GroundingResult can only be produced by groundClaim() with a real record.
 *   groundClaim() can only call buildSurveyTrustBundle() with a real SurveyInput.
 *   buildSurveyTrustBundle() asserts producer discipline and throws if "verified"
 *   is claimed without a real review outcome (actor + reviewedAt).
 *
 *   The refusal is NOT a heuristic "if confidence low" — the code path literally
 *   cannot return a GroundedAnswer without a GroundingResult. TypeScript enforces it.
 */

import { groundClaim } from "./lab.js";
import { retrieveSalesRecord, rawLookup } from "./sales-system.js";
import type { GroundingResult } from "./lab.js";
import type { TrustBundle, TrustReport } from "@kontourai/surface";

export interface SalesQuery {
  accountId: string;
  period: string;
}

// ── Result discriminated union ────────────────────────────────────────────────

export interface GroundedAnswer {
  kind: "grounded";
  query: SalesQuery;
  accountId: string;
  period: string;
  /** The verified sales amount — only present when grounding succeeded. */
  amount: number;
  /** The real Hachure TrustBundle produced by @kontourai/survey. */
  bundle: TrustBundle;
  /** The TrustReport produced by @kontourai/surface. */
  report: TrustReport;
  /** Human-readable chain-of-custody summary. */
  provenance: string;
}

export interface Refusal {
  kind: "refused";
  query: SalesQuery;
  accountId: string;
  period: string;
  /** Structural refusal message — no fabrication. */
  reason: string;
}

export type ConductedAnswer = GroundedAnswer | Refusal;

// ── Raw / ungrounded answer (the contrast) ───────────────────────────────────

export interface RawAnswer {
  kind: "raw";
  query: SalesQuery;
  accountId: string;
  period: string;
  /** Always returns a number — even when no source exists. */
  amount: number;
  /** No provenance — the whole point. */
  provenance: null;
  /** Whether the raw lookup actually had a backing record. */
  hasSource: boolean;
}

// ── Claim decomposition ───────────────────────────────────────────────────────

function decomposeQuery(query: SalesQuery) {
  return {
    claimType: "sales.quarterly",
    subjectType: "account",
    subjectId: query.accountId,
    qualifier: query.period,
    fieldOrBehavior: "revenue_usd",
  };
}

// ── Conductor: the conducted / grounded path ─────────────────────────────────

/**
 * Conducts a grounded answer:
 *   - Decomposes query → claim request
 *   - Calls lab to retrieve + ground
 *   - GATES: grounding result present → GroundedAnswer; absent → Refusal
 *
 * STRUCTURAL GATE: This function returns ConductedAnswer (GroundedAnswer | Refusal).
 * There is NO overloaded path that could return a GroundedAnswer without grounding.
 * TypeScript's discriminated union prevents any caller from treating a Refusal as
 * a GroundedAnswer without explicitly checking .kind.
 */
export function answer(query: SalesQuery): ConductedAnswer {
  const claimRequest = decomposeQuery(query);

  // 1. Retrieve from mocked sales system.
  const record = retrieveSalesRecord(query.accountId, query.period);

  // 2. Ground the claim in the lab (calls real buildSurveyTrustBundle).
  const grounding: GroundingResult | undefined = groundClaim(claimRequest, record);

  // 3. GATE: grounding is either present or absent — no third path.
  if (!grounding) {
    // STRUCTURAL REFUSAL:
    // We cannot construct a GroundedAnswer here because `grounding` is undefined.
    // The compiler enforces this — there's no way to reach GroundedAnswer without
    // a real GroundingResult from the lab.
    return {
      kind: "refused",
      query,
      accountId: query.accountId,
      period: query.period,
      reason: `No source found for ${query.accountId} / ${query.period} — cannot verify; I won't fabricate this.`,
    };
  }

  // Only reachable when grounding succeeded with a real verified bundle.
  const claim = grounding.bundle.claims[0];
  const evidence = grounding.bundle.evidence[0];
  const provenance = [
    `Source: ${evidence?.sourceRef ?? "unknown"}`,
    `Locator: ${evidence?.sourceLocator ?? "n/a"}`,
    `Collected: ${evidence?.observedAt ?? "n/a"}`,
    `By: ${evidence?.collectedBy ?? "n/a"}`,
    `Claim status: ${claim?.status ?? "unknown"}`,
  ].join(" | ");

  return {
    kind: "grounded",
    query,
    accountId: query.accountId,
    period: query.period,
    amount: grounding.amount,
    bundle: grounding.bundle,
    report: grounding.report,
    provenance,
  };
}

// ── Raw path: the contrast ────────────────────────────────────────────────────

/**
 * The raw / ungrounded path — always returns an amount, never refuses.
 * No provenance. No grounding loop. No structural gating.
 *
 * This is NOT faking an LLM hallucination. The honest framing:
 *   "The raw path has no grounding and no structural refusal mechanism;
 *    here's what it returns — including for queries with no backing data."
 */
export function rawAnswer(query: SalesQuery): RawAnswer {
  const lookup = rawLookup(query.accountId, query.period);
  return {
    kind: "raw",
    query,
    accountId: query.accountId,
    period: query.period,
    amount: lookup.amount ?? 0,
    provenance: null,
    hasSource: lookup.hasSource,
  };
}
