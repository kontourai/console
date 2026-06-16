/**
 * RAG + fact-check baseline — a FAIR, REAL competitor lane.
 *
 * THIS IS NOT A STRAWMAN. The whole point of the demo is that structural grounding
 * beats a COMPETENT retrieve-then-check pipeline, so this lane must be genuine:
 *
 *   1. Retrieval — a real, deterministic lexical similarity (token-overlap cosine
 *      over a TF vector) across the chunk corpus. No network, no API, no LLM. This is
 *      a legitimate sparse retriever; BM25/embedding retrievers behave the same way
 *      for these inputs (they surface the most lexically/semantically on-topic chunk).
 *
 *   2. Fact-check — a real entailment-style check: "is the claimed numeric value
 *      SUPPORTED by the retrieved context?" Production NLI/grounding fact-checkers do
 *      exactly this: they check the proposed answer against the retrieved evidence and
 *      pass it if the evidence states (entails) the value. They are POST-HOC and
 *      TEXT-LEVEL — they do not re-derive the answer or reason about binding qualifiers,
 *      content freshness, joins, or which locator a figure came from.
 *
 * The honest blind spot of EVERY post-hoc text checker: it confirms the number appears
 * in supporting text; it cannot confirm the number answers the QUESTION THAT WAS ASKED.
 * Each scenario exploits a different facet of that gap, and each carries a
 * WHY_FACTCHECK_PASSES note explaining the legitimate reason a fair checker passes.
 */

import { CHUNKS } from "./corpus.js";
import type { Chunk } from "./corpus.js";

