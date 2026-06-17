/**
 * Mocked source-of-record corpus for the three-lane gallery.
 *
 * WHAT IS MOCKED:
 *   - The in-memory documents (sales records, restatements, COGS, citations).
 *   - The deterministic content hashes (modelled like HTTP ETags / content digests).
 *
 * WHAT IS REAL:
 *   - The SHAPE of every record mirrors what a real source-of-record would expose:
 *     a stable docId, a field locator, an observedAt, and a content hash that
 *     changes when the underlying value is restated.
 *   - The corpus is consumed identically by all three lanes:
 *       • Raw lane ignores provenance entirely.
 *       • RAG lane retrieves CHUNKS (free text) and fact-checks against them.
 *       • Kontour lane grounds STRUCTURED records (with qualifier + locator + hash).
 *     The same underlying facts feed both the chunk text and the structured record,
 *     so the RAG lane is not handed a degraded corpus — it sees the same truth, just
 *     flattened to text the way a real retriever ingests documents.
 */

import { createHash } from "node:crypto";

/** A structured source record — what the Kontour lane grounds against. */
export interface SourceRecord {
  docId: string;
  accountId: string;
  accountName: string;
  /** The qualifier that BINDS this value. Period for sales; period for COGS. */
  period: string;
  /** What the value measures, e.g. "revenue_usd", "cogs_usd". */
  field: string;
  value: number;
  currency: string;
  /** Field path within the doc that holds `value`. */
  fieldLocator: string;
  observedAt: string;
  recordedBy: string;
  /**
   * Content hash of the CURRENT value of this record at this locator.
   * Modelled like an HTTP ETag: if the source restates the value, the hash changes.
   * The Kontour lane snapshots this at grounding time; a later mismatch == stale.
   */
  contentHash: string;
  /** Optional verbatim text from the source the value was read from (a real excerpt, not a summary). */
  sourceExcerpt?: string;
  /** Optional fetchable URL whose content hashes to contentHash — powers the panel's in-browser Verify. */
  verifyUrl?: string;
}

/** A retrievable free-text chunk — what the RAG lane searches over. */
export interface Chunk {
  /** Stable id, traces back to a docId. */
  id: string;
  docId: string;
  /** Free text — the form a retriever actually ingests and a fact-checker reads. */
  text: string;
}

/** Deterministic content hash over the value at a locator (ETag analogue). */
export function hashValue(docId: string, locator: string, value: number): string {
  return createHash("sha256")
    .update(`${docId}::${locator}::${value}`)
    .digest("hex")
    .slice(0, 16);
}

function record(
  r: Omit<SourceRecord, "contentHash">
): SourceRecord {
  return { ...r, contentHash: hashValue(r.docId, r.fieldLocator, r.value) };
}

// ── The structured corpus ─────────────────────────────────────────────────────
// Distinct accounts/values per scenario so the gallery reads cleanly.

