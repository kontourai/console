/**
 * The four (plus one) scenarios, declared mostly as data.
 *
 * Each scenario supplies:
 *   - query              : the natural-language question
 *   - rawAnswer          : what the ungrounded LLM confidently returns (the WRONG answer)
 *   - ragCandidate       : the value the RAG pipeline ships (same wrong answer)
 *   - shipOnAbstain      : whether the RAG pipeline ships when the checker abstains
 *   - whyFactCheckPasses : the honest reason a FAIR fact-checker passes the bad answer
 *   - groundAndGate      : the scenario's distinct structural mechanism — grounds the
 *                          real claim(s) and runs the matching gate predicate. This is
 *                          the ONLY per-scenario code; everything else is shared.
 *   - correctAnswer      : the truth, for the report/UI (what a grounded answer WOULD say,
 *                          or that no answer is possible).
 *
 * The harness runs all three lanes against this declaration. The Kontour lane's verdict
 * is whatever groundAndGate returns — a real GateOutcome over a real TrustBundle.
 */

import { findRecord, findRecordByDoc, hashValue } from "./corpus.js";
import { groundValue } from "./ground.js";
import type { ClaimBinding } from "./ground.js";
import {
  gateAbsent,
  gateQualifier,
  gateFreshness,
  gateJoin,
  gateLocator,
} from "./gate.js";
import type { GateOutcome } from "./gate.js";

export interface Scenario {
  id: string;
  slug: string; // for screenshot filenames
  title: string;
  query: string;
  /** Confident, ungrounded answer. */
  rawAnswer: number;
  /** Value the RAG pipeline ships. */
  ragCandidate: number;
  /** Subject identifiers the fact-checker requires in supporting evidence. */
  subjectTerms: string[];
  /** Does the RAG pipeline ship when the fact-checker abstains? */
  shipOnAbstain: boolean;
  /** Optional join spec for join-aware fact-checking (scenario 3). */
  ragJoin?: {
    subClaims: Array<{ role: string; query: string; value: number; subjectTerms: string[] }>;
  };
  /** Honest reason a FAIR fact-checker passes the bad answer. Surfaced in the UI. */
  whyFactCheckPasses: string;
  /** Short truth statement for the report/UI. */
  correctAnswer: string;
  /** The scenario's distinct structural mechanism. Returns a real GateOutcome. */
  groundAndGate: () => GateOutcome;
}

const SUBJECT = "account";

function binding(subjectId: string, requestedQualifier: string, field: string): ClaimBinding {
  return {
    subjectType: SUBJECT,
    subjectId,
    requestedQualifier,
    fieldOrBehavior: field,
    claimType: "sales.quarterly",
  };
}

// ── Scenario 0 — absence → confabulation ──────────────────────────────────────

const scenario0: Scenario = {
  id: "s0",
  slug: "s0-absence",
  title: "Absence → confabulation",
  query: "What were Vega Labs' Q3-2025 sales?",
  rawAnswer: 295_000,
  ragCandidate: 295_000,
  subjectTerms: ["Vega"],
  shipOnAbstain: true, // pipeline ships unverified answers absent contradicting evidence
  whyFactCheckPasses:
    "Retrieval finds NO on-topic Vega chunk, so the fact-checker ABSTAINS (it cannot " +
    "corroborate, but it also has nothing that contradicts the number). A pipeline that " +
    "ships answers unless it can prove them wrong then emits the fabricated figure. The " +
    "checker never had grounds to block it — abstention is not refusal.",
  correctAnswer: "No Vega Labs Q3-2025 record exists; the only correct response is to refuse.",
  groundAndGate: () => {
    const b = binding("account-vega", "Q3-2025", "revenue_usd");
    const record = findRecord("account-vega", "Q3-2025", "revenue_usd");
    if (!record) return gateAbsent(b); // structurally cannot ground → refuse
    // (unreachable: no Vega record exists)
    return gateQualifier(b, groundValue(b, record));
  },
};

// ── Scenario 1 — HERO: right number, wrong qualifier (period) ──────────────────

