export interface ConsoleRef {
  product?: string;
  kind?: string;
  id?: string;
  label?: string;
  name?: string;
}

export interface ConsoleLink {
  from?: ConsoleRef;
  relation?: string;
  to?: ConsoleRef;
  createdAt?: string;
}

export interface ConsoleSource {
  mode?: string;
  streamIds?: string[];
  acceptedEventCount?: number;
  duplicateEventCount?: number;
  lastAcceptedEventId?: string | null;
}

/**
 * Process operating-state vocabulary (console#229). Generic across products —
 * not a Flow-run-only or vertical-specific set. `needs_input` and
 * `review_pending` cover interactive-session work (an agent session or
 * process paused for a human to answer a question or review output) so an
 * interactive board has real states to render instead of a bare `blocked`.
 * Kept an open union (`| string`) like every other status field in this file:
 * producers may emit product-specific statuses the console still displays,
 * console-server's validator does not enforce this enum, and existing
 * producers are unaffected by the new members.
 */
export type ConsoleProcessStatus =
  | "not_started"
  | "running"
  | "paused"
  | "blocked"
  | "waiting"
  | "needs_input"
  | "review_pending"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export interface ConsoleProcess {
  id: string;
  label?: string;
  sourceRef?: ConsoleRef;
  status?: ConsoleProcessStatus;
  /**
   * Why the process is blocked/needs_input/review_pending — an operator- or
   * agent-facing sentence, folded from the causing event's `payload.reason`
   * (`process.blocked` and similar). Optional and independent of `status` so
   * a producer can set it without also adopting the interactive states.
   */
  blockedReason?: string;
  currentStep?: string | { id?: string; label?: string };
  percentComplete?: number;
  updatedAt?: string;
  claimRefs?: ConsoleRef[];
  nextActionRefs?: ConsoleRef[];
  /**
   * `@kontourai/surface`'s `buildTrustReport` output, folded verbatim from
   * flow-agents' workflow-trust bridge (console#254) so this process's board
   * card can carry the FULL Surface trust report even when it has zero gate
   * associations. Typed `unknown` here (like `PipelineGateExpect.trustReport`
   * in pipeline.ts) so console-core takes no dependency on `@kontourai/surface`;
   * console-ui narrows/passes it through opaquely at the UI boundary where
   * `<surface-trust-panel>` (console#255) mounts. Console never derives or
   * transforms this — Surface stays the sole authority for trust verdicts.
   */
  trustReport?: unknown;
}

export interface ConsoleGate {
  id: string;
  label?: string;
  status?: string;
  processRef?: ConsoleRef;
  expectationRefs?: ConsoleRef[];
  evidenceRefs?: ConsoleRef[];
  missingEvidence?: string[];
  routeBack?: {
    reason?: string;
    targetStep?: string;
    attempt?: number;
    maxAttempts?: number;
  };
  updatedAt?: string;
  /**
   * The same Surface trust report relayed onto this gate directly (console#254's
   * workflow-trust bridge attaches it to every gate association), so
   * console#255's gate trust panel can read it without first resolving the
   * owning process. See `ConsoleProcess.trustReport` for the opaque-typing
   * rationale.
   */
  trustReport?: unknown;
}

export interface ConsoleClaim {
  id: string;
  label?: string;
  sourceRef?: ConsoleRef;
  status?: string;
  freshness?: {
    status?: string;
    lastCheckedAt?: string;
    expiresAt?: string;
  };
  materiality?: string;
  processRefs?: ConsoleRef[];
  evidenceRefs?: ConsoleRef[];
  updatedAt?: string;
  lastVerifiedAt?: string;
}

export interface ConsoleAction {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
  readOnly?: boolean;
  authority?: {
    product?: string;
    command?: string;
  };
  subjectRefs?: ConsoleRef[];
}

export interface ConsoleEvidence {
  id: string;
  label?: string;
  sourceRef?: ConsoleRef;
  status?: string;
  capturedAt?: string;
  summary?: string;
  claimRefs?: ConsoleRef[];
  gateRefs?: ConsoleRef[];
  processRefs?: ConsoleRef[];
}

