import type {
  ConsoleGate,
  ConsoleProcess,
  ConsoleRef,
  OperatingState,
  Pipeline,
  PipelineStage,
  TimelineItem,
} from "@kontourai/console-core";
import { BOARD_STAGES, BOARD_STAGE_LABEL, classifyBoardStage, runIdFromProcessId, type BoardStage } from "@kontourai/console-ui";
import { classifyActivity, type ActivityDisplay, type FreshnessTier } from "../workers/derive";
import { serializeOperatePath } from "../../utils/appRoute";
import { deriveSourceRefs, type SourceRef } from "../../utils/sourceRefs";

/**
 * console#253 run drill-in — a pure projection answering "where is this run
 * in its flow?" for a single process, reusing the SAME primitives the rest
 * of the app already trusts rather than inventing a parallel stage model:
 *
 * - Stage vocabulary: `classifyBoardStage`/`BOARD_STAGES` (lib/src/board.ts,
 *   #177/#230) — the board's own five-column stage classification IS the
 *   per-run stage vocabulary (see BoardSection.tsx's docstring). A run's
 *   position among backlog/planning/in-flight/verify/done is derived from
 *   this, exactly like its board card. IMPORTANT (console#253 review finding
 *   2): that classifier only answers "which column is this run in NOW" — it
 *   has no gate-evidence backing "which earlier stages actually completed".
 *   See `stagesFromBoardVocabulary`'s comment for exactly which stages are
 *   (and are not) allowed to read as "completed".
 * - Real flow topology: when `state.pipeline` (console-core/src/pipeline.ts,
 *   built by `buildPipeline` from a Flow run's own definition+state) is
 *   present, structurally valid, and unambiguously OWNED by this run
 *   (`pipeline.runId === process.id` — pipeline.runId is namespaced via the
 *   same `run-<id>` convention `runIdFromProcessId` strips, so this equality
 *   is exact, not a heuristic — see `matchingPipeline`), its real per-step
 *   stages replace the generic board-stage strip, INCLUDING non-passed
 *   outcomes (blocked/failed) and the pipeline's own authoritative
 *   `currentStageId` — see `stagesFromPipeline`.
 * - Gate health / timeline: joined via `refJoinsProcess` — an id match,
 *   strengthened to also require product/kind agreement when the ref
 *   actually carries them (console#253 review finding 5).
 * - Freshness: `classifyActivity` (sections/workers/derive.ts, #251) —
 *   imported, not re-implemented, so a run's drill-in freshness tier always
 *   agrees with its fleet card.
 *
 * Kept framework-free (no React) and injectable-`now` (mirrors #251's
 * `classifyActivity`/BoardView's own `now` prop) for deterministic tests and
 * SSR-safety. Re-derives fully from `state` on every call — no internal
 * caching — so SSE-driven state updates flow straight through when a host
 * component re-invokes this on each render.
 */

export type RunStageOutcome = "completed" | "earlier" | "current" | "blocked" | "failed" | "pending";

export interface RunStageNode {
  /** Board stage id in the fallback vocabulary, or the Flow step id when a
   *  matching `state.pipeline` supplies the run's real topology. */
  id: string;
  label: string;
  /** Visual/semantic outcome for this stage (see the enum + derivation
   *  functions below for exactly what evidence backs each value). */
  outcome: RunStageOutcome;
  /**
   * True iff this stage is the run's CURRENT position — authoritative and
   * independent of `outcome` (console#253 review finding 1): a stage can be
   * both the current position AND carry a blocked/failed outcome (e.g. a run
   * stuck on a failing gate at its current step). Exactly one stage is
   * `current: true` when the topology/vocabulary resolved a position at all.
   */
  current: boolean;
}

export interface RunGateEntry {
  id: string;
  label: string;
  status: string;
  updatedAt?: string;
  /** `/gate/:id` — a real deep-link path (console#252's route), not a fake handler. */
  href: string;
}

