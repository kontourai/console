// Workflow-trust bridge (console#254): translates flow-agents' workflow-trust
// projection envelope (flow-agents#891, schema `kontour.console.projection`,
// written by the `flow-agents-console-trust-projection` CLI /
// src/lib/workflow-trust-projection.ts) into `kontour.console.event` records
// that fold through the SAME `buildCurrentOperatingState` replay path every
// other Console record uses. Before this bridge, a workflow's local
// `trust.bundle` (Surface's own verified claims/evidence/events, aggregated by
// `@kontourai/surface`'s `buildTrustReport`) had no live board consumer: the
// evidence and claims planes stayed empty for flow-agents workflows, so a
// board gate trust panel (console#255) had nothing to render.
//
// Read-only over the producer's envelope file; Surface stays the sole
// authority for claim/evidence/trust VERDICTS (`nonAuthority: true` on every
// entry) -- this bridge only RELAYS `payload` (Surface's own `buildTrustReport`
// output) verbatim. It never recomputes, re-derives, or overrides a claim's
// status, freshness, or a gate's pass/fail verdict. Deterministic,
// CONTENT-ADDRESSED event ids (mirroring workflow-process-bridge.ts's
// `eventIdForProcessEntry`) make re-bridging idempotent: an unchanged report
// re-derives the SAME ids (the sink/hub dedupes it), while a changed report
// (new evidence attached, a claim's status advanced) re-derives NEW ids for
// exactly the affected objects.
//
// Kept as its own module/bin, mirroring workflow-process-bridge.ts's own
// module-doc rationale: this bridge translates a DIFFERENT flow-agents
// envelope family (`trusts[]`, Surface's per-workflow trust report) via a
// structurally different payload (an opaque, already-Surface-validated
// `buildTrustReport` result) than the process bridge's `processes[]`
// (workflow state/handoff sidecars). Both bridges independently derive the
// SAME scope-qualified "workflow" subject id for a given workflow (see
// workflow-subject-identity.ts's `qualifiedWorkflowSubjectId`, console#254) so
// this bridge's `gate.*`/`process.progressed` events land on the SAME process
// card the process bridge creates, instead of fabricating a duplicate.
//
// flow-agents does not (yet) export this envelope's TypeScript shape via a
// stable package subpath (see workflow-process-bridge.ts's own note on this).
// The minimal shape this bridge needs is redefined below, mirrored
// field-for-field against flow-agents' src/lib/workflow-trust-projection.ts
// (`ConsoleTrustProjection` / `ConsoleTrustProjectionEnvelope`, flow-agents#891).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_CONSOLE_RUNTIME_ROOT } = require("./runtime-root");
const { LocalFileSink, CompositeSink, ApiSink } = require("./emitter");
const { qualifiedWorkflowSubjectId } = require("./workflow-subject-identity");
import type { ConsoleEventRecord, ConsoleRecord, DeliveryResult, Sink } from "./types";

/** Same root workflow-process-bridge.ts scans -- the trust CLI writes under `<kontour-root>/projections/<producer>/<scope>.json` just like the process/learning CLIs (default producer dir `flow-agents-trust`, distinct from the process bridge's `flow-agents-process`). */
export const DEFAULT_WORKFLOW_TRUST_PROJECTION_ROOT = path.join(DEFAULT_CONSOLE_RUNTIME_ROOT, "projections");

// -- Minimal mirror of flow-agents' src/lib/workflow-trust-projection.ts shapes (flow-agents#891) --

export interface WorkflowTrustProjectionRef {
  product: string;
  kind: string;
  id: string;
  label?: string;
}

export interface WorkflowTrustSourceOfTruthRef extends WorkflowTrustProjectionRef {
  url?: string;
  sourcePath?: string;
}

export interface WorkflowTrustProjectionScope {
  kind: string;
  id: string;
}

export interface WorkflowTrustGateAssociation {
  gateId: string;
  claimIds: string[];
  evidenceIds: string[];
  eventIds: string[];
}

export interface WorkflowTrustProjectionEntryExtensions {
  "flow-agents": {
    task_slug: string;
    source_path: string;
  };
}

