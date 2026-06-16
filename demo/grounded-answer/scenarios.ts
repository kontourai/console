/**
 * The scenarios, declared mostly as data.
 *
 * Two CLASSES, distinguished by `kind`:
 *   - "answerable" (wins) : the question CAN be grounded cleanly. Kontour answers with
 *                           confidence (gate PASSES, real trust panel). A fair RAG pipeline
 *                           also answers it correctly — both are fine on the easy ones.
 *   - "trap"              : no clean grounding exists. Kontour refuses; RAG ships a wrong
 *                           answer the fact-checker endorsed. Only Kontour catches it.
 * Together they prove Kontour is a PRECISE DISCRIMINATOR: it answers exactly when it can
 * and refuses exactly when it can't.
 *
 * Each scenario supplies:
 *   - kind               : "answerable" | "trap"
 *   - query              : the natural-language question
 *   - rawAnswer          : what the ungrounded LLM confidently returns (the answer it emits)
 *   - ragCandidate       : the value the RAG pipeline ships (the right answer on wins; the
 *                          SAME wrong answer on traps)
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
import {
  loadOkfConcept,
  countSchemaFields,
  groundOkf,
  okfDocId,
  sha256Of,
} from "./okf.js";

export interface Scenario {
  id: string;
  slug: string; // for screenshot filenames
  title: string;
  /**
   * Whether the question is genuinely ANSWERABLE from the corpus (a win — Kontour
   * confidently grounds it and the gate PASSES) or a TRAP (no clean grounding exists —
   * Kontour refuses where a fair RAG+fact-check pipeline ships the wrong answer).
   *
   * This discriminator lets the harness, builders, and scoreboard treat the two classes
   * distinctly — proving Kontour is a PRECISE DISCRIMINATOR, not a refuse-everything box.
   */
  kind: "answerable" | "trap";
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
  /**
   * Optional OKF provenance, surfaced by the deck/gallery for the interop scenarios.
   * Present only on scenarios grounded against the vendored Google OKF concept file —
   * lets the UI show that the source is Google's public data (un-riggable) and that
   * Hachure adds the content-hash integrity-ref OKF has no field for.
   */
  okf?: {
    resourceUri: string;
    okfTimestamp: string;
    /** sha256 of the vendored OKF file content (the integrity-ref OKF omits). */
    integrityRef: string;
    upstreamUrl: string;
    repoCommitSha: string;
    /** What the freshness trap modelled (only on the trap). */
    staleSnapshot?: string;
  };
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
  kind: "trap",
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
  kind: "trap",
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
  kind: "trap",
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
  kind: "trap",
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
  kind: "trap",
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

// ── Win W0 — the opening win: a cleanly grounded answer (establishes the product) ──
//
// Before any trap appears, show the product doing the thing it exists to do: answer a
// well-grounded question with confidence. Gamma Q3-2025 revenue is a real record at a
// real locator for the requested period — every binding matches, so the gate PASSES and
// emits a verified value with a real green trust panel.