export interface ConsoleLearning {
  id: string;
  sourceEventId?: string;
  sourceRef?: ConsoleRef;
  subjectRef?: ConsoleRef;
  family?: string;
  nonAuthority?: boolean;
  summary?: string;
  confidence?: number;
  refs?: ConsoleRef[];
  links?: ConsoleLink[];
  updatedAt?: string;
}

export interface ConsoleInquiry {
  id: string;
  label?: string;
  outcome: "matched" | "derived" | "unsupported" | string;
  asker?: string;
  claimRefs?: ConsoleRef[];
  ruleRefs?: ConsoleRef[];
  statusFunctionVersion?: string;
  resolvedAt?: string;
  sourceRef?: ConsoleRef;
}

export interface TimelineItem {
  id: string;
  type?: string;
  occurredAt?: string;
  observedAt?: string;
  summary?: string;
  streamId?: string;
  producer?: {
    product?: string;
    id?: string;
    name?: string;
  };
  subjectRef?: ConsoleRef;
}

/**
 * One currently-active (actor, subjectId) liveness holder (flow-agents #295) —
 * folded from `kontour.console.liveness` claim/heartbeat/release records.
 * `actor` is an opaque per-session identity token (see flow-agents
 * scripts/hooks/lib/actor-identity.js), NOT a friendly agent/runtime name — it
 * is a different identifier space from the telemetry `agentName`/`runtime`
 * facets and should not be assumed joinable with them without a real mapping.
 */
export interface ConsoleActor {
  id: string;
  actor: string;
  subjectId: string;
  status?: string;
  lastSeenAt?: string;
  updatedAt?: string;
  ttlSeconds?: number;
  /** Optional stable correlation key the emitter may send (relay.sh `actor_key`). */
  actorKey?: string;
  host?: string;
  branch?: string;
  artifactDir?: string;
}

export interface OperatingState {
  generatedAt?: string | null;
  currentStage?: string;
  source?: ConsoleSource;
  processes?: ConsoleProcess[];
  gates?: ConsoleGate[];
  claims?: ConsoleClaim[];
  evidence?: ConsoleEvidence[];
  learnings?: ConsoleLearning[];
  inquiries?: ConsoleInquiry[];
  actions?: ConsoleAction[];
  links?: ConsoleLink[];
  timeline?: TimelineItem[];
  actors?: ConsoleActor[];
  /** TTL-expired actors still within the bounded liveness prune horizon. */
  reclaimableActors?: ConsoleActor[];
  pipeline?: import("./pipeline").Pipeline;
  /**
   * Flow's already-derived console projection for the active run, passed through
   * read-only so the UI can mount <flow-run-panel>. Typed `unknown` here (like
   * `PipelineGateExpect.trustReport`) so console-core takes no dependency on
   * `@kontourai/flow`; console-ui narrows it to `FlowConsoleProjection` at the
   * UI boundary where the type-only Flow contract import lives. Console never
   * derives this — it only renders what Flow's projector produced.
   */
  flowProjection?: unknown;
  /**
   * Optional pre-fetched child-run projections keyed by child run_id, so a
   * parent run that references a child is drillable to the child's panel without
   * an in-browser re-derivation (read-through, not re-derivation). When a
   * referenced child is absent here, the UI leaves a TODO for the live fetch
   * from the hosted ingest endpoint rather than faking a projection.
   */
  flowChildProjections?: Record<string, unknown>;
}

export interface RecordAcceptedEvent {
  delivery?: {
    outcome?: string;
    recordId?: string;
    observedAt?: string;
  };
  state?: OperatingState;
}

export function selectLearningsBySubjectRef(state: OperatingState, subjectRef: ConsoleRef): ConsoleLearning[] {
  const subjectKey = refKey(subjectRef);
  if (!subjectKey) return [];

  return (state.learnings || []).filter((learning) => {
    if (refKey(learning.subjectRef) === subjectKey) return true;
    if (refKey(learning.sourceRef) === subjectKey) return true;
    return (learning.refs || []).some((ref) => refKey(ref) === subjectKey);
  });
}

function refKey(ref?: ConsoleRef) {
  if (!ref?.product || !ref.kind || !ref.id) return "";
  return [ref.product, ref.kind, ref.id].join(":");
}