const scenario1: Scenario = {
  id: "s1",
  slug: "s1-qualifier",
  title: "Right number, wrong qualifier (period)",
  query: "What were Alpha Corp's Q3-2025 sales?",
  rawAnswer: 451_000, // the real Q2 figure, mis-presented as Q3
  ragCandidate: 451_000,
  subjectTerms: ["Alpha Corp", "Alpha"],
  shipOnAbstain: false, // it won't even need to: the checker SUPPORTS the value
  whyFactCheckPasses:
    "Retrieval is qualifier-blind. The Alpha Q2 chunk is the most lexically/semantically " +
    "similar hit for \"Alpha Corp sales\" (same account, same word \"sales\", and it states " +
    "$451,000), so it ranks #1. The fact-checker confirms $451,000 IS supported by the " +
    "retrieved Alpha sales context and passes. A real retriever blurs Q2 vs Q3 — both are " +
    "\"Alpha Corp sales\" — and a text-level checker has no notion that the requested PERIOD " +
    "(Q3) differs from the period the supporting text describes (Q2).",
  correctAnswer:
    "There is no Alpha Corp Q3-2025 record. $451,000 is the real Q2-2025 figure. The correct " +
    "response is to refuse the Q3 question, not to hand back the Q2 number.",
  groundAndGate: () => {
    const b = binding("account-alpha", "Q3-2025", "revenue_usd");
    // No Q3 record exists; the only Alpha record is Q2-2025. We ground THAT (it is real
    // and verified) and let the qualifier gate catch that it answers the wrong period.
    const q3 = findRecord("account-alpha", "Q3-2025", "revenue_usd");
    if (q3) return gateQualifier(b, groundValue(b, q3));
    const q2 = findRecord("account-alpha", "Q2-2025", "revenue_usd");
    if (!q2) return gateAbsent(b);
    // Ground the real Q2 value; the gate compares its bound qualifier to the request.
    return gateQualifier(b, groundValue(b, q2));
  },
};

// ── Scenario 2 — stale source ─────────────────────────────────────────────────