const winOpening: Scenario = {
  id: "w0",
  slug: "w0-open-win",
  title: "A grounded answer (the product)",
  kind: "answerable",
  query: "What was Gamma Holdings' Q3-2025 revenue?",
  rawAnswer: 900_000,
  ragCandidate: 900_000,
  subjectTerms: ["Gamma Holdings", "Gamma"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "This question is genuinely answerable: the Gamma Q3-2025 revenue record states $900,000 " +
    "for the period asked. The retriever surfaces the on-topic Gamma revenue chunk and the " +
    "fact-checker correctly confirms $900,000 — a right answer to a right question. On the easy, " +
    "well-grounded cases a competent RAG+fact-check pipeline is fine. So is Kontour.",
  correctAnswer:
    "Gamma Holdings Q3-2025 revenue is $900,000 (records[0].amount). The question is answerable " +
    "and every binding matches — period, locator, source. The correct response is to ANSWER it.",
  groundAndGate: () => {
    const b = binding("account-gamma", "Q3-2025", "revenue_usd");
    const rec = findRecord("account-gamma", "Q3-2025", "revenue_usd");
    if (!rec) return gateAbsent(b);
    // Every binding matches the request → gateQualifier passes and emits the verified value.
    return gateQualifier(b, groundValue(b, rec));
  },
};

// ── Win W1 — the HERO win: the same data as s1, asked for the period that EXISTS ─────
//
// s1 asks Alpha for Q3 (no record) and Kontour refuses. THIS asks Alpha for Q2 — the
// period the $451,000 record actually covers — and Kontour answers, verified. Same
// number, same source, same machinery: Kontour refuses s1 because it is PRECISE about
// the period, not because it is timid. This is the precision pairing.

const winHero: Scenario = {
  id: "w1",
  slug: "w1-qualifier-win",
  title: "Right number, right qualifier (the period that exists)",
  kind: "answerable",
  query: "What were Alpha Corp's Q2-2025 sales?",
  rawAnswer: 451_000,
  ragCandidate: 451_000,
  subjectTerms: ["Alpha Corp", "Alpha"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "Asked about the period that actually exists, everyone agrees. The Alpha Q2 chunk states " +
    "$451,000 and the fact-checker correctly supports it. This is the twin of s1: SAME $451,000, " +
    "SAME source — but here the requested period (Q2) matches the grounded period, so the answer " +
    "is genuinely correct. The fact-checker can't tell this case apart from s1; Kontour can.",
  correctAnswer:
    "Alpha Corp Q2-2025 sales are $451,000 — the period this record actually covers. The binding " +
    "matches the request, so Kontour ANSWERS it (the s1 twin asked for Q3, which does not exist).",
  groundAndGate: () => {
    const b = binding("account-alpha", "Q2-2025", "revenue_usd");
    const q2 = findRecord("account-alpha", "Q2-2025", "revenue_usd");
    if (!q2) return gateAbsent(b);
    // Requested qualifier (Q2-2025) matches the grounded qualifier → the gate PASSES.
    return gateQualifier(b, groundValue(b, q2));
  },
};

// ── OKF interop — grounding against a REAL, public Google source ──────────────
//
// These two scenarios kill "you wrote the data": the grounded source is a byte-for-byte
// copy of a Google Cloud Open Knowledge Format (OKF) concept file (the Bitcoin Blocks
// BigQuery table), vendored under okf-fixture/ with a PROVENANCE.json recording the
// upstream URL + repo commit SHA + sha256. The fact — "the schema defines 12 fields" —
// is COUNTED from the file's own schema table, so it genuinely appears in Google's file.
//
// One source, three proofs:
//   (1) it's Google's public data, not ours — un-riggable;
//   (2) Hachure ↔ OKF interop: OKF resource → sourceLocator, OKF timestamp → freshness;
//   (3) Hachure adds the content-hash integrity-ref + freshness invalidation OKF omits.

const okfConcept = loadOkfConcept();
const okfFieldCount = countSchemaFields(okfConcept); // counted from the file (= 12)
const OKF_RESOURCE = okfConcept.frontmatter.resource ?? "okf://concept";
const OKF_TIMESTAMP = okfConcept.frontmatter.timestamp ?? "unknown";
const OKF_INTEGRITY_REF = okfConcept.currentIntegrityRef; // sha256 of the vendored bytes
const OKF_DOC_ID = okfDocId(okfConcept);
const OKF_UPSTREAM_URL =
  "https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/" +
  "ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a/okf/bundles/crypto_bitcoin/tables/blocks.md";
const OKF_COMMIT_SHA = "ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a";

function okfBinding(requestedQualifier: string): ClaimBinding {
  return {
    subjectType: "okf-concept",
    subjectId: OKF_DOC_ID,
    requestedQualifier,
    fieldOrBehavior: "schema_field_count",
    claimType: "okf.schema",
  };
}

// ── OKF Win — grounded against the real Google OKF concept ─────────────────────
const winOkf: Scenario = {
  id: "wokf",
  slug: "wokf-okf-win",
  title: "Grounded against a real Google OKF bundle",
  kind: "answerable",
  query: "How many fields does the Bitcoin Blocks BigQuery table schema define (per the Google OKF bundle)?",
  rawAnswer: okfFieldCount, // 12
  ragCandidate: okfFieldCount, // 12
  subjectTerms: ["Bitcoin", "blocks", "OKF"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "This is genuinely answerable from a REAL, public source: Google's OKF concept file for the " +
    "Bitcoin Blocks BigQuery table lists 12 schema fields. The retriever surfaces the on-topic OKF " +
    "chunk and the fact-checker correctly confirms 12 — a right answer to a right question. On the " +
    "easy, well-grounded cases a competent RAG+fact-check pipeline is fine. So is Kontour — but " +
    "Kontour also binds the answer to the OKF `resource` URI and stamps it with the content-hash " +
    "(sha256) integrity-ref that OKF has no field for.",
  correctAnswer:
    `The Bitcoin Blocks schema defines ${okfFieldCount} fields (counted from the OKF file's own ` +
    `schema table). Kontour grounds it at the OKF resource ${OKF_RESOURCE}, stamps the OKF timestamp ` +
    `${OKF_TIMESTAMP} as the freshness anchor, and adds the sha256 integrity-ref OKF omits — so the ` +
    `answer is portable and re-verifiable against Google's public file.`,
  groundAndGate: () => {
    const b = okfBinding(OKF_TIMESTAMP);
    const grounded = groundOkf(b, okfConcept, okfFieldCount);
    // The grounded qualifier (OKF timestamp) matches the request → gate PASSES, emitting
    // a verified value bound to the OKF resource with the sha256 integrity-ref.
    return gateQualifier(b, grounded);
  },
  okf: {
    resourceUri: OKF_RESOURCE,
    okfTimestamp: OKF_TIMESTAMP,
    integrityRef: OKF_INTEGRITY_REF,
    upstreamUrl: OKF_UPSTREAM_URL,
    repoCommitSha: OKF_COMMIT_SHA,
  },
};

// ── OKF Freshness Trap — the gap OKF cannot cover ──────────────────────────────
//
// We ground the SAME fact against the SAME real OKF file, but with a STALE integrity-ref
// snapshot — the hash captured when the concept was first grounded, BEFORE the upstream
// asset changed. The fixture's CURRENT content hash is the real sha256 of the vendored
// bytes; the stale snapshot no longer matches it. Kontour's integrity-ref fires and marks
// the claim STALE. A naive OKF-trusting / RAG consumer trusts the OKF `timestamp`
// (last-changed) — which has NO content-integrity semantics — and serves the cached fact.
// This is honest: the source changed and OKF has no mechanism to notice; Hachure does.
const STALE_OKF_SNAPSHOT = sha256Of("okf-blocks::schema::pre-change-snapshot");
const okfStaleTrap: Scenario = {
  id: "sokf",
  slug: "sokf-okf-stale",
  title: "OKF freshness gap (source changed, OKF can't notice)",
  kind: "trap",
  query: "How many fields does the Bitcoin Blocks schema define (from the cached OKF grounding)?",
  rawAnswer: okfFieldCount, // 12 — the value the stale snapshot would serve
  ragCandidate: okfFieldCount,
  subjectTerms: ["Bitcoin", "blocks", "OKF"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "The retriever reads the cached OKF chunk, which still states 12 fields, and the fact-checker " +
    "confirms 12 appears in it — PASS. Both the answer and the evidence agree, because both are read " +
    "from the cached OKF copy. OKF's only temporal field is `timestamp` (last meaningful change) — it " +
    "is NOT a content hash, so neither the OKF consumer nor the post-hoc checker can tell the source " +
    "changed since this grounding was captured. There is no freshness boundary to cross.",
  correctAnswer:
    "The grounding snapshot's integrity-ref no longer matches the OKF file's current content hash — " +
    "the source changed since it was grounded. OKF's bare `timestamp` provides no invalidation; " +
    "Hachure's content-hash integrity-ref does. The cached value must be re-grounded before serving.",
  groundAndGate: () => {
    const b = okfBinding(OKF_TIMESTAMP);
    // Ground against a STALE integrity-ref snapshot (captured before the source changed).
    const grounded = groundOkf(b, okfConcept, okfFieldCount, { snapshotHash: STALE_OKF_SNAPSHOT });
    // The fixture's CURRENT content hash is the real sha256 of the vendored bytes; the
    // stale snapshot no longer matches it → freshness fires (content-change invalidation).
    return gateFreshness(b, grounded, {
      current: OKF_INTEGRITY_REF,
      restatedTo: "the upstream OKF concept's content hash advanced past the grounding snapshot",
      restatedAt: "since the cached grounding was captured",
    });
  },
  okf: {
    resourceUri: OKF_RESOURCE,
    okfTimestamp: OKF_TIMESTAMP,
    integrityRef: OKF_INTEGRITY_REF,
    upstreamUrl: OKF_UPSTREAM_URL,
    repoCommitSha: OKF_COMMIT_SHA,
    staleSnapshot: STALE_OKF_SNAPSHOT,
  },
};

/**
 * The full scenario set: wins (answerable) interleaved so the wins establish the product
 * before/around the traps. Builders re-order per surface (the present deck leads with a
 * win, pairs w1↔s1, then runs the remaining traps). The gallery and tests iterate this
 * array directly; filter by `kind` to separate wins from traps.
 */
export const SCENARIOS: Scenario[] = [
  winOpening, // W0 — the product: a confident grounded answer
  winHero, // W1 — Alpha Q2 win (the s1 twin: same data, answerable)
  scenario1, // s1 hero trap — Alpha Q3 (the same data, refused)
  scenario2,
  scenario3,
  scenario4,
  winOkf, // OKF win — grounded against Google's real public OKF concept
  okfStaleTrap, // OKF freshness trap — the gap OKF can't cover
  scenario0, // absence last (the original "refuse-moment")
];

/** The OKF interop scenarios (grounded against the vendored Google OKF concept). */
export const OKF_WIN = winOkf;
export const OKF_TRAP = okfStaleTrap;

/** Just the answerable wins. */
export const WIN_SCENARIOS: Scenario[] = SCENARIOS.filter((s) => s.kind === "answerable");
/** Just the traps. */
export const TRAP_SCENARIOS: Scenario[] = SCENARIOS.filter((s) => s.kind === "trap");
