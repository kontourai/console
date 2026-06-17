/**
 * Mocked internal sales system.
 *
 * WHAT IS MOCKED:
 *   - The in-memory dataset itself (accounts, Q3 records, amounts).
 *   - The retrieval function (lookup by accountId + period).
 *
 * WHAT IS REAL:
 *   - The shape of SalesRecord mirrors what a real system would provide for grounding.
 *   - The absence of a record for "account-omega"/"Q3-2025" is intentional — it proves
 *     the structural refusal path.
 */

export interface SalesRecord {
  /** Internal source document ID — becomes the sourceRef in grounding. */
  docId: string;
  accountId: string;
  accountName: string;
  period: string;
  amount: number;
  currency: string;
  /** Which field path within the doc holds the amount. */
  fieldLocator: string;
  recordedBy: string;
  recordedAt: string;
}

/** Mocked in-memory dataset: two accounts, only one with Q3-2025 data. */
const SALES_RECORDS: SalesRecord[] = [
  {
    docId: "sales-doc-2025-Q3-alpha",
    accountId: "account-alpha",
    accountName: "Alpha Corp",
    period: "Q3-2025",
    amount: 482_000,
    currency: "USD",
    fieldLocator: "records[0].amount",
    recordedBy: "revenue-ops@example.com",
    recordedAt: "2025-10-02T09:15:00Z",
  },
  {
    docId: "sales-doc-2025-Q2-omega",
    accountId: "account-omega",
    accountName: "Omega Ltd",
    period: "Q2-2025",
    amount: 317_000,
    currency: "USD",
    fieldLocator: "records[0].amount",
    recordedBy: "revenue-ops@example.com",
    recordedAt: "2025-07-05T14:30:00Z",
  },
  // NOTE: account-omega has NO Q3-2025 record — this absence drives the structural refusal demo.
];

/**
 * Retrieve a sales record for a given account + period.
 * Returns undefined when no record exists (not when the system is down).
 * The absence is structural — the data simply isn't there.
 */
export function retrieveSalesRecord(
  accountId: string,
  period: string
): SalesRecord | undefined {
  return SALES_RECORDS.find(
    (r) => r.accountId === accountId && r.period === period
  );
}

/**
 * The "raw" / ungrounded path: return whatever we have, or make something up.
 * This represents the confabulation risk — no structural gating.
 *
 * IMPORTANT: We do NOT pretend to have real LLM hallucination here. The honest
 * framing is that the raw path returns a number even when no source exists,
 * with NO provenance and NO structural refusal mechanism.
 */
export function rawLookup(
  accountId: string,
  period: string
): { accountId: string; period: string; amount: number | null; hasSource: boolean } {
  const record = retrieveSalesRecord(accountId, period);
  if (record) {
    return { accountId, period, amount: record.amount, hasSource: true };
  }
  // Raw path: returns a fabricated number with no source — no refusal.
  // This simulates what a retrieve-then-hope system does when the data isn't there.
  return { accountId, period, amount: 295_000, hasSource: false };
}
