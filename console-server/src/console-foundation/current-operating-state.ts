import type {
  ConsoleActionRecord,
  ConsoleEventRecord,
  ConsoleLink,
  ConsoleLivenessRecord,
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
import { compareLivenessOrder, isLivenessRecord, livenessSessionKey, parseCanonicalLivenessAt, DEFAULT_LIVENESS_TTL_SECONDS, MAX_LIVENESS_TTL_SECONDS } from "./liveness";

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
  /** Currently-active (actor, subjectId) liveness holders — flow-agents #295. */
  actors: Map<string, ReplayObject>;
};

function buildCurrentOperatingState(input: ReplayInput | ReplayEventStream[] | ConsoleEventRecord[] | null | undefined, options: CurrentOperatingStateOptions = {}): OperatingState {
  const eventStreams = normalizeEventStreams(input);
  const prepared = prepareEvents(eventStreams);
  const working = createMutableReplayState();
  prepared.acceptedEvents.forEach((entry: ReplayEventEntry) => applyEvent(working, entry.event, entry.streamId, resolveNowMs(options.now)));
  const lastEntry = prepared.acceptedEvents[prepared.acceptedEvents.length - 1];
  return materializeOperatingState(working, {
    streamIds: eventStreams.map((stream: ReplayEventStream, index: number) => stream.relativePath || stream.filePath || `stream-${index + 1}`),
    acceptedEventCount: prepared.acceptedEvents.length,
    duplicateEventCount: prepared.duplicateEventCount,
    lastAcceptedEventId: lastEntry ? lastEntry.event.id ?? null : null,
    generatedAt: replayGeneratedAt(prepared.acceptedEvents)
  }, options);
}

function createMutableReplayState(): MutableReplayState {
  return {
    processes: new Map<string, ReplayObject>(),
    gates: new Map<string, ReplayObject>(),
    claims: new Map<string, ReplayObject>(),
    evidence: new Map<string, ReplayObject>(),
    learnings: new Map<string, ReplayObject>(),
    inquiries: new Map<string, ReplayObject>(),
    actions: new Map<string, ConsoleActionRecord>(),
    links: new Map<string, ConsoleLink>(),
    timeline: [],
    pipeline: undefined,
    actors: new Map<string, ReplayObject>()
  };
}

interface OperatingStateMeta {
  streamIds: string[];
  acceptedEventCount: number;
  duplicateEventCount: number;
  lastAcceptedEventId: string | null;
  generatedAt: string | null;
}

