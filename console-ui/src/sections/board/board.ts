import type { ConsoleGate, ConsoleProcess, OperatingState } from "@kontourai/console-core";

/**
 * #177 Board — the control-plane front door. A Kanban of work items (operating-
 * state `processes`) across flow stages, with gate health per card.
 *
 * No new server plumbing: this is a pure projection over the existing `/state`
 * OperatingState the Operate tab already consumes. Stage is derived client-side
 * because the read model has no first-class stage field — only free-string
 * `status` / `currentStep` from flow events.
 *
 * Live agent presence per card is intentionally NOT computed here. Liveness
 * `actors` carry `subjectId` = the flow-agents work-item slug, whereas a
 * process `id` is `run-${runId}` from flow-bridge — a different producer and id
 * space (operating-state.ts documents them as not joinable without a real
 * mapping). Rather than imply a live count that would silently read zero in
 * production, live presence waits on a verified cross-producer id mapping,
 * alongside the Me/Team filter (per-user identity #98/#159).
 */

export type BoardStage = "backlog" | "planning" | "in-flight" | "verify" | "done";

export const BOARD_STAGES: BoardStage[] = ["backlog", "planning", "in-flight", "verify", "done"];

export const BOARD_STAGE_LABEL: Record<BoardStage, string> = {
  backlog: "Backlog",
  planning: "Planning",
  "in-flight": "In flight",
  verify: "Verify",
  done: "Done"
};

// A terminal STATUS wins outright — a released/closed item is Done regardless
// of which step lingers.
const DONE_STATUS = /(^|\b)(complete|completed|done|closed|released|delivered|shipped|merged|cancell?ed|abandoned)\b/;

// Stage is driven by the current STEP, not status: flow-bridge stamps every
// non-terminal step `status:"running"`, so status can't distinguish planning
// from in-flight. Match the most-advanced step keyword first. `release`/
// `publish` are late-but-active work (In flight) until the status goes terminal.
const VERIFY_STEP = /(verify|review|critique|gate|accept|validat|sign-?off)/;
const IN_FLIGHT_STEP = /(execut|implement|build|coding|deliver|release|publish|in[-\s]?flight|in[-\s]?progress)/;
const PLANNING_STEP = /(plan|probe|design|pull[-\s]?work|groom|shape|scope|backlog[-\s]?refine|triage)/;

// Only consulted when there is no step string (producers that drive off status).
// `needs_input` (console#229) is deliberate, not regex luck: an interactive
// session stalled on a human answer is active work-in-progress, not an
// unstarted Backlog item. `review_pending` already matches via the "review"
// substring above (VERIFY_STEP, checked first) — see the board test asserting
// that pairing so it stays intentional, not an accident of match order.
const IN_FLIGHT_STATUS = /(running|active|in[-\s]?progress|execut|deliver|needs[-_\s]?input)/;

function stepText(step: ConsoleProcess["currentStep"]): string {
  if (!step) return "";
  return typeof step === "string" ? step : step.label || step.id || "";
}

/** Map a work item's free-string status/step onto one of the five board stages. */
export function classifyBoardStage(process: ConsoleProcess): BoardStage {
  const status = (process.status || "").toLowerCase();
  if (DONE_STATUS.test(status)) return "done";

  const step = stepText(process.currentStep).toLowerCase();
  if (step) {
    if (VERIFY_STEP.test(step)) return "verify";
    if (IN_FLIGHT_STEP.test(step)) return "in-flight";
    if (PLANNING_STEP.test(step)) return "planning";
    return "backlog";
  }

  // No step to read — fall back to status hints for status-driven producers.
  if (VERIFY_STEP.test(status)) return "verify";
  if (IN_FLIGHT_STATUS.test(status)) return "in-flight";
  if (PLANNING_STEP.test(status)) return "planning";
  return "backlog";
}

// "routed_back" (underscore) is the exact status console-server emits for a
// gate.routed_back event (statusFromGateEvent, current-operating-state.ts:886);
// the hyphenated "route-back" listed here before matched no producer, so a
// routed-back gate was undercounted in a card's blocked-gate tally. Mirrors the
// same set in sections/environment/derive.ts.
const BLOCKED_GATE_STATUSES = new Set(["blocked", "failed", "routed_back", "rejected"]);
const PASSED_GATE_STATUSES = new Set(["passed", "approved", "accepted", "complete"]);

export interface BoardCard {
  id: string;
  /** The flow run id for drill-down (#178): the process id with its `run-`
   *  prefix stripped, matching the `/ingest/flow/:runId` projection key. */
  runId: string;
  title: string;
  stage: BoardStage;
  stepLabel?: string;
  percentComplete?: number;
  gatesPassed: number;
  gatesBlocked: number;
  updatedAt?: string;
}

/**
 * Recover the flow run id from a process id. flow-bridge and flow-ingest both
 * build the operating-state subject id as `run-${runId}`, while the projection
 * read endpoint is keyed by the bare `runId` — so drill-down strips the prefix.
 */
export function runIdFromProcessId(processId: string): string {
  return processId.startsWith("run-") ? processId.slice(4) : processId;
}

export interface BoardColumn {
  stage: BoardStage;
  label: string;
  cards: BoardCard[];
}

export interface BoardModel {
  columns: BoardColumn[];
  totalCards: number;
}

/** Tally passed/blocked gates per work item (gate.processRef.id === work-item id). */
function gatesByProcess(gates: ConsoleGate[] | undefined): Map<string, { passed: number; blocked: number }> {
  const byProcess = new Map<string, { passed: number; blocked: number }>();
  for (const gate of gates || []) {
    const processId = gate.processRef?.id;
    if (!processId) continue;
    const tally = byProcess.get(processId) || { passed: 0, blocked: 0 };
    const status = (gate.status || "").toLowerCase();
    if (PASSED_GATE_STATUSES.has(status)) tally.passed += 1;
    else if (BLOCKED_GATE_STATUSES.has(status)) tally.blocked += 1;
    byProcess.set(processId, tally);
  }
  return byProcess;
}

/**
 * Project the operating state into a stage-grouped board. Every process becomes
 * exactly one card (including terminal ones, which land in Done) so the board is
 * a faithful, lossless view of work in flight — not the active-only filter.
 */
export function deriveBoard(state: OperatingState | null | undefined): BoardModel {
  const safe: OperatingState = state ?? ({} as OperatingState);
  const gateCounts = gatesByProcess(safe.gates);

  const columns: BoardColumn[] = BOARD_STAGES.map((stage) => ({
    stage,
    label: BOARD_STAGE_LABEL[stage],
    cards: []
  }));
  const columnByStage = new Map(columns.map((column) => [column.stage, column]));

  for (const process of safe.processes || []) {
    const stage = classifyBoardStage(process);
    const gates = gateCounts.get(process.id) || { passed: 0, blocked: 0 };
    const step = process.currentStep;
    columnByStage.get(stage)!.cards.push({
      id: process.id,
      runId: runIdFromProcessId(process.id),
      title: process.label || process.id,
      stage,
      stepLabel: typeof step === "string" ? step : step?.label || step?.id,
      percentComplete: process.percentComplete,
      gatesPassed: gates.passed,
      gatesBlocked: gates.blocked,
      updatedAt: process.updatedAt
    });
  }

  // Within a column, most-recently-updated first; undated rows sink to the bottom.
  for (const column of columns) {
    column.cards.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  const totalCards = columns.reduce((sum, column) => sum + column.cards.length, 0);
  return { columns, totalCards };
}