// ── Tokenization ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "to", "in", "on", "and", "or", "is", "are",
  "was", "were", "by", "this", "that", "it", "as", "at", "be", "with", "what",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[$,]/g, " ")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Real cosine similarity between two TF vectors. */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [term, av] of a) {
    const bv = b.get(term);
    if (bv) dot += av * bv;
  }
  const magA = Math.sqrt([...a.values()].reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt([...b.values()].reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
}

/**
 * Real top-k retrieval over the chunk corpus. Deterministic, no network.
 * Returns chunks ranked by cosine similarity to the query, filtered to a minimum
 * relevance so off-topic chunks don't get surfaced (a real retriever thresholds too).
 */
export function retrieve(query: string, k = 3, minScore = 0.08): RetrievedChunk[] {
  const qv = termFreq(tokenize(query));
  return CHUNKS.map((chunk) => ({ chunk, score: cosine(qv, termFreq(tokenize(chunk.text))) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// ── Fact-check (entailment-style) ─────────────────────────────────────────────

export type FactCheckVerdict = "supported" | "unsupported" | "abstain";

export interface FactCheckResult {
  verdict: FactCheckVerdict;
  /** Which retrieved chunk supported the claimed value (if any). */
  supportingChunkId?: string;
  rationale: string;
  retrieved: RetrievedChunk[];
}

/**
 * Does a chunk mention the subject? A competent fact-checker checks the claim's
 * entities against the evidence — it won't accept a Beta chunk as support for a Vega
 * claim. We raise the honesty bar by making the checker subject-aware: support only
 * counts when the supporting chunk actually mentions the subject. This makes the
 * baseline STRONGER, not weaker.
 */
function mentionsSubject(text: string, subjectTerms: string[]): boolean {
  const lower = text.toLowerCase();
  return subjectTerms.some((term) => lower.includes(term.toLowerCase()));
}

/** Extract every numeric value mentioned in a chunk (handles $451,000 etc). */
function numbersIn(text: string): number[] {
  const matches = text.match(/\$?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/[$,]/g, "")))
    .filter((n) => Number.isFinite(n));
}

/**
 * Real entailment-style fact-check: does the retrieved context SUPPORT the claimed
 * numeric value? This is the standard post-hoc grounding check:
 *   - retrieve top-k for the query,
 *   - if a retrieved chunk states the claimed value (and is on-topic), the claim is
 *     SUPPORTED (entailed by retrieved evidence),
 *   - if nothing on-topic is retrieved, ABSTAIN (cannot corroborate),
 *   - else UNSUPPORTED.
 *
 * Critically — like every real text-level checker — it asks "does the number appear in
 * supporting text?", NOT "does the supporting text answer the exact question asked?".
 */
export function factCheck(
  query: string,
  claimedValue: number,
  /** Terms that identify the subject (e.g. ["Vega"]); support must mention one. */
  subjectTerms: string[]
): FactCheckResult {
  const retrieved = retrieve(query);

  // A chunk only counts as support if it is on-topic for the SUBJECT. This is the
  // competent behavior: don't let an off-subject chunk corroborate the claim.
  const onSubject = retrieved.filter((r) => mentionsSubject(r.chunk.text, subjectTerms));

  if (onSubject.length === 0) {
    return {
      verdict: "abstain",
      rationale:
        `No retrieved chunk is on-topic for the subject (${subjectTerms.join(", ")}). ` +
        `The checker cannot corroborate the value, so it abstains — it does not assert the ` +
        `answer is wrong, it simply has no support for it.`,
      retrieved,
    };
  }

  for (const r of onSubject) {
    if (numbersIn(r.chunk.text).includes(claimedValue)) {
      return {
        verdict: "supported",
        supportingChunkId: r.chunk.id,
        rationale:
          `The claimed value $${claimedValue.toLocaleString()} appears in retrieved chunk ` +
          `"${r.chunk.id}" (cosine ${r.score.toFixed(3)}), which is on-topic for the subject. ` +
          `The value is therefore entailed by the retrieved evidence — PASS.`,
        retrieved,
      };
    }
  }

  return {
    verdict: "unsupported",
    rationale:
      `The claimed value $${claimedValue.toLocaleString()} does not appear in any on-subject ` +
      `retrieved chunk. No supporting evidence — UNSUPPORTED.`,
    retrieved,
  };
}

/**
 * Join-aware fact-check, for a COMPUTED answer (e.g. margin = revenue - COGS).
 *
 * A competent join-aware pipeline does the best a post-hoc checker can: it fact-checks
 * each retrievable INPUT sub-number, and abstains on the derived result it cannot find
 * stated in any source. Here every sub-number checks out individually, yet the join is
 * still wrong — because one input was the wrong-period figure. The checker has no way to
 * see that: it confirms each number exists, not that the right numbers were combined.
 */
export function factCheckJoin(
  query: string,
  subClaims: Array<{ role: string; query: string; value: number; subjectTerms: string[] }>,
  derivedValue: number
): FactCheckResult {
  const subResults = subClaims.map((s) => ({
    role: s.role,
    value: s.value,
    result: factCheck(s.query, s.value, s.subjectTerms),
  }));
  const allInputsSupported = subResults.every((s) => s.result.verdict === "supported");
  const retrieved = retrieve(query);
  if (allInputsSupported) {
    return {
      verdict: "abstain",
      rationale:
        `Every input checks out individually: ` +
        subResults
          .map((s) => `${s.role} $${s.value.toLocaleString()} (${s.result.verdict})`)
          .join(", ") +
        `. But the derived result $${derivedValue.toLocaleString()} is stated in NO source, ` +
        `so the checker abstains on the composite. It cannot see the join — it never verifies ` +
        `that the right-period inputs were combined.`,
      retrieved,
    };
  }
  return {
    verdict: "unsupported",
    rationale:
      `At least one input could not be corroborated: ` +
      subResults.map((s) => `${s.role} (${s.result.verdict})`).join(", ") + `.`,
    retrieved,
  };
}

// ── The RAG lane result ───────────────────────────────────────────────────────

export interface RagLaneResult {
  kind: "rag";
  /** The (wrong) answer the RAG pipeline emits. */
  answer: number;
  /** Whether the fact-checker passed the answer (supported / abstain-then-pass). */
  passed: boolean;
  factCheck: FactCheckResult;
}

/**
 * Run the RAG lane: emit the candidate answer and fact-check it.
 *
 * A "passed" answer means the pipeline SHIPS the (wrong) number to the user — either
 * because the checker marked it supported, OR because the checker abstained and the
 * pipeline ships unverified answers when it has no contradicting evidence (the common
 * production default: "answer unless we can prove it wrong"). We surface which case it is.
 */
export function runRagLane(
  query: string,
  candidateAnswer: number,
  subjectTerms: string[],
  shipOnAbstain: boolean,
  /** Optional join spec — when present, uses join-aware fact-checking. */
  join?: {
    subClaims: Array<{ role: string; query: string; value: number; subjectTerms: string[] }>;
  }
): RagLaneResult {
  const fc = join
    ? factCheckJoin(query, join.subClaims, candidateAnswer)
    : factCheck(query, candidateAnswer, subjectTerms);
  const passed = fc.verdict === "supported" || (fc.verdict === "abstain" && shipOnAbstain);
  return { kind: "rag", answer: candidateAnswer, passed, factCheck: fc };
}
