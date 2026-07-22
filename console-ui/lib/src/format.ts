/** Human relative time from an ISO string: "just now", "3m ago", "2h ago", "5d ago". */
export function formatRelative(value?: string | null, now = Date.now()): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const ms = Math.max(0, now - then);
  const s = Math.floor(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