export interface RunDetail {
  id: string;
  /** The flow run id for the projection fetch (#178) — process id minus its `run-` prefix. */
  runId: string;
  title: string;
  status: string;
  stepLabel?: string;
  blockedReason?: string;
  percentComplete?: number;
  updatedAt?: string;
  freshness: FreshnessTier;
  display: ActivityDisplay;
  stages: RunStageNode[];
  gates: RunGateEntry[];
  /** This run's own recent timeline slice, newest first, capped — see `RUN_TIMELINE_LIMIT`. */
  timeline: TimelineItem[];
  /**
   * Source-of-truth link-outs (console#256), when the process record carries
   * them — deterministically ordered (work-item, then the assignment trio,
   * then anything else), each rendered by the shared `SourceRefLinks`
   * component. A ref with no safe http(s) url is still included (rendered as
   * text, never a fake anchor) — see `deriveSourceRefs` (utils/sourceRefs.ts).
   */
  sourceOfTruthRefs: SourceRef[];
}

/** Cap on the timeline slice rendered per run — recent context, not a full audit log. */
export const RUN_TIMELINE_LIMIT = 10;

function stepLabel(step: ConsoleProcess["currentStep"]): string | undefined {
  if (!step) return undefined;
  return typeof step === "string" ? step : step.label || step.id;
}

/** The Flow step id a process's `currentStep` names, if any — the MACHINE id
 *  (`.id`, not `.label`), matching `PipelineStage.id`'s vocabulary. */
function currentStepId(step: ConsoleProcess["currentStep"]): string | undefined {
  if (!step) return undefined;
  return typeof step === "string" ? step : step.id;
}

// ── Stage derivation: real Flow topology (state.pipeline) ──────────────────

/**
 * Structural validation for a single pipeline stage entry — console#253
 * review finding 3: the prior guard only checked `Array.isArray(stages) &&
 * stages.length > 0`, so a malformed entry (`null`, a missing `id`, etc.)
 * reached `.sort()`/`.map()` and crashed on a null deref, or produced
 * `undefined` ids that collide as duplicate React keys. Only the fields this
 * module actually reads are required; everything else is tolerated.
 */
function isValidPipelineStage(value: unknown): value is PipelineStage {
  if (!value || typeof value !== "object") return false;
  const stage = value as Partial<PipelineStage>;
  return (
    typeof stage.id === "string" && stage.id.length > 0 &&
    typeof stage.label === "string" &&
    typeof stage.status === "string" &&
    typeof stage.order === "number" && Number.isFinite(stage.order)
  );
}

/**
 * A `state.pipeline` snapshot only supplies THIS run's topology when it is
 * present, structurally valid throughout (console#253 review finding 3 — ANY
 * invalid stage rejects the WHOLE snapshot, never a partial adoption), free
 * of duplicate stage ids (which would otherwise collide as duplicate React
 * keys / an ambiguous topology), and its `runId` matches the process id
 * exactly (module docstring). Anything else falls back to the board-stage
 * vocabulary rather than attributing foreign or malformed topology.
 */
function matchingPipeline(state: OperatingState, processId: string): Pipeline | null {
  const raw = state.pipeline;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Pipeline;
  if (!Array.isArray(candidate.stages) || candidate.stages.length === 0) return null;
  if (candidate.runId !== processId) return null;
  if (!candidate.stages.every(isValidPipelineStage)) return null;
  const ids = candidate.stages.map((stage) => stage.id);
  if (new Set(ids).size !== ids.length) return null;
  return candidate;
}

function outcomeFromPipelineStatus(status: PipelineStage["status"]): RunStageOutcome {
  switch (status) {
    case "passed":
      return "completed";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "current":
      return "current";
    case "ready":
    case "pending":
    default:
      return "pending";
  }
}

/**
 * The run's current position within a validated pipeline's stages.
 * `pipeline.currentStageId` is authoritative WHEN it names one of this
 * pipeline's own stages (console#253 review finding 1 — a stage's position
 * is independent of its status: `currentStageId` wins even when that stage's
 * own status is `blocked`/`failed`, which is exactly a run stuck there, not
 * a run that has moved on). Falls back to whichever stage's own status is
 * literally `"current"` when `currentStageId` is absent/stale, and to `null`
 * (no stage marked current — never a fabricated position) when neither
 * signal resolves one.
 *
 * console#253 review finding 4: `state.pipeline` is a single whole-object
 * snapshot (current-operating-state.ts replaces it wholesale on each
 * `flow.pipeline.snapshot`), so it can go stale relative to this specific
 * process's own (independently-updated) `currentStep` fold. When the
 * process's `currentStep` names a DIFFERENT stage that IS one of this
 * pipeline's own stages, the fresher process record wins the POSITION —
 * the pipeline snapshot still supplies the topology/labels/per-step
 * outcomes untouched.
 */
