import type { ConsoleGate, ConsoleProcess, OperatingState, Pipeline, TimelineItem } from "@kontourai/console-core";
import { BOARD_STAGES, BOARD_STAGE_LABEL, classifyBoardStage, runIdFromProcessId, type BoardStage } from "@kontourai/console-ui";
import { classifyActivity, type ActivityDisplay, type FreshnessTier } from "../workers/derive";
import { serializeOperatePath } from "../../utils/appRoute";

/**
 * console#253 run drill-in — a pure projection answering "where is this run
 * in its flow?" for a single process, reusing the SAME primitives the rest
 * of the app already trusts rather than inventing a parallel stage model:
 *
 * - Stage vocabulary: `classifyBoardStage`/`BOARD_STAGES` (lib/src/board.ts,
 *   #177/#230) — the board's own five-column stage classification IS the
 *   per-run stage vocabulary (see BoardSection.tsx's docstring). A run's
 *   position among backlog/planning/in-flight/verify/done is derived from
 *   this, exactly like its board card.
 * - Real flow topology: when `state.pipeline` (console-core/src/pipeline.ts,
 *   built by `buildPipeline` from a Flow run's own definition+state) is
 *   BOTH present and unambiguously OWNED by this run (`pipeline.runId ===
 *   process.id` — pipeline.runId is namespaced via the same `run-<id>`
 *   convention `runIdFromProcessId` strips, so this equality is exact, not a
 *   heuristic), its real per-step stages replace the generic board-stage
 *   strip. `state.pipeline` is a single whole-object snapshot (not indexed
 *   per run), so a mismatch is the ordinary case for any run other than
 *   whichever one most recently posted a `flow.pipeline.snapshot` — falling
 *   back to the board vocabulary rather than attributing a foreign run's
 *   topology to this one.
 * - Gate health: `gate.processRef.id === process.id` — the exact join
 *   `deriveBoard`'s own `gatesByProcess` tally uses (lib/src/board.ts), so
 *   the gate history shown here is always the same set that produced the
 *   card's passed/blocked counts on the board, never a divergent re-join.
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

export type RunStageState = "completed" | "current" | "pending";

export interface RunStageNode {
  /** Board stage id in the fallback vocabulary, or the Flow step id when a
   *  matching `state.pipeline` supplies the run's real topology. */
  id: string;
  label: string;
  state: RunStageState;
}

export interface RunGateEntry {
  id: string;
  label: string;
  status: string;
  updatedAt?: string;
  /** `/gate/:id` — a real deep-link path (console#252's route), not a fake handler. */
  href: string;
}

export interface RunSourceRef {
  label: string;
  url: string;
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
  /** External work-item link-outs, when the process record carries them. Only
   *  entries with a real, non-empty URL are ever included — never fabricated. */
  sourceOfTruthRefs: RunSourceRef[];
}

/** Cap on the timeline slice rendered per run — recent context, not a full audit log. */
export const RUN_TIMELINE_LIMIT = 10;

function stepLabel(step: ConsoleProcess["currentStep"]): string | undefined {
  if (!step) return undefined;
  return typeof step === "string" ? step : step.label || step.id;
}

/**
 * A `state.pipeline` snapshot only describes THIS run's topology when its
 * `runId` matches the process id exactly (see module docstring) — anything
 * else (missing, malformed, or another run's snapshot) falls back to the
 * board-stage vocabulary rather than attributing foreign topology.
 */
function matchingPipeline(state: OperatingState, processId: string): Pipeline | null {
  const raw = state.pipeline;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Pipeline;
  if (!Array.isArray(candidate.stages) || candidate.stages.length === 0) return null;
  if (candidate.runId !== processId) return null;
  return candidate;
}

function stagesFromPipeline(pipeline: Pipeline): RunStageNode[] {
  return pipeline.stages
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      id: stage.id,
      label: stage.label,
      state: stage.status === "passed" ? "completed" : stage.status === "current" ? "current" : "pending",
    }));
}

function stagesFromBoardVocabulary(process: ConsoleProcess): RunStageNode[] {
  const currentStage: BoardStage = classifyBoardStage(process);
  const currentIndex = BOARD_STAGES.indexOf(currentStage);
  return BOARD_STAGES.map((stage, index) => ({
    id: stage,
    label: BOARD_STAGE_LABEL[stage],
    state: index < currentIndex ? "completed" : index === currentIndex ? "current" : "pending",
  }));
}

function deriveStages(state: OperatingState, process: ConsoleProcess): RunStageNode[] {
  const pipeline = matchingPipeline(state, process.id);
  return pipeline ? stagesFromPipeline(pipeline) : stagesFromBoardVocabulary(process);
}

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

function deriveGateHistory(state: OperatingState, process: ConsoleProcess): RunGateEntry[] {
  const gates = (state.gates || []).filter((gate: ConsoleGate) => gate.processRef?.id === process.id);
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
  const items = (state.timeline || []).filter((item) => item.subjectRef?.id === process.id);
  return items
    .slice()
    .sort((a, b) => byRecencyDesc(recencyMs(a.occurredAt || a.observedAt), recencyMs(b.occurredAt || b.observedAt)))
    .slice(0, RUN_TIMELINE_LIMIT);
}

/**
 * `sourceOfTruthRefs` is not (yet) a declared `ConsoleProcess` field — no
 * producer in this repo emits it. Read defensively off the raw record so a
 * future producer's link-outs render the moment they appear, without ever
 * fabricating a link: only entries carrying a real, non-empty URL string are
 * included (tolerating either a `url` or `href` key), everything else is
 * silently skipped rather than guessed at.
 */
function deriveSourceOfTruthRefs(process: ConsoleProcess): RunSourceRef[] {
  const raw = (process as unknown as { sourceOfTruthRefs?: unknown }).sourceOfTruthRefs;
  if (!Array.isArray(raw)) return [];
  const refs: RunSourceRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { url?: unknown; href?: unknown; label?: unknown; id?: unknown };
    const url = typeof candidate.url === "string" && candidate.url
      ? candidate.url
      : typeof candidate.href === "string" && candidate.href
        ? candidate.href
        : undefined;
    if (!url) continue;
    const label = (typeof candidate.label === "string" && candidate.label)
      || (typeof candidate.id === "string" && candidate.id)
      || url;
    refs.push({ label, url });
  }
  return refs;
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
    sourceOfTruthRefs: deriveSourceOfTruthRefs(process),
  };
}
