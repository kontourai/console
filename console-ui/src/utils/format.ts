import type { ConsoleProcess } from "../types";

export function formatStep(step: ConsoleProcess["currentStep"]) {
  if (!step) return "n/a";
  if (typeof step === "string") return step;
  return step.label || step.id || "n/a";
}

export function formatTime(value?: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
