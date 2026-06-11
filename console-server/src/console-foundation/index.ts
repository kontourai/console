const fs = require("node:fs");
const path = require("node:path");
import type {
  ActionDescriptor,
  ConsoleEventRecord,
  ConsoleLink,
  ConsoleObjectRecord,
  ConsoleProjectionSnapshot,
  CrossProductRef,
  EventStreamInspection,
  InspectLocalOptions,
  InspectOptions,
  LoaderOptions,
  OpenRecord,
  ProjectionInspection,
  ValidationIssue,
  ValidationSeverity
} from "./types";

export type {
  ActionDescriptor,
  ClassifiedRecord,
  CompositeSinkOptions,
  ConsoleAcceptedRecordSsePayload,
  ConsoleApiError,
  ConsoleApiErrorCode,
  ConsoleEventsResponse,
  ConsoleEventsCompatibilityPath,
  ConsoleEventsSsePayload,
  ConsoleEventRecord,
  ConsoleHostedAuthToken,
  ConsoleHubServer,
  ConsoleHubServerOptions,
  ConsoleProjectionRecord,
  ConsoleReadySsePayload,
  ConsoleRecord,
  ConsoleRecordsRequest,
  ConsoleRecordsResponse,
  ConsoleRequestContext,
  ConsoleRuntimeMode,
  ConsoleSqlClient,
  ConsoleSqlQueryResult,
  CrossProductRef,
  CurrentOperatingStateOptions,
  DeliveryOutcome,
  DeliveryResult,
  EventSummary,
  EventStreamInspection,
  Hub,
  InMemorySinkOptions,
  InspectLocalOptions,
  InspectOptions,
  InspectionReport,
  KontourEmitterOptions,
  ListenOptions,
  LoaderOptions,
  LocalConsoleHubOptions,
  LocalFileSinkOptions,
  OperatingState,
  ProjectionInspection,
  ProjectionSummary,
  RecordKind,
  ConsoleSseEventName,
  ConsoleSsePayloadMap,
  ConsoleStateResponse,
  ConsoleStateSsePayload,
  ConsoleStreamPath,
  ConsoleStreamSsePayload,
  Sink,
  TelemetryDeliveryResult,
  TelemetryRecord,
  TelemetryRecordKind,
  TelemetryRecordsRequest,
  TelemetryRecordSummary,
  TelemetrySourceSummary,
  TelemetryStorageAdapterName,
  TelemetrySummary,
  ValidationIssue,
  ValidationSummary
} from "./types";

export {
  assertConsoleRuntimeConfig,
  redactConsoleRuntimeConfig,
  resolveConsoleRuntimeConfig,
  resolveTelemetryStorageAdapter
} from "./config";
export type {
  ConsoleConfigValidationIssue,
  ConsoleRuntimeConfig
} from "./config";

export {
  applyConsoleMigrations,
  loadConsoleMigrations
} from "./migrations";
export type {
  ConsoleMigration,
  ConsoleMigrationResult
} from "./migrations";

export {
  createTelemetryRepository,
  createTelemetryStore,
  validateTelemetryRecordBody
} from "./telemetry";
export type {
  TelemetryRepository,
  TelemetryRepositoryConfig,
  TelemetryStore
} from "./telemetry";

const EVENT_DIR = path.join("docs", "examples", "event-streams");
const PROJECTION_DIR = path.join("docs", "examples", "projections");
const LOCAL_KONTOUR_DIR = ".kontour";
const OBJECT_ARRAY_KEYS = [
  "claims",
  "processes",
  "gates",
  "reviewItems",
  "evidence",
  "decisions",
  "actions",
  "exceptions",
  "learnings",
  "inquiries"
];
type StatusQueryOptions = OpenRecord & {
  claimId?: string;
  reviewId?: string;
  providerFieldRef?: string;
  processId?: string;
  status?: string;
  gateId?: string;
};

function inspectFixtures(options: InspectOptions = {}) {
  const rootDir = options.rootDir || process.cwd();
  const source: LoaderOptions = {
    sourceKind: "fixture",
    sourceRoot: rootDir
  };
  const eventStreams = loadEventStreams(path.join(rootDir, EVENT_DIR), rootDir, source);
  const projections = loadProjectionSnapshots(path.join(rootDir, PROJECTION_DIR), rootDir, source);
  const issues = eventStreams.flatMap((stream: EventStreamInspection) => stream.validation)
    .concat(projections.flatMap((projection: ProjectionInspection) => projection.validation));

  return {
    rootDir,
    eventStreams,
    projections,
    validation: splitIssues(issues)
  };
}

