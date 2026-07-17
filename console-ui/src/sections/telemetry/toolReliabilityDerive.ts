import type {
  ConsoleTelemetryToolReliability,
  ConsoleTelemetryToolReliabilitySummary
} from "../../serverApiTypes";

/** A tool row for display, carrying an explicit failure-signal flag alongside
 *  the server's raw counts. `failureRate` is `fail/(pass+fail)` from the server
 *  — 0 both when nothing failed AND when there is no pass-or-fail result at all
 *  (denom==0). `hasFailureSignal` disambiguates the two: false means "no
 *  recognized pass/fail outcome yet" (e.g. only ambiguous results, or an
 *  unlabeled/future outcome string), which must render as "no signal" — never
 *  a reassuring green 0%. */
export interface ToolReliabilityRow extends ConsoleTelemetryToolReliability {
  hasFailureSignal: boolean;
}

export interface ToolReliabilityView {
  /** Rows to render, capped to `limit`, in server order (result volume desc). */
  rows: ToolReliabilityRow[];
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
  const rows: ToolReliabilityRow[] = all.slice(0, limit).map((tool) => ({
    ...tool,
    hasFailureSignal: tool.passCount + tool.failCount > 0
  }));
  return { rows, hasSignal };
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
