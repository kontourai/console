/**
 * OKF source adapter — grounding against a REAL, public, un-riggable source.
 *
 * This is the part of the gallery that kills "you wrote the data". The grounded
 * source here is NOT ours: it is a byte-for-byte copy of a Google Cloud
 * Open Knowledge Format (OKF) concept file, vendored under okf-fixture/ with a
 * PROVENANCE.json recording the upstream URL, repo commit SHA, and sha256. A skeptic
 * can diff our fixture against Google's public repo and recompute the hash.
 *
 *   OKF (Open Knowledge Format v0.1, Google Cloud, 2026-06-12) is a vendor-neutral
 *   spec: a directory of markdown files with YAML frontmatter, one concept per file.
 *   Reserved frontmatter: type (required), title, description, resource (a URI for the
 *   underlying asset), tags, timestamp ("last meaningful change"). OKF has NO
 *   provenance / integrity-hash / verification / freshness-invalidation semantics —
 *   `timestamp` is just last-changed.
 *
 * The adapter:
 *   - parses the fixture's YAML frontmatter (type, resource, timestamp, …) + body;
 *   - maps OKF `resource`  → evidence sourceLocator (the locator the value is bound to);
 *   - computes sha256 of the WHOLE file content → currentIntegrityRef (the field OKF
 *     deliberately omits);
 *   - maps OKF `timestamp` → the freshness anchor;
 *   - feeds a real SourceRecord through the SAME groundValue() the sales scenarios use,
 *     calling the REAL buildSurveyTrustBundle() + buildTrustReport() (no stubs).
 *
 * "OKF tells the agent what it knows; Hachure proves what the answer stood on."
 *
 * WHAT IS REAL: the vendored Google OKF file (verifiable provenance), the sha256
 *   integrity-ref over its bytes, and buildSurveyTrustBundle()/buildTrustReport().
 * WHAT IS DERIVED: the field-count fact (12), counted from the file's own schema table.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groundValue } from "./ground.js";
import type { ClaimBinding, GroundedClaim } from "./ground.js";
import type { SourceRecord } from "./corpus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "okf-fixture", "blocks.md");

/** Reserved OKF v0.1 frontmatter fields (no integrity/provenance among them). */
export interface OkfFrontmatter {
  type: string;
  title?: string;
  description?: string;
  /** URI for the underlying asset → our evidence sourceLocator. */
  resource?: string;
  tags?: string[];
  /** OKF "last meaningful change" → our freshness anchor. */
  timestamp?: string;
}

export interface OkfConcept {
  /** The raw file content, byte-for-byte as vendored from Google's repo. */
  raw: string;
  frontmatter: OkfFrontmatter;
  /** Markdown body after the frontmatter block. */
  body: string;
  /**
   * sha256 over the WHOLE file content — the currentIntegrityRef OKF has no field for.
   * This is the integrity guarantee Hachure adds on top of an OKF source.
   */
  currentIntegrityRef: string;
  /** The fixture's path on disk (for the UI / provenance). */
  path: string;
}

/** Minimal, dependency-free YAML frontmatter parse (the subset OKF uses). */
function parseFrontmatter(raw: string): { frontmatter: OkfFrontmatter; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error("OKF concept file has no YAML frontmatter block");
  const [, fmText, body] = m;
  const fm: Record<string, unknown> = {};
  const lines = fmText.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) {
      i++;
      continue;
    }
    const [, key, rest] = kv;
    if (rest.trim() === "") {
      // A block scalar / list: collect following "- item" lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(lines[j].replace(/^\s*-\s+/, "").trim());
        j++;
      }
      fm[key] = items;
      i = j;
    } else {
      fm[key] = stripQuotes(rest.trim());
      i++;
    }
  }
  return { frontmatter: fm as unknown as OkfFrontmatter, body };
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** sha256 over the file's exact bytes — the integrity-ref OKF omits. */
export function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Load + parse the vendored OKF concept. Deterministic, NO network at runtime. */
export function loadOkfConcept(): OkfConcept {
  const raw = readFileSync(FIXTURE_PATH, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    raw,
    frontmatter,
    body,
    currentIntegrityRef: sha256Of(raw),
    path: FIXTURE_PATH,
  };
}

/**
 * The real, checkable fact we ground from this file: the number of fields the
 * Bitcoin Blocks schema defines. We COUNT the rows of the "# Schema" markdown table
 * in the file's own body — we do not hardcode it. This genuinely appears in Google's
 * file (12 field rows), so the claim is real, not fabricated.
 */
