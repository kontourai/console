import type {
  ConsoleTelemetryToolReliability,
  ConsoleTelemetryToolReliabilitySummary
} from "../../serverApiTypes";

export interface ToolReliabilityView {
  /** Rows to render, capped to `limit`, in server order (result volume desc). */
  rows: ConsoleTelemetryToolReliability[];
  /** True once at least one tool carries a latency OR a pass/fail/ambiguous
   *  outcome — i.e. the #580 enriched result stream has landed. Bare result
   *  counts with no signal read as "not yet" so the panel shows an honest empty
   *  state rather than a table of blank latencies and 0% failure. */
  hasSignal: boolean;
}

export function deriveToolReliability(
  summary: ConsoleTelemetryToolReliabilitySummary | undefined,
  limit = 12
): ToolReliabilityView {
  const all = summary?.tools ?? [];
  const hasSignal = all.some(
    (t) => t.p50DurationMs != null || t.passCount + t.failCount + t.ambiguousCount > 0
  );
  return { rows: all.slice(0, limit), hasSignal };
}

/** Latency in a compact human form: "820ms", "1.4s", "2m 3s". Null/absent →
 *  an em dash (the tool ran but the runtime didn't time it). Pure. */
export function formatLatencyMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

/** Failure rate as a whole-percent string. `<1%` for tiny non-zero rates so a
 *  real-but-small failure rate never rounds away to a reassuring 0%. Pure. */
export function formatFailureRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  const pct = rate * 100;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export type FailureTone = "good" | "caution" | "bad";

/** Tone for a failure rate: green ≤5%, amber <20%, red otherwise. Pure. */
export function failureTone(rate: number): FailureTone {
  if (!Number.isFinite(rate) || rate <= 0.05) return "good";
  if (rate < 0.2) return "caution";
  return "bad";
}

/** Bar width percent for a failure rate: 0 stays empty; any real rate shows at
 *  least a 2% sliver so a small failure is visible. Pure. */
export function failureBarWidth(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(2, Math.min(100, rate * 100));
}