function resolvePipelinePosition(pipeline: Pipeline, stages: PipelineStage[], process: ConsoleProcess): string | null {
  const stageIds = new Set(stages.map((stage) => stage.id));
  const snapshotPositionId = stageIds.has(pipeline.currentStageId ?? "")
    ? (pipeline.currentStageId as string)
    : (stages.find((stage) => stage.status === "current")?.id ?? null);

  const processPositionId = currentStepId(process.currentStep);
  if (processPositionId && processPositionId !== snapshotPositionId && stageIds.has(processPositionId)) {
    return processPositionId;
  }
  return snapshotPositionId;
}

function stagesFromPipeline(pipeline: Pipeline, process: ConsoleProcess): RunStageNode[] {
  const stages = pipeline.stages.slice().sort((a, b) => a.order - b.order);
  const positionId = resolvePipelinePosition(pipeline, stages, process);
  return stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    outcome: outcomeFromPipelineStatus(stage.status),
    current: stage.id === positionId,
  }));
}

// ── Stage derivation: board-vocabulary fallback ─────────────────────────────

/**
 * Terminal statuses that represent genuine forward completion — mirrors
 * board.ts's DONE_STATUS wording MINUS cancelled/abandoned, which end a run
 * without completing it (console#253 review finding 2). Only these are
 * defensible enough to green-check a run's earlier board stages.
 */
const SUCCESS_TERMINAL_STATUSES = new Set([
  "complete", "completed", "done", "closed", "released", "delivered", "shipped", "merged",
]);

/**
 * Terminal statuses that end a run WITHOUT completing it. A run that failed,
 * was cancelled, or was abandoned may never have gotten evidence-backed
 * confirmation for ANY earlier stage — green-checking predecessors here would
 * fabricate confidence the classifier (a free-text status/step keyword
 * match, not gate evidence) cannot support (console#253 review finding 2,
 * probe-confirmed: `{status:'failed', currentStep:'verify'}` previously
 * showed Backlog/Planning/In-flight as "completed"; a plain `cancelled`
 * status previously showed every stage before Done as "completed" too).
 */
const FAILURE_TERMINAL_STATUSES = new Set(["failed", "cancelled", "canceled", "abandoned"]);

/**
 * `classifyBoardStage` only answers "which column is this run in RIGHT NOW"
 * — a free-text status/step keyword match, never gate evidence about which
 * earlier stages actually completed. Presenting every predecessor stage as a
 * green-checked "completed" therefore over-claims in two ways this module
 * must not repeat (console#253 review finding 2):
 *
 * - a run still in progress hasn't had its earlier stages VERIFIED complete
 *   either — it has simply moved past them textually. Predecessors of a
 *   non-terminal run's current stage read as the neutral `"earlier"`
 *   (behind the current position), never `"completed"`.
 * - a run that ended in FAILURE (failed/cancelled/abandoned) may not have
 *   gotten past stage one — predecessors stay `"earlier"` here too, and the
 *   classified/current stage itself is badged `"failed"` (a terminal, non-
 *   in-progress outcome), never the active-work `"current"` badge.
 *
 * The one case where "completed" IS a defensible inference: a run that
 * reached a genuine SUCCESS terminal status (released/completed/closed/…).
 * There, the classified/current stage and every predecessor read as
 * `"completed"` — the same green-check behavior this fallback had before,
 * kept for the one case the review did not flag as over-claiming.
 */
function stagesFromBoardVocabulary(process: ConsoleProcess): RunStageNode[] {
  const currentStage: BoardStage = classifyBoardStage(process);
  const currentIndex = BOARD_STAGES.indexOf(currentStage);
  const status = (process.status || "").toLowerCase();
  const isFailureTerminal = FAILURE_TERMINAL_STATUSES.has(status);
  const isSuccessTerminal = SUCCESS_TERMINAL_STATUSES.has(status);

  return BOARD_STAGES.map((stage, index) => {
    const current = index === currentIndex;
    let outcome: RunStageOutcome;
    if (current) {
      outcome = isFailureTerminal ? "failed" : isSuccessTerminal ? "completed" : "current";
    } else if (index < currentIndex) {
      outcome = isSuccessTerminal ? "completed" : "earlier";
    } else {
      outcome = "pending";
    }
    return { id: stage, label: BOARD_STAGE_LABEL[stage], outcome, current };
  });
}

