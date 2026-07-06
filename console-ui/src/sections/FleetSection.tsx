import { useMemo } from "react";
import { StatusBadge } from "@kontourai/ui/react";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import { formatCompact, formatUsd } from "../utils/format";

// "The fleet" — who's active across the operation. v1 derives real "active actors" from telemetry
// (the agents/runtimes facets + per-agent usage); it is honest about its limit: the true
// coordination state — held · fresh / reclaimable / human-held / CI actor — comes from the
// flow-agents → console liveness relay (#295), which is not wired yet. Each row already accepts an
// optional `coordinationState`, so when the relay lands the pills light up with no redesign.

// Populated by #295 (the liveness relay). Absent today — we never fabricate held/reclaimable data.
export type CoordinationState = "held-fresh" | "held" | "reclaimable" | "human-held" | "ci";

interface FleetActor {
  name: string;
  runtime?: string;
  events: number;
  costUsd: number;
  coordinationState?: CoordinationState;
}

interface FleetSectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  onOpen: () => void;
}

const COORDINATION_PRESENTATION: Record<CoordinationState, { label: string; status: string }> = {
  "held-fresh": { label: "held · fresh", status: "fresh" },
  held: { label: "held", status: "active" },
  reclaimable: { label: "reclaimable", status: "stale" },
  "human-held": { label: "human-held", status: "waiting" },
  ci: { label: "CI · fresh", status: "fresh" },
};

function facetCounts(telemetry: ConsoleTelemetryResponse, id: string): Map<string, number> {
  const facet = telemetry.analytics.facets.find((f) => f.id === id);
  const map = new Map<string, number>();
  for (const c of facet?.counts || []) map.set(c.name, c.count);
  return map;
}

function initials(name: string): string {
  const parts = name.replace(/[:_/-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function deriveActors(telemetry: ConsoleTelemetryResponse | null): FleetActor[] {
  if (!telemetry) return [];
  const activity = facetCounts(telemetry, "agents");
  const byName = new Map<string, FleetActor>();

  // Cost-bearing agents first (usageByAgent carries spend + a stable label).
  for (const u of telemetry.analytics.usageByAgent || []) {
    const name = u.label || u.key;
    if (!name) continue;
    byName.set(name, { name, events: activity.get(name) ?? 0, costUsd: u.estimatedCostUsd ?? 0 });
  }
  // Any active agent without recorded spend still belongs in the fleet.
  for (const [name, count] of activity) {
    if (!byName.has(name)) byName.set(name, { name, events: count, costUsd: 0 });
  }

  return [...byName.values()].sort((a, b) => b.events - a.events || b.costUsd - a.costUsd);
}

export function FleetSection({ telemetry, onOpen }: FleetSectionProps) {
  const actors = useMemo(() => deriveActors(telemetry), [telemetry]);
  const sessions = telemetry?.totals.sessionCount ?? 0;

  return (
    <section className="ov-section">
      <header className="ov-head">
        <h2 className="ov-title">The fleet</h2>
        <span className="ov-sub">
          {actors.length > 0 ? `${actors.length} active actor${actors.length === 1 ? "" : "s"} · ${sessions} session${sessions === 1 ? "" : "s"}` : "who's active"}
        </span>
        <span className="ov-grow" />
        <button type="button" className="ov-link" onClick={onOpen}>see all sessions →</button>
      </header>

      <div className="fleet">
        {actors.length > 0 ? (
          <ul className="fleet-list">
            {actors.slice(0, 8).map((a) => (
              <FleetRow key={a.name} actor={a} />
            ))}
          </ul>
        ) : (
          <p className="now-idle">No active actors yet. Sessions posting telemetry to this hub appear here as they run.</p>
        )}
        <p className="fleet-note">
          Coordination state — <span className="mono">held · reclaimable · human-held</span> — arrives with the liveness relay; today this shows who is active from telemetry.
        </p>
      </div>
    </section>
  );
}

function FleetRow({ actor }: { actor: FleetActor }) {
  const coord = actor.coordinationState ? COORDINATION_PRESENTATION[actor.coordinationState] : null;
  return (
    <li className="fleet-row">
      <span className="fleet-avatar" aria-hidden="true">{initials(actor.name)}</span>
      <div className="fleet-main">
        <span className="fleet-name">{actor.name}</span>
        {actor.runtime ? <span className="fleet-runtime">{actor.runtime}</span> : null}
      </div>
      <span className="fleet-metric" title="events observed">{formatCompact(actor.events)} ev</span>
      <span className="fleet-metric" title="estimated spend">{formatUsd(actor.costUsd)}</span>
      {coord ? <StatusBadge status={coord.label} /> : <span className="fleet-active-dot" title="active" aria-label="active" />}
    </li>
  );
}
