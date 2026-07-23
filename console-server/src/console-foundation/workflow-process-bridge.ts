// Workflow-process bridge (console#239): translates flow-agents' workflow-process
// projection envelope (flow-agents#778 -- schema `kontour.console.projection`,
// written by the `flow-agents-console-process-projection` CLI /
// src/lib/workflow-process-projection.ts) into `kontour.console.event` records
// that fold through the SAME `buildCurrentOperatingState` replay path every other
// Console process uses. Before this bridge, that envelope was inert: it had no
// live board consumer, so a flow-agents session sitting in blocked/needs_input/
// review_pending never rendered on the board.
//
// Read-only over the producer's envelope file; flow-agents stays the authority
// for workflow-process state (nonAuthority: true on every entry), Console only
// aggregates it. Deterministic, CONTENT-ADDRESSED event ids (see
// `eventIdForProcessEntry`) make re-bridging idempotent the same way
// flow-bridge.ts's sequence-keyed ids do, adapted for a source that is a
// point-in-time SNAPSHOT with no event history rather than an ordered
// transition log (`derivedFrom.mode: "direct_snapshot"`,
// `eventHistory: "unavailable"` on the envelope itself).
//
// Kept as its own module/bin rather than folded into flow-bridge.ts: the two
// bridges translate DIFFERENT products (`flow` run-transition history that this
// module's sibling replays event-by-event, vs. `flow-agents` workflow-process
// SNAPSHOTS with no history to replay) via structurally different read models
// (a run-directory scan of `state.json`/`definition.json`/evidence manifests,
// vs. a single pre-aggregated envelope file). This mirrors the existing
// per-source split in this directory (flow-ingest.ts vs. flow-bridge.ts already
// separate by SOURCE, not by "one big bridge module") instead of growing
// flow-bridge.ts with a second, unrelated translation strategy.
//
// flow-agents does not (yet) export this envelope's TypeScript shape via a
// stable package subpath: its package.json `exports` map only lists ".",
// "./package.json", and "./schemas/*.json" (unlike Flow's own
// `@kontourai/flow/console-contract`, which flow-bridge.ts consumes type-only
// via `with { "resolution-mode": "import" }`). We therefore redefine the
// minimal shape this bridge needs below, mirrored field-for-field against
// flow-agents' own src/lib/workflow-process-projection.ts
// (`ConsoleProcessProjection` / `ConsoleProcessProjectionEnvelope`, issue #778).
// A follow-up on flow-agents to publish an equivalent
// `@kontourai/flow-agents/console-contract` subpath would let this become a
// type-only import, the same way the Flow bridge does today.
//
// console#239 independent review (2026-07-22), all four findings addressed here:
//   1. Event identity AND subject identity are now SCOPE-QUALIFIED
//      (`qualifiedSubjectId`): the producer derives `entry.id` from relative
//      source path + task slug only, NOT projection scope, so two different
//      scopes (e.g. two repos) can legitimately emit the SAME entry.id. Without
//      qualification those would collapse onto one board process / dedupe each
//      other out at the hub. Qualifying with (producer.product, scope.kind,
//      scope.id) makes cross-scope collisions structurally impossible while
//      staying deterministic within a scope.
//   2. The event-id content key is now a SHA-256 digest of a canonical,
//      JSON-encoded (not delimiter-joined) field set that INCLUDES occurredAt --
//      closing both the delimiter-ambiguity collision (a raw `"|"`-joined string
//      can't distinguish a value containing the delimiter from a differently-
//      split neighbor) and the stale-id bug (a still-blocked session whose
//      `updated_at` alone advances must still get a new id).
//   3. Both the envelope (`validateEnvelopeShape`) and each entry
//      (`validateProcessEntryShape`) are runtime-validated against the
//      producer's REQUIRED contract. A malformed ENTRY is skipped with a
//      collected warning -- valid sibling entries still deliver -- rather than
//      throwing and dropping the whole batch; a malformed ENVELOPE (no sibling
//      entries to preserve) still throws, unchanged.
//   4. `bridgeWorkflowProcessProjection` accepts the canonical `allowedRoot`
//      discovery already computes and re-validates containment via realpath
//      immediately before opening the file (mirrors flow-bridge's
//      `readFlowJson`/`isWithin allowedRunsRoot` TOCTOU posture) -- the CLI now
//      threads it through instead of discarding it.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DEFAULT_CONSOLE_RUNTIME_ROOT } = require("./runtime-root");
const { LocalFileSink, CompositeSink, ApiSink } = require("./emitter");
import type { ConsoleEventRecord, ConsoleRecord, DeliveryResult, Sink } from "./types";

