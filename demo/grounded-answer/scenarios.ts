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
import { salesQuery, salesQueryByLocator } from "./mcp-baseline.js";
import type { McpLaneResult } from "./mcp-baseline.js";

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
  /** Optional value unit. When set, the value renders as "N noun" instead of "$N". */
  unit?: { noun: string };
  /**
   * Optional Agent + Tools (MCP) lane. When present, the lane is rendered alongside
   * Raw/RAG/Kontour on this scenario. The agent invokes a REAL tool over the SAME
   * corpus the other lanes use (stronger than RAG's fuzzy retrieval), and this returns
   * the honest outcome — where the tool answer is wrong (qualifier/freshness/locator),
   * where a well-formed query genuinely catches it, and where the answer is right but
   * leaves no recomputable artifact (the binding + portability gap). Optional: scenarios
   * without it still render the existing three lanes.
   */
  runMcp?: () => McpLaneResult;
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
  // Agent + Tools (MCP): a well-formed strict tool query genuinely CATCHES this — the tool
  // returns nothing for Vega, so a disciplined agent refuses (like RAG abstaining on a clean
  // miss). We are honest: data access is enough here. The residual gap is only that no
  // recomputable artifact records the refusal — but on absence, MCP gets it right.
  runMcp: () => {
    const call = { tool: "sales.query", args: { account: "account-vega", period: "Q3-2025", field: "revenue_usd" } };
    const result = salesQuery(call.args, { loose: false });
    return {
      kind: "mcp",
      call,
      result,
      shipped: false,
      gap: "none",
      caught: true,
      note:
        "The strict tool query finds no Vega row, so a disciplined agent refuses — a well-formed " +
        "query catches absence, just like RAG abstaining. Tool access is enough here.",
    };
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
  // Agent + Tools (MCP): the agent calls the live tool for Alpha Q3. No Q3 row exists, so a
  // loosely-scoped call falls back to the account's latest row (Q2, $451,000) and the agent
  // presents it for Q3 — REAL data, fresh, wrong period. Stronger than RAG (it queried the
  // system) but it still answers the wrong qualifier, and nothing binds the call to the claim.
  runMcp: () => {
    const call = { tool: "sales.query", args: { account: "account-alpha", period: "Q3-2025", field: "revenue_usd" } };
    const result = salesQuery(call.args, { loose: true });
    return {
      kind: "mcp",
      call,
      result,
      answer: result.value,
      shipped: result.value !== undefined,
      gap: "qualifier",
      caught: false,
      note:
        "The tool returned a REAL, fresh row — but it is Alpha's Q2 figure, surfaced for a Q3 " +
        "question by a loosely-scoped call. The agent has no qualifier gate, so it ships $451,000 " +
        "for Q3. And no portable artifact records which call backed the claim — only the transcript does.",
    };
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
    // Pass the source's CURRENT content hash so the REAL buildTrustReport() derives the
    // claim as STALE (TrustStatus "stale") — the panel shows "Needs refresh" + a
    // freshness-breach gap, not a contradictory "Verified".
    const grounded = groundValue(b, record, {
      snapshotHash: staleSnapshot,
      currentIntegrityRef: record.contentHash,
    });
    return gateFreshness(b, grounded);
  },
  // Agent + Tools (MCP): the agent queries the tool for Beta Q3 — but the MCP server reads a
  // cached replica (the latency-friendly default), which still holds the pre-restated $512,000.
  // No content-hash boundary means the agent can't tell the cache drifted from the live row,
  // so it confidently ships the stale value. Querying the system did not make it fresh.
  runMcp: () => {
    const call = { tool: "sales.query", args: { account: "account-beta", period: "Q3-2025", field: "revenue_usd" } };
    const result = salesQuery(call.args, { fromCache: true, cacheValue: 512_000 });
    return {
      kind: "mcp",
      call,
      result,
      answer: result.value,
      shipped: result.value !== undefined,
      gap: "freshness",
      caught: false,
      note:
        "The tool returned $512,000 from a cached replica — the value before the Beta row was " +
        "restated to $488,000. With no content-hash freshness boundary, the agent cannot see the " +
        "cache drifted, so it ships the stale figure. A live-looking tool call is not a fresh one.",
    };
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
  // Agent + Tools (MCP): the agent calls the tool against the REAL Delta Q3 doc and reads a
  // value from the forecast locator. The tool faithfully returns whatever field the agent
  // asked for; nothing binds the cited locator to the actuals the question wanted. So the
  // agent reports the $600,000 forecast as Q3 sales — a real doc, the wrong locator.
  runMcp: () => {
    const call = { tool: "sales.query", args: { account: "account-delta", period: "Q3-2025", field: "records[0].forecast" } };
    const result = salesQueryByLocator("sales-2025-q3-delta", "records[0].forecast");
    return {
      kind: "mcp",
      call,
      // The tool grabbed the forecast value (600k), not the actuals (750k) — model that.
      answer: 600_000,
      result: { ...result, value: 600_000, note: result.note },
      shipped: true,
      gap: "locator",
      caught: false,
      note:
        "The tool returned the REAL Delta Q3 doc, and the agent read the value at the forecast " +
        "locator ($600,000). The document exists, but nothing binds that locator to actuals — the " +
        "agent presents a forecast as sales, with no recomputable proof of which locator it used.",
    };
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
  // Agent + Tools (MCP): asked the period that EXISTS, the tool returns the right row and the
  // agent answers $451,000 correctly — data access is genuinely sufficient for the number.
  // The remaining gap is portability: the answer lives only in the transcript, with no
  // recomputable bundle binding this call to the claim (the `/goal` problem). Right answer,
  // no portable proof — the exact difference Kontour closes.
  runMcp: () => {
    const call = { tool: "sales.query", args: { account: "account-alpha", period: "Q2-2025", field: "revenue_usd" } };
    const result = salesQuery(call.args, { loose: false });
    return {
      kind: "mcp",
      call,
      answer: result.value,
      result,
      shipped: result.value !== undefined,
      gap: "no-artifact",
      caught: true,
      note:
        "Asked the period that exists, the tool returns the right row and the agent answers " +
        "$451,000 correctly. But the result lives only in the transcript — there is no portable, " +
        "recomputable trust bundle binding THIS call to the claim. Right answer, no portable proof.",
    };
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
  unit: { noun: "schema fields" },
  slug: "wokf-okf-win",
  title: "Grounded against a real public source",
  kind: "answerable",
  query: "How many fields does the Bitcoin Blocks BigQuery table schema define?",
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
  // Agent + Tools (MCP): a BigQuery-style tool (bq.tableSchema) queries the live table and
  // counts 12 fields — the right answer, from a real query. Sufficient for the number; but
  // the answer is unbound and non-portable: nothing records WHICH table version (content hash)
  // the count was read from, so it cannot be re-verified later against Google's bytes.
  runMcp: (): McpLaneResult => ({
    kind: "mcp",
    call: { tool: "bq.tableSchema", args: { account: OKF_RESOURCE, period: "live", field: "schema_field_count" } },
    answer: okfFieldCount,
    result: {
      value: okfFieldCount,
      returnedPeriod: "live",
      note: `Tool queried ${OKF_RESOURCE} and counted ${okfFieldCount} schema fields from the live table.`,
    },
    shipped: true,
    gap: "no-artifact",
    caught: true,
    note:
      `The tool queried the live BigQuery table and returned ${okfFieldCount} fields — correct. But ` +
      "the answer is unbound: no content-hash records which table version it was read from, so it " +
      "cannot be re-verified against Google's bytes later. Right answer, no portable proof.",
  }),
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
  unit: { noun: "schema fields" },
  slug: "sokf-okf-stale",
  title: "Freshness gap (source changed, a timestamp can't notice)",
  kind: "trap",
  query: "How many fields does the Bitcoin Blocks schema define (from the cached grounding)?",
  rawAnswer: okfFieldCount, // 12 — the value the stale snapshot would serve
  ragCandidate: okfFieldCount,
  subjectTerms: ["Bitcoin", "blocks", "OKF"],
  shipOnAbstain: false,
  whyFactCheckPasses:
    "The retriever reads the cached chunk, which still states 12 fields, and the fact-checker " +
    "confirms 12 appears in it — PASS. Both the answer and the evidence agree, because both are read " +
    "from the cached copy. The source's only temporal field is a `timestamp` (last meaningful change) — " +
    "it is NOT a content hash, so neither the consumer nor the post-hoc checker can tell the source " +
    "changed since this grounding was captured. There is no freshness boundary to cross.",
  correctAnswer:
    "The grounding snapshot's integrity-ref no longer matches the source file's current content hash — " +
    "the source changed since it was grounded. A bare `timestamp` provides no invalidation; " +
    "Kontour's content-hash integrity-ref does. The cached value must be re-grounded before serving.",
  groundAndGate: () => {
    const b = okfBinding(OKF_TIMESTAMP);
    // Ground against a STALE integrity-ref snapshot (captured before the source changed).
    // Pass the OKF file's CURRENT content hash so the REAL buildTrustReport() derives the
    // claim as STALE — the panel shows "Needs refresh" + a freshness-breach gap, not "Verified".
    const grounded = groundOkf(b, okfConcept, okfFieldCount, {
      snapshotHash: STALE_OKF_SNAPSHOT,
      currentIntegrityRef: OKF_INTEGRITY_REF,
    });
    // The fixture's CURRENT content hash is the real sha256 of the vendored bytes; the
    // stale snapshot no longer matches it → freshness fires (content-change invalidation).
    return gateFreshness(b, grounded, {
      current: OKF_INTEGRITY_REF,
      restatedTo: "the source's content hash advanced past the grounding snapshot",
      restatedAt: "since the cached grounding was captured",
    });
  },
  // Agent + Tools (MCP): the agent reads the cached OKF grounding (the same indexed snapshot an
  // MCP server serves), which still reports 12 fields. With no content-hash boundary the agent
  // can't tell the upstream concept changed since the cache was captured, so it ships the stale
  // count. A tool call over a cached source is no fresher than the cache.
  runMcp: (): McpLaneResult => ({
    kind: "mcp",
    call: { tool: "bq.tableSchema", args: { account: OKF_RESOURCE, period: "cached", field: "schema_field_count" } },
    answer: okfFieldCount,
    result: {
      value: okfFieldCount,
      returnedPeriod: "cached",
      fromCache: true,
      note: `Tool read the cached grounding for ${OKF_RESOURCE} and returned ${okfFieldCount} fields.`,
    },
    shipped: true,
    gap: "freshness",
    caught: false,
    note:
      "The tool read the cached grounding and returned 12 fields. With no content-hash boundary, " +
      "the agent can't see the source advanced past the grounding snapshot, so it ships the " +
      "stale count. Querying a cached source through a tool does not make it fresh.",
  }),
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
