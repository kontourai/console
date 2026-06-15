import type {
  ConsoleActionRecord,
  ConsoleEventRecord,
  ConsoleLink,
  CrossProductRef,
  CurrentOperatingStateOptions,
  JsonObject,
  JsonValue,
  OpenRecord,
  OperatingState,
  ReplayEventEntry,
  ReplayEventStream,
  ReplayInput
} from "./types";

type ReplayObject = JsonObject & { id: string; label?: string; [key: string]: unknown };
type ReplayPatch = OpenRecord;
type CurrentStageState = {
  processes: ReplayObject[];
  gates: ReplayObject[];
  claims: ReplayObject[];
  timeline: JsonObject[];
};
type MutableReplayState = {
  processes: Map<string, ReplayObject>;
  gates: Map<string, ReplayObject>;
  claims: Map<string, ReplayObject>;
  evidence: Map<string, ReplayObject>;
  learnings: Map<string, ReplayObject>;
  inquiries: Map<string, ReplayObject>;
  actions: Map<string, ConsoleActionRecord>;
  links: Map<string, ConsoleLink>;
  timeline: JsonObject[];
  pipeline?: Record<string, unknown>;
};

function buildCurrentOperatingState(input: ReplayInput | ReplayEventStream[] | ConsoleEventRecord[] | null | undefined, options: CurrentOperatingStateOptions = {}): OperatingState {
  const eventStreams = normalizeEventStreams(input);
  const prepared = prepareEvents(eventStreams);
  const generatedAt = options.generatedAt || replayGeneratedAt(prepared.acceptedEvents);
  const state: OperatingState = {
    generatedAt,
    source: {
      mode: "event_replay",
      streamIds: eventStreams.map((stream: ReplayEventStream, index: number) => stream.relativePath || stream.filePath || `stream-${index + 1}`),
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
    inquiries: [],
    actions: [],
    links: [],
    timeline: []
  };

  const working: MutableReplayState = {
    processes: new Map<string, ReplayObject>(),
    gates: new Map<string, ReplayObject>(),
    claims: new Map<string, ReplayObject>(),
    evidence: new Map<string, ReplayObject>(),
    learnings: new Map<string, ReplayObject>(),
    inquiries: new Map<string, ReplayObject>(),
    actions: new Map<string, ConsoleActionRecord>(),
    links: new Map<string, ConsoleLink>(),
    timeline: [],
    pipeline: undefined
  };

  prepared.acceptedEvents.forEach((entry: ReplayEventEntry) => applyEvent(working, entry.event, entry.streamId));

  const processes = sortById([...working.processes.values()]);
  const gates = sortById([...working.gates.values()]);
  const claims = sortById([...working.claims.values()]);
  state.processes = processes;
  state.gates = gates;
  state.claims = claims;
  state.evidence = sortById([...working.evidence.values()]);
  state.learnings = sortById([...working.learnings.values()]);
  state.inquiries = sortById([...working.inquiries.values()]);
  state.actions = sortById([...working.actions.values()]).map((action: ConsoleActionRecord) => ({
    ...action,
    readOnly: true
  }));
  state.links = [...working.links.values()].sort(compareLinks);
  state.timeline = working.timeline;
  if (working.pipeline !== undefined) {
    state.pipeline = working.pipeline;
  }
  state.currentStage = describeCurrentStage({
    processes,
    gates,
    claims,
    timeline: state.timeline
  });

  return state;
}

function normalizeEventStreams(input: ReplayInput | ReplayEventStream[] | ConsoleEventRecord[] | null | undefined): ReplayEventStream[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    if (input.every((item: unknown) => isReplayEventStream(item))) return input as ReplayEventStream[];
    return [{ relativePath: "inline-events", events: input as ConsoleEventRecord[] }];
  }
  if (Array.isArray(input.eventStreams)) return input.eventStreams;
  if (Array.isArray(input.events)) return [{ relativePath: input.relativePath || "inline-events", events: input.events }];
  return [];
}

function isReplayEventStream(value: unknown): value is ReplayEventStream {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ReplayEventStream).events));
}