export interface WorkflowTrustProjectionEntry {
  id: string;
  family: "workflow";
  nonAuthority: true;
  subjectRef: WorkflowTrustProjectionRef;
  sourceRef: WorkflowTrustProjectionRef;
  /** `@kontourai/surface`'s `buildTrustReport` output, VERBATIM (claims/evidence/events/transparencyGaps/summary/...) -- Surface owns this shape; this bridge treats it as opaque except for the handful of fields it relays field-by-field below. */
  payload: Record<string, unknown>;
  gateAssociations: WorkflowTrustGateAssociation[];
  sourceOfTruthRefs: WorkflowTrustSourceOfTruthRef[];
  extensions: WorkflowTrustProjectionEntryExtensions;
}

export interface WorkflowTrustProjectionEnvelope {
  schema: "kontour.console.projection";
  version: string;
  generatedAt: string;
  scope: WorkflowTrustProjectionScope;
  producer: { id: string; product: string };
  derivedFrom: Record<string, unknown>;
  trusts: WorkflowTrustProjectionEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Shape discriminator against sibling envelope families (`processes[]`, `learnings[]`) -- all share `schema: "kontour.console.projection"`. */
export function isWorkflowTrustProjectionEnvelope(value: unknown): value is WorkflowTrustProjectionEnvelope {
  if (!isRecord(value)) return false;
  return value.schema === "kontour.console.projection" && Array.isArray(value.trusts);
}

/** Runtime validation of the envelope's REQUIRED top-level fields (mirrors workflow-process-bridge.ts's `validateEnvelopeShape`). One malformed ENVELOPE has no sibling envelope to preserve, so this throws. */
function validateEnvelopeShape(value: unknown, filePath: string): WorkflowTrustProjectionEnvelope {
  if (!isWorkflowTrustProjectionEnvelope(value)) {
    throw new Error(`${filePath} is not a workflow-trust projection envelope (expected schema "kontour.console.projection" with a trusts[] array)`);
  }
  const candidate = value as unknown as Record<string, unknown>;
  if (!isNonEmptyString(candidate.version)) {
    throw new Error(`${filePath}: envelope.version must be a non-empty string`);
  }
  if (!isNonEmptyString(candidate.generatedAt)) {
    throw new Error(`${filePath}: envelope.generatedAt must be a non-empty string`);
  }
  const scope = candidate.scope;
  if (!isRecord(scope) || !isNonEmptyString(scope.kind) || !isNonEmptyString(scope.id)) {
    throw new Error(`${filePath}: envelope.scope.kind and envelope.scope.id must be non-empty strings`);
  }
  const producer = candidate.producer;
  if (!isRecord(producer) || !isNonEmptyString(producer.id) || !isNonEmptyString(producer.product)) {
    throw new Error(`${filePath}: envelope.producer.id and envelope.producer.product must be non-empty strings`);
  }
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Read-only, symlink-guarded JSON read (mirrors workflow-process-bridge.ts's `readEnvelopeJson`). */
function readEnvelopeJson(filePath: string): unknown {
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`not a regular file: ${filePath}`);
    const buffer = Buffer.alloc(stat.size);
    const bytesRead = fs.readSync(fd, buffer, 0, stat.size, 0);
    if (bytesRead !== stat.size) throw new Error(`${filePath} changed while being read`);
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`${filePath} must not be a symlink`);
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Re-validates containment against a canonical `allowedRoot` IMMEDIATELY before the file is opened (TOCTOU guard, mirrors workflow-process-bridge.ts's `assertWithinAllowedRoot`). */
function assertWithinAllowedRoot(filePath: string, allowedRoot: string): void {
  let canonicalAllowedRoot: string;
  try {
    canonicalAllowedRoot = fs.realpathSync(allowedRoot);
  } catch (error) {
    throw new Error(`${allowedRoot}: cannot resolve allowed projection root (${(error as Error).message})`);
  }
  let canonicalFilePath: string;
  try {
    canonicalFilePath = fs.realpathSync(filePath);
  } catch (error) {
    throw new Error(`${filePath}: cannot resolve real path immediately before reading (${(error as Error).message})`);
  }
  if (!isWithin(canonicalAllowedRoot, canonicalFilePath)) {
    throw new Error(`${filePath} escapes the allowed projection root ${allowedRoot} (containment re-checked immediately before reading)`);
  }
}

/** Reads and shape-validates one workflow-trust projection envelope file. Throws on a malformed or non-matching (e.g. process-projection-shaped) file, or on a file that resolves outside `allowedRoot` when one is supplied. */
export function readWorkflowTrustProjectionEnvelope(filePath: string, allowedRoot?: string): WorkflowTrustProjectionEnvelope {
  if (allowedRoot !== undefined) assertWithinAllowedRoot(filePath, allowedRoot);
  const value = readEnvelopeJson(filePath);
  return validateEnvelopeShape(value, filePath);
}

export interface WorkflowTrustProjectionDiscovery {
  allowedRoot?: string;
  envelopePaths: string[];
}

function safeReadDir(dir: string): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Discovers `<root>/<producer>/<file>.json` candidate paths (mirrors workflow-process-bridge.ts's `discoverWorkflowProcessProjections`: a purely STRUCTURAL two-level scan + symlink-escape guard, schema-agnostic). Shape validation happens per-file at bridge time, so one malformed or non-matching file never aborts the whole pass. The returned `allowedRoot` MUST be threaded back into `bridgeWorkflowTrustProjection`/`readWorkflowTrustProjectionEnvelope`. */
export function discoverWorkflowTrustProjections(root: string): WorkflowTrustProjectionDiscovery {
  if (!fs.existsSync(root)) return { envelopePaths: [] };
  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(root);
  } catch {
    return { envelopePaths: [] };
  }

  const envelopePaths: string[] = [];
  for (const producerEntry of safeReadDir(canonicalRoot)) {
    if (!producerEntry.isDirectory()) continue;
    const producerDir = path.join(canonicalRoot, producerEntry.name);
    let canonicalProducerDir: string;
    try {
      canonicalProducerDir = fs.realpathSync(producerDir);
    } catch {
      continue;
    }
    if (!isWithin(canonicalRoot, canonicalProducerDir)) continue;

    for (const fileEntry of safeReadDir(canonicalProducerDir)) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) continue;
      const filePath = path.join(canonicalProducerDir, fileEntry.name);
      let canonicalFilePath: string;
      try {
        canonicalFilePath = fs.realpathSync(filePath);
      } catch {
        continue;
      }
      if (!isWithin(canonicalProducerDir, canonicalFilePath)) continue;
      envelopePaths.push(filePath);
    }
  }
  return { allowedRoot: canonicalRoot, envelopePaths: envelopePaths.sort() };
}

/** Canonical, length-safe digest over an ordered field set (mirrors workflow-process-bridge.ts's `canonicalDigest`): SHA-256 of a sorted-key JSON encoding, so no two distinct field combinations can serialize to the same bytes. */
function canonicalDigest(fields: Record<string, string>): string {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(fields).sort()) ordered[key] = fields[key];
  return crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

function isValidRef(value: unknown): value is WorkflowTrustProjectionRef {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.product) && isNonEmptyString(value.kind) && isNonEmptyString(value.id);
}