function inspectLocalKontour(options: InspectLocalOptions = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const kontourRoot = resolveUnderRoot(rootDir, options.kontourRoot || options.localRoot || LOCAL_KONTOUR_DIR);
  const sourceRoot = kontourRoot;
  const source: LoaderOptions = {
    sourceKind: "local",
    sourceRoot
  };
  const eventStreams = loadEventStreams(path.join(kontourRoot, "events"), sourceRoot, {
    ...source,
    recursive: true,
    containmentRoot: sourceRoot
  });
  const projections = loadProjectionSnapshots(path.join(kontourRoot, "projections"), sourceRoot, {
    ...source,
    recursive: true,
    containmentRoot: sourceRoot
  });
  const issues = eventStreams.flatMap((stream: EventStreamInspection) => stream.validation)
    .concat(projections.flatMap((projection: ProjectionInspection) => projection.validation));

  return {
    rootDir,
    kontourRoot: sourceRoot,
    eventStreams,
    projections,
    validation: splitIssues(issues)
  };
}

function loadEventStreams(streamDir: string, rootDir = process.cwd(), options: LoaderOptions = {}): EventStreamInspection[] {
  const files = options.recursive
    ? listFilesRecursive(streamDir, ".jsonl", options.containmentRoot || streamDir)
    : listFiles(streamDir, ".jsonl");
  return files.map((filePath: string) => {
    const relativePath = path.relative(rootDir, filePath);
    const events: ConsoleEventRecord[] = [];
    const validation: ValidationIssue[] = [];
    let lines: string[] = [];

    try {
      lines = readContainedTextFile(filePath, options.containmentRoot).split(/\r?\n/);
    } catch (error) {
      validation.push(issue("error", relativePath, `unable to read event stream: ${safeErrorMessage(error)}`));
    }

    lines.forEach((line: string, index: number) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        events.push(event);
        validation.push(...validateEvent(event, `${relativePath}:${index + 1}`));
      } catch (error) {
        validation.push(issue("error", `${relativePath}:${index + 1}`, `invalid JSON: ${safeErrorMessage(error)}`));
      }
    });

    return {
      filePath,
      relativePath,
      sourceKind: options.sourceKind,
      sourceRoot: options.sourceRoot,
      events,
      summary: summarizeEvents(events),
      validation
    };
  });
}

function loadProjectionSnapshots(projectionDir: string, rootDir = process.cwd(), options: LoaderOptions = {}): ProjectionInspection[] {
  const files = options.recursive
    ? listFilesRecursive(projectionDir, ".json", options.containmentRoot || projectionDir)
    : listFiles(projectionDir, ".json");
  return files.map((filePath: string) => {
    const relativePath = path.relative(rootDir, filePath);
    const validation: ValidationIssue[] = [];
    let snapshot: ConsoleProjectionSnapshot = {} as ConsoleProjectionSnapshot;

    try {
      snapshot = JSON.parse(readContainedTextFile(filePath, options.containmentRoot));
      validation.push(...validateProjection(snapshot, relativePath));
    } catch (error) {
      validation.push(issue("error", relativePath, `invalid JSON: ${safeErrorMessage(error)}`));
    }

    return {
      filePath,
      relativePath,
      sourceKind: options.sourceKind,
      sourceRoot: options.sourceRoot,
      snapshot,
      summary: summarizeProjection(snapshot),
      actions: extractActionDescriptors(snapshot, relativePath),
      validation
    };
  });
}

function getSurfaceClaimStatus(projections: ProjectionInspection[], options: StatusQueryOptions = {}) {
  return projections
    .filter((projection: ProjectionInspection) => projection.snapshot.producer && projection.snapshot.producer.product === "surface")
    .flatMap((projection: ProjectionInspection) => arrayOf<ConsoleObjectRecord>(projection.snapshot.claims).map((claim: ConsoleObjectRecord) => ({
      projection: projection.relativePath,
      id: claim.id,
      label: claim.label,
      status: claim.status,
      currentValue: claim.currentValue,
      validFrom: claim.validFrom,
      validUntil: claim.validUntil,
      lastUpdatedAt: claim.lastUpdatedAt,
      lastVerifiedAt: claim.lastVerifiedAt,
      freshness: claim.freshness,
      evidenceRefs: arrayOf(claim.evidenceRefs),
      actionRefs: arrayOf(claim.actionRefs),
      requiresSelectedFlowRun: Boolean(renderingExtension(claim).requiresSelectedFlowRun),
      source: claim
    })))
    .filter((claim: { id?: string }) => !options.claimId || claim.id === options.claimId);
}

