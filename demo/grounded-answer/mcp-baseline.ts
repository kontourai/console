/**
 * Agent + Tools (MCP) baseline — a COMPETENT, REAL stepping-stone lane.
 *
 * THIS IS NOT A STRAWMAN. The modern answer to RAG's fuzzy retrieval is to give an
 * agent a real tool (MCP) that queries the ACTUAL system. So this lane is genuinely
 * stronger than RAG: instead of retrieving free-text chunks and fact-checking them, the
 * agent calls a tool — `sales.query(account, period[, field])` — over the SAME structured
 * corpus the Kontour lane grounds against, and gets back REAL, FRESH records. It *feels*
 * authoritative: "I queried the system." On a well-formed call it returns the right number.
 *
 * The honest gap the demo proves is NOT "the tool has bad data." It is that tool access
 * is not the same as binding + gate + portable proof:
 *
 *   (a) QUALIFIER — a loosely-scoped tool call answers the wrong period. A real agent,
 *       asked for Q3 of an account that only has Q2 on file, frequently falls back to the
 *       nearest record ("the latest sales for Alpha") rather than refusing. The tool
 *       faithfully returns Q2; the agent presents it as the answer to Q3.
 *
 *   (b) FRESHNESS — the agent reads from the tool's CACHE/replica (the same indexed
 *       snapshot a real MCP server serves for latency), which still holds the pre-restated
 *       value. No content-hash boundary means the agent can't tell the cache drifted.
 *
 *   (c) NO RECOMPUTABLE ARTIFACT — critically, even when the tool answer is right, the
 *       result lives only in the transcript. There is no portable trust bundle binding
 *       *which call* backed *which claim*. Later you cannot re-verify the answer (the
 *       `/goal` problem): "show me the evidence" returns a chat log, not a recomputable proof.
 *
 * Where a well-formed tool query genuinely WOULD catch the error, we are honest and let
 * the MCP lane catch it (e.g. absence: the strict tool returns nothing, so a disciplined
 * agent refuses — like RAG abstaining on a clean miss). The remaining, unmistakable gap is
 * then the missing binding + gate + portable artifact, not data access.
 *
 * No network, no LLM. The tool is a real deterministic function over corpus.ts records.
 */

import { findRecord, findRecordByDoc, STRUCTURED_RECORDS } from "./corpus.js";
import type { SourceRecord } from "./corpus.js";

// ── The MCP tool: a real lookup over the structured system of record ───────────

export interface ToolCall {
  /** The tool the agent invoked, e.g. "sales.query". */
  tool: string;
  /** The arguments the agent passed. */
  args: { account: string; period: string; field?: string };
}

export interface ToolResult {
  /** The record the tool returned (the live system row), if any. */
  record?: SourceRecord;
  /** The value the tool surfaced (what the agent reads back). */
  value?: number;
  /** The period the returned record is actually FOR (may differ from the requested period). */
  returnedPeriod?: string;
  /** Whether the tool returned from a cached/replica snapshot rather than live. */
  fromCache?: boolean;
  /** Human note describing what the tool did (for the lane to render). */
  note: string;
}

/**
 * `sales.query(account, period, field)` — a real, deterministic tool over the system
 * of record. Two call modes model how an agent actually invokes a tool:
 *
 *   - strict (loose=false): exact (account, period, field). Returns nothing if the
 *     period has no record — a disciplined agent then refuses.
 *   - loose (loose=true):   the period is treated as a hint. If no exact match exists,
 *     the tool falls back to the latest record for the account+field. This is the
 *     common, competent-but-unbound behavior: the agent gets "the account's sales"
 *     and presents them for the requested period.
 */
export function salesQuery(
  args: { account: string; period: string; field?: string },
  opts?: { loose?: boolean; fromCache?: boolean; cacheValue?: number }
): ToolResult {
  const field = args.field ?? "revenue_usd";
  const exact = findRecord(args.account, args.period, field);

  if (exact) {
    // Live, fresh, exact match. If a cache value is modelled (stale replica), the tool
    // serves the cached value instead of the live one — an MCP server reading a replica.
    if (opts?.fromCache && typeof opts.cacheValue === "number") {
      return {
        record: exact,
        value: opts.cacheValue,
        returnedPeriod: exact.period,
        fromCache: true,
        note:
          `Tool returned ${args.account} ${args.period} ${field} from a cached replica ` +
          `(value ${opts.cacheValue.toLocaleString()}); the live row has since been restated.`,
      };
    }
    return {
      record: exact,
      value: exact.value,
      returnedPeriod: exact.period,
      note: `Tool returned the live ${args.account} ${args.period} ${field} row (${exact.value.toLocaleString()}).`,
    };
  }

  if (opts?.loose) {
    // No exact period match. A loosely-scoped agent call falls back to the account's
    // latest record for this field — and presents it as the answer to the requested period.
    const candidates = STRUCTURED_RECORDS.filter(
      (r) => r.accountId === args.account && r.field === field
    ).sort((a, b) => b.period.localeCompare(a.period));
    const fallback = candidates[0];
    if (fallback) {
      return {
        record: fallback,
        value: fallback.value,
        returnedPeriod: fallback.period,
        note:
          `No ${args.period} row exists; the loosely-scoped call fell back to the account's ` +
          `latest ${field} row (${fallback.period}, ${fallback.value.toLocaleString()}) and the ` +
          `agent presented it for ${args.period}.`,
      };
    }
  }

  return {
    note:
      `Tool found NO ${args.account} ${args.period} ${field} row. A disciplined agent has ` +
      `nothing to return and must refuse — but no portable artifact records that it refused.`,
  };
}

/** A tool over the citation case: returns a value at a SPECIFIC locator of a real doc. */
export function salesQueryByLocator(docId: string, locator: string): ToolResult {
  const rec = findRecordByDoc(docId);
  if (!rec) return { note: `Tool found no document ${docId}.` };
  // The doc is real. The agent's tool call grabbed a value from `locator`. The forecast
  // locator holds a different figure than the actuals locator — the tool faithfully
  // returns whatever the agent asked for, with no notion that it does not answer "sales".
  return {
    record: rec,
    value: rec.value,
    returnedPeriod: rec.period,
    note:
      `Tool returned doc ${docId}; the agent read the value at "${locator}". The doc is real, ` +
      `but nothing binds the cited locator to the actuals the question asked for.`,
  };
}

// ── The MCP lane result ────────────────────────────────────────────────────────

export type McpGap = "qualifier" | "freshness" | "locator" | "join" | "no-artifact" | "none";

export interface McpLaneResult {
  kind: "mcp";
  /** The tool call the agent issued. */
  call: ToolCall;
  /** What the tool returned. */
  result: ToolResult;
  /** The answer the agent emits (the tool value it read back). */
  answer?: number;
  /** Did the agent SHIP an answer (vs. refuse because the tool returned nothing)? */
  shipped: boolean;
  /**
   * The honest gap that bites on this scenario:
   *   - "qualifier"/"freshness"/"locator"/"join": the tool answer is wrong for the reason named
   *   - "no-artifact": the answer is RIGHT, but lives only in the transcript — not recomputable
   *   - "none": the agent correctly refused (a well-formed query caught it)
   */
  gap: McpGap;
  /** Whether the agent caught the error (refused / would not present a wrong answer). */
  caught: boolean;
  /** Plain-English note the lane renders. */
  note: string;
}
