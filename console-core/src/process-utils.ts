import type { ConsoleProcess } from "./operating-state";

// console#229 (review MEDIUM): explicit priority tiers, checked in order, so
// selection is deterministic and never accidental first-match-over-ID-sorted-
// array luck. A process a human must act on outranks one merely blocked on an
// external system, which outranks one simply running — an interactive board
// should surface the process someone needs to act on, not whichever one
// happens to sort first.
const PROCESS_SELECTION_TIERS: string[][] = [
  ["needs_input", "review_pending"],
  ["blocked", "waiting", "paused"],
  ["running", "open", "in-progress", "in_progress"]
];

function normalizedProcessStatus(process: ConsoleProcess): string {
  return (process.status || "").toLowerCase().replace(/\s+/g, "-");
}

export function selectActiveProcess(processes: ConsoleProcess[]) {
  for (const tier of PROCESS_SELECTION_TIERS) {
    const match = processes.find((process) => tier.includes(normalizedProcessStatus(process)));
    if (match) return match;
  }
  return processes[0] || null;
}

export function formatStep(step: ConsoleProcess["currentStep"]) {
  if (!step) return "n/a";
  if (typeof step === "string") return step;
  return step.label || step.id || "n/a";
}
