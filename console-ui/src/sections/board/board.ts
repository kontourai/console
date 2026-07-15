import type { ConsoleActor, ConsoleGate, ConsoleProcess, OperatingState } from "@kontourai/console-core";

/**
 * #177 Board — the control-plane front door. A Kanban of work items (operating-
 * state `processes`) across flow stages, reconciled with live agent presence
 * (liveness `actors`, joined by subjectId === work-item id) and gate health.
 *
 * No new server plumbing: this is a pure projection over the existing `/state`
 * OperatingState the Operate tab already consumes. Stage is derived client-side
 * because the read model has no first-class stage field — only free-string
 * `status` / `currentStep` from flow events.
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

// Terminal statuses win outright (a released/closed item is Done regardless of
// which step string lingers). The remaining stages are matched against the
// combined status + current-step text, most-advanced first, so a work item
// mid-verify isn't misfiled as still planning.
const DONE_STATUS = /(^|\b)(complete|completed|done|closed|released|delivered|shipped|merged|cancell?ed|abandoned)\b/;
const VERIFY = /(verify|review|critique|gate|accept|validat|sign-?off)/;
const IN_FLIGHT = /(execut|implement|build|coding|in[-\s]?flight|in[-\s]?progress|running|active|deliver)/;
const PLANNING = /(plan|probe|design|pull[-\s]?work|groom|shape|scope|backlog[-\s]?refine|triage)/;

function stepText(step: ConsoleProcess["currentStep"]): string {
  if (!step) return "";
  return typeof step === "string" ? step : step.label || step.id || "";
}

/** Map a work item's free-string status/step onto one of the five board stages. */
export function classifyBoardStage(process: ConsoleProcess): BoardStage {
  const status = (process.status || "").toLowerCase();
  if (DONE_STATUS.test(status)) return "done";
  const hay = `${status} ${stepText(process.currentStep)}`.toLowerCase();
  if (VERIFY.test(hay)) return "verify";
  if (IN_FLIGHT.test(hay)) return "in-flight";
  if (PLANNING.test(hay)) return "planning";
  return "backlog";
}

const BLOCKED_GATE_STATUSES = new Set(["blocked", "failed", "route-back", "rejected"]);
const PASSED_GATE_STATUSES = new Set(["passed", "approved", "accepted", "complete"]);

export interface BoardCard {
  id: string;
  title: string;
  stage: BoardStage;
  stepLabel?: string;
  percentComplete?: number;
  /** Distinct live liveness actors holding this work item (subagents counted). */
  liveAgentCount: number;
  gatesPassed: number;
  gatesBlocked: number;
  updatedAt?: string;
}

export interface BoardColumn {
  stage: BoardStage;
  label: string;
  cards: BoardCard[];
}

export interface BoardModel {
  columns: BoardColumn[];
  totalCards: number;
  liveAgentTotal: number;
}

/** Count distinct live actors per work item (subjectId === work-item id). */
function liveAgentsBySubject(actors: ConsoleActor[] | undefined): Map<string, number> {
  const bySubject = new Map<string, Set<string>>();
  for (const actor of actors || []) {
    if (!actor.subjectId) continue;
    const set = bySubject.get(actor.subjectId) || new Set<string>();
    set.add(actor.actor || actor.id);
    bySubject.set(actor.subjectId, set);
  }
  const counts = new Map<string, number>();
  for (const [subjectId, set] of bySubject) counts.set(subjectId, set.size);
  return counts;
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
  const liveCounts = liveAgentsBySubject(safe.actors);
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
      title: process.label || process.id,
      stage,
      stepLabel: typeof step === "string" ? step : step?.label || step?.id,
      percentComplete: process.percentComplete,
      liveAgentCount: liveCounts.get(process.id) || 0,
      gatesPassed: gates.passed,
      gatesBlocked: gates.blocked,
      updatedAt: process.updatedAt
    });
  }

  // Within a column, most-recently-updated first; undated rows sink to the bottom.
  for (const column of columns) {
    column.cards.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  // Total reflects agents on cards actually shown, so the header never disagrees
  // with the sum of the cards (actors holding items not on the board are excluded).
  let totalCards = 0;
  let liveAgentTotal = 0;
  for (const column of columns) {
    totalCards += column.cards.length;
    for (const card of column.cards) liveAgentTotal += card.liveAgentCount;
  }

  return { columns, totalCards, liveAgentTotal };
}
