// @ts-nocheck
function buildCurrentOperatingState(input, options = {}) {
  const eventStreams = normalizeEventStreams(input);
  const prepared = prepareEvents(eventStreams);
  const generatedAt = options.generatedAt || replayGeneratedAt(prepared.acceptedEvents);
  const state = {
    generatedAt,
    source: {
      mode: "event_replay",
      streamIds: eventStreams.map((stream, index) => stream.relativePath || stream.filePath || `stream-${index + 1}`),
      acceptedEventCount: prepared.acceptedEvents.length,
      duplicateEventCount: prepared.duplicateEventCount,
      lastAcceptedEventId: prepared.acceptedEvents.length
        ? prepared.acceptedEvents[prepared.acceptedEvents.length - 1].event.id
        : null
    },
    currentStage: "No events replayed.",
    processes: [],
    gates: [],
    claims: [],
    evidence: [],
    learnings: [],
    actions: [],
    links: [],
    timeline: []
  };

  const working = {
    processes: new Map(),
    gates: new Map(),
    claims: new Map(),
    evidence: new Map(),
    learnings: new Map(),
    actions: new Map(),
    links: new Map(),
    timeline: []
  };

  prepared.acceptedEvents.forEach((entry) => applyEvent(working, entry.event, entry.streamId));

  state.processes = sortById([...working.processes.values()]);
  state.gates = sortById([...working.gates.values()]);
  state.claims = sortById([...working.claims.values()]);
  state.evidence = sortById([...working.evidence.values()]);
  state.learnings = sortById([...working.learnings.values()]);
  state.actions = sortById([...working.actions.values()]).map((action) => ({
    ...action,
    readOnly: true
  }));
  state.links = [...working.links.values()].sort(compareLinks);
  state.timeline = working.timeline;
  state.currentStage = describeCurrentStage(state);

  return state;
}

function normalizeEventStreams(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    if (input.every((item) => item && Array.isArray(item.events))) return input;
    return [{ relativePath: "inline-events", events: input }];
  }
  if (Array.isArray(input.eventStreams)) return input.eventStreams;
  if (Array.isArray(input.events)) return [{ relativePath: input.relativePath || "inline-events", events: input.events }];
  return [];
}

function prepareEvents(eventStreams) {
  const seen = new Set();
  const acceptedEvents = [];
  let duplicateEventCount = 0;

  eventStreams.forEach((stream, streamIndex) => {
    const streamId = stream.relativePath || stream.filePath || `stream-${streamIndex + 1}`;
    arrayOf(stream.events).forEach((event, eventIndex) => {
      if (!event || typeof event !== "object") return;
      if (event.id && seen.has(event.id)) {
        duplicateEventCount += 1;
        return;
      }
      if (event.id) seen.add(event.id);
      acceptedEvents.push({ event, streamId, streamIndex, eventIndex });
    });
  });

  acceptedEvents.sort(compareEventEntries);
  return { acceptedEvents, duplicateEventCount };
}

function compareEventEntries(left, right) {
  return compareMaybeNumber(left.event.sequence, right.event.sequence)
    || compareMaybeString(left.event.occurredAt, right.event.occurredAt)
    || compareMaybeString(left.event.observedAt, right.event.observedAt)
    || left.streamIndex - right.streamIndex
    || left.eventIndex - right.eventIndex;
}

function replayGeneratedAt(acceptedEvents) {
  if (!acceptedEvents.length) return null;
  const last = acceptedEvents[acceptedEvents.length - 1].event;
  return last.observedAt || last.occurredAt || null;
}

function applyEvent(state, event, streamId) {
  const subject = clone(event.subject);
  const payload = event.payload || {};
  const refs = arrayOf(payload.refs);
  const after = payload.after && typeof payload.after === "object" ? clone(payload.after) : {};
  const summary = payload.summary || event.summary;

  switch (event.type) {
    case "process.started":
    case "process.progressed":
      upsertProcess(state, event, subject, refs, after);
      break;
    case "gate.opened":
    case "gate.passed":
    case "gate.failed":
    case "gate.routed_back":
      upsertGate(state, event, subject, refs, after);
      break;
    case "claim.freshness.changed":
    case "claim.reverification.completed":
    case "claim.status.changed":
      upsertClaim(state, event, subject, refs, after);
      break;
    case "evidence.attached":
      upsertEvidence(state, event, subject, refs, summary);
      break;
    default:
      if (typeof event.type === "string" && event.type.startsWith("learning.")) {
        upsertLearning(state, event, subject, refs, payload, summary);
      }
      break;
  }

  arrayOf(event.links).forEach((link) => {
    state.links.set(linkKey(link), clone(link));
  });
  arrayOf(payload.actions).concat(arrayOf(after.nextActionRefs).map((ref) => actionFromRef(ref)))
    .filter(Boolean)
    .forEach((action) => {
      state.actions.set(action.id, compactObject(clone(action)));
    });

  state.timeline.push({
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    observedAt: event.observedAt,
    producer: clone(event.producer),
    subjectRef: subject,
    summary,
    streamId
  });
}