function getSurveyReviewState(projections: ProjectionInspection[], options: StatusQueryOptions = {}) {
  return projections
    .filter((projection: ProjectionInspection) => projection.snapshot.producer && projection.snapshot.producer.product === "survey")
    .flatMap((projection: ProjectionInspection) => {
      const snapshot = projection.snapshot;
      return arrayOf<ConsoleObjectRecord>(snapshot.reviewItems)
        .filter((reviewItem: ConsoleObjectRecord) => matchesReview(reviewItem, options))
        .map((reviewItem: ConsoleObjectRecord) => {
          const claimIds = new Set(arrayOf<CrossProductRef>(reviewItem.claimRefs).map((ref: CrossProductRef) => ref.id));
          const evidenceIds = new Set(arrayOf<CrossProductRef>(reviewItem.evidenceRefs).map((ref: CrossProductRef) => ref.id));
          const actionIds = new Set(arrayOf<CrossProductRef>(reviewItem.actionRefs).map((ref: CrossProductRef) => ref.id));
          const subjectRef = reviewItem.subjectRef as CrossProductRef | undefined;
          const subjectIds = new Set([reviewItem.id, subjectRef && subjectRef.id].filter(Boolean));
          const claims = arrayOf<ConsoleObjectRecord>(snapshot.claims).filter((claim: ConsoleObjectRecord) => claimIds.has(String(claim.id)) || options.claimId === claim.id);
          const evidence = arrayOf<ConsoleObjectRecord>(snapshot.evidence).filter((item: ConsoleObjectRecord) => evidenceIds.has(String(item.id)) || refsContain(item.claimRefs, claimIds));
          const actions = arrayOf<ConsoleObjectRecord>(snapshot.actions).filter((action: ConsoleObjectRecord) => actionIds.has(String(action.id)) || refsContain(action.subjectRefs, claimIds) || refsContain(action.subjectRefs, subjectIds));
          const decisions = arrayOf<ConsoleObjectRecord>(snapshot.decisions).filter((decision: ConsoleObjectRecord) => refsContain(decision.subjectRefs, new Set([reviewItem.id])) || refsContain(decision.evidenceRefs, evidenceIds));
          const linkedIds = new Set([reviewItem.id, ...claimIds, ...evidenceIds, ...actionIds, ...subjectIds, ...decisions.map((decision: ConsoleObjectRecord) => decision.id)]);
          return {
            projection: projection.relativePath,
            reviewItem,
            claim: claims[0] || null,
            claims,
            evidence,
            decisions,
            actions: actions.map((action: ConsoleObjectRecord) => toActionDescriptor(action, `${projection.relativePath}.actions`)),
            links: arrayOf<ConsoleLink>(snapshot.links).filter((link: ConsoleLink) => refSetHas(link.from, linkedIds) || refSetHas(link.to, linkedIds))
          };
        });
    });
}

function renderingExtension(record: ConsoleObjectRecord): Record<string, unknown> {
  const extensions = record.extensions;
  if (!extensions || typeof extensions !== "object" || Array.isArray(extensions)) return {};
  const rendering = (extensions as Record<string, unknown>).rendering;
  return rendering && typeof rendering === "object" && !Array.isArray(rendering)
    ? rendering as Record<string, unknown>
    : {};
}

function getFlowProcessStatus(projections: ProjectionInspection[], options: StatusQueryOptions = {}) {
  return projections
    .filter((projection: ProjectionInspection) => projection.snapshot.producer && projection.snapshot.producer.product === "flow")
    .flatMap((projection: ProjectionInspection) => {
      const snapshot = projection.snapshot;
      return arrayOf<ConsoleObjectRecord>(snapshot.processes)
        .filter((process: ConsoleObjectRecord) => matchesProcess(process, snapshot, options))
        .map((process: ConsoleObjectRecord) => {
          const processIds = new Set([process.id].filter(Boolean));
          const openGateIds = new Set(arrayOf<CrossProductRef>(process.openGateRefs).map((ref: CrossProductRef) => ref.id));
          const nextActionIds = new Set(arrayOf<CrossProductRef>(process.nextActionRefs).map((ref: CrossProductRef) => ref.id));
          const gates = arrayOf<ConsoleObjectRecord>(snapshot.gates).filter((gate: ConsoleObjectRecord) => {
            const processRef = gate.processRef as CrossProductRef | undefined;
            const matchesProcessRef = processRef && processIds.has(processRef.id);
            const matchesExplicitGate = Boolean(gate.id && openGateIds.has(gate.id));
            return matchesProcessRef || matchesExplicitGate || options.gateId === gate.id;
          });
          const gateIds = new Set(gates.map((gate: ConsoleObjectRecord) => gate.id).filter(Boolean));
          const openGates = gates.filter((gate: ConsoleObjectRecord) => isOpenFlowGate(gate) || Boolean(gate.id && openGateIds.has(gate.id)));
          const evidence = arrayOf<ConsoleObjectRecord>(snapshot.evidence).filter((item: ConsoleObjectRecord) => refsContain(item.processRefs, processIds) || refsContain(item.gateRefs, gateIds));
          const decisions = arrayOf<ConsoleObjectRecord>(snapshot.decisions).filter((decision: ConsoleObjectRecord) => refsContain(decision.subjectRefs, processIds) || refsContain(decision.subjectRefs, gateIds));
          const actions = arrayOf<ConsoleObjectRecord>(snapshot.actions).filter((action: ConsoleObjectRecord) => {
            if (action.id && nextActionIds.has(action.id)) return true;
            if (refsContain(action.subjectRefs, processIds)) return true;
            return refsContain(action.subjectRefs, gateIds);
          });

          return {
            projection: projection.relativePath,
            id: process.id,
            definitionId: process.definitionId,
            label: process.label,
            status: process.status,
            currentStep: process.currentStep,
            percentComplete: process.percentComplete,
            openGateRefs: arrayOf(process.openGateRefs),
            claimRefs: arrayOf(process.claimRefs),
            reviewItemRefs: arrayOf(process.reviewItemRefs),
            nextActionRefs: arrayOf(process.nextActionRefs),
            gates,
            openGates,
            evidence,
            decisions,
            actions: actions.map((action: ConsoleObjectRecord) => toActionDescriptor(action, `${projection.relativePath}.actions`)),
            source: process
          };
        });
    });
}

