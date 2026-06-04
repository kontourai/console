import type { ConsoleProcess } from "./operating-state";

export function selectActiveProcess(processes: ConsoleProcess[]) {
  return processes.find((process) => ["running", "open", "waiting", "in-progress", "in_progress", "blocked", "paused"].includes((process.status || "").toLowerCase().replace(/\s+/g, "-")))
    || processes[0]
    || null;
}

export function formatStep(step: ConsoleProcess["currentStep"]) {
  if (!step) return "n/a";
  if (typeof step === "string") return step;
  return step.label || step.id || "n/a";
}