export const STRUCTURED_RECORDS: SourceRecord[] = [
  // Scenario 0 (absence): Vega has NO Q3 record at all. (no entry)

  // Scenario 1 (qualifier): Alpha has a Q2-2025 record but NO Q3-2025 record.
  // The Q2 figure is real; the query asks for Q3.
  record({
    docId: "sales-2025-q2-alpha",
    accountId: "account-alpha",
    accountName: "Alpha Corp",
    period: "Q2-2025",
    field: "revenue_usd",
    value: 451_000,
    currency: "USD",
    fieldLocator: "records[0].amount",
    observedAt: "2025-07-04T10:00:00Z",
    recordedBy: "revenue-ops@example.com",
  }),

  // Scenario 2 (stale): Beta Q3 revenue was grounded at 512_000, then RESTATED.
  // CURRENT_HASH below reflects the restated value; the grounding snapshot holds
  // the OLD hash, so the freshness check fires.
  record({
    docId: "sales-2025-q3-beta",
    accountId: "account-beta",
    accountName: "Beta Industries",
    period: "Q3-2025",
    field: "revenue_usd",
    value: 488_000, // RESTATED current value (was 512_000 when first grounded)
    currency: "USD",
    fieldLocator: "records[0].amount",
    observedAt: "2026-06-14T08:00:00Z", // restatement date
    recordedBy: "revenue-ops@example.com",
  }),

  // Scenario 3 (join): Gamma Q3 revenue and Q2/Q3 COGS for a margin computation.
  record({
    docId: "sales-2025-q3-gamma-rev",
    accountId: "account-gamma",
    accountName: "Gamma Holdings",
    period: "Q3-2025",
    field: "revenue_usd",
    value: 900_000,
    currency: "USD",
    fieldLocator: "records[0].amount",
    observedAt: "2025-10-03T09:00:00Z",
    recordedBy: "revenue-ops@example.com",
  }),
  record({
    docId: "cogs-2025-q3-gamma",
    accountId: "account-gamma",
    accountName: "Gamma Holdings",
    period: "Q3-2025",
    field: "cogs_usd",
    value: 540_000, // the CORRECT Q3 COGS
    currency: "USD",
    fieldLocator: "records[0].cogs",
    observedAt: "2025-10-03T09:00:00Z",
    recordedBy: "finance-ops@example.com",
  }),
  record({
    docId: "cogs-2025-q2-gamma",
    accountId: "account-gamma",
    accountName: "Gamma Holdings",
    period: "Q2-2025",
    field: "cogs_usd",
    value: 600_000, // the WRONG-PERIOD COGS the bad answer uses
    currency: "USD",
    fieldLocator: "records[0].cogs",
    observedAt: "2025-07-03T09:00:00Z",
    recordedBy: "finance-ops@example.com",
  }),

  // Scenario 4 (citation theater): Delta Q3 doc EXISTS and is real, but the revenue
  // figure lives at records[0].amount (= 750_000). The bad answer cites this real doc
  // but binds to a DIFFERENT locator (records[0].forecast) that holds a forecast, not
  // the actuals — i.e. the cited locator does not support the claimed figure.
  record({
    docId: "sales-2025-q3-delta",
    accountId: "account-delta",
    accountName: "Delta Systems",
    period: "Q3-2025",
    field: "revenue_usd",
    value: 750_000,
    currency: "USD",
    fieldLocator: "records[0].amount",
    observedAt: "2025-10-04T09:00:00Z",
    recordedBy: "revenue-ops@example.com",
  }),
];

/**
 * The CURRENT content hash of a record's value at its locator, as the source
 * reports it RIGHT NOW. For most records this equals the snapshotted hash. For
 * the stale scenario (Beta), the source has been restated since grounding, so the
 * current hash differs from the hash captured in the grounding snapshot.
 */
export function currentContentHash(docId: string): string | undefined {
  const rec = STRUCTURED_RECORDS.find((r) => r.docId === docId);
  if (!rec) return undefined;
  return rec.contentHash;
}

export function findRecord(
  accountId: string,
  period: string,
  field: string
): SourceRecord | undefined {
  return STRUCTURED_RECORDS.find(
    (r) => r.accountId === accountId && r.period === period && r.field === field
  );
}

export function findRecordByDoc(docId: string): SourceRecord | undefined {
  return STRUCTURED_RECORDS.find((r) => r.docId === docId);
}

// ── The free-text chunk corpus (what the RAG retriever ingests) ───────────────
// Generated from the same facts, flattened to prose. The retriever sees these;
// it does NOT see the structured qualifier/locator/hash bindings — exactly the
// information loss a real document retriever suffers.