function validateEvent(event: ConsoleEventRecord, basePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  requireString(event, "schema", basePath, issues);
  requireString(event, "version", basePath, issues);
  requireString(event, "id", basePath, issues);
  requireString(event, "type", basePath, issues);
  requireString(event, "occurredAt", basePath, issues);
  requireObject(event, "producer", basePath, issues);
  requireObject(event, "scope", basePath, issues);
  requireObject(event, "subject", basePath, issues);
  requireObject(event, "payload", basePath, issues);
  validateRef(event.subject, `${basePath}.subject`, issues);
  arrayOf(event.payload && event.payload.refs).forEach((ref: unknown, index: number) => validateRef(ref, `${basePath}.payload.refs[${index}]`, issues));
  validateLinks(event.links, `${basePath}.links`, issues);
  validateLearningEventPayload(event, basePath, issues);
  if (event.schema !== "kontour.console.event") issues.push(issue("error", `${basePath}.schema`, "expected kontour.console.event"));
  if (event.version !== "0.1") issues.push(issue("warning", `${basePath}.version`, "expected v0.1 event version"));
  return issues;
}

function validateProjection(snapshot: ConsoleProjectionSnapshot, basePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  requireString(snapshot, "schema", basePath, issues);
  requireString(snapshot, "version", basePath, issues);
  requireString(snapshot, "generatedAt", basePath, issues);
  requireObject(snapshot, "derivedFrom", basePath, issues);
  requireObject(snapshot, "producer", basePath, issues);
  requireObject(snapshot, "scope", basePath, issues);
  if (snapshot.schema !== "kontour.console.projection") issues.push(issue("error", `${basePath}.schema`, "expected kontour.console.projection"));
  if (snapshot.version !== "0.1") issues.push(issue("warning", `${basePath}.version`, "expected v0.1 projection version"));
  OBJECT_ARRAY_KEYS.forEach((key: string) => {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) {
      issues.push(issue("error", `${basePath}.${key}`, "expected an array when present"));
    }
  });
  arrayOf<ConsoleLink>(snapshot.links).forEach((link: ConsoleLink, index: number) => validateLink(link, `${basePath}.links[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.claims).forEach((claim: ConsoleObjectRecord, index: number) => validateClaim(claim, `${basePath}.claims[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.processes).forEach((process: ConsoleObjectRecord, index: number) => validateProcess(process, `${basePath}.processes[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.gates).forEach((gate: ConsoleObjectRecord, index: number) => validateGate(gate, `${basePath}.gates[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.reviewItems).forEach((reviewItem: ConsoleObjectRecord, index: number) => validateReviewItem(reviewItem, `${basePath}.reviewItems[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.evidence).forEach((evidence: ConsoleObjectRecord, index: number) => validateEvidence(evidence, `${basePath}.evidence[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.decisions).forEach((decision: ConsoleObjectRecord, index: number) => validateDecision(decision, `${basePath}.decisions[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.exceptions).forEach((exception: ConsoleObjectRecord, index: number) => validateException(exception, `${basePath}.exceptions[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.learnings).forEach((learning: ConsoleObjectRecord, index: number) => validateLearning(learning, `${basePath}.learnings[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.inquiries).forEach((inquiry: ConsoleObjectRecord, index: number) => validateInquiry(inquiry, `${basePath}.inquiries[${index}]`, issues));
  arrayOf<ConsoleObjectRecord>(snapshot.actions).forEach((action: ConsoleObjectRecord, index: number) => {
    requireString(action, "id", `${basePath}.actions[${index}]`, issues);
    requireObject(action, "authority", `${basePath}.actions[${index}]`, issues);
    arrayOf(action && action.subjectRefs).forEach((ref: unknown, refIndex: number) => validateRef(ref, `${basePath}.actions[${index}].subjectRefs[${refIndex}]`, issues));
    for (const warning of actionDescriptorWarnings(action)) {
      issues.push(issue("warning", `${basePath}.actions[${index}]`, warning));
    }
  });
  return issues;
}

function summarizeEvents(events: ConsoleEventRecord[]) {
  const eventTypeCounts: Record<string, number> = {};
  for (const event of events) {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
  }
  return {
    acceptedEventCount: events.length,
    eventTypeCounts,
    firstOccurredAt: events[0] && events[0].occurredAt,
    lastOccurredAt: events[events.length - 1] && events[events.length - 1].occurredAt
  };
}

function summarizeProjection(snapshot: ConsoleProjectionSnapshot) {
  const objectCounts: Record<string, number> = {};
  for (const key of OBJECT_ARRAY_KEYS) {
    objectCounts[key] = arrayOf(snapshot[key]).length;
  }
  objectCounts.links = arrayOf(snapshot.links).length;
  objectCounts.inquiries = arrayOf(snapshot.inquiries).length;
  return {
    objectCounts,
    currentState: {
      claims: arrayOf<ConsoleObjectRecord>(snapshot.claims).map((claim: ConsoleObjectRecord) => ({ id: claim.id, status: claim.status, freshnessStatus: renderingExtension(claim).freshnessStatus || (claim.freshness as OpenRecord | undefined)?.status })),
      processes: arrayOf<ConsoleObjectRecord>(snapshot.processes).map((item: ConsoleObjectRecord) => ({ id: item.id, status: item.status })),
      gates: arrayOf<ConsoleObjectRecord>(snapshot.gates).map((item: ConsoleObjectRecord) => ({ id: item.id, status: item.status })),
      reviewItems: arrayOf<ConsoleObjectRecord>(snapshot.reviewItems).map((item: ConsoleObjectRecord) => ({ id: item.id, status: item.status })),
      actions: arrayOf<ConsoleObjectRecord>(snapshot.actions).map((item: ConsoleObjectRecord) => ({ id: item.id, status: item.status, authorityProduct: (item.authority as OpenRecord | undefined)?.product }))
    }
  };
}

function extractActionDescriptors(snapshot: ConsoleProjectionSnapshot, basePath: string = "projection"): ActionDescriptor[] {
  return arrayOf<ConsoleObjectRecord>(snapshot.actions).map((action: ConsoleObjectRecord) => toActionDescriptor(action, `${basePath}.actions`));
}

function toActionDescriptor(action: ConsoleObjectRecord, basePath: string): ActionDescriptor {
  return {
    id: action.id || "unknown-action",
    label: action.label,
    kind: action.kind,
    status: action.status,
    authority: isOpenRecord(action.authority) ? action.authority : undefined,
    subjectRefs: arrayOf<CrossProductRef>(action.subjectRefs),
    readOnly: true,
    warnings: actionDescriptorWarnings(action).map((message: string) => ({ severity: "warning", path: `${basePath}.${action.id}`, message })),
    source: action
  };
}

function actionDescriptorWarnings(action: ConsoleObjectRecord): string[] {
  const warnings: string[] = [];
  if (!action || typeof action !== "object") return warnings;
  const authority = action.authority as OpenRecord | undefined;
  if (authority && authority.command) warnings.push("authority.command is an inert descriptor only");
  if (authority && authority.endpoint) warnings.push("authority.endpoint is an inert descriptor only");
  if (authority && authority.externalUrl) warnings.push("authority.externalUrl is an inert descriptor only");
  return warnings;
}

function listFiles(dir: string, extension: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name: string) => name.endsWith(extension))
    .sort()
    .map((name: string) => path.join(dir, name));
}

function listFilesRecursive(dir: string, extension: string, containmentRoot: string): string[] {
  const root = path.resolve(containmentRoot);
  const start = path.resolve(dir);
  if (!isSafeDiscoveryRoot(root) || !isContainedPath(start, root) || !fs.existsSync(start)) return [];
  const entries: string[] = [];
  walkSafe(start, root, extension, entries);
  return entries.sort();
}

function resolveUnderRoot(rootDir: string, maybeRelativePath: string) {
  return path.resolve(path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.join(rootDir, maybeRelativePath));
}

function readContainedTextFile(filePath: string, containmentRoot?: string) {
  if (!containmentRoot) return fs.readFileSync(filePath, "utf8");
  const root = path.resolve(containmentRoot);
  if (!isContainedPath(filePath, root)) {
    throw new Error("file must stay inside the configured kontour root");
  }

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(filePath, flags);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error("file must be a regular file");
    }
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function isSafeDiscoveryRoot(root: string): boolean {
  try {
    const stat = fs.lstatSync(root);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    return false;
  }
}

function walkSafe(dir: string, root: string, extension: string, entries: string[]): void {
  let stat;
  try {
    stat = fs.lstatSync(dir);
  } catch (error) {
    return;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isContainedPath(dir, root)) return;

  for (const name of fs.readdirSync(dir).sort()) {
    const filePath = path.join(dir, name);
    let childStat;
    try {
      childStat = fs.lstatSync(filePath);
    } catch (error) {
      continue;
    }
    if (childStat.isSymbolicLink()) continue;
    if (!isContainedPath(filePath, root)) continue;
    if (childStat.isDirectory()) {
      walkSafe(filePath, root, extension, entries);
    } else if (childStat.isFile() && filePath.endsWith(extension)) {
      entries.push(filePath);
    }
  }
}

function isContainedPath(candidate: string, root: string): boolean {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function matchesReview(reviewItem: ConsoleObjectRecord, options: StatusQueryOptions): boolean {
  if (options.reviewId && reviewItem.id !== options.reviewId) return false;
  if (options.claimId && !refsContain(reviewItem.claimRefs, new Set([options.claimId]))) return false;
  const subjectRef = reviewItem.subjectRef as CrossProductRef | undefined;
  if (options.providerFieldRef && (!subjectRef || subjectRef.id !== options.providerFieldRef)) return false;
  return true;
}

function matchesProcess(process: ConsoleObjectRecord, snapshot: ConsoleProjectionSnapshot, options: StatusQueryOptions): boolean {
  if (options.processId && process.id !== options.processId) return false;
  if (options.status && process.status !== options.status) return false;
  if (options.gateId) {
    const openGateRefs = new Set(arrayOf<CrossProductRef>(process.openGateRefs).map((ref: CrossProductRef) => ref.id));
    const hasGate = arrayOf<ConsoleObjectRecord>(snapshot.gates).some((gate: ConsoleObjectRecord) => {
      const processRef = gate.processRef as CrossProductRef | undefined;
      return gate.id === options.gateId && processRef && processRef.id === process.id;
    });
    if (!openGateRefs.has(options.gateId) && !hasGate) return false;
  }
  return true;
}

function isOpenFlowGate(gate: ConsoleObjectRecord): boolean {
  return Boolean(gate && typeof gate.status === "string" && ["open", "waiting", "routed_back"].includes(gate.status));
}

function refsContain(refs: unknown, ids: Set<unknown>): boolean {
  return arrayOf<CrossProductRef>(refs).some((ref: CrossProductRef) => ids.has(ref.id));
}

function refSetHas(ref: unknown, ids: Set<unknown>): boolean {
  const candidate = ref as CrossProductRef | undefined;
  return Boolean(candidate && ids.has(candidate.id));
}

function validateClaim(claim: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(claim, "id", basePath, issues);
  requireString(claim, "status", basePath, issues);
  validateRefArray(claim && claim.evidenceRefs, `${basePath}.evidenceRefs`, issues);
  validateRefArray(claim && claim.actionRefs, `${basePath}.actionRefs`, issues);
  if (claim && claim.sourceRef !== undefined) validateRef(claim.sourceRef, `${basePath}.sourceRef`, issues);
}

function validateProcess(process: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(process, "id", basePath, issues);
  requireString(process, "status", basePath, issues);
  validateRefArray(process && process.openGateRefs, `${basePath}.openGateRefs`, issues);
  validateRefArray(process && process.reviewItemRefs, `${basePath}.reviewItemRefs`, issues);
  validateRefArray(process && process.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(process && process.nextActionRefs, `${basePath}.nextActionRefs`, issues);
}

function validateGate(gate: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(gate, "id", basePath, issues);
  requireString(gate, "status", basePath, issues);
  validateRef(gate && gate.processRef, `${basePath}.processRef`, issues);
  validateRefArray(gate && gate.expectationRefs, `${basePath}.expectationRefs`, issues);
  validateRefArray(gate && gate.evidenceRefs, `${basePath}.evidenceRefs`, issues);
}

function validateReviewItem(reviewItem: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(reviewItem, "id", basePath, issues);
  requireString(reviewItem, "kind", basePath, issues);
  requireString(reviewItem, "status", basePath, issues);
  validateRef(reviewItem && reviewItem.subjectRef, `${basePath}.subjectRef`, issues);
  validateRefArray(reviewItem && reviewItem.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(reviewItem && reviewItem.processRefs, `${basePath}.processRefs`, issues);
  validateRefArray(reviewItem && reviewItem.evidenceRefs, `${basePath}.evidenceRefs`, issues);
  validateRefArray(reviewItem && reviewItem.actionRefs, `${basePath}.actionRefs`, issues);
}

function validateEvidence(evidence: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(evidence, "id", basePath, issues);
  validateRef(evidence && evidence.producerRef, `${basePath}.producerRef`, issues);
  validateRefArray(evidence && evidence.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(evidence && evidence.processRefs, `${basePath}.processRefs`, issues);
}

function validateDecision(decision: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(decision, "id", basePath, issues);
  requireString(decision, "kind", basePath, issues);
  requireString(decision, "decidedAt", basePath, issues);
  validateRefArray(decision && decision.subjectRefs, `${basePath}.subjectRefs`, issues);
  validateRefArray(decision && decision.evidenceRefs, `${basePath}.evidenceRefs`, issues);
}

function validateException(exception: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(exception, "id", basePath, issues);
  requireString(exception, "status", basePath, issues);
  validateRefArray(exception && exception.subjectRefs, `${basePath}.subjectRefs`, issues);
  validateRefArray(exception && exception.evidenceRefs, `${basePath}.evidenceRefs`, issues);
}

function validateLearning(learning: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(learning, "id", basePath, issues);
  requireString(learning, "summary", basePath, issues);
  validateRef(learning && learning.subjectRef, `${basePath}.subjectRef`, issues);
  validateLearningFamily(learning && learning.family, `${basePath}.family`, issues);
  requireTrue(learning, "nonAuthority", basePath, issues);
  validateOptionalNumber(learning && learning.confidence, `${basePath}.confidence`, issues);
  if (learning && learning.sourceRef !== undefined) validateRef(learning.sourceRef, `${basePath}.sourceRef`, issues);
  validateRefArray(learning && learning.refs, `${basePath}.refs`, issues);
  validateLinks(learning && learning.links, `${basePath}.links`, issues);
}

function validateInquiry(inquiry: ConsoleObjectRecord, basePath: string, issues: ValidationIssue[]): void {
  requireString(inquiry, "id", basePath, issues);
  requireString(inquiry, "outcome", basePath, issues);
  // Console folds inquiry records as append-only testimony; it does not recompute outcomes.
  // Validate cross-product ref arrays for navigation only.
  validateRefArray(inquiry && inquiry.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(inquiry && inquiry.ruleRefs, `${basePath}.ruleRefs`, issues);
  if (inquiry && inquiry.sourceRef !== undefined) validateRef(inquiry.sourceRef, `${basePath}.sourceRef`, issues);
}

function validateLearningEventPayload(event: ConsoleEventRecord, basePath: string, issues: ValidationIssue[]): void {
  if (!event || typeof event.type !== "string" || !event.type.startsWith("learning.")) return;
  const payload = event.payload;
  requireString(payload, "summary", `${basePath}.payload`, issues);
  requireObject(payload, "data", `${basePath}.payload`, issues);
  const payloadRecord = isOpenRecord(payload) ? payload : {};
  const data: OpenRecord = isOpenRecord(payloadRecord.data) ? payloadRecord.data : {};
  validateLearningFamily(data.family, `${basePath}.payload.data.family`, issues);
  requireTrue(data, "nonAuthority", `${basePath}.payload.data`, issues);
  validateOptionalNumber(data && data.confidence, `${basePath}.payload.data.confidence`, issues);
  if (data.id !== undefined) requireString(data, "id", `${basePath}.payload.data`, issues);
  if (data.sourceRef !== undefined) validateRef(data.sourceRef, `${basePath}.payload.data.sourceRef`, issues);
  validateLinks(payloadRecord.links, `${basePath}.payload.links`, issues);
}

function validateLearningFamily(value: unknown, pathName: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !["workflow", "domain"].includes(value)) {
    issues.push(issue("error", pathName, "expected workflow or domain"));
  }
}

function validateOptionalNumber(value: unknown, pathName: string, issues: ValidationIssue[]): void {
  if (value !== undefined && typeof value !== "number") {
    issues.push(issue("error", pathName, "expected a number when present"));
  }
}

function validateLinks(links: unknown, basePath: string, issues: ValidationIssue[]): void {
  if (links === undefined) return;
  if (!Array.isArray(links)) {
    issues.push(issue("error", basePath, "expected an array"));
    return;
  }
  links.forEach((link: unknown, index: number) => validateLink(link, `${basePath}[${index}]`, issues));
}

function validateLink(link: unknown, basePath: string, issues: ValidationIssue[]): void {
  requireObject({ link }, "link", basePath, issues);
  if (!link || typeof link !== "object") return;
  const linkRecord = link as OpenRecord;
  validateRef(linkRecord.from, `${basePath}.from`, issues);
  validateRef(linkRecord.to, `${basePath}.to`, issues);
  requireString(linkRecord, "relation", basePath, issues);
}

function validateRefArray(refs: unknown, basePath: string, issues: ValidationIssue[]): void {
  if (refs === undefined) return;
  if (!Array.isArray(refs)) {
    issues.push(issue("error", basePath, "expected an array"));
    return;
  }
  refs.forEach((ref: unknown, index: number) => validateRef(ref, `${basePath}[${index}]`, issues));
}

function validateRef(ref: unknown, basePath: string, issues: ValidationIssue[]): void {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    issues.push(issue("error", basePath, "expected CrossProductRef object"));
    return;
  }
  const refRecord = ref as OpenRecord;
  requireString(refRecord, "product", basePath, issues);
  requireString(refRecord, "kind", basePath, issues);
  requireString(refRecord, "id", basePath, issues);
  ["apiVersion", "name", "uid", "label", "url"].forEach((key: string) => {
    if (refRecord[key] !== undefined && (typeof refRecord[key] !== "string" || refRecord[key].length === 0)) {
      issues.push(issue("error", `${basePath}.${key}`, "expected a non-empty string when present"));
    }
  });
  if (refRecord.scope !== undefined) {
    requireObject(refRecord, "scope", basePath, issues);
    if (refRecord.scope && typeof refRecord.scope === "object" && !Array.isArray(refRecord.scope)) {
      const scope = refRecord.scope as OpenRecord;
      ["product", "kind", "id"].forEach((key: string) => {
        if (scope[key] !== undefined && (typeof scope[key] !== "string" || scope[key].length === 0)) {
          issues.push(issue("error", `${basePath}.scope.${key}`, "expected a non-empty string when present"));
        }
      });
    }
  }
}

function requireString(object: unknown, key: string, basePath: string, issues: ValidationIssue[]): void {
  const record = object as OpenRecord | undefined;
  if (!record || typeof record[key] !== "string" || record[key].length === 0) {
    issues.push(issue("error", `${basePath}.${key}`, "expected a non-empty string"));
  }
}

function requireObject(object: unknown, key: string, basePath: string, issues: ValidationIssue[]): void {
  const record = object as OpenRecord | undefined;
  if (!record || !record[key] || typeof record[key] !== "object" || Array.isArray(record[key])) {
    issues.push(issue("error", `${basePath}.${key}`, "expected an object"));
  }
}

function requireTrue(object: unknown, key: string, basePath: string, issues: ValidationIssue[]): void {
  const record = object as OpenRecord | undefined;
  if (!record || record[key] !== true) {
    issues.push(issue("error", `${basePath}.${key}`, "expected true"));
  }
}

function issue(severity: ValidationSeverity, pathName: string, message: string): ValidationIssue {
  return { severity, path: pathName, message };
}

function splitIssues(issues: ValidationIssue[]) {
  return {
    errors: issues.filter((item: ValidationIssue) => item.severity === "error"),
    warnings: issues.filter((item: ValidationIssue) => item.severity === "warning")
  };
}

function arrayOf<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function isOpenRecord(value: unknown): value is OpenRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const emitter = require("./emitter");
const surfaceClaimHelper = require("./surface-claim-helper");
const flowProcessHelper = require("./flow-process-helper");
const currentOperatingState = require("./current-operating-state");
const consoleHub = require("./console-hub");
const consoleHubServer = require("./console-hub-server");
const config = require("./config");
const migrations = require("./migrations");
const telemetry = require("./telemetry");

module.exports = {
  inspectFixtures,
  inspectLocalKontour,
  loadEventStreams,
  loadProjectionSnapshots,
  getSurfaceClaimStatus,
  getFlowProcessStatus,
  getSurveyReviewState,
  buildCurrentOperatingState: currentOperatingState.buildCurrentOperatingState,
  LocalConsoleHub: consoleHub.LocalConsoleHub,
  createLocalConsoleHub: consoleHub.createLocalConsoleHub,
  createConsoleHubServer: consoleHubServer.createConsoleHubServer,
  applyConsoleMigrations: migrations.applyConsoleMigrations,
  loadConsoleMigrations: migrations.loadConsoleMigrations,
  assertConsoleRuntimeConfig: config.assertConsoleRuntimeConfig,
  redactConsoleRuntimeConfig: config.redactConsoleRuntimeConfig,
  resolveConsoleRuntimeConfig: config.resolveConsoleRuntimeConfig,
  resolveTelemetryStorageAdapter: config.resolveTelemetryStorageAdapter,
  createTelemetryRepository: telemetry.createTelemetryRepository,
  createTelemetryStore: telemetry.createTelemetryStore,
  validateTelemetryRecordBody: telemetry.validateTelemetryRecordBody,
  extractActionDescriptors,
  validateEvent,
  validateProjection,
  KontourEmitter: emitter.KontourEmitter,
  LocalFileSink: emitter.LocalFileSink,
  CompositeSink: emitter.CompositeSink,
  InMemorySink: emitter.InMemorySink,
  classifyRecord: emitter.classifyRecord,
  formatDeliveryResult: emitter.formatDeliveryResult,
  surfaceClaimStateToProjection: surfaceClaimHelper.surfaceClaimStateToProjection,
  surfaceFreshnessTransitionToEvent: surfaceClaimHelper.surfaceFreshnessTransitionToEvent,
  flowProcessStateToProjection: flowProcessHelper.flowProcessStateToProjection,
  flowGateTransitionToEvent: flowProcessHelper.flowGateTransitionToEvent
};

export {
  bridgeFlowRun,
  deriveFlowRunEvents,
  listFlowRunDirs,
} from "./flow-bridge";
export type {
  FlowBridgeDelivery,
  FlowBridgeEvent,
  FlowBridgeScopeOptions,
} from "./flow-bridge";