export function countSchemaFields(concept: OkfConcept): number {
  // The schema is a markdown table "| field | type |". Header + separator rows
  // ("| Field | Type |" and "| --- | --- |") are excluded; only data rows count.
  const rows = concept.body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.endsWith("|"));
  const dataRows = rows.filter((l) => {
    const cells = l.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 2) return false;
    // Skip the header row and the "--- | ---" separator row.
    const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c));
    const isHeader = cells[0].toLowerCase() === "field" && cells[1].toLowerCase() === "type";
    return !isSeparator && !isHeader;
  });
  return dataRows.length;
}

/** The OKF concept's stable doc id (derived from its resource URI tail). */
export function okfDocId(concept: OkfConcept): string {
  const r = concept.frontmatter.resource ?? "okf-concept";
  // e.g. .../tables/blocks → "okf-blocks"
  const tail = r.replace(/\/+$/, "").split("/").pop() || "concept";
  return `okf-${tail}`;
}

/**
 * Build the SourceRecord that grounds the OKF fact, mapping OKF fields onto the
 * same SourceRecord shape the sales scenarios use:
 *
 *   - resource   → fieldLocator   (surfaces as the grounded sourceLocator)
 *   - timestamp  → period         (the freshness anchor / grounded qualifier)
 *   - file bytes → contentHash    (the sha256 currentIntegrityRef OKF omits)
 *
 * `snapshotHash` lets the freshness-trap scenario ground against a STALE integrity-ref
 * snapshot whose hash no longer matches the fixture's current content hash.
 */
// The actual schema-table text from the OKF file — the verbatim source the
// field count was read from, not a synthesized summary.
function schemaTableExcerpt(concept: OkfConcept): string {
  const lines = concept.body.split("\n");
  const out: string[] = [];
  let inSchema = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s+schema\b/i.test(line)) {
      inSchema = true;
      out.push(line);
      continue;
    }
    if (inSchema) {
      if (/^#{1,6}\s/.test(line) && !/schema/i.test(line)) break;
      if (line) out.push(line);
    }
  }
  if (out.length <= 1) return lines.map((l) => l.trim()).filter((l) => l.startsWith("|")).join("\n");
  return out.join("\n");
}

export function okfSourceRecord(
  concept: OkfConcept,
  value: number,
  opts?: { snapshotHash?: string }
): SourceRecord {
  const resource = concept.frontmatter.resource ?? "okf://concept";
  const timestamp = concept.frontmatter.timestamp ?? "unknown";
  return {
    docId: okfDocId(concept),
    accountId: "okf:bigquery-public-data.crypto_bitcoin.blocks",
    accountName: concept.frontmatter.title ?? "OKF concept",
    // OKF timestamp → the freshness anchor / grounded qualifier.
    period: timestamp,
    field: "schema_field_count",
    value,
    currency: "fields",
    // OKF resource URI → the sourceLocator the value is bound to.
    fieldLocator: resource,
    observedAt: timestamp.includes("T") ? toIso(timestamp) : new Date(0).toISOString(),
    recordedBy: "google-cloud-okf@knowledge-catalog",
    // sha256 of the file's bytes — the integrity-ref OKF deliberately omits.
    // For the freshness trap we ground a STALE snapshot instead of the current one.
    contentHash: opts?.snapshotHash ?? concept.currentIntegrityRef,
    sourceExcerpt: schemaTableExcerpt(concept),
  };
}

function toIso(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/**
 * Ground an OKF-derived value through the REAL groundValue() → real
 * buildSurveyTrustBundle() + buildTrustReport(). Returns the same GroundedClaim the
 * gate consumes; groundedLocator == the OKF resource, groundingHashSnapshot == the
 * sha256 (current, or a stale snapshot for the freshness trap).
 */
export function groundOkf(
  binding: ClaimBinding,
  concept: OkfConcept,
  value: number,
  opts?: {
    snapshotHash?: string;
    /**
     * The OKF file's CURRENT content hash. When supplied and it differs from the
     * grounding snapshot, the real buildTrustReport() derives the claim as STALE
     * (see groundValue). Used by the OKF freshness trap so the panel shows the
     * adverse state, not "Verified".
     */
    currentIntegrityRef?: string;
  }
): GroundedClaim {
  const record = okfSourceRecord(concept, value, opts);
  return groundValue(binding, record, {
    snapshotHash: opts?.snapshotHash,
    currentIntegrityRef: opts?.currentIntegrityRef,
  });
}