function deriveStages(state: OperatingState, process: ConsoleProcess): RunStageNode[] {
  const pipeline = matchingPipeline(state, process.id);
  return pipeline ? stagesFromPipeline(pipeline, process) : stagesFromBoardVocabulary(process);
}

// ── Recency ordering ─────────────────────────────────────────────────────────

/** Epoch ms, or `null` when missing/unparsable — never fabricated as "now". */
function recencyMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Most-recent-first; undated/unparsable entries sink to the bottom together
 *  rather than sorting first or last arbitrarily (mirrors workers/derive.ts's
 *  `byRecency`, console#251 review finding 1). */
function byRecencyDesc(aMs: number | null, bMs: number | null): number {
  if (aMs == null && bMs == null) return 0;
  if (aMs == null) return 1;
  if (bMs == null) return -1;
  return bMs - aMs;
}

// ── Gate / timeline joins ────────────────────────────────────────────────────

/**
 * A gate/timeline ref join. Both `gatesByProcess` (deriveBoard, lib/src/
 * board.ts) and this module previously joined on `ref.id === process.id`
 * alone — safe only because every real producer in this repo currently
 * emits an id-only, unqualified `processRef`/`subjectRef` for these joins.
 * A ref that DOES carry a `product` and/or `kind` is a stronger claim about
 * what it targets; requiring that claim to agree with the process's own
 * `sourceRef` closes a theoretical id-collision across producers/products
 * (console#253 review finding 5, probe: a `{product:'other', id:'run-x'}`
 * ref must NOT join a flow run whose id happens to also be `run-x`).
 * `deriveBoard`'s own tally shares the id-only weakness and is intentionally
 * NOT changed here — noted in the task report as a follow-up candidate,
 * since strengthening it changes the board's existing gate-tally contract
 * out of scope for this run-detail slice.
 */
function refJoinsProcess(ref: ConsoleRef | undefined, process: ConsoleProcess): boolean {
  if (!ref || !ref.id || ref.id !== process.id) return false;
  if (ref.product !== undefined && ref.product !== process.sourceRef?.product) return false;
  if (ref.kind !== undefined && ref.kind !== (process.sourceRef?.kind ?? "run")) return false;
  return true;
}

function deriveGateHistory(state: OperatingState, process: ConsoleProcess): RunGateEntry[] {
  const gates = (state.gates || []).filter((gate: ConsoleGate) => refJoinsProcess(gate.processRef, process));
  return gates
    .map((gate) => ({
      id: gate.id,
      label: gate.label || gate.id,
      status: gate.status || "unknown",
      updatedAt: gate.updatedAt,
      href: serializeOperatePath(gate.id),
    }))
    .sort((a, b) => byRecencyDesc(recencyMs(a.updatedAt), recencyMs(b.updatedAt)));
}

function deriveTimelineSlice(state: OperatingState, process: ConsoleProcess): TimelineItem[] {
  const items = (state.timeline || []).filter((item) => refJoinsProcess(item.subjectRef, process));
  return items
    .slice()
    .sort((a, b) => byRecencyDesc(recencyMs(a.occurredAt || a.observedAt), recencyMs(b.occurredAt || b.observedAt)))
    .slice(0, RUN_TIMELINE_LIMIT);
}

/**
 * Project a single run's drill-in detail from the operating state, or `null`
 * when the process id isn't present in the CURRENT state — an honest
 * "not found" rather than a stale/fabricated view (e.g. the run completed
 * and was pruned, or the `/run/:id` in the address bar is simply wrong).
 */
export function deriveRunDetail(
  state: OperatingState | null | undefined,
  processId: string,
  now: number = Date.now()
): RunDetail | null {
  const safe: OperatingState = state ?? ({} as OperatingState);
  const process = (safe.processes || []).find((candidate) => candidate.id === processId);
  if (!process) return null;

  const activity = classifyActivity(process.updatedAt, now);

  return {
    id: process.id,
    runId: runIdFromProcessId(process.id),
    title: process.label || process.id,
    status: process.status || "unknown",
    stepLabel: stepLabel(process.currentStep),
    blockedReason: process.blockedReason,
    percentComplete: process.percentComplete,
    updatedAt: process.updatedAt,
    freshness: activity.freshness,
    display: activity.display,
    stages: deriveStages(safe, process),
    gates: deriveGateHistory(safe, process),
    timeline: deriveTimelineSlice(safe, process),
    sourceOfTruthRefs: deriveSourceRefs(process),
  };
}