function upsertProcess(state, event, subject, refs, after) {
  const existing = state.processes.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    claimRefs: [],
    gateRefs: [],
    evidenceRefs: [],
    updatedAt: event.occurredAt
  };

  const next = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    startedAt: existing.startedAt || (event.type === "process.started" ? event.occurredAt : undefined),
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.claimRefs = mergeRefs(existing.claimRefs, refs.filter((ref) => ref.product === "surface" && ref.kind === "claim"));
  next.gateRefs = mergeRefs(existing.gateRefs, refs.filter((ref) => ref.product === "flow" && ref.kind === "gate"));
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref) => ref.kind === "evidence"));
  state.processes.set(subject.id, compactObject(next));
}

function upsertGate(state, event, subject, refs, after) {
  const existing = state.gates.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    expectationRefs: [],
    evidenceRefs: [],
    updatedAt: event.occurredAt
  };

  const next = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status: after.status || statusFromGateEvent(event.type) || existing.status,
    processRef: after.processRef || existing.processRef || processRefFromScope(subject.scope),
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.expectationRefs = mergeRefs(existing.expectationRefs, refs.filter((ref) => ref.product === "surface" && ref.kind === "claim"));
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref) => ref.kind === "evidence"));
  state.gates.set(subject.id, compactObject(next));
  updateProcessFromGate(state, event, refs, after, next);
}

function upsertClaim(state, event, subject, refs, after) {
  const existing = state.claims.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    evidenceRefs: [],
    gateRefs: [],
    processRefs: [],
    updatedAt: event.occurredAt
  };

  const next = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status: after.status || existing.status,
    updatedAt: event.occurredAt || existing.updatedAt
  };

  if (!next.lastVerifiedAt && after.freshness && after.freshness.lastCheckedAt) {
    next.lastVerifiedAt = after.freshness.lastCheckedAt;
  }

  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref) => ref.kind === "evidence"));
  next.gateRefs = mergeRefs(existing.gateRefs, refs.filter((ref) => ref.product === "flow" && ref.kind === "gate"));
  next.processRefs = mergeRefs(existing.processRefs, refs.filter((ref) => ref.product === "flow" && ref.kind === "run"));
  state.claims.set(subject.id, compactObject(next));
}

function upsertEvidence(state, event, subject, refs, summary) {
  const existing = state.evidence.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    status: "available",
    capturedAt: event.occurredAt
  };

  const next = {
    ...existing,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status: existing.status || "available",
    capturedAt: existing.capturedAt || event.occurredAt,
    summary: summary || existing.summary,
    claimRefs: mergeRefs(existing.claimRefs, refs.filter((ref) => ref.product === "surface" && ref.kind === "claim")),
    gateRefs: mergeRefs(existing.gateRefs, refs.filter((ref) => ref.product === "flow" && ref.kind === "gate")),
    processRefs: mergeRefs(existing.processRefs, refs.filter((ref) => ref.product === "flow" && ref.kind === "run"))
  };

  state.evidence.set(subject.id, compactObject(next));
}

function upsertLearning(state, event, subject, refs, payload, summary) {
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  if (!summary || !["workflow", "domain"].includes(data.family) || data.nonAuthority !== true) return;

  const id = typeof data.id === "string" && data.id.length > 0
    ? data.id
    : subject.id || event.id;
  const existing = state.learnings.get(id) || {
    id,
    sourceEventId: event.id,
    subjectRef: subject,
    refs: [],
    updatedAt: event.occurredAt
  };
  const sourceRef = data.sourceRef && typeof data.sourceRef === "object" && isRef(data.sourceRef)
    ? clone(data.sourceRef)
    : undefined;
  const next = {
    ...existing,
    id,
    sourceEventId: existing.sourceEventId || event.id,
    sourceRef: sourceRef || existing.sourceRef,
    subjectRef: subject,
    family: data.family,
    nonAuthority: true,
    summary,
    confidence: data.confidence,
    refs: mergeRefs(existing.refs, refs),
    links: mergeLinks(existing.links, arrayOf(event.links).concat(arrayOf(payload.links))),
    updatedAt: event.occurredAt || existing.updatedAt
  };

  state.learnings.set(id, compactObject(next));
}

function updateProcessFromGate(state, event, refs, after, gate) {
  if (!gate.processRef || !gate.processRef.id) return;
  const existing = state.processes.get(gate.processRef.id) || {
    id: gate.processRef.id,
    label: gate.processRef.label,
    sourceRef: gate.processRef,
    claimRefs: [],
    gateRefs: [],
    evidenceRefs: [],
    nextActionRefs: []
  };
  const processPatch = pickProcessPatch(after);
  const next = {
    ...existing,
    ...processPatch,
    id: gate.processRef.id,
    label: gate.processRef.label || existing.label,
    sourceRef: existing.sourceRef || gate.processRef,
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.claimRefs = mergeRefs(existing.claimRefs, refs.filter((ref) => ref.product === "surface" && ref.kind === "claim"));
  next.gateRefs = mergeRefs(existing.gateRefs, [gate.sourceRef]);
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref) => ref.kind === "evidence"));
  next.nextActionRefs = mergeRefs(existing.nextActionRefs, processPatch.nextActionRefs);
  state.processes.set(gate.processRef.id, compactObject(next));
}