function prepareEvents(eventStreams: ReplayEventStream[]): { acceptedEvents: ReplayEventEntry[]; duplicateEventCount: number } {
  const seen = new Set();
  const acceptedEvents: ReplayEventEntry[] = [];
  let duplicateEventCount = 0;

  eventStreams.forEach((stream: ReplayEventStream, streamIndex: number) => {
    const streamId = stream.relativePath || stream.filePath || `stream-${streamIndex + 1}`;
    arrayOf<ConsoleEventRecord>(stream.events).forEach((event: ConsoleEventRecord, eventIndex: number) => {
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

function compareEventEntries(left: ReplayEventEntry, right: ReplayEventEntry): number {
  return compareMaybeNumber(left.event.sequence, right.event.sequence)
    || compareMaybeString(left.event.occurredAt, right.event.occurredAt)
    || compareMaybeString(left.event.observedAt, right.event.observedAt)
    || left.streamIndex - right.streamIndex
    || left.eventIndex - right.eventIndex;
}

function replayGeneratedAt(acceptedEvents: ReplayEventEntry[]): string | null {
  if (!acceptedEvents.length) return null;
  const last = acceptedEvents[acceptedEvents.length - 1].event;
  return last.observedAt || last.occurredAt || null;
}

function applyEvent(state: MutableReplayState, event: ConsoleEventRecord, streamId: string): void {
  const subject = clone(event.subject);
  const payload: OpenRecord = event.payload || {};
  const refs = arrayOf<CrossProductRef>(payload.refs);
  const after: ReplayPatch = isPlainObject(payload.after) ? clone(payload.after) : {};
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
    case "inquiry.resolved":
    case "inquiry.mapping.proposed":
    case "inquiry.mapping.reviewed":
      upsertInquiry(state, event, subject, refs, after, summary);
      break;
    case "claim.dispute.resolved":
      upsertClaimDisputeResolved(state, event, subject, refs, after);
      break;
    case "flow.pipeline.snapshot":
      if (isPlainObject(after.pipeline)) {
        state.pipeline = clone(after.pipeline as Record<string, unknown>);
      }
      break;
    default:
      if (typeof event.type === "string" && event.type.startsWith("learning.")) {
        upsertLearning(state, event, subject, refs, payload, summary);
      }
      break;
  }

  arrayOf<ConsoleLink>(event.links).forEach((link: ConsoleLink) => {
    state.links.set(linkKey(link), clone(link));
  });
  if (!isLearningEvent(event)) {
    const actions = [
      ...arrayOf<ConsoleActionRecord>(payload.actions),
      ...arrayOf<CrossProductRef>(after.nextActionRefs).map((ref: CrossProductRef) => actionFromRef(ref))
    ].filter(isConsoleActionRecord);
    actions
      .forEach((action: ConsoleActionRecord) => {
        state.actions.set(action.id, compactObject<ConsoleActionRecord>(clone(action)));
      });
  }

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

function upsertProcess(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch): void {
  const existing: ReplayObject = state.processes.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    claimRefs: [],
    gateRefs: [],
    evidenceRefs: [],
    updatedAt: event.occurredAt
  };

  const next: ReplayObject = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    startedAt: existing.startedAt || (event.type === "process.started" ? event.occurredAt : undefined),
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.claimRefs = mergeRefs(existing.claimRefs, refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim"));
  next.gateRefs = mergeRefs(existing.gateRefs, refs.filter((ref: CrossProductRef) => ref.product === "flow" && ref.kind === "gate"));
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref: CrossProductRef) => ref.kind === "evidence"));
  state.processes.set(subject.id, compactObject(next));
}

function upsertGate(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch): void {
  const existing: ReplayObject = state.gates.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    expectationRefs: [],
    evidenceRefs: [],
    updatedAt: event.occurredAt
  };

  const next: ReplayObject = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status: after.status || statusFromGateEvent(event.type) || existing.status,
    processRef: after.processRef || existing.processRef || processRefFromScope(subject.scope),
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.expectationRefs = mergeRefs(existing.expectationRefs, refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim"));
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref: CrossProductRef) => ref.kind === "evidence"));
  state.gates.set(subject.id, compactObject(next));
  updateProcessFromGate(state, event, refs, after, next);
}

