import type { ConsoleProcess } from "../types";

export function selectActiveProcess(processes: ConsoleProcess[]) {
  return processes.find((process) => ["running", "blocked", "waiting", "paused"].includes(process.status || ""))
    || processes[0]
    || null;
}