export const CHUNKS: Chunk[] = [
  // Scenario 1 — Alpha. Note the Q2 chunk says "sales" and "Alpha Corp" and the
  // amount; a lexical/semantic retriever surfaces it for an Alpha "sales" query.
  {
    id: "chunk-alpha-q2",
    docId: "sales-2025-q2-alpha",
    text:
      "Alpha Corp quarterly sales report. Account: Alpha Corp. " +
      "Revenue recognized for the quarter: $451,000 USD. " +
      "Filed by revenue operations. This is the Alpha Corp sales figure on record.",
  },
  {
    id: "chunk-alpha-context",
    docId: "sales-2025-q2-alpha",
    text:
      "Alpha Corp is an enterprise account. Sales for Alpha Corp are tracked " +
      "quarterly by revenue operations and reported in USD.",
  },

  // Scenario 2 — Beta. The RAG corpus chunk reflects the value AT CACHE TIME (stale).
  // This models a retriever reading from a cached/indexed snapshot, not live source.
  {
    id: "chunk-beta-q3-cached",
    docId: "sales-2025-q3-beta",
    text:
      "Beta Industries Q3-2025 sales report. Account: Beta Industries. " +
      "Q3-2025 revenue: $512,000 USD. Reported by revenue operations.",
  },

  // Scenario 3 — Gamma. Separate chunks for revenue and each COGS. NO chunk states
  // the final margin, so a post-hoc checker can only verify the sub-numbers.
  {
    id: "chunk-gamma-rev-q3",
    docId: "sales-2025-q3-gamma-rev",
    text:
      "Gamma Holdings Q3-2025 revenue report. Account: Gamma Holdings. " +
      "Q3-2025 revenue: $900,000 USD.",
  },
  {
    id: "chunk-gamma-cogs-q3",
    docId: "cogs-2025-q3-gamma",
    text:
      "Gamma Holdings Q3-2025 cost of goods sold. Account: Gamma Holdings. " +
      "Q3-2025 COGS: $540,000 USD.",
  },
  {
    id: "chunk-gamma-cogs-q2",
    docId: "cogs-2025-q2-gamma",
    text:
      "Gamma Holdings Q2-2025 cost of goods sold. Account: Gamma Holdings. " +
      "Q2-2025 COGS: $600,000 USD.",
  },

  // Scenario 4 — Delta. The cited document EXISTS and mentions Delta Q3 and a
  // $600,000 forecast figure. The bad answer cites this real doc for a $600,000
  // revenue claim. The doc exists and contains "600,000" (as a forecast), so a
  // citation/existence checker is satisfied.
  {
    id: "chunk-delta-q3",
    docId: "sales-2025-q3-delta",
    text:
      "Delta Systems Q3-2025 report. Account: Delta Systems. " +
      "Q3-2025 forecast: $600,000 USD. Actual recognized revenue is recorded separately.",
  },

  // OKF scenarios — a real Google OKF concept (Bitcoin Blocks table) flattened to a
  // retrievable chunk. The chunk states the same fact the OKF body states: the schema
  // defines 12 fields. A naive OKF-trusting / RAG consumer reads this and serves 12 —
  // it trusts the OKF `timestamp` (last-changed) and has no content-integrity check.
  {
    id: "chunk-okf-bitcoin-blocks",
    docId: "okf-blocks",
    text:
      "Bitcoin Blocks BigQuery table (Google Cloud OKF concept). " +
      "Resource: bigquery-public-data.crypto_bitcoin.blocks. " +
      "The schema defines 12 fields: hash, size, stripped_size, weight, number, version, " +
      "merkle_root, timestamp, nonce, bits, coinbase_param, transaction_count. " +
      "Last meaningful change (OKF timestamp): 2026-05-28.",
  },

  // Scenario 0 — absence. There is NO Vega chunk at all; retrieval finds nothing
  // on-topic, so the fact-checker can only abstain (cannot corroborate).
  {
    id: "chunk-unrelated-policy",
    docId: "policy-doc",
    text:
      "Company revenue recognition policy. Revenue is recognized when control " +
      "of goods or services transfers to the customer.",
  },
];