function upsertClaim(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch): void {
  const existing: ReplayObject = state.claims.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    evidenceRefs: [],
    gateRefs: [],
    processRefs: [],
    updatedAt: event.occurredAt
  };

  const next: ReplayObject = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status: after.status || existing.status,
    updatedAt: event.occurredAt || existing.updatedAt
  };

  const freshness = isPlainObject(after.freshness) ? after.freshness : {};
  if (!next.lastVerifiedAt && freshness.lastCheckedAt) {
    next.lastVerifiedAt = freshness.lastCheckedAt;
  }

  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref: CrossProductRef) => ref.kind === "evidence"));
  next.gateRefs = mergeRefs(existing.gateRefs, refs.filter((ref: CrossProductRef) => ref.product === "flow" && ref.kind === "gate"));
  next.processRefs = mergeRefs(existing.processRefs, refs.filter((ref: CrossProductRef) => ref.product === "flow" && ref.kind === "run"));
  state.claims.set(subject.id, compactObject(next));
}

function upsertEvidence(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], summary: unknown): void {
  const existing: ReplayObject = state.evidence.get(subject.id) || {
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
    claimRefs: mergeRefs(existing.claimRefs, refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim")),
    gateRefs: mergeRefs(existing.gateRefs, refs.filter((ref: CrossProductRef) => ref.product === "flow" && ref.kind === "gate")),
    processRefs: mergeRefs(existing.processRefs, refs.filter((ref: CrossProductRef) => ref.product === "flow" && ref.kind === "run"))
  };

  state.evidence.set(subject.id, compactObject(next));
}

function upsertInquiry(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch, summary: unknown): void {
  // Console folds inquiry records as append-only testimony. It accumulates counts
  // and links but never recomputes outcomes. Surface is the authority for resolution.
  const existing: ReplayObject = state.inquiries.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    claimRefs: [],
    ruleRefs: []
  };

  // Only inquiry.resolved events carry the inquiry resolution outcome (matched/derived/unsupported).
  // inquiry.mapping.proposed and inquiry.mapping.reviewed carry the mapping/review outcome,
  // not the inquiry resolution outcome. Never overwrite the resolution outcome from those events.
  const isResolutionEvent = event.type === "inquiry.resolved";
  const outcome = isResolutionEvent
    ? ((after.outcome as string | undefined) || (existing.outcome as string | undefined) || "unsupported")
    : (existing.outcome as string | undefined) || "unsupported";
  const next: ReplayObject = {
    ...existing,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    outcome,
    asker: (after.asker as string | undefined) || (existing.asker as string | undefined),
    statusFunctionVersion: (after.statusFunctionVersion as string | undefined) || (existing.statusFunctionVersion as string | undefined),
    resolvedAt: (existing.resolvedAt as string | undefined) || (isResolutionEvent ? event.occurredAt : undefined)
  };

  // For inquiry.resolved: fold claim refs (matched/derived) and rule refs (derived).
  // Console stores these for cross-product navigation only — it does not re-derive status.
  next.claimRefs = mergeRefs(
    existing.claimRefs,
    refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim")
  );
  next.ruleRefs = mergeRefs(
    existing.ruleRefs,
    refs.filter((ref: CrossProductRef) => ref.kind === "rule" || ref.kind === "derivation_rule")
  );

  state.inquiries.set(subject.id, compactObject(next));
}

