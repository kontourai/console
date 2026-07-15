import type {
  ConsoleTelemetryActionClass,
  ConsoleTelemetryActionClassSummary,
  ConsoleTelemetryTurnCost,
  ConsoleTelemetryTurnCostSummary
} from "../../serverApiTypes";

// Fixed visual order for the activity bar so segment positions stay stable as
// counts shift; the legend is ordered by volume for readability.
export const ACTION_ORDER: ConsoleTelemetryActionClass[] = [
  "edit",
  "search",
  "read",
  "execute",
  "web",
  "delegate",
  "other"
];

const KNOWN = new Set<string>(ACTION_ORDER);

/** Coerce any class the server might send to a known one, so a future 8th class
 *  shipped ahead of a matching UI deploy renders as "other" (a visible grey
 *  segment ordered last) rather than an invisible, unordered gap. */
export function knownActionClass(value: string): ConsoleTelemetryActionClass {
  return (KNOWN.has(value) ? value : "other") as ConsoleTelemetryActionClass;
}

export interface ActivityView {
  totalActions: number;
  /** Fixed ACTION_ORDER — for the segmented bar. */
  barSegments: ConsoleTelemetryActionClassSummary[];
  /** Volume order (count desc) — for the legend. */
  legend: ConsoleTelemetryActionClassSummary[];
}

export function deriveActivity(actionClasses: ConsoleTelemetryActionClassSummary[]): ActivityView {
  const totalActions = actionClasses.reduce((sum, entry) => sum + entry.count, 0);
  const orderIndex = (entry: ConsoleTelemetryActionClassSummary): number => {
    const index = ACTION_ORDER.indexOf(knownActionClass(entry.actionClass));
    return index === -1 ? ACTION_ORDER.length : index;
  };
  const barSegments = [...actionClasses].sort((a, b) => orderIndex(a) - orderIndex(b));
  const legend = [...actionClasses].sort((a, b) => b.count - a.count);
  return { totalActions, barSegments, legend };
}

export interface TurnCostView {
  turnCount: number;
  totalCost: number;
  avgPerTurn: number;
  topTurns: ConsoleTelemetryTurnCost[];
}

export function deriveTurnCost(
  costPerTurn: ConsoleTelemetryTurnCostSummary | undefined,
  limit = 8
): TurnCostView {
  const turnCount = costPerTurn?.turnCount ?? 0;
  const totalCost = costPerTurn?.totalEstimatedCostUsd ?? 0;
  const avgPerTurn = turnCount > 0 ? totalCost / turnCount : 0;
  const topTurns = (costPerTurn?.turns ?? []).slice(0, limit);
  return { turnCount, totalCost, avgPerTurn, topTurns };
}

/** Short text summary of the activity mix for the bar's aria-label. Reports the
 *  top classes and, when truncated, how many more exist so the percentages
 *  aren't silently incomplete. */
export function activityAltText(legend: ConsoleTelemetryActionClassSummary[], total: number): string {
  if (total <= 0) return "No tool activity";
  const shown = legend.slice(0, 4);
  const parts = shown.map((entry) => `${entry.label} ${Math.round((entry.count / total) * 100)}%`);
  const remaining = legend.length - shown.length;
  if (remaining > 0) parts.push(`+${remaining} more`);
  return `Activity by action class: ${parts.join(", ")}`;
}
