import type { ConsoleProcess } from "./operating-state";

// Interactive-session states (console#229) are stalled-on-external-actor like
// "blocked"/"waiting", not idle — a process needing human input or review is
// exactly the kind of work an interactive board should be able to focus on.
export function selectActiveProcess(processes: ConsoleProcess[]) {
  return processes.find((process) => ["running", "open", "waiting", "in-progress", "in_progress", "blocked", "paused", "needs_input", "review_pending"].includes((process.status || "").toLowerCase().replace(/\s+/g, "-")))
    || processes[0]
    || null;
}

export function formatStep(step: ConsoleProcess["currentStep"]) {
  if (!step) return "n/a";
  if (typeof step === "string") return step;
  return step.label || step.id || "n/a";
}