function pickProcessPatch(after) {
  const patch = {};
  ["currentStep", "percentComplete", "nextActionRefs"].forEach((key) => {
    if (after[key] !== undefined) patch[key] = clone(after[key]);
  });
  return patch;
}

function actionFromRef(ref) {
  if (!ref || ref.kind !== "action" || !ref.id) return null;
  const action = {
    id: ref.id,
    label: ref.label,
    kind: ref.name && ref.name.startsWith("resume-") ? "resume" : undefined,
    status: "available",
    authority: {
      product: ref.product
    },
    subjectRefs: ref.scope ? [clone(ref.scope)] : undefined
  };
  if (action.kind === "resume" && ref.product === "flow") action.authority.command = "flow.run.resume";
  return action;
}

function describeCurrentStage(state) {
  const waitingGate = state.gates.find((gate) => ["waiting", "open", "routed_back"].includes(gate.status));
  if (waitingGate) {
    const claim = state.claims.find((item) => arrayOf(waitingGate.expectationRefs).some((ref) => ref.id === item.id));
    if (claim) return `Still waiting on ${claim.label || claim.id}.`;
    return `Still waiting on ${waitingGate.label || waitingGate.id}.`;
  }

  const failedGate = state.gates.find((gate) => gate.status === "failed");
  if (failedGate) return `${failedGate.label || failedGate.id} failed.`;

  const passedGate = [...state.gates].reverse().find((gate) => gate.status === "passed");
  if (passedGate) {
    const process = state.processes.find((item) => passedGate.processRef && item.id === passedGate.processRef.id);
    return `${passedGate.label || passedGate.id} passed; ${(process && (process.label || process.id)) || "the process"} can continue.`;
  }

  const activeProcess = state.processes.find((process) => ["running", "active", "waiting"].includes(process.status));
  if (activeProcess) return `${activeProcess.label || activeProcess.id} is ${activeProcess.status}.`;

  return state.timeline.length ? state.timeline[state.timeline.length - 1].summary || "Events replayed." : "No events replayed.";
}

function statusFromGateEvent(type) {
  if (type === "gate.opened") return "waiting";
  if (type === "gate.passed") return "passed";
  if (type === "gate.failed") return "failed";
  if (type === "gate.routed_back") return "routed_back";
  return undefined;
}

function processRefFromScope(scope) {
  if (!scope || scope.kind !== "run" || !scope.id) return undefined;
  return clone(scope);
}

function mergeRefs(existing, refs) {
  const byKey = new Map();
  arrayOf(existing).concat(arrayOf(refs)).forEach((ref) => {
    if (!ref || !ref.id) return;
    byKey.set(refKey(ref), clone(ref));
  });
  return [...byKey.values()].sort(compareRefs);
}

function isRef(ref) {
  return Boolean(ref
    && typeof ref === "object"
    && !Array.isArray(ref)
    && typeof ref.product === "string"
    && ref.product.length > 0
    && typeof ref.kind === "string"
    && ref.kind.length > 0
    && typeof ref.id === "string"
    && ref.id.length > 0);
}

function mergeLinks(existing, links) {
  const byKey = new Map();
  arrayOf(existing).concat(arrayOf(links)).forEach((link) => {
    if (!link) return;
    byKey.set(linkKey(link), clone(link));
  });
  return [...byKey.values()].sort(compareLinks);
}

function refKey(ref) {
  return [ref.product, ref.kind, ref.id].join(":");
}

function linkKey(link) {
  return [
    link && link.from && refKey(link.from),
    link && link.relation,
    link && link.to && refKey(link.to),
    link && link.createdAt
  ].join("|");
}

function compareRefs(left, right) {
  return refKey(left).localeCompare(refKey(right));
}

function compareLinks(left, right) {
  return compareMaybeString(left.createdAt, right.createdAt)
    || compareMaybeString(linkKey(left), linkKey(right));
}

function sortById(items) {
  return items.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function compareMaybeNumber(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftComparable = Number.isFinite(leftNumber);
  const rightComparable = Number.isFinite(rightNumber);
  if (leftComparable && rightComparable && leftNumber !== rightNumber) return leftNumber - rightNumber;
  if (leftComparable !== rightComparable) return leftComparable ? -1 : 1;
  return 0;
}

function compareMaybeString(left, right) {
  if (left && right && left !== right) return String(left).localeCompare(String(right));
  if (left && !right) return -1;
  if (!left && right) return 1;
  return 0;
}

function compactObject(object) {
  const result = {};
  Object.entries(object).forEach(([key, value]) => {
    if (value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    result[key] = value;
  });
  return result;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildCurrentOperatingState
};
