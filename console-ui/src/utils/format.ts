// formatRelative moved to lib/src/format.ts (#230): it is used by the pure,
// published BoardView component and by app-only sections alike. Re-exported
// here so existing app imports (`from "../utils/format"`) keep working — one
// source, no fork.
export { formatRelative } from "../../lib/src/format";

export function formatTime(value?: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Currency for spend/cost fields — cents precision under $10, whole-dollar-ish above. */
export function formatUsd(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "$0";
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  const digits = value < 10 ? 2 : value < 1000 ? 2 : 0;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Compact counts for token/volume fields: 1.2M, 3.4K, 850. */
export function formatCompact(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return `${Math.round(value)}`;
}