/** Default root this bridge scans for producer-written envelope files: `<kontour-root>/projections`, matching the `console-process-projection`/`console-learning-projection` CLIs' own `destinationPath` (`<kontour-root>/projections/<producer>/<scope>.json`). */
export const DEFAULT_WORKFLOW_PROCESS_PROJECTION_ROOT = path.join(DEFAULT_CONSOLE_RUNTIME_ROOT, "projections");

// -- Minimal mirror of flow-agents' src/lib/workflow-process-projection.ts shapes (issue #778) --
// Tightened to match the producer's REQUIRED fields (console#239 review finding
// 3): `extensions`/`extensions["flow-agents"]` and its `task_slug`/
// `workflow_status`/`phase`/`next_action_status`/`source_path` sub-fields,
// `sourceRef`, `derivedFrom`, `version`, and `producer.product` are all
// required in the producer's own type and are required here too. These TS
// shapes document the CONTRACT; `validateEnvelopeShape`/`validateProcessEntryShape`
// below are the actual runtime gate, since envelope files are untrusted input.

export interface WorkflowProcessProjectionRef {
  product: string;
  kind: string;
  id: string;
  label?: string;
}

export interface WorkflowProcessProjectionScope {
  kind: string;
  id: string;
}

export interface WorkflowProcessProjectionEntryExtensions {
  "flow-agents": {
    task_slug: string;
    workflow_status: string;
    phase: string;
    next_action_status: string;
    has_unresolved_critique?: boolean;
    updated_at?: string;
    source_path: string;
  };
}

export interface WorkflowProcessProjectionEntry {
  id: string;
  family: "workflow";
  nonAuthority: true;
  subjectRef: WorkflowProcessProjectionRef;
  sourceRef: WorkflowProcessProjectionRef;
  summary: string;
  /** Console's ConsoleProcessStatus vocabulary (console#229/#236): an open string union. */
  status: string;
  blockedReason?: string;
  extensions: WorkflowProcessProjectionEntryExtensions;
}