function isValidGateAssociation(value: unknown): value is WorkflowTrustGateAssociation {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.gateId)
    && isStringArray(value.claimIds)
    && isStringArray(value.evidenceIds)
    && isStringArray(value.eventIds);
}

function isValidSourceOfTruthRef(value: unknown): value is WorkflowTrustSourceOfTruthRef {
  if (!isValidRef(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  if (candidate.url !== undefined && typeof candidate.url !== "string") return false;
  if (candidate.sourcePath !== undefined && typeof candidate.sourcePath !== "string") return false;
  return true;
}

/**
 * Runtime validation of one `trusts[]` entry against the producer's REQUIRED
 * contract (mirrors workflow-process-bridge.ts's `validateProcessEntryShape`).
 * Returns a discriminated result rather than throwing: a malformed entry is
 * the caller's signal to SKIP that entry and continue with valid siblings,
 * never to abort the whole batch. `payload` is validated only structurally
 * (`claims`/`evidence` arrays present) -- its CONTENTS are Surface's own
 * already-validated `buildTrustReport` output and are relayed opaquely.
 */
function validateTrustEntryShape(
  value: unknown,
  index: number,
): { ok: true; entry: WorkflowTrustProjectionEntry } | { ok: false; reason: string } {
  const label = `trusts[${index}]`;
  if (!isRecord(value)) return { ok: false, reason: `${label} must be an object` };
  if (!isNonEmptyString(value.id)) return { ok: false, reason: `${label}.id must be a non-empty string` };
  const entryLabel = `${label} (${value.id})`;
  if (value.family !== "workflow") return { ok: false, reason: `${entryLabel}.family must be "workflow"` };
  if (value.nonAuthority !== true) return { ok: false, reason: `${entryLabel}.nonAuthority must be true` };
  if (!isValidRef(value.subjectRef)) return { ok: false, reason: `${entryLabel}.subjectRef must be a {product,kind,id} ref` };
  if (!isValidRef(value.sourceRef)) return { ok: false, reason: `${entryLabel}.sourceRef must be a {product,kind,id} ref` };
  if (!isRecord(value.payload)) return { ok: false, reason: `${entryLabel}.payload must be an object (the Surface trust report)` };
  const payload = value.payload as Record<string, unknown>;
  if (!Array.isArray(payload.claims)) return { ok: false, reason: `${entryLabel}.payload.claims must be an array` };
  if (!Array.isArray(payload.evidence)) return { ok: false, reason: `${entryLabel}.payload.evidence must be an array` };
  if (!Array.isArray(value.gateAssociations)) return { ok: false, reason: `${entryLabel}.gateAssociations must be an array` };
  if (!Array.isArray(value.sourceOfTruthRefs)) return { ok: false, reason: `${entryLabel}.sourceOfTruthRefs must be an array` };
  if (!isRecord(value.extensions)) return { ok: false, reason: `${entryLabel}.extensions must be an object` };
  const flowAgentsExtension = (value.extensions as Record<string, unknown>)["flow-agents"];
  if (!isRecord(flowAgentsExtension) || !isNonEmptyString(flowAgentsExtension.task_slug)) {
    return { ok: false, reason: `${entryLabel}.extensions["flow-agents"].task_slug must be a non-empty string` };
  }
  return { ok: true, entry: value as unknown as WorkflowTrustProjectionEntry };
}

interface TrustReportClaimLike {
  id: string;
  status?: string;
  updatedAt?: string;
  fieldOrBehavior?: string;
  claimType?: string;
  freshness?: { asOf?: string };
}

interface TrustReportEvidenceLike {
  id: string;
  claimId: string;
  observedAt?: string;
  excerptOrSummary?: string;
  evidenceType?: string;
}

function reportGeneratedAt(payload: Record<string, unknown>): string | undefined {
  return isNonEmptyString(payload.generatedAt) ? payload.generatedAt : undefined;
}

function reportClaims(payload: Record<string, unknown>): TrustReportClaimLike[] {
  return (Array.isArray(payload.claims) ? payload.claims : []).filter((item: unknown): item is TrustReportClaimLike =>
    isRecord(item) && isNonEmptyString(item.id));
}

function reportEvidence(payload: Record<string, unknown>): TrustReportEvidenceLike[] {
  return (Array.isArray(payload.evidence) ? payload.evidence : []).filter((item: unknown): item is TrustReportEvidenceLike =>
    isRecord(item) && isNonEmptyString(item.id) && isNonEmptyString(item.claimId));
}

/** The scope-qualified "workflow" subject id BOTH this bridge and workflow-process-bridge.ts derive for the same workflow (console#254) -- see workflow-subject-identity.ts. */
function qualifiedWorkflowId(envelope: WorkflowTrustProjectionEnvelope, taskSlug: string): string {
  return qualifiedWorkflowSubjectId(envelope.producer.product, envelope.scope, taskSlug);
}

function qualifiedGateId(envelope: WorkflowTrustProjectionEnvelope, taskSlug: string, gateId: string): string {
  return `${qualifiedWorkflowId(envelope, taskSlug)}:gate:${gateId}`;
}

function qualifiedClaimId(envelope: WorkflowTrustProjectionEnvelope, taskSlug: string, claimId: string): string {
  return `${qualifiedWorkflowId(envelope, taskSlug)}:claim:${claimId}`;
}

function qualifiedEvidenceId(envelope: WorkflowTrustProjectionEnvelope, taskSlug: string, evidenceId: string): string {
  return `${qualifiedWorkflowId(envelope, taskSlug)}:evidence:${evidenceId}`;
}

export interface TranslateWorkflowTrustProjectionResult {
  events: ConsoleEventRecord[];
  /** Reasons any `trusts[]` entry (or a sub-record within one) was skipped -- never thrown, always surfaced for the caller to log/count. */
  warnings: string[];
}

/**
 * Translates one envelope's `trusts[]` into `kontour.console.event` records.
 * Each VALID entry (see `validateTrustEntryShape`) becomes:
 *
 *  - ONE `process.progressed` event on the SAME qualified workflow subject id
 *    workflow-process-bridge.ts derives, carrying the FULL Surface trust
 *    report verbatim under `payload.after.trustReport` (console#255's gate
 *    trust panel reads it from there) plus aggregate claim/evidence refs, so
 *    the report is retrievable even for a workflow with zero gate
 *    associations. No `status`/`blockedReason` is touched -- this event never
 *    competes with workflow-process-bridge.ts's own process lifecycle events.
 *  - ONE `gate.opened` event per gate association, carrying `payload.refs`
 *    scoped to that gate's claim/evidence ids (folds into `gates[].evidenceRefs`
 *    / `gates[].expectationRefs` via `upsertGate`) and `after.processRef`
 *    pointing at the SAME qualified workflow subject id (folds evidenceRefs
 *    onto the process too, via `updateProcessFromGate`). `gate.opened` is used
 *    UNIFORMLY (idempotent-safe reuse, mirroring workflow-process-bridge.ts's
 *    own `process.started` reuse) and deliberately never sets `after.status`:
 *    Surface owns pass/fail verdicts, and this bridge relays evidence
 *    ASSOCIATIONS, not a computed gate verdict. `payload.after.trustReport`
 *    carries the FULL report again here too, so console#255 can read it
 *    directly off whichever gate it is rendering.
 *  - ONE `claim.status.changed` event per claim in the report, carrying
 *    Surface's OWN already-derived `status`/`freshness` fields UNCHANGED.
 *  - ONE `evidence.attached` event per evidence record in the report, subject
 *    = the evidence item itself (`upsertEvidence` keys `state.evidence` by
 *    `subject.id`; a gate-keyed subject would collide multiple evidence items
 *    for the same gate onto one map entry), with refs carrying the associated
 *    claim identity.
 *
 * An INVALID entry is skipped (its reason collected into `warnings`); a
 * malformed sub-record (a claim missing `status`, a gate association missing
 * `gateId`, ...) is skipped individually with its own warning -- valid
 * siblings and sibling entries still translate and deliver.
 */
export function translateWorkflowTrustProjectionEnvelope(
  envelope: WorkflowTrustProjectionEnvelope,
  options: { scopeLabel?: string } = {},
): TranslateWorkflowTrustProjectionResult {
  const scopeLabel = options.scopeLabel ?? `${envelope.scope.kind} ${envelope.scope.id}`;
  const events: ConsoleEventRecord[] = [];
  const warnings: string[] = [];
  envelope.trusts.forEach((candidate, index) => {
    const validated = validateTrustEntryShape(candidate, index);
    if (!validated.ok) {
      warnings.push(validated.reason);
      return;
    }
    translateTrustEntry(validated.entry, envelope, scopeLabel, warnings, events);
  });
  return { events, warnings };
}

function translateTrustEntry(
  entry: WorkflowTrustProjectionEntry,
  envelope: WorkflowTrustProjectionEnvelope,
  scopeLabel: string,
  warnings: string[],
  events: ConsoleEventRecord[],
): void {
  const taskSlug = entry.extensions["flow-agents"].task_slug;
  const entryLabel = `trusts (${entry.id})`;
  const payload = entry.payload;
  const reportAt = reportGeneratedAt(payload) ?? envelope.generatedAt;
  const claims = reportClaims(payload);
  const evidence = reportEvidence(payload);
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const workflowSubjectId = qualifiedWorkflowId(envelope, taskSlug);

  const allClaimRefs = claims.map((claim) => surfaceClaimRef(envelope, taskSlug, claim.id));
  const allEvidenceRefs = evidence.map((item) => surfaceEvidenceRef(envelope, taskSlug, item.id));

  const sourceOfTruthRefs = entry.sourceOfTruthRefs.filter((ref, index) => {
    const ok = isValidSourceOfTruthRef(ref);
    if (!ok) warnings.push(`${entryLabel}: sourceOfTruthRefs[${index}] is not a well-formed ref -- skipping it`);
    return ok;
  });

  events.push(processProgressedEvent(envelope, entry, taskSlug, scopeLabel, reportAt, allClaimRefs, allEvidenceRefs, sourceOfTruthRefs));

  entry.gateAssociations.forEach((candidate, index) => {
    if (!isValidGateAssociation(candidate)) {
      warnings.push(`${entryLabel}: gateAssociations[${index}] is not well-formed (gateId/claimIds/evidenceIds/eventIds) -- skipping it`);
      return;
    }
    const gateClaimRefs = candidate.claimIds
      .filter((claimId) => {
        const known = claimsById.has(claimId);
        if (!known) warnings.push(`${entryLabel}: gate '${candidate.gateId}' references unknown claim id '${claimId}' -- skipping that ref`);
        return known;
      })
      .map((claimId) => surfaceClaimRef(envelope, taskSlug, claimId));
    const gateEvidenceRefs = candidate.evidenceIds.map((evidenceId) => surfaceEvidenceRef(envelope, taskSlug, evidenceId));
    events.push(gateOpenedEvent(envelope, entry, taskSlug, candidate, scopeLabel, reportAt, gateClaimRefs, gateEvidenceRefs, workflowSubjectId));
  });

  claims.forEach((claim, index) => {
    if (!isNonEmptyString(claim.status)) {
      warnings.push(`${entryLabel}: payload.claims[${index}] (${claim.id}) is missing a non-empty string status -- skipping it`);
      return;
    }
    const claimEvidenceRefs = evidence
      .filter((item) => item.claimId === claim.id)
      .map((item) => surfaceEvidenceRef(envelope, taskSlug, item.id));
    events.push(claimStatusChangedEvent(envelope, entry, taskSlug, claim, scopeLabel, reportAt, claimEvidenceRefs));
  });

  evidence.forEach((item, index) => {
    if (!claimsById.has(item.claimId)) {
      warnings.push(`${entryLabel}: payload.evidence[${index}] (${item.id}) references unknown claim id '${item.claimId}' -- attaching without a claim ref`);
    }
    events.push(evidenceAttachedEvent(envelope, entry, taskSlug, item, scopeLabel, reportAt));
  });
}

function surfaceClaimRef(envelope: WorkflowTrustProjectionEnvelope, taskSlug: string, claimId: string) {
  return { product: "surface", kind: "claim", id: qualifiedClaimId(envelope, taskSlug, claimId), label: claimId };
}

function surfaceEvidenceRef(envelope: WorkflowTrustProjectionEnvelope, taskSlug: string, evidenceId: string) {
  return { product: "surface", kind: "evidence", id: qualifiedEvidenceId(envelope, taskSlug, evidenceId), label: evidenceId };
}

function processProgressedEvent(
  envelope: WorkflowTrustProjectionEnvelope,
  entry: WorkflowTrustProjectionEntry,
  taskSlug: string,
  scopeLabel: string,
  occurredAt: string,
  claimRefs: ReturnType<typeof surfaceClaimRef>[],
  evidenceRefs: ReturnType<typeof surfaceEvidenceRef>[],
  sourceOfTruthRefs: WorkflowTrustSourceOfTruthRef[],
): ConsoleEventRecord {
  const subjectId = qualifiedWorkflowId(envelope, taskSlug);
  const digest = canonicalDigest({
    subjectId,
    kind: "process",
    reportGeneratedAt: occurredAt,
    content: JSON.stringify(entry.payload),
  });
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-trustbridge-process-${digest}`,
    type: "process.progressed",
    occurredAt,
    producer: {
      id: "workflow-trust-bridge",
      product: "flow-agents",
      name: "flow-agents workflow-trust bridge",
    },
    scope: { kind: envelope.scope.kind, id: envelope.scope.id, label: scopeLabel },
    subject: { product: "flow-agents", kind: "workflow", id: subjectId, label: taskSlug },
    correlationId: `corr-workflow-trust-${subjectId}`,
    sequence: 1,
    payload: {
      after: { trustReport: entry.payload, sourceOfTruthRefs },
      refs: [...claimRefs, ...evidenceRefs],
      summary: `Surface trust report relayed for ${taskSlug}`,
    },
  } as unknown as ConsoleEventRecord;
}

function gateOpenedEvent(
  envelope: WorkflowTrustProjectionEnvelope,
  entry: WorkflowTrustProjectionEntry,
  taskSlug: string,
  gateAssociation: WorkflowTrustGateAssociation,
  scopeLabel: string,
  occurredAt: string,
  claimRefs: ReturnType<typeof surfaceClaimRef>[],
  evidenceRefs: ReturnType<typeof surfaceEvidenceRef>[],
  workflowSubjectId: string,
): ConsoleEventRecord {
  const subjectId = qualifiedGateId(envelope, taskSlug, gateAssociation.gateId);
  const digest = canonicalDigest({
    subjectId,
    kind: "gate",
    claimIds: JSON.stringify([...gateAssociation.claimIds].sort()),
    evidenceIds: JSON.stringify([...gateAssociation.evidenceIds].sort()),
    reportGeneratedAt: occurredAt,
    content: JSON.stringify(entry.payload),
  });
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-trustbridge-gate-${digest}`,
    type: "gate.opened",
    occurredAt,
    producer: {
      id: "workflow-trust-bridge",
      product: "flow-agents",
      name: "flow-agents workflow-trust bridge",
    },
    scope: { kind: envelope.scope.kind, id: envelope.scope.id, label: scopeLabel },
    subject: { product: "flow-agents", kind: "gate", id: subjectId, label: gateAssociation.gateId },
    correlationId: `corr-workflow-trust-${workflowSubjectId}`,
    sequence: 1,
    payload: {
      // Deliberately no `status`: Surface owns pass/fail verdicts, this bridge
      // relays evidence ASSOCIATIONS. See the module-level translate doc comment.
      after: {
        processRef: { product: "flow-agents", kind: "workflow", id: workflowSubjectId, label: taskSlug },
        trustReport: entry.payload,
      },
      refs: [...claimRefs, ...evidenceRefs],
      summary: `Trust gate '${gateAssociation.gateId}' evidence relayed for ${taskSlug}`,
    },
  } as unknown as ConsoleEventRecord;
}

function claimStatusChangedEvent(
  envelope: WorkflowTrustProjectionEnvelope,
  entry: WorkflowTrustProjectionEntry,
  taskSlug: string,
  claim: TrustReportClaimLike,
  scopeLabel: string,
  fallbackOccurredAt: string,
  evidenceRefs: ReturnType<typeof surfaceEvidenceRef>[],
): ConsoleEventRecord {
  const occurredAt = isNonEmptyString(claim.updatedAt) ? claim.updatedAt : fallbackOccurredAt;
  const subjectId = qualifiedClaimId(envelope, taskSlug, claim.id);
  const digest = canonicalDigest({
    subjectId,
    occurredAt,
    content: JSON.stringify(claim),
  });
  const after: Record<string, unknown> = { status: claim.status };
  if (claim.freshness && isNonEmptyString(claim.freshness.asOf)) {
    after.freshness = { lastCheckedAt: claim.freshness.asOf };
  }
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-trustbridge-claim-${digest}`,
    type: "claim.status.changed",
    occurredAt,
    producer: {
      id: "workflow-trust-bridge",
      product: "flow-agents",
      name: "flow-agents workflow-trust bridge",
    },
    scope: { kind: envelope.scope.kind, id: envelope.scope.id, label: scopeLabel },
    subject: { product: "surface", kind: "claim", id: subjectId, label: claim.fieldOrBehavior || claim.claimType || claim.id },
    correlationId: `corr-workflow-trust-${qualifiedWorkflowId(envelope, taskSlug)}`,
    sequence: 1,
    payload: {
      after,
      refs: evidenceRefs,
      summary: `Surface claim '${claim.id}' status relayed as ${claim.status}`,
    },
  } as unknown as ConsoleEventRecord;
}

function evidenceAttachedEvent(
  envelope: WorkflowTrustProjectionEnvelope,
  entry: WorkflowTrustProjectionEntry,
  taskSlug: string,
  item: TrustReportEvidenceLike,
  scopeLabel: string,
  fallbackOccurredAt: string,
): ConsoleEventRecord {
  const occurredAt = isNonEmptyString(item.observedAt) ? item.observedAt : fallbackOccurredAt;
  const subjectId = qualifiedEvidenceId(envelope, taskSlug, item.id);
  const digest = canonicalDigest({
    subjectId,
    occurredAt,
    content: JSON.stringify(item),
  });
  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: `evt-trustbridge-evidence-${digest}`,
    type: "evidence.attached",
    occurredAt,
    producer: {
      id: "workflow-trust-bridge",
      product: "flow-agents",
      name: "flow-agents workflow-trust bridge",
    },
    scope: { kind: envelope.scope.kind, id: envelope.scope.id, label: scopeLabel },
    subject: { product: "surface", kind: "evidence", id: subjectId, label: item.excerptOrSummary || item.id },
    correlationId: `corr-workflow-trust-${qualifiedWorkflowId(envelope, taskSlug)}`,
    sequence: 1,
    payload: {
      refs: [surfaceClaimRef(envelope, taskSlug, item.claimId)],
      summary: item.excerptOrSummary || `Evidence '${item.id}' attached`,
    },
  } as unknown as ConsoleEventRecord;
}

export interface WorkflowTrustBridgeDelivery {
  envelopePath: string;
  events: number;
  accepted: number;
  duplicates: number;
  failed: number;
  /** Per-entry/per-sub-record validation warnings -- always populated, never thrown for an entry-level defect. */
  warnings: string[];
}

function countDelivery(delivery: WorkflowTrustBridgeDelivery, result: DeliveryResult, recordId: string, sentIds?: Set<string>): void {
  if (result.outcome === "skipped") {
    delivery.duplicates += 1;
    return;
  }
  if (result.outcome === "accepted") {
    delivery.accepted += 1;
    sentIds?.add(recordId);
    return;
  }
  delivery.failed += 1;
}

export interface BridgeWorkflowTrustProjectionOptions {
  scopeLabel?: string;
  /** Canonical root `discoverWorkflowTrustProjections` returned; when supplied, containment is re-checked via realpath IMMEDIATELY before the envelope is opened. */
  allowedRoot?: string;
}

/** Translates and delivers one envelope's events through the configured Sink. Idempotent across passes: unchanged entries re-derive the same content-addressed ids, so the sink/hub dedupes them. */
export async function bridgeWorkflowTrustProjection(
  envelopePath: string,
  sinkOrHubUrl: Sink | string,
  options: BridgeWorkflowTrustProjectionOptions = {},
  sentIds?: Set<string>,
): Promise<WorkflowTrustBridgeDelivery> {
  const envelope = readWorkflowTrustProjectionEnvelope(envelopePath, options.allowedRoot);
  const { events, warnings } = translateWorkflowTrustProjectionEnvelope(envelope, options);
  const sink: Sink = typeof sinkOrHubUrl === "string" ? new ApiSink(sinkOrHubUrl, "", { sentIds }) : sinkOrHubUrl;

  const delivery: WorkflowTrustBridgeDelivery = { envelopePath, events: events.length, accepted: 0, duplicates: 0, failed: 0, warnings };
  for (const event of events) {
    if (event.id && sentIds?.has(event.id)) {
      delivery.duplicates += 1;
      continue;
    }
    const result = await sink.deliver(event as unknown as ConsoleRecord);
    countDelivery(delivery, result, event.id as string, sentIds);
  }
  return delivery;
}

export interface WorkflowTrustBridgeSinkConfig {
  /** Local mirror root (.kontourai/console by default). Pass null to disable local. */
  localRoot?: string | null;
  /** Hosted console base URL. When set, an ApiSink is added to the fanout. */
  hubUrl?: string;
  /** Hosted console auth token (Bearer / x-console-api-token). */
  authToken?: string;
  /** Tenant routed to the hosted console via x-console-tenant(-id). */
  tenantId?: string;
}

/** Builds the Sink this bridge delivers through -- local-vs-hosted is pure configuration, mirroring `buildWorkflowProcessBridgeSink`. */
export function buildWorkflowTrustBridgeSink(config: WorkflowTrustBridgeSinkConfig = {}, sentIds?: Set<string>): Sink {
  const sinks: Sink[] = [];
  if (config.localRoot !== null) {
    sinks.push(new LocalFileSink({ root: config.localRoot ?? DEFAULT_CONSOLE_RUNTIME_ROOT }));
  }
  if (config.hubUrl) {
    sinks.push(new ApiSink(config.hubUrl, config.authToken ?? "", {
      tenantId: config.tenantId,
      sentIds,
    }));
  }
  if (sinks.length === 0) {
    throw new TypeError("buildWorkflowTrustBridgeSink requires at least one destination (localRoot or hubUrl)");
  }
  if (sinks.length === 1) return sinks[0];
  return new CompositeSink(sinks);
}