function upsertClaimDisputeResolved(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch): void {
  // claim.dispute.resolved is an append-only verification event in Surface's ledger.
  // Console folds it as a decision record for timeline and navigation.
  // The resulting claim status update arrives through a separate claim.status.changed event.
  // Do not attempt to update claim status here — Surface is the authority.
  const decisionId = `decision-dispute-${subject.id}-${event.occurredAt}`;
  const decision: ReplayObject = {
    id: decisionId,
    label: `Dispute resolved: ${subject.label || subject.id}`,
    sourceRef: subject,
    kind: "dispute_resolution",
    decidedAt: event.occurredAt,
    subjectRefs: [subject, ...refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim")],
    resolvedStatus: after.resolvedStatus || after.status
  };
  // Store as an action-queue note only; the dispute decision projection lives in decisions[]
  // which are projection-only objects emitted directly by producers, not folded from events here.
  // We keep the inquiry record updated if the dispute resolves an inquiry-related claim.
  refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "inquiry").forEach((inquiryRef: CrossProductRef) => {
    const existing = state.inquiries.get(inquiryRef.id);
    if (existing) {
      state.inquiries.set(inquiryRef.id, compactObject({
        ...existing,
        claimRefs: mergeRefs(existing.claimRefs, refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim"))
      }));
    }
  });
  // Surface-owned decision; Console records the id for timeline reference
  void decision;
}

function upsertLearning(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], payload: OpenRecord, summary: unknown): void {
  const data: OpenRecord = isPlainObject(payload.data) ? payload.data : {};
  if (!summary || typeof data.family !== "string" || !["workflow", "domain"].includes(data.family) || data.nonAuthority !== true) return;

  const id = typeof data.id === "string" && data.id.length > 0
    ? data.id
    : subject.id || event.id;
  const existing: ReplayObject = state.learnings.get(id) || {
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

function isLearningEvent(event: { type?: unknown }): boolean {
  return typeof event.type === "string" && event.type.startsWith("learning.");
}

function updateProcessFromGate(state: MutableReplayState, event: ConsoleEventRecord, refs: CrossProductRef[], after: ReplayPatch, gate: ReplayObject): void {
  const processRef = gate.processRef as CrossProductRef | undefined;
  if (!processRef || !processRef.id) return;
  const existing: ReplayObject = state.processes.get(processRef.id) || {
    id: processRef.id,
    label: processRef.label,
    sourceRef: processRef,
    claimRefs: [],
    gateRefs: [],
    evidenceRefs: [],
    nextActionRefs: []
  };
  const processPatch = pickProcessPatch(after);
  const next: ReplayObject = {
    ...existing,
    ...processPatch,
    id: processRef.id,
    label: processRef.label || existing.label,
    sourceRef: existing.sourceRef || processRef,
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.claimRefs = mergeRefs(existing.claimRefs, refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim"));
  next.gateRefs = mergeRefs(existing.gateRefs, isRef(gate.sourceRef) ? [gate.sourceRef] : []);
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref: CrossProductRef) => ref.kind === "evidence"));
  next.nextActionRefs = mergeRefs(existing.nextActionRefs, processPatch.nextActionRefs);
  state.processes.set(processRef.id, compactObject(next));
}

function pickProcessPatch(after: ReplayPatch): ReplayPatch {
  const patch: ReplayPatch = {};
  ["currentStep", "percentComplete", "nextActionRefs"].forEach((key: string) => {
    if (after[key] !== undefined) patch[key] = clone(after[key]);
  });
  return patch;
}

function actionFromRef(ref: CrossProductRef): ConsoleActionRecord | null {
  if (!ref || ref.kind !== "action" || !ref.id) return null;
  const action: ConsoleActionRecord = {
    id: ref.id,
    label: ref.label,
    kind: ref.name && ref.name.startsWith("resume-") ? "resume" : undefined,
    status: "available",
    authority: {
      product: ref.product
    },
    subjectRefs: isRef(ref.scope) ? [clone(ref.scope)] : undefined
  };
  if (action.kind === "resume" && ref.product === "flow" && action.authority) action.authority.command = "flow.run.resume";
  return action;
}

function describeCurrentStage(state: CurrentStageState): string {
  const waitingGate = state.gates.find((gate: ReplayObject) => ["waiting", "open", "routed_back"].includes(String(gate.status)));
  if (waitingGate) {
    const claim = state.claims.find((item: ReplayObject) => arrayOf<CrossProductRef>(waitingGate.expectationRefs).some((ref: CrossProductRef) => ref.id === item.id));
    if (claim) return `Still waiting on ${claim.label || claim.id}.`;
    return `Still waiting on ${waitingGate.label || waitingGate.id}.`;
  }

  const failedGate = state.gates.find((gate: ReplayObject) => gate.status === "failed");
  if (failedGate) return `${failedGate.label || failedGate.id} failed.`;

  const passedGate = [...state.gates].reverse().find((gate: ReplayObject) => gate.status === "passed");
  if (passedGate) {
    const processRef = passedGate.processRef as CrossProductRef | undefined;
    const process = state.processes.find((item: ReplayObject) => processRef && item.id === processRef.id);
    return `${passedGate.label || passedGate.id} passed; ${(process && (process.label || process.id)) || "the process"} can continue.`;
  }

  const activeProcess = state.processes.find((process: ReplayObject) => ["running", "active", "waiting"].includes(String(process.status)));
  if (activeProcess) return `${activeProcess.label || activeProcess.id} is ${activeProcess.status}.`;

  const latestAuthoritativeEvent = [...state.timeline].reverse().find((item: JsonObject) => !isLearningEvent(item));
  if (latestAuthoritativeEvent) return String(latestAuthoritativeEvent.summary || "Events replayed.");
  return state.timeline.length ? "No authoritative events replayed." : "No events replayed.";
}

function statusFromGateEvent(type: string): string | undefined {
  if (type === "gate.opened") return "waiting";
  if (type === "gate.passed") return "passed";
  if (type === "gate.failed") return "failed";
  if (type === "gate.routed_back") return "routed_back";
  return undefined;
}

function processRefFromScope(scope: unknown): CrossProductRef | undefined {
  if (!isRef(scope) || scope.kind !== "run") return undefined;
  return clone(scope);
}

function mergeRefs(existing: unknown, refs: unknown): CrossProductRef[] {
  const byKey = new Map<string, CrossProductRef>();
  arrayOf<CrossProductRef>(existing).concat(arrayOf<CrossProductRef>(refs)).forEach((ref: CrossProductRef) => {
    if (!ref || !ref.id) return;
    byKey.set(refKey(ref), clone(ref));
  });
  return [...byKey.values()].sort(compareRefs);
}

function isRef(ref: unknown): ref is CrossProductRef {
  const candidate = ref as Partial<CrossProductRef> | undefined;
  return Boolean(ref
    && typeof ref === "object"
    && !Array.isArray(ref)
    && typeof candidate?.product === "string"
    && candidate.product.length > 0
    && typeof candidate.kind === "string"
    && candidate.kind.length > 0
    && typeof candidate.id === "string"
    && candidate.id.length > 0);
}

function mergeLinks(existing: unknown, links: unknown): ConsoleLink[] {
  const byKey = new Map<string, ConsoleLink>();
  arrayOf<ConsoleLink>(existing).concat(arrayOf<ConsoleLink>(links)).forEach((link: ConsoleLink) => {
    if (!link) return;
    byKey.set(linkKey(link), clone(link));
  });
  return [...byKey.values()].sort(compareLinks);
}

function refKey(ref: CrossProductRef): string {
  return [ref.product, ref.kind, ref.id].join(":");
}

function linkKey(link: ConsoleLink): string {
  return [
    link && link.from && refKey(link.from),
    link && link.relation,
    link && link.to && refKey(link.to),
    link && link.createdAt
  ].join("|");
}

function compareRefs(left: CrossProductRef, right: CrossProductRef): number {
  return refKey(left).localeCompare(refKey(right));
}

function compareLinks(left: ConsoleLink, right: ConsoleLink): number {
  return compareMaybeString(left.createdAt, right.createdAt)
    || compareMaybeString(linkKey(left), linkKey(right));
}

function sortById<T extends { id?: unknown }>(items: T[]): T[] {
  return items.sort((left: T, right: T) => String(left.id).localeCompare(String(right.id)));
}

function compareMaybeNumber(left: unknown, right: unknown): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftComparable = Number.isFinite(leftNumber);
  const rightComparable = Number.isFinite(rightNumber);
  if (leftComparable && rightComparable && leftNumber !== rightNumber) return leftNumber - rightNumber;
  if (leftComparable !== rightComparable) return leftComparable ? -1 : 1;
  return 0;
}

function compareMaybeString(left: unknown, right: unknown): number {
  if (left && right && left !== right) return String(left).localeCompare(String(right));
  if (left && !right) return -1;
  if (!left && right) return 1;
  return 0;
}

function compactObject<T extends OpenRecord>(object: T): T {
  const result: OpenRecord = {};
  Object.entries(object).forEach(([key, value]) => {
    if (value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    result[key] = value;
  });
  return result as T;
}

function clone<T>(value: T): T;
function clone<T>(value: T | undefined): T | undefined;
function clone<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function arrayOf<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function isPlainObject(value: unknown): value is OpenRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isConsoleActionRecord(value: ConsoleActionRecord | null): value is ConsoleActionRecord {
  return Boolean(value && typeof value.id === "string" && value.id.length > 0);
}

module.exports = {
  buildCurrentOperatingState
};