const scenario2: Scenario = {
  id: "s2",
  slug: "s2-stale",
  title: "Stale source (restated since grounding)",
  query: "What were Beta Industries' Q3-2025 sales?",
  rawAnswer: 512_000, // the OLD, pre-restatement value
  ragCandidate: 512_000,
  subjectTerms: ["Beta Industries", "Beta"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "The retriever reads from an indexed/cached snapshot of the Beta Q3 document that still " +
    "says $512,000 (the value before the source was restated). The fact-checker confirms " +
    "$512,000 appears in the retrieved chunk and passes. Both the answer and the evidence " +
    "agree — because both are stale. A post-hoc checker has no freshness boundary: it cannot " +
    "see that the live source was restated to $488,000 after the chunk was indexed.",
  correctAnswer:
    "Beta Q3-2025 was restated to $488,000 on 2026-06-14. The cached $512,000 is stale and " +
    "must be re-grounded before it can be served.",
  groundAndGate: () => {
    const b = binding("account-beta", "Q3-2025", "revenue_usd");
    const record = findRecordByDoc("sales-2025-q3-beta");
    if (!record) return gateAbsent(b);
    // Ground with the OLD snapshot hash (the value as it was when first grounded = 512_000).
    // The source's CURRENT hash reflects the restated 488_000, so freshness fires.
    const staleSnapshot = hashValue("sales-2025-q3-beta", "records[0].amount", 512_000);
    const grounded = groundValue(b, record, { snapshotHash: staleSnapshot });
    return gateFreshness(b, grounded);
  },
};

// ── Scenario 3 — composition / join error ─────────────────────────────────────

const scenario3: Scenario = {
  id: "s3",
  slug: "s3-join",
  title: "Composition / join error (wrong-period COGS)",
  query: "What was Gamma Holdings' Q3-2025 gross margin?",
  // margin = Q3 revenue (900k) - Q2 COGS (600k) = 300k  ← WRONG (used Q2 COGS)
  // correct = 900k - Q3 COGS (540k) = 360k
  rawAnswer: 300_000,
  ragCandidate: 300_000,
  subjectTerms: ["Gamma Holdings", "Gamma"],
  shipOnAbstain: true,
  ragJoin: {
    subClaims: [
      {
        role: "Q3 revenue",
        query: "Gamma Holdings Q3-2025 revenue",
        value: 900_000,
        subjectTerms: ["Gamma"],
      },
      {
        // The bad answer's COGS input (Q2, $600,000) — which IS individually supported.
        role: "COGS used",
        query: "Gamma Holdings cost of goods sold $600,000",
        value: 600_000,
        subjectTerms: ["Gamma"],
      },
    ],
  },
  whyFactCheckPasses:
    "No single document states the gross margin — it is COMPUTED. The fact-checker can only " +
    "check the sub-numbers, and each one checks out in isolation: $900,000 revenue is in the " +
    "Gamma revenue chunk, and $600,000 COGS is in a real Gamma COGS chunk. The final $300,000 " +
    "appears in no chunk, so the checker abstains on it and the pipeline ships the computed " +
    "figure. A post-hoc checker cannot see the JOIN — it never verifies that the COGS used was " +
    "the Q3 COGS and not the (equally real) Q2 COGS.",
  correctAnswer:
    "Correct Q3 margin = $900,000 - $540,000 (Q3 COGS) = $360,000. The bad answer used Q2 COGS " +
    "($600,000), yielding $300,000. The join mixes periods.",
  groundAndGate: () => {
    const b = binding("account-gamma", "Q3-2025", "gross_margin_usd");
    const revB = binding("account-gamma", "Q3-2025", "revenue_usd");
    const cogsB = binding("account-gamma", "Q3-2025", "cogs_usd");
    const rev = findRecord("account-gamma", "Q3-2025", "revenue_usd");
    // The bad answer joined the Q2 COGS record (the qualifier error in the join).
    const cogsQ2 = findRecord("account-gamma", "Q2-2025", "cogs_usd");
    if (!rev || !cogsQ2) return gateAbsent(b);
    const groundedRev = groundValue(revB, rev);
    const groundedCogs = groundValue(cogsB, cogsQ2); // ground the real (Q2) COGS value
    return gateJoin(b, {
      label: "Q3-2025 gross margin",
      derivedValue: rev.value - cogsQ2.value, // 300_000
      subClaims: [
        { role: "Q3 revenue", grounded: groundedRev },
        { role: "Q3 COGS (actually Q2)", grounded: groundedCogs },
      ],
    });
  },
};

// ── Scenario 4 — citation theater ─────────────────────────────────────────────

const scenario4: Scenario = {
  id: "s4",
  slug: "s4-citation",
  title: "Citation theater (real doc, unsupported locator)",
  query: "What were Delta Systems' Q3-2025 sales?",
  rawAnswer: 600_000, // the FORECAST figure, cited as if it were actuals
  ragCandidate: 600_000,
  subjectTerms: ["Delta Systems", "Delta"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "The cited document (Delta Q3-2025 report) is REAL and is retrieved. It even contains the " +
    "string $600,000 — as a forecast. A citation/grounding checker confirms (a) the document " +
    "exists and is on-topic and (b) the value $600,000 appears in it, so it passes. The checker " +
    "validates that the number is present in the cited source; it does not parse that the figure " +
    "lives at the forecast locator rather than the actual-revenue locator ($750,000).",
  correctAnswer:
    "Delta Q3-2025 actual revenue is $750,000 (at records[0].amount). The cited $600,000 is the " +
    "forecast (records[0].forecast) — the citation does not support a sales/actuals claim.",
  groundAndGate: () => {
    const b = binding("account-delta", "Q3-2025", "revenue_usd");
    const record = findRecordByDoc("sales-2025-q3-delta");
    if (!record) return gateAbsent(b);
    // The answer cites the real Delta doc but binds to the FORECAST locator for a $600k
    // figure. We ground a claim that cites records[0].forecast. The real actuals locator
    // (records[0].amount) holds $750,000, so the cited locator does not support the value.
    const grounded = groundValue(b, record, { citedLocator: "records[0].forecast" });
    return gateLocator(b, grounded, record.fieldLocator /* the real actuals locator */);
  },
};

export const SCENARIOS: Scenario[] = [
  scenario1, // hero first
  scenario2,
  scenario3,
  scenario4,
  scenario0, // absence last (already proven by the original demo)
];
