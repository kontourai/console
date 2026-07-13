// Read-model projection (console#180): turn the raw telemetry event stream into
// "what am I working on" — grouped by project, with the tools used, session count,
// and last activity. Pure and unit-testable; no React.
//
// Works entirely off fields we already receive today (project, toolName, sessionId,
// observedAt) — no emitter enrichment required. This is the first step from a
// firehose of mechanism toward an operator-legible activity view.
import type { ConsoleTelemetryRecentEvent } from "../../serverApiTypes";

export interface FocusToolCount {
  name: string;
  count: number;
}

export interface FocusEntry {
  /** The project the work is attributed to, or "unattributed" when absent. */
  project: string;
  /** True when this bucket has no real project — it cannot be used to scope. */
  unattributed: boolean;
  eventCount: number;
  sessionCount: number;
  /** Tools used in this project, most-used first. */
  tools: FocusToolCount[];
  /** Most recent observedAt across this project's events (ISO), if any. */
  lastAt?: string;
}

export const UNATTRIBUTED_PROJECT = "unattributed";

interface FocusAccumulator {
  count: number;
  sessions: Set<string>;
  tools: Map<string, number>;
  lastAt?: string;
  lastMs: number;
}

export function deriveFocusMap(events: ConsoleTelemetryRecentEvent[] | null | undefined): FocusEntry[] {
  const byProject = new Map<string, FocusAccumulator>();

  for (const event of events || []) {
    // Group non-blank projects by their RAW value (matches the server's untrimmed
    // filter comparison so a Focus click scopes identically to the grid's Projects
    // facet). Only a genuinely missing/blank project falls into "unattributed".
    const raw = event.project;
    const project = raw && raw.trim() ? raw : UNATTRIBUTED_PROJECT;
    let acc = byProject.get(project);
    if (!acc) {
      acc = { count: 0, sessions: new Set(), tools: new Map(), lastMs: -Infinity };
      byProject.set(project, acc);
    }
    acc.count += 1;
    if (event.sessionId) acc.sessions.add(event.sessionId);
    if (event.toolName) acc.tools.set(event.toolName, (acc.tools.get(event.toolName) || 0) + 1);
    if (event.observedAt) {
      const ms = Date.parse(event.observedAt);
      if (Number.isFinite(ms) && ms > acc.lastMs) {
        acc.lastMs = ms;
        acc.lastAt = event.observedAt;
      }
    }
  }

  return [...byProject.entries()]
    .map(([project, acc]) => ({
      project,
      unattributed: project === UNATTRIBUTED_PROJECT,
      eventCount: acc.count,
      sessionCount: acc.sessions.size,
      tools: [...acc.tools.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      ...(acc.lastAt ? { lastAt: acc.lastAt } : {}),
    }))
    // Most active project first; stable by name on ties.
    .sort((a, b) => b.eventCount - a.eventCount || a.project.localeCompare(b.project));
}