function materializeOperatingState(working: MutableReplayState, meta: OperatingStateMeta, options: CurrentOperatingStateOptions): OperatingState {
  const state: OperatingState = {
    generatedAt: options.generatedAt || meta.generatedAt,
    source: {
      mode: "event_replay",
      streamIds: meta.streamIds,
      acceptedEventCount: meta.acceptedEventCount,
      duplicateEventCount: meta.duplicateEventCount,
      lastAcceptedEventId: meta.lastAcceptedEventId
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
    timeline: [],
    actors: [],
    reclaimableActors: []
  };

  const processes = sortById([...working.processes.values()]);
  const gates = sortById([...working.gates.values()]);
  const claims = sortById([...working.claims.values()]);
  state.processes = processes;
  state.gates = gates;
  state.claims = claims;
  state.evidence = sortById([...working.evidence.values()]);
  state.learnings = sortById([...working.learnings.values()]);
  state.inquiries = sortById([...working.inquiries.values()]);
  // Liveness actors are partitioned at READ time (not via a stored sweep).
  // Deriving freshness/reclaimability here keeps stored state a pure fold and
  // makes transitions deterministic under an injected clock.
  const nowMs = resolveNowMs(options.now);
  const actors: ReplayObject[] = [];
  const reclaimableActors: ReplayObject[] = [];
  for (const actor of working.actors.values()) {
    if (actor._livenessType === "release") continue;
    const livenessState = classifyActorLiveness(actor, nowMs);
    if (livenessState === "fresh") actors.push(publicActor(actor));
    if (livenessState === "reclaimable") reclaimableActors.push(publicActor(actor));
  }
  state.actors = sortById(actors);
  state.reclaimableActors = sortById(reclaimableActors);
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

interface OperatingStateProjection {
  apply(event: ConsoleEventRecord | ConsoleLivenessRecord, streamId?: string): void;
  materialize(options?: CurrentOperatingStateOptions): OperatingState;
  wouldAdvanceLiveness(event: ConsoleLivenessRecord, options?: CurrentOperatingStateOptions): boolean;
}

// Incremental projection: maintain the folded operating state as events arrive
// instead of re-folding the full event history on every read. The hosted Postgres
// hub uses this so memory and per-request cost scale with current state rather
// than total history (ops#34) — it no longer retains every raw event record nor
// rebuilds from scratch on each /state call.
//
// Parity contract: callers must apply events in the order prepareEvents would sort
// them into (by sequence asc, then occurredAt/observedAt). The hub satisfies this —
// it cold-loads `order by sequence asc` and appends monotonically — so a projection
// fed the hub's events produces the same OperatingState as buildCurrentOperatingState
// over the same events (verified by tests/current-operating-state-projection.test.ts).
function createOperatingStateProjection(defaultStreamId: string = "inline-events", maintenanceOptions: CurrentOperatingStateOptions = {}): OperatingStateProjection {
  const working = createMutableReplayState();
  const seen = new Set<string>();
  const streamIds = new Set<string>();
  let acceptedEventCount = 0;
  let duplicateEventCount = 0;
  let lastAcceptedEventId: string | null = null;
  let generatedAt: string | null = null;

  return {
    apply(event: ConsoleEventRecord | ConsoleLivenessRecord, streamId: string = defaultStreamId): void {
      if (!event || typeof event !== "object") return;
      streamIds.add(streamId);
      // Liveness records share ONE id per (actor, subjectId) session by design
      // (current-state, not an event log). They must therefore bypass id-based
      // dedup — a heartbeat/release carrying the same id as its claim is a state
      // UPDATE to fold, not a duplicate to drop. applyLivenessEvent is an
      // idempotent upsert, so re-folding the same record is harmless.
      if (!isLivenessRecord(event)) {
        if (event.id && seen.has(event.id)) {
          duplicateEventCount += 1;
          return;
        }
        if (event.id) seen.add(event.id);
      }
      applyEvent(working, event, streamId, resolveNowMs(maintenanceOptions.now));
      acceptedEventCount += 1;
      lastAcceptedEventId = event.id ?? null;
      generatedAt = recordTimestamp(event) || null;
    },
    materialize(options: CurrentOperatingStateOptions = {}): OperatingState {
      return materializeOperatingState(working, {
        streamIds: [...streamIds],
        acceptedEventCount,
        duplicateEventCount,
        lastAcceptedEventId,
        generatedAt
      }, options);
    },
    wouldAdvanceLiveness(event: ConsoleLivenessRecord, options: CurrentOperatingStateOptions = {}): boolean {
      pruneLivenessTombstones(working, resolveNowMs(options.now ?? maintenanceOptions.now));
      return wouldAdvanceLivenessEvent(working, event);
    }
  };
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
    arrayOf<ConsoleEventRecord | ConsoleLivenessRecord>(stream.events).forEach((event: ConsoleEventRecord | ConsoleLivenessRecord, eventIndex: number) => {
      if (!event || typeof event !== "object") return;
      // Liveness records share one id per session — they are folded as state
      // updates, not deduplicated (mirrors the incremental projection's apply()).
      if (!isLivenessRecord(event)) {
        if (event.id && seen.has(event.id)) {
          duplicateEventCount += 1;
          return;
        }
        if (event.id) seen.add(event.id);
      }
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
  return recordTimestamp(last) || null;
}

/**
 * Best-available timestamp for either record shape: a `kontour.console.event`
 * carries `observedAt`/`occurredAt`; a `kontour.console.liveness` record
 * carries only `at`. Reading through the union's catch-all index signature
 * directly (`event.observedAt`) widens to `unknown` and breaks inference at
 * call sites, so this centralizes the cast.
 */
function recordTimestamp(record: ConsoleEventRecord | ConsoleLivenessRecord): string | undefined {
  const open = record as unknown as OpenRecord;
  const value = open.observedAt || open.occurredAt || open.at;
  return typeof value === "string" ? value : undefined;
}

function applyEvent(state: MutableReplayState, event: ConsoleEventRecord | ConsoleLivenessRecord, streamId: string, nowMs: number): void {
  // Liveness (flow-agents #295) is a flat claim/heartbeat/release fact about one
  // (actor, subjectId) pair — it has no subject/payload/producer envelope, so it
  // is folded by a wholly separate function rather than falling through the
  // ConsoleEventRecord-shaped switch below. This is deliberately NOT folded into
  // the existing `claim.*` cases: those model Surface's verification claims
  // (freshness/outcome/evidence) — an unrelated domain that happens to share the
  // word "claim". Conflating the two would corrupt state.claims with a
  // heterogeneous shape and break the UI's claim rendering assumptions.
  if (isLivenessRecord(event)) {
    applyLivenessEvent(state, event, streamId, nowMs);
    return;
  }

  const subject = clone(event.subject);
  const payload: OpenRecord = event.payload || {};
  const refs = arrayOf<CrossProductRef>(payload.refs);
  const after: ReplayPatch = isPlainObject(payload.after) ? clone(payload.after) : {};
  const summary = payload.summary || event.summary;
  // console#229: the generic ConsoleEventPayload.reason carries WHY a process
  // is blocked/needs_input/review_pending (docs/specs/projection-schema.md,
  // "Event Payload"). It folds into ConsoleProcess.blockedReason below.
  const reason = typeof payload.reason === "string" ? payload.reason : undefined;

  switch (event.type) {
    case "process.started":
    case "process.progressed":
    // console#229 (review HIGH): these lifecycle events used to fall through
    // to the default no-op case, so a process.blocked/paused/resumed/completed
    // event never touched state.processes — status stayed stale at whatever
    // process.started/progressed last set (a replay probe proved status stuck
    // at "running" after a process.blocked event). Fold them the same way,
    // with a type-derived status fallback (mirrors statusFromGateEvent below)
    // for producers that only send the event type without an explicit
    // payload.after.status.
    case "process.paused":
    case "process.resumed":
    case "process.blocked":
    case "process.completed":
      upsertProcess(state, event, subject, refs, after, reason);
      break;
    case "gate.opened":
    case "gate.passed":
    case "gate.failed":
    case "gate.routed_back":
      upsertGate(state, event, subject, refs, after);
      break;
    // console#254 review HIGH finding 1: a dedicated event type for
    // ASSOCIATION-ONLY gate producers (Surface trust reporting has no native
    // "gate" concept and never computes a Flow-style pass/fail/open verdict
    // for one -- see workflow-trust-bridge.ts's `gateEnrichedEvent`). Routed
    // through the SAME `upsertGate` upsert pattern (evidenceRefs/
    // expectationRefs still fold identically) but with the type-derived
    // status fallback explicitly disabled, so relaying evidence associations
    // can never fabricate a status Surface itself never asserted.
    case "gate.enriched":
      upsertGate(state, event, subject, refs, after, { applyTypeStatusFallback: false });
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

function upsertProcess(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch, reason?: string): void {
  const existing: ReplayObject = state.processes.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    claimRefs: [],
    gateRefs: [],
    evidenceRefs: [],
    updatedAt: event.occurredAt
  };

  // Explicit payload.after.status wins (covers needs_input/review_pending,
  // which have no dedicated event type — console#229); otherwise fall back to
  // a type-derived status so a bare process.blocked/paused/resumed/completed
  // event still advances status. Mirrors statusFromGateEvent's precedence.
  const status = (typeof after.status === "string" && after.status)
    || statusFromProcessEvent(event.type)
    || existing.status;

  const next: ReplayObject = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status,
    // console#229 (review HIGH): blockedReason must not survive a transition
    // out of a blocked-like status — otherwise a resumed/completed process
    // keeps showing a stale "why it was stuck" reason. `undefined` here is
    // deliberate: compactObject() below drops undefined keys, actually
    // deleting the field (a JSON `null` can't express deletion and would
    // fail validateProjection's "expected a string when present" check).
    blockedReason: isBlockedLikeProcessStatus(status)
      ? ((typeof after.blockedReason === "string" && after.blockedReason) || reason || existing.blockedReason)
      : undefined,
    startedAt: existing.startedAt || (event.type === "process.started" ? event.occurredAt : undefined),
    updatedAt: event.occurredAt || existing.updatedAt
  };

  next.claimRefs = mergeRefs(existing.claimRefs, refs.filter((ref: CrossProductRef) => ref.product === "surface" && ref.kind === "claim"));
  next.gateRefs = mergeRefs(existing.gateRefs, refs.filter((ref: CrossProductRef) => ref.product === "flow" && ref.kind === "gate"));
  next.evidenceRefs = mergeRefs(existing.evidenceRefs, refs.filter((ref: CrossProductRef) => ref.kind === "evidence"));
  state.processes.set(subject.id, compactObject(next));
}

/**
 * Type-derived fallback status for process lifecycle events (console#229),
 * used only when a producer omits an explicit `payload.after.status`. Mirrors
 * `statusFromGateEvent`'s precedence pattern for gates. `process.blocked`
 * defaults to the generic "blocked" — the interactive `needs_input` /
 * `review_pending` states have no dedicated event type and require an
 * explicit `payload.after.status` (docs/specs/projection-schema.md).
 */
function statusFromProcessEvent(type: string): string | undefined {
  if (type === "process.paused") return "paused";
  if (type === "process.resumed") return "running";
  if (type === "process.blocked") return "blocked";
  if (type === "process.completed") return "completed";
  return undefined;
}

/** console#229: statuses for which a `blockedReason` is meaningful and retained. */
const BLOCKED_LIKE_PROCESS_STATUSES = new Set(["blocked", "needs_input", "review_pending", "waiting", "paused"]);

function isBlockedLikeProcessStatus(status: unknown): boolean {
  return typeof status === "string" && BLOCKED_LIKE_PROCESS_STATUSES.has(status);
}

interface UpsertGateOptions {
  /**
   * When false, `statusFromGateEvent`'s type-derived status fallback is
   * skipped entirely (console#254 review HIGH finding 1): an
   * ASSOCIATION-ONLY producer -- one that relays evidence/expectation refs
   * for a gate without ever computing a pass/fail/open verdict itself (e.g.
   * flow-agents' workflow-trust bridge, `gate.enriched` below) -- must not
   * have this fold SILENTLY MATERIALIZE a fabricated "waiting" status just
   * because its event type happens to share the gate.* upsert path. Default
   * true preserves the existing gate.opened/passed/failed/routed_back
   * behavior unchanged.
   */
  applyTypeStatusFallback?: boolean;
}

function upsertGate(state: MutableReplayState, event: ConsoleEventRecord, subject: CrossProductRef, refs: CrossProductRef[], after: ReplayPatch, options: UpsertGateOptions = {}): void {
  const existing: ReplayObject = state.gates.get(subject.id) || {
    id: subject.id,
    label: subject.label,
    sourceRef: subject,
    expectationRefs: [],
    evidenceRefs: [],
    updatedAt: event.occurredAt
  };

  const applyTypeStatusFallback = options.applyTypeStatusFallback !== false;
  const typeStatus = applyTypeStatusFallback ? statusFromGateEvent(event.type) : undefined;
  const next: ReplayObject = {
    ...existing,
    ...after,
    id: subject.id,
    label: subject.label || existing.label,
    sourceRef: subject,
    status: after.status || typeStatus || existing.status,
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

/**
 * Fold one `kontour.console.liveness` claim/heartbeat/release record into
 * `state.actors` — the currently-active (actor, subjectId) holders (flow-agents
 * #295). Tenant isolation needs no bespoke logic here: each tenant gets its own
 * MutableReplayState (one per hub instance, keyed by tenant — see
 * hostedHubForTenant in console-hub-server.ts), so actors from one tenant can
 * never appear in another tenant's projection.
 *
 * - claim / heartbeat: upsert-create-or-refresh the (actor, subjectId) entry
 *   (a lone heartbeat with no preceding claim — which is exactly what a cold
 *   Postgres replay sees, since the heartbeat row overwrote the claim row —
 *   still reconstructs an ACTIVE actor), refreshing `lastSeenAt` and carrying
 *   forward ttlSeconds/host/branch/artifactDir when the newer event omits them.
 * - release: retain a timestamped tombstone internally, excluded from the
 *   public actors array, until its stale-event safety window expires.
 *
 * The map key is the shared, colon-safe `livenessSessionKey` — the SAME derivation
 * the persisted record id uses — so an in-memory slot and its Postgres row can
 * never disagree, and a `subjectId` containing a `:` can never collide two pairs.
 */
function applyLivenessEvent(state: MutableReplayState, event: ConsoleLivenessRecord, streamId: string, nowMs: number): void {
  const actor = typeof event.actor === "string" ? event.actor : "";
  const subjectId = typeof event.subjectId === "string" ? event.subjectId : "";
  if (!actor || !subjectId) return;

  const key = livenessSessionKey(actor, subjectId);
  const lastSeenAt = typeof event.at === "string" ? event.at : undefined;

  pruneLivenessTombstones(state, nowMs);
  const existing = state.actors.get(key);
  const atMs = parseCanonicalLivenessAt(event.at);
  if (atMs === undefined) {
    if (!existing && event.type !== "release") {
      state.actors.set(key, compactObject({ id: key, actor, subjectId, status: "active", lastSeenAt, updatedAt: lastSeenAt }));
    }
  } else if (event.type === "release") {
    applyLivenessRelease(state, key, existing, event, actor, subjectId, lastSeenAt, atMs, nowMs);
  } else {
    applyLivenessActive(state, key, existing, event, actor, subjectId, lastSeenAt, atMs);
  }

  state.timeline.push({
    id: event.id,
    type: `liveness.${event.type}`,
    occurredAt: lastSeenAt,
    observedAt: lastSeenAt,
    producer: { product: "flow-agents", name: actor },
    subjectRef: { product: "flow", kind: "session", id: subjectId },
    summary: `${actor} ${event.type === "release" ? "released" : event.type === "heartbeat" ? "heartbeat on" : "claimed"} ${subjectId}`,
    streamId
  });
}

const LIVENESS_METADATA_FIELDS = [
  ["ttlSeconds", "ttlSeconds"],
  ["actor_key", "actorKey"],
  ["host", "host"],
  ["branch", "branch"],
  ["artifact_dir", "artifactDir"]
] as const;

type LivenessMetadataProvenance = Record<string, { atMs: number; value: unknown }>;

function applyLivenessRelease(
  state: MutableReplayState,
  key: string,
  existing: ReplayObject | undefined,
  event: ConsoleLivenessRecord,
  actor: string,
  subjectId: string,
  lastSeenAt: string | undefined,
  atMs: number,
  nowMs: number
): void {
  const priorReleaseAtMs = numberField(existing, "_livenessReleaseAtMs");
  if (priorReleaseAtMs !== undefined && atMs <= priorReleaseAtMs) return;
  const winnerAtMs = numberField(existing, "_livenessAtMs");
  const metadata = metadataAfterRelease(existing, atMs);
  const ownership = compareLivenessOrder(atMs, event.type, winnerAtMs, existing?._livenessType);
  if (ownership <= 0 && existing?._livenessType !== "release") {
    state.actors.set(key, withLivenessMetadata({
      ...existing!,
      _livenessReleaseAtMs: atMs
    }, metadata));
    return;
  }
  state.actors.set(key, compactObject({
    id: key,
    actor,
    subjectId,
    status: "released",
    lastSeenAt,
    updatedAt: lastSeenAt,
    ttlSeconds: effectiveLivenessTtl(event.ttlSeconds),
    _livenessType: "release",
    _livenessAtMs: atMs,
    _livenessReleaseAtMs: atMs,
    _livenessObservedAtMs: nowMs,
    _livenessMetadata: metadata
  }));
}

function applyLivenessActive(
  state: MutableReplayState,
  key: string,
  existing: ReplayObject | undefined,
  event: ConsoleLivenessRecord,
  actor: string,
  subjectId: string,
  lastSeenAt: string | undefined,
  atMs: number
): void {
  const releaseAtMs = numberField(existing, "_livenessReleaseAtMs");
  if (releaseAtMs !== undefined && atMs <= releaseAtMs) return;
  const winnerAtMs = numberField(existing, "_livenessAtMs");
  const metadata = mergeLivenessMetadata(existing, event, atMs, releaseAtMs);
  const winner = compareLivenessOrder(atMs, event.type, winnerAtMs, existing?._livenessType) > 0
    ? { id: key, actor, subjectId, status: "active", lastSeenAt, updatedAt: lastSeenAt, _livenessType: event.type, _livenessAtMs: atMs, _livenessReleaseAtMs: releaseAtMs }
    : existing!;
  state.actors.set(key, withLivenessMetadata(winner, metadata));
}

function mergeLivenessMetadata(existing: ReplayObject | undefined, event: ConsoleLivenessRecord, atMs: number, releaseAtMs: number | undefined): LivenessMetadataProvenance {
  const metadata: LivenessMetadataProvenance = { ...((existing?._livenessMetadata as LivenessMetadataProvenance | undefined) || {}) };
  for (const [source, target] of LIVENESS_METADATA_FIELDS) {
    const rawValue = event[source];
    const value = target === "ttlSeconds" && rawValue !== undefined && rawValue !== null
      ? effectiveLivenessTtl(rawValue)
      : rawValue;
    if (value === undefined || value === null || (releaseAtMs !== undefined && atMs <= releaseAtMs)) continue;
    const prior = metadata[target];
    if (!prior || atMs > prior.atMs) metadata[target] = { atMs, value };
  }
  return metadata;
}

function metadataAfterRelease(existing: ReplayObject | undefined, releaseAtMs: number): LivenessMetadataProvenance {
  const metadata = (existing?._livenessMetadata as LivenessMetadataProvenance | undefined) || {};
  return Object.fromEntries(Object.entries(metadata).filter(([, candidate]) => candidate.atMs > releaseAtMs));
}

function withLivenessMetadata(actor: ReplayObject, metadata: LivenessMetadataProvenance): ReplayObject {
  const next: ReplayObject = { ...actor, _livenessMetadata: metadata };
  for (const [, target] of LIVENESS_METADATA_FIELDS) delete next[target];
  for (const [target, candidate] of Object.entries(metadata)) next[target] = candidate.value;
  return compactObject(next);
}

function numberField(object: ReplayObject | undefined, field: string): number | undefined {
  const value = object && object[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Strict parseable-at-newest ordering; malformed incoming timestamps are oldest. */
function wouldAdvanceLivenessEvent(state: MutableReplayState, event: ConsoleLivenessRecord): boolean {
  const actor = typeof event.actor === "string" ? event.actor : "";
  const subjectId = typeof event.subjectId === "string" ? event.subjectId : "";
  const incomingAtMs = parseCanonicalLivenessAt(event.at);
  if (!actor || !subjectId) return false;
  const existing = state.actors.get(livenessSessionKey(actor, subjectId));
  // A malformed event is the oldest possible value: it may establish a
  // fail-closed active entry when no winner exists, but never a tombstone and
  // never displaces any existing state.
  if (!existing) return incomingAtMs !== undefined || event.type !== "release";
  if (incomingAtMs === undefined) return false;
  const existingAtMs = numberField(existing, "_livenessAtMs");
  return compareLivenessOrder(incomingAtMs, event.type, existingAtMs, existing._livenessType) > 0;
}

function effectiveLivenessTtl(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_LIVENESS_TTL_SECONDS
    ? value
    : DEFAULT_LIVENESS_TTL_SECONDS;
}

/** Fold-time maintenance only; reads never mutate the retained winner state. */
function pruneLivenessTombstones(state: MutableReplayState, nowMs: number): void {
  for (const [key, actor] of state.actors) {
    if (actor._livenessType !== "release") continue;
    const observedAtMs = numberField(actor, "_livenessObservedAtMs");
    if (observedAtMs === undefined || nowMs - observedAtMs <= effectiveLivenessTtl(MAX_LIVENESS_TTL_SECONDS) * 1000) continue;
    state.actors.delete(key);
  }
}

function publicActor(actor: ReplayObject): ReplayObject {
  const { _livenessType, _livenessAtMs, _livenessReleaseAtMs, _livenessObservedAtMs, _livenessMetadata, ...visible } = actor;
  return visible as ReplayObject;
}

/** Resolve the read-time clock (epoch millis or ISO string) to epoch millis; defaults to now. */
function resolveNowMs(now: number | string | undefined): number {
  if (typeof now === "number" && Number.isFinite(now)) return now;
  if (typeof now === "string") {
    const parsed = Date.parse(now);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Classify a folded actor at `nowMs`: fresh through its effective TTL,
 * reclaimable after that TTL through the maximum prune horizon, then absent.
 * Missing or unparseable `lastSeenAt` values fail closed as absent.
 */
function classifyActorLiveness(actor: ReplayObject, nowMs: number): "fresh" | "reclaimable" | "absent" {
  const lastSeenAt = actor.lastSeenAt;
  if (typeof lastSeenAt !== "string") return "absent";
  const lastSeenMs = parseCanonicalLivenessAt(lastSeenAt);
  if (lastSeenMs === undefined) return "absent";
  const ageMs = nowMs - lastSeenMs;
  const ttlSeconds = effectiveLivenessTtl(actor.ttlSeconds);
  if (ageMs <= ttlSeconds * 1000) return "fresh";
  if (ageMs <= MAX_LIVENESS_TTL_SECONDS * 1000) return "reclaimable";
  return "absent";
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
  buildCurrentOperatingState,
  createOperatingStateProjection
};