export interface WorkflowProcessProjectionEnvelope {
  schema: "kontour.console.projection";
  version: string;
  generatedAt: string;
  scope: WorkflowProcessProjectionScope;
  producer: { id: string; product: string };
  derivedFrom: Record<string, unknown>;
  processes: WorkflowProcessProjectionEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Shape discriminator against a sibling envelope family (console-learning-projection, which carries `learnings[]` instead of `processes[]`) -- both share `schema: "kontour.console.projection"`. */
export function isWorkflowProcessProjectionEnvelope(value: unknown): value is WorkflowProcessProjectionEnvelope {
  if (!isRecord(value)) return false;
  return value.schema === "kontour.console.projection" && Array.isArray(value.processes);
}

/**
 * Runtime validation of the envelope's REQUIRED top-level fields (console#239
 * review finding 3). One malformed ENVELOPE has no sibling envelope to
 * preserve, so this throws (unlike per-entry validation below, which skips and
 * continues) -- matching the existing `readWorkflowProcessProjectionEnvelope`
 * contract callers already depend on.
 */
function validateEnvelopeShape(value: unknown, filePath: string): WorkflowProcessProjectionEnvelope {
  if (!isWorkflowProcessProjectionEnvelope(value)) {
    throw new Error(`${filePath} is not a workflow-process projection envelope (expected schema "kontour.console.projection" with a processes[] array)`);
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

/** Read-only, symlink-guarded JSON read (mirrors flow-agents' own `readSourceJson` / flow-bridge's `readFlowJson` posture). */
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

/**
 * Re-validates containment against a canonical `allowedRoot` (as returned by
 * `discoverWorkflowProcessProjections`) IMMEDIATELY before the file is opened
 * (console#239 review finding 4). `O_NOFOLLOW` in `readEnvelopeJson` only
 * guards the FINAL path component; an ancestor directory (e.g. the producer
 * directory) could be swapped for a symlink escaping the root between
 * discovery and read. Mirrors flow-bridge's `readFlowJson`/`isWithin
 * allowedRunsRoot` pattern: a realpath + isWithin recheck right before the
 * read, not a one-time check at discovery.
 */
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

/**
 * Reads and shape-validates one workflow-process projection envelope file.
 * Throws on a malformed or non-matching (e.g. learning-projection) file, or on
 * a file that resolves outside `allowedRoot` when one is supplied (TOCTOU
 * guard, console#239 review finding 4).
 */
export function readWorkflowProcessProjectionEnvelope(filePath: string, allowedRoot?: string): WorkflowProcessProjectionEnvelope {
  if (allowedRoot !== undefined) assertWithinAllowedRoot(filePath, allowedRoot);
  const value = readEnvelopeJson(filePath);
  return validateEnvelopeShape(value, filePath);
}

export interface WorkflowProcessProjectionDiscovery {
  allowedRoot?: string;
  envelopePaths: string[];
}

/**
 * Discovers `<root>/<producer>/<file>.json` candidate paths, pinning the
 * canonical boundary (mirrors flow-bridge's `discoverFlowRuns` two-level scan
 * + symlink-escape guard). This is a purely STRUCTURAL scan -- it does not
 * parse or shape-validate file contents (so a sibling console-learning-
 * projection envelope written under the same root, e.g. under a
 * `flow-agents-learning` producer directory, is discovered too). Shape
 * validation happens per-file at bridge time (`readWorkflowProcessProjectionEnvelope`
 * inside `bridgeWorkflowProcessProjection`), so ONE malformed or non-matching
 * file never aborts the whole pass -- the caller (see bin/kontour-process-bridge.ts)
 * catches and warns per envelope, mirroring flow-bridge's own per-source
 * (not whole-batch) error handling. The returned `allowedRoot` MUST be threaded
 * back into `bridgeWorkflowProcessProjection`/`readWorkflowProcessProjectionEnvelope`
 * (console#239 review finding 4) -- discovery alone does not protect a later read.
 */
export function discoverWorkflowProcessProjections(root: string): WorkflowProcessProjectionDiscovery {
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

function safeReadDir(dir: string): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function extensionField(entry: WorkflowProcessProjectionEntry, field: string): unknown {
  const flowAgentsExtension = entry.extensions?.["flow-agents"];
  return flowAgentsExtension && typeof flowAgentsExtension === "object"
    ? (flowAgentsExtension as Record<string, unknown>)[field]
    : undefined;
}

function stringExtensionField(entry: WorkflowProcessProjectionEntry, field: string): string {
  const value = extensionField(entry, field);
  return typeof value === "string" ? value : "";
}

/**
 * Globally-unique, scope-qualified subject/process id (console#239 review
 * finding 1). The producer derives `entry.id` from relative source path +
 * task slug ONLY (flow-agents src/lib/workflow-process-projection.ts's
 * `deterministicProcessId`) -- it does NOT fold in projection scope. Two
 * different scopes (e.g. two repos, each with a "demo" workflow at the same
 * relative sidecar path) can therefore legitimately produce the SAME
 * `entry.id`. Qualifying with the envelope's own (producer.product,
 * scope.kind, scope.id) tuple makes that collision structurally impossible on
 * the board, while staying fully deterministic: the SAME entry in the SAME
 * scope always re-derives the SAME qualified id.
 */
function qualifiedSubjectId(envelope: WorkflowProcessProjectionEnvelope, entry: WorkflowProcessProjectionEntry): string {
  return [envelope.producer.product, envelope.scope.kind, envelope.scope.id, entry.id].join(":");
}

/**
 * Canonical, length-safe digest over an ordered field set: JSON.stringify of
 * an object whose keys are inserted in SORTED order, hashed with SHA-256
 * (console#239 review finding 2). This replaces a raw `"|"`-delimited join,
 * which was ambiguous: blockedReason `"a|blocked"` + status `"blocked"` +
 * phase `"p"` hashed identically to blockedReason `"a"` + status `"blocked"` +
 * phase `"blocked|p"` under a naive join, because the delimiter is not escaped
 * inside field values. `JSON.stringify` quotes and escapes every field value
 * independently, so no two distinct field combinations can serialize to the
 * same bytes. SHA-256 (vs. the previous 32-bit FNV) also removes any
 * meaningful random-collision risk.
 */
function canonicalDigest(fields: Record<string, string>): string {
  const ordered: Record<string, string> = {};
  for (const key of Object.keys(fields).sort()) ordered[key] = fields[key];
  return crypto.createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

/**
 * Content-addressed event id for one process entry (console#239 review finding
 * 2): the SAME (scope-qualified subject, status, blockedReason,
 * workflow_status, phase, occurredAt) content yields the SAME id across bridge
 * passes, so re-bridging an unchanged snapshot is a pure duplicate (hub/sink
 * dedupe drops it, mirroring flow-bridge's "second pass: duplicates=N,
 * accepted=0" contract) -- while any change to that content, INCLUDING
 * `occurredAt`/`updated_at` alone advancing (e.g. a still-blocked session
 * re-confirmed two days later), yields a NEW id, so the fold actually advances
 * `state.processes` and its `updatedAt` (console#239 AC1/AC2). This is
 * deliberately CONTENT-keyed rather than sequence-keyed like flow-bridge's
 * ids: the source here is a point-in-time snapshot with no event history to
 * replay (`derivedFrom.mode: "direct_snapshot"` on the envelope), so there is
 * no stable sequence number to key off of.
 */
function eventIdForProcessEntry(
  envelope: WorkflowProcessProjectionEnvelope,
  entry: WorkflowProcessProjectionEntry,
  occurredAt: string,
): string {
  const digest = canonicalDigest({
    subjectId: qualifiedSubjectId(envelope, entry),
    status: entry.status,
    blockedReason: entry.blockedReason ?? "",
    workflowStatus: stringExtensionField(entry, "workflow_status"),
    phase: stringExtensionField(entry, "phase"),
    occurredAt,
  });
  return `evt-processbridge-${digest}`;
}

function isValidRef(value: unknown): value is WorkflowProcessProjectionRef {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.product) && isNonEmptyString(value.kind) && isNonEmptyString(value.id);
}

/**
 * Runtime validation of one `processes[]` entry against the producer's
 * REQUIRED contract (console#239 review finding 3). Returns a discriminated
 * result rather than throwing: a malformed entry (e.g. `status: 42`,
 * `blockedReason: 99`, a missing `subjectRef`) is the caller's signal to SKIP
 * that entry and continue with valid siblings, never to abort the whole batch
 * -- mirroring flow-bridge's own per-source (not whole-batch) error handling
 * (`joinCritiqueState`'s per-session catch, `attachTrustReports`'s graceful
 * per-entry skips).
 */
function validateProcessEntryShape(
  value: unknown,
  index: number,
): { ok: true; entry: WorkflowProcessProjectionEntry } | { ok: false; reason: string } {
  const label = `processes[${index}]`;
  if (!isRecord(value)) return { ok: false, reason: `${label} must be an object` };
  if (!isNonEmptyString(value.id)) return { ok: false, reason: `${label}.id must be a non-empty string` };
  const entryLabel = `${label} (${value.id})`;
  if (value.family !== "workflow") return { ok: false, reason: `${entryLabel}.family must be "workflow"` };
  if (value.nonAuthority !== true) return { ok: false, reason: `${entryLabel}.nonAuthority must be true` };
  if (!isValidRef(value.subjectRef)) return { ok: false, reason: `${entryLabel}.subjectRef must be a {product,kind,id} ref` };
  if (!isValidRef(value.sourceRef)) return { ok: false, reason: `${entryLabel}.sourceRef must be a {product,kind,id} ref` };
  if (!isNonEmptyString(value.summary)) return { ok: false, reason: `${entryLabel}.summary must be a non-empty string` };
  // The concrete probe this guards against (console#239 review finding 3):
  // {status: 42, blockedReason: 99} previously copied straight into
  // payload.after and folded into a process with NO string status --
  // current-operating-state.ts's replay only accepts a string `after.status`,
  // so the board silently classified the corrupt process as Backlog.
  if (!isNonEmptyString(value.status)) return { ok: false, reason: `${entryLabel}.status must be a non-empty string` };
  if (value.blockedReason !== undefined && typeof value.blockedReason !== "string") {
    return { ok: false, reason: `${entryLabel}.blockedReason must be a string when present` };
  }
  if (!isRecord(value.extensions)) return { ok: false, reason: `${entryLabel}.extensions must be an object` };
  const flowAgentsExtension = (value.extensions as Record<string, unknown>)["flow-agents"];
  if (flowAgentsExtension !== undefined && !isRecord(flowAgentsExtension)) {
    return { ok: false, reason: `${entryLabel}.extensions["flow-agents"] must be an object when present` };
  }
  return { ok: true, entry: value as unknown as WorkflowProcessProjectionEntry };
}

export interface TranslateWorkflowProcessProjectionResult {
  events: ConsoleEventRecord[];
  /** Reasons any `processes[]` entry was skipped (console#239 review finding 3) -- never thrown, always surfaced for the caller to log/count. */
  warnings: string[];
}

/**
 * Translates one envelope's `processes[]` into `kontour.console.event` records.
 * Each VALID entry (see `validateProcessEntryShape`) becomes a single
 * `process.started` event carrying `payload.after.status` (folds into
 * `ConsoleProcess.status` via `current-operating-state.ts`'s `upsertProcess`)
 * and, when present, `payload.after.blockedReason` (folds into
 * `ConsoleProcess.blockedReason` for every blocked-like status --
 * `blocked`/`needs_input`/`review_pending`/`waiting`/`paused` -- per
 * console#229/#236's own retained-not-cleared contract, which `upsertProcess`
 * already implements unchanged by this bridge). An INVALID entry is skipped
 * (its reason collected into `warnings`), never thrown -- valid sibling
 * entries still translate and deliver (console#239 review finding 3).
 * `process.started` (not `process.progressed`) is used uniformly because
 * `upsertProcess` only sets `startedAt` on the FIRST fold of a given subject id
 * (`existing.startedAt || ...`) -- reusing "started" across repeated bridge
 * passes of the same process is therefore idempotent-safe, not a semantic claim
 * that the process just began.
 */
export function translateWorkflowProcessProjectionEnvelope(
  envelope: WorkflowProcessProjectionEnvelope,
  options: { scopeLabel?: string } = {},
): TranslateWorkflowProcessProjectionResult {
  const scopeLabel = options.scopeLabel ?? `${envelope.scope.kind} ${envelope.scope.id}`;
  const events: ConsoleEventRecord[] = [];
  const warnings: string[] = [];
  envelope.processes.forEach((candidate, index) => {
    const validated = validateProcessEntryShape(candidate, index);
    if (!validated.ok) {
      warnings.push(validated.reason);
      return;
    }
    events.push(translateProcessEntry(validated.entry, envelope, scopeLabel));
  });
  return { events, warnings };
}

function translateProcessEntry(
  entry: WorkflowProcessProjectionEntry,
  envelope: WorkflowProcessProjectionEnvelope,
  scopeLabel: string,
): ConsoleEventRecord {
  const updatedAt = stringExtensionField(entry, "updated_at");
  const occurredAt = updatedAt.length > 0 ? updatedAt : envelope.generatedAt;
  const phase = extensionField(entry, "phase");
  const subjectId = qualifiedSubjectId(envelope, entry);

  const after: Record<string, unknown> = { status: entry.status };
  if (typeof phase === "string" && phase.length > 0) after.currentStep = phase;
  if (entry.blockedReason) after.blockedReason = entry.blockedReason;

  return {
    schema: "kontour.console.event",
    version: "0.1",
    id: eventIdForProcessEntry(envelope, entry, occurredAt),
    type: "process.started",
    occurredAt,
    producer: {
      id: "workflow-process-bridge",
      product: "flow-agents",
      name: "flow-agents workflow-process bridge",
    },
    scope: { kind: envelope.scope.kind, id: envelope.scope.id, label: scopeLabel },
    subject: {
      product: entry.subjectRef.product,
      kind: entry.subjectRef.kind,
      id: subjectId,
      label: entry.subjectRef.label || entry.summary || entry.subjectRef.id,
    },
    correlationId: `corr-workflow-process-${subjectId}`,
    sequence: 1,
    payload: {
      after,
      summary: entry.summary,
    },
  } as unknown as ConsoleEventRecord;
}

export interface WorkflowProcessBridgeDelivery {
  envelopePath: string;
  events: number;
  accepted: number;
  duplicates: number;
  failed: number;
  /** Per-entry validation warnings (console#239 review finding 3) -- always populated, never thrown for an entry-level defect. */
  warnings: string[];
}

function countDelivery(delivery: WorkflowProcessBridgeDelivery, result: DeliveryResult, recordId: string, sentIds?: Set<string>): void {
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

export interface BridgeWorkflowProcessProjectionOptions {
  scopeLabel?: string;
  /**
   * Canonical root `discoverWorkflowProcessProjections` returned. When
   * supplied, containment is re-checked via realpath IMMEDIATELY before the
   * envelope is opened (console#239 review finding 4) -- discovery alone does
   * not protect a read that happens after a TOCTOU window.
   */
  allowedRoot?: string;
}

/** Translates and delivers one envelope's events through the configured Sink. Idempotent across passes: unchanged entries re-derive the same content-addressed id (see `eventIdForProcessEntry`), so the sink/hub dedupes them (AC3). */
export async function bridgeWorkflowProcessProjection(
  envelopePath: string,
  sinkOrHubUrl: Sink | string,
  options: BridgeWorkflowProcessProjectionOptions = {},
  sentIds?: Set<string>,
): Promise<WorkflowProcessBridgeDelivery> {
  const envelope = readWorkflowProcessProjectionEnvelope(envelopePath, options.allowedRoot);
  const { events, warnings } = translateWorkflowProcessProjectionEnvelope(envelope, options);
  const sink: Sink = typeof sinkOrHubUrl === "string" ? new ApiSink(sinkOrHubUrl, "", { sentIds }) : sinkOrHubUrl;

  const delivery: WorkflowProcessBridgeDelivery = { envelopePath, events: events.length, accepted: 0, duplicates: 0, failed: 0, warnings };
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

export interface WorkflowProcessBridgeSinkConfig {
  /** Local mirror root (.kontourai/console by default). Pass null to disable local. */
  localRoot?: string | null;
  /** Hosted console base URL. When set, an ApiSink is added to the fanout. */
  hubUrl?: string;
  /** Hosted console auth token (Bearer / x-console-api-token). */
  authToken?: string;
  /** Tenant routed to the hosted console via x-console-tenant(-id). */
  tenantId?: string;
}

/** Builds the Sink this bridge delivers through -- local-vs-hosted is pure configuration, mirroring `buildFlowBridgeSink`. */
export function buildWorkflowProcessBridgeSink(config: WorkflowProcessBridgeSinkConfig = {}, sentIds?: Set<string>): Sink {
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
    throw new TypeError("buildWorkflowProcessBridgeSink requires at least one destination (localRoot or hubUrl)");
  }
  if (sinks.length === 1) return sinks[0];
  return new CompositeSink(sinks);
}
