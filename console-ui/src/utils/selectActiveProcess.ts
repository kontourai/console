import type { ConsoleProcess } from "../types";

export function selectActiveProcess(processes: ConsoleProcess[]) {
  return processes.find((process) => ["running", "open", "waiting", "in-progress", "in_progress", "blocked", "paused"].includes((process.status || "").toLowerCase().replace(/\s+/g, "-")))
    || processes[0]
    || null;
}
