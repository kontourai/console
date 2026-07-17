import type {
  ConsoleTelemetryActionClass,
  ConsoleTelemetryActivityTimeline
} from "../../serverApiTypes";
import { ACTION_ORDER } from "./activityCostDerive";

/** One chart datum: a time bucket flattened to a per-action-class count map plus
 *  a short axis label. Keys match ACTION_ORDER so a stacked chart can map series
 *  1:1. */
export interface TimelinePoint {
  t: string;
  startedAt: string;
  total: number;
  edit: number;
  read: number;
  search: number;
  execute: number;
  web: number;
  delegate: number;
  other: number;
}

export interface ActivityTimelineView {
  points: TimelinePoint[];
  totalActions: number;
  classes: ConsoleTelemetryActionClass[];
}

/** Short axis label for a bucket start. Hourly → "14:00"; daily → "Jul 14".
 *  Empty string for an unparseable timestamp (never throws). Pure. */
export function formatBucketLabel(iso: string, bucket: "hour" | "day"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return bucket === "day"
    ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function deriveActivityTimeline(
  timeline: ConsoleTelemetryActivityTimeline | undefined
): ActivityTimelineView {
  const bucket = timeline?.bucket ?? "hour";
  const buckets = timeline?.buckets ?? [];
  const points: TimelinePoint[] = buckets.map((b) => {
    const by = b.byActionClass;
    return {
      t: formatBucketLabel(b.startedAt, bucket),
      startedAt: b.startedAt,
      total: b.total,
      edit: by.edit ?? 0,
      read: by.read ?? 0,
      search: by.search ?? 0,
      execute: by.execute ?? 0,
      web: by.web ?? 0,
      delegate: by.delegate ?? 0,
      other: by.other ?? 0
    };
  });
  const totalActions = points.reduce((sum, p) => sum + p.total, 0);
  return { points, totalActions, classes: ACTION_ORDER };
}
