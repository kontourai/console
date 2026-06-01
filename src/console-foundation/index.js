const fs = require("node:fs");
const path = require("node:path");

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
  "exceptions"
];

function inspectFixtures(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const source = {
    sourceKind: "fixture",
    sourceRoot: rootDir
  };
  const eventStreams = loadEventStreams(path.join(rootDir, EVENT_DIR), rootDir, source);
  const projections = loadProjectionSnapshots(path.join(rootDir, PROJECTION_DIR), rootDir, source);
  const issues = eventStreams.flatMap((stream) => stream.validation)
    .concat(projections.flatMap((projection) => projection.validation));

  return {
    rootDir,
    eventStreams,
    projections,
    validation: splitIssues(issues)
  };
}

function inspectLocalKontour(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const kontourRoot = resolveUnderRoot(rootDir, options.kontourRoot || options.localRoot || LOCAL_KONTOUR_DIR);
  const sourceRoot = kontourRoot;
  const source = {
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
  const issues = eventStreams.flatMap((stream) => stream.validation)
    .concat(projections.flatMap((projection) => projection.validation));

  return {
    rootDir,
    kontourRoot: sourceRoot,
    eventStreams,
    projections,
    validation: splitIssues(issues)
  };
}

function loadEventStreams(streamDir, rootDir = process.cwd(), options = {}) {
  const files = options.recursive
    ? listFilesRecursive(streamDir, ".jsonl", options.containmentRoot || streamDir)
    : listFiles(streamDir, ".jsonl");
  return files.map((filePath) => {
    const relativePath = path.relative(rootDir, filePath);
    const events = [];
    const validation = [];
    let lines = [];

    try {
      lines = readContainedTextFile(filePath, options.containmentRoot).split(/\r?\n/);
    } catch (error) {
      validation.push(issue("error", relativePath, `unable to read event stream: ${error.message}`));
    }

    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        events.push(event);
        validation.push(...validateEvent(event, `${relativePath}:${index + 1}`));
      } catch (error) {
        validation.push(issue("error", `${relativePath}:${index + 1}`, `invalid JSON: ${error.message}`));
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

function loadProjectionSnapshots(projectionDir, rootDir = process.cwd(), options = {}) {
  const files = options.recursive
    ? listFilesRecursive(projectionDir, ".json", options.containmentRoot || projectionDir)
    : listFiles(projectionDir, ".json");
  return files.map((filePath) => {
    const relativePath = path.relative(rootDir, filePath);
    const validation = [];
    let snapshot = {};

    try {
      snapshot = JSON.parse(readContainedTextFile(filePath, options.containmentRoot));
      validation.push(...validateProjection(snapshot, relativePath));
    } catch (error) {
      validation.push(issue("error", relativePath, `invalid JSON: ${error.message}`));
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

function getSurfaceClaimStatus(projections, options = {}) {
  return projections
    .filter((projection) => projection.snapshot.producer && projection.snapshot.producer.product === "surface")
    .flatMap((projection) => arrayOf(projection.snapshot.claims).map((claim) => ({
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
      requiresSelectedFlowRun: Boolean(claim.extensions && claim.extensions.rendering && claim.extensions.rendering.requiresSelectedFlowRun),
      source: claim
    })))
    .filter((claim) => !options.claimId || claim.id === options.claimId);
}

function getCampfitFieldReviewState(projections, options = {}) {
  return projections
    .filter((projection) => projection.snapshot.producer && projection.snapshot.producer.product === "campfit")
    .flatMap((projection) => {
      const snapshot = projection.snapshot;
      return arrayOf(snapshot.reviewItems)
        .filter((reviewItem) => matchesReview(reviewItem, options))
        .map((reviewItem) => {
          const claimIds = new Set(arrayOf(reviewItem.claimRefs).map((ref) => ref.id));
          const evidenceIds = new Set(arrayOf(reviewItem.evidenceRefs).map((ref) => ref.id));
          const actionIds = new Set(arrayOf(reviewItem.actionRefs).map((ref) => ref.id));
          const subjectIds = new Set([reviewItem.id, reviewItem.subjectRef && reviewItem.subjectRef.id].filter(Boolean));
          const claims = arrayOf(snapshot.claims).filter((claim) => claimIds.has(claim.id) || options.claimId === claim.id);
          const evidence = arrayOf(snapshot.evidence).filter((item) => evidenceIds.has(item.id) || refsContain(item.claimRefs, claimIds));
          const actions = arrayOf(snapshot.actions).filter((action) => actionIds.has(action.id) || refsContain(action.subjectRefs, claimIds) || refsContain(action.subjectRefs, subjectIds));
          const decisions = arrayOf(snapshot.decisions).filter((decision) => refsContain(decision.subjectRefs, new Set([reviewItem.id])) || refsContain(decision.evidenceRefs, evidenceIds));
          const linkedIds = new Set([reviewItem.id, ...claimIds, ...evidenceIds, ...actionIds, ...subjectIds, ...decisions.map((decision) => decision.id)]);
          return {
            projection: projection.relativePath,
            reviewItem,
            claim: claims[0] || null,
            claims,
            evidence,
            decisions,
            actions: actions.map((action) => toActionDescriptor(action, `${projection.relativePath}.actions`)),
            links: arrayOf(snapshot.links).filter((link) => refSetHas(link.from, linkedIds) || refSetHas(link.to, linkedIds))
          };
        });
    });
}

function validateEvent(event, basePath) {
  const issues = [];
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
  arrayOf(event.payload && event.payload.refs).forEach((ref, index) => validateRef(ref, `${basePath}.payload.refs[${index}]`, issues));
  validateLinks(event.links, `${basePath}.links`, issues);
  if (event.schema !== "kontour.console.event") issues.push(issue("error", `${basePath}.schema`, "expected kontour.console.event"));
  if (event.version !== "0.1") issues.push(issue("warning", `${basePath}.version`, "expected v0.1 event version"));
  return issues;
}

function validateProjection(snapshot, basePath) {
  const issues = [];
  requireString(snapshot, "schema", basePath, issues);
  requireString(snapshot, "version", basePath, issues);
  requireString(snapshot, "generatedAt", basePath, issues);
  requireObject(snapshot, "derivedFrom", basePath, issues);
  requireObject(snapshot, "producer", basePath, issues);
  requireObject(snapshot, "scope", basePath, issues);
  if (snapshot.schema !== "kontour.console.projection") issues.push(issue("error", `${basePath}.schema`, "expected kontour.console.projection"));
  if (snapshot.version !== "0.1") issues.push(issue("warning", `${basePath}.version`, "expected v0.1 projection version"));
  OBJECT_ARRAY_KEYS.forEach((key) => {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) {
      issues.push(issue("error", `${basePath}.${key}`, "expected an array when present"));
    }
  });
  arrayOf(snapshot.links).forEach((link, index) => validateLink(link, `${basePath}.links[${index}]`, issues));
  arrayOf(snapshot.claims).forEach((claim, index) => validateClaim(claim, `${basePath}.claims[${index}]`, issues));
  arrayOf(snapshot.processes).forEach((process, index) => validateProcess(process, `${basePath}.processes[${index}]`, issues));
  arrayOf(snapshot.gates).forEach((gate, index) => validateGate(gate, `${basePath}.gates[${index}]`, issues));
  arrayOf(snapshot.reviewItems).forEach((reviewItem, index) => validateReviewItem(reviewItem, `${basePath}.reviewItems[${index}]`, issues));
  arrayOf(snapshot.evidence).forEach((evidence, index) => validateEvidence(evidence, `${basePath}.evidence[${index}]`, issues));
  arrayOf(snapshot.decisions).forEach((decision, index) => validateDecision(decision, `${basePath}.decisions[${index}]`, issues));
  arrayOf(snapshot.exceptions).forEach((exception, index) => validateException(exception, `${basePath}.exceptions[${index}]`, issues));
  arrayOf(snapshot.actions).forEach((action, index) => {
    requireString(action, "id", `${basePath}.actions[${index}]`, issues);
    requireObject(action, "authority", `${basePath}.actions[${index}]`, issues);
    arrayOf(action && action.subjectRefs).forEach((ref, refIndex) => validateRef(ref, `${basePath}.actions[${index}].subjectRefs[${refIndex}]`, issues));
    for (const warning of actionDescriptorWarnings(action)) {
      issues.push(issue("warning", `${basePath}.actions[${index}]`, warning));
    }
  });
  return issues;
}

function summarizeEvents(events) {
  const eventTypeCounts = {};
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

function summarizeProjection(snapshot) {
  const objectCounts = {};
  for (const key of OBJECT_ARRAY_KEYS) {
    objectCounts[key] = arrayOf(snapshot[key]).length;
  }
  objectCounts.links = arrayOf(snapshot.links).length;
  return {
    objectCounts,
    currentState: {
      claims: arrayOf(snapshot.claims).map((claim) => ({ id: claim.id, status: claim.status, freshnessStatus: claim.freshness && claim.freshness.status })),
      processes: arrayOf(snapshot.processes).map((item) => ({ id: item.id, status: item.status })),
      gates: arrayOf(snapshot.gates).map((item) => ({ id: item.id, status: item.status })),
      reviewItems: arrayOf(snapshot.reviewItems).map((item) => ({ id: item.id, status: item.status })),
      actions: arrayOf(snapshot.actions).map((item) => ({ id: item.id, status: item.status, authorityProduct: item.authority && item.authority.product }))
    }
  };
}

function extractActionDescriptors(snapshot, basePath = "projection") {
  return arrayOf(snapshot.actions).map((action) => toActionDescriptor(action, `${basePath}.actions`));
}

function toActionDescriptor(action, basePath) {
  return {
    id: action.id,
    label: action.label,
    kind: action.kind,
    status: action.status,
    authority: action.authority,
    subjectRefs: arrayOf(action.subjectRefs),
    readOnly: true,
    warnings: actionDescriptorWarnings(action).map((message) => ({ severity: "warning", path: `${basePath}.${action.id}`, message })),
    source: action
  };
}

function actionDescriptorWarnings(action) {
  const warnings = [];
  if (!action || typeof action !== "object") return warnings;
  if (action.authority && action.authority.command) warnings.push("authority.command is an inert descriptor only");
  if (action.authority && action.authority.endpoint) warnings.push("authority.endpoint is an inert descriptor only");
  if (action.authority && action.authority.externalUrl) warnings.push("authority.externalUrl is an inert descriptor only");
  return warnings;
}

function listFiles(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => path.join(dir, name));
}

function listFilesRecursive(dir, extension, containmentRoot) {
  const root = path.resolve(containmentRoot);
  const start = path.resolve(dir);
  if (!isSafeDiscoveryRoot(root) || !isContainedPath(start, root) || !fs.existsSync(start)) return [];
  const entries = [];
  walkSafe(start, root, extension, entries);
  return entries.sort();
}

function resolveUnderRoot(rootDir, maybeRelativePath) {
  return path.resolve(path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.join(rootDir, maybeRelativePath));
}

function readContainedTextFile(filePath, containmentRoot) {
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

function isSafeDiscoveryRoot(root) {
  try {
    const stat = fs.lstatSync(root);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    return false;
  }
}

function walkSafe(dir, root, extension, entries) {
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

function isContainedPath(candidate, root) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function matchesReview(reviewItem, options) {
  if (options.reviewId && reviewItem.id !== options.reviewId) return false;
  if (options.claimId && !refsContain(reviewItem.claimRefs, new Set([options.claimId]))) return false;
  if (options.providerFieldRef && (!reviewItem.subjectRef || reviewItem.subjectRef.id !== options.providerFieldRef)) return false;
  return true;
}

function refsContain(refs, ids) {
  return arrayOf(refs).some((ref) => ids.has(ref.id));
}

function refSetHas(ref, ids) {
  return Boolean(ref && ids.has(ref.id));
}

function validateClaim(claim, basePath, issues) {
  requireString(claim, "id", basePath, issues);
  requireString(claim, "status", basePath, issues);
  validateRefArray(claim && claim.evidenceRefs, `${basePath}.evidenceRefs`, issues);
  validateRefArray(claim && claim.actionRefs, `${basePath}.actionRefs`, issues);
  if (claim && claim.sourceRef !== undefined) validateRef(claim.sourceRef, `${basePath}.sourceRef`, issues);
}

function validateProcess(process, basePath, issues) {
  requireString(process, "id", basePath, issues);
  requireString(process, "status", basePath, issues);
  validateRefArray(process && process.openGateRefs, `${basePath}.openGateRefs`, issues);
  validateRefArray(process && process.reviewItemRefs, `${basePath}.reviewItemRefs`, issues);
  validateRefArray(process && process.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(process && process.nextActionRefs, `${basePath}.nextActionRefs`, issues);
}

function validateGate(gate, basePath, issues) {
  requireString(gate, "id", basePath, issues);
  requireString(gate, "status", basePath, issues);
  validateRef(gate && gate.processRef, `${basePath}.processRef`, issues);
  validateRefArray(gate && gate.expectationRefs, `${basePath}.expectationRefs`, issues);
  validateRefArray(gate && gate.evidenceRefs, `${basePath}.evidenceRefs`, issues);
}

function validateReviewItem(reviewItem, basePath, issues) {
  requireString(reviewItem, "id", basePath, issues);
  requireString(reviewItem, "kind", basePath, issues);
  requireString(reviewItem, "status", basePath, issues);
  validateRef(reviewItem && reviewItem.subjectRef, `${basePath}.subjectRef`, issues);
  validateRefArray(reviewItem && reviewItem.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(reviewItem && reviewItem.processRefs, `${basePath}.processRefs`, issues);
  validateRefArray(reviewItem && reviewItem.evidenceRefs, `${basePath}.evidenceRefs`, issues);
  validateRefArray(reviewItem && reviewItem.actionRefs, `${basePath}.actionRefs`, issues);
}

function validateEvidence(evidence, basePath, issues) {
  requireString(evidence, "id", basePath, issues);
  validateRef(evidence && evidence.producerRef, `${basePath}.producerRef`, issues);
  validateRefArray(evidence && evidence.claimRefs, `${basePath}.claimRefs`, issues);
  validateRefArray(evidence && evidence.processRefs, `${basePath}.processRefs`, issues);
}

function validateDecision(decision, basePath, issues) {
  requireString(decision, "id", basePath, issues);
  requireString(decision, "kind", basePath, issues);
  requireString(decision, "decidedAt", basePath, issues);
  validateRefArray(decision && decision.subjectRefs, `${basePath}.subjectRefs`, issues);
  validateRefArray(decision && decision.evidenceRefs, `${basePath}.evidenceRefs`, issues);
}

function validateException(exception, basePath, issues) {
  requireString(exception, "id", basePath, issues);
  requireString(exception, "status", basePath, issues);
  validateRefArray(exception && exception.subjectRefs, `${basePath}.subjectRefs`, issues);
  validateRefArray(exception && exception.evidenceRefs, `${basePath}.evidenceRefs`, issues);
}

function validateLinks(links, basePath, issues) {
  if (links === undefined) return;
  if (!Array.isArray(links)) {
    issues.push(issue("error", basePath, "expected an array"));
    return;
  }
  links.forEach((link, index) => validateLink(link, `${basePath}[${index}]`, issues));
}

function validateLink(link, basePath, issues) {
  requireObject({ link }, "link", basePath, issues);
  if (!link || typeof link !== "object") return;
  validateRef(link.from, `${basePath}.from`, issues);
  validateRef(link.to, `${basePath}.to`, issues);
  requireString(link, "relation", basePath, issues);
}

function validateRefArray(refs, basePath, issues) {
  if (refs === undefined) return;
  if (!Array.isArray(refs)) {
    issues.push(issue("error", basePath, "expected an array"));
    return;
  }
  refs.forEach((ref, index) => validateRef(ref, `${basePath}[${index}]`, issues));
}

function validateRef(ref, basePath, issues) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    issues.push(issue("error", basePath, "expected CrossProductRef object"));
    return;
  }
  requireString(ref, "product", basePath, issues);
  requireString(ref, "kind", basePath, issues);
  requireString(ref, "id", basePath, issues);
}

function requireString(object, key, basePath, issues) {
  if (!object || typeof object[key] !== "string" || object[key].length === 0) {
    issues.push(issue("error", `${basePath}.${key}`, "expected a non-empty string"));
  }
}

function requireObject(object, key, basePath, issues) {
  if (!object || !object[key] || typeof object[key] !== "object" || Array.isArray(object[key])) {
    issues.push(issue("error", `${basePath}.${key}`, "expected an object"));
  }
}

function issue(severity, pathName, message) {
  return { severity, path: pathName, message };
}

function splitIssues(issues) {
  return {
    errors: issues.filter((item) => item.severity === "error"),
    warnings: issues.filter((item) => item.severity === "warning")
  };
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

const emitter = require("./emitter");
const surfaceClaimHelper = require("./surface-claim-helper");

module.exports = {
  inspectFixtures,
  inspectLocalKontour,
  loadEventStreams,
  loadProjectionSnapshots,
  getSurfaceClaimStatus,
  getCampfitFieldReviewState,
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
  surfaceFreshnessTransitionToEvent: surfaceClaimHelper.surfaceFreshnessTransitionToEvent
};
