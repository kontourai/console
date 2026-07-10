import React, { useMemo } from "react";
import { StatusBadge } from "@kontourai/ui/react";
import type { ConsoleActor } from "@kontourai/console-core";
import type { ConsoleTelemetryResponse } from "../serverApiTypes";
import { formatCompact, formatUsd } from "../utils/format";

// "The fleet" derives rows from telemetry facets/usage, then correlates liveness
// actor identities with the runtime session ids retained from telemetry records.
// Identities that cannot be joined remain visible in the honest fallback line.
export type CoordinationState = "held-fresh" | "held" | "reclaimable" | "human-held" | "ci";

export interface FleetActor {
  name: string;
  runtime?: string;
  events: number;
  costUsd: number;
  runtimeSessionIds: string[];
  coordinationState?: CoordinationState;
}

export interface UnjoinedLivenessActor {
  actor: ConsoleActor;
  state: "fresh" | "reclaimable";
}

export interface FleetViewModel {
  actors: FleetActor[];
  unjoinedActors: UnjoinedLivenessActor[];
}

interface FleetSectionProps {
  telemetry: ConsoleTelemetryResponse | null;
  /** Currently-active liveness sessions (OperatingState.actors) — flow-agents #295. */
  liveSessions?: ConsoleActor[];
  /** TTL-expired liveness sessions still within the bounded prune horizon. */
  reclaimableSessions?: ConsoleActor[];
  onOpen: () => void;
}

const COORDINATION_PRESENTATION: Record<CoordinationState, { label: string }> = {
  "held-fresh": { label: "held · fresh" },
  held: { label: "held" },
  reclaimable: { label: "reclaimable" },
  "human-held": { label: "human-held" },
  ci: { label: "CI · fresh" },
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
    byName.set(name, { name, events: activity.get(name) ?? 0, costUsd: u.estimatedCostUsd ?? 0, runtimeSessionIds: [] });
  }
  // Any active agent without recorded spend still belongs in the fleet.
  for (const [name, count] of activity) {
    if (!byName.has(name)) byName.set(name, { name, events: count, costUsd: 0, runtimeSessionIds: [] });
  }

  const sessionIdsByName = new Map<string, Set<string>>();
  for (const record of telemetry.records) {
    if (!record.agentName) continue;
    const actor = byName.get(record.agentName);
    if (!actor) continue;
    if (record.runtime && !actor.runtime) actor.runtime = record.runtime;
    if (!record.runtimeSessionId) continue;
    const sessionIds = sessionIdsByName.get(record.agentName) ?? new Set<string>();
    sessionIds.add(record.runtimeSessionId);
    sessionIdsByName.set(record.agentName, sessionIds);
  }
  for (const [name, sessionIds] of sessionIdsByName) {
    const actor = byName.get(name);
    if (actor) actor.runtimeSessionIds = [...sessionIds].sort();
  }

  return [...byName.values()].sort((a, b) => b.events - a.events || b.costUsd - a.costUsd);
}

function actorRuntimeSessionId(identity: string): string | undefined {
  const segments = identity.split(":");
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) return undefined;
  if (segments[1].startsWith("anc-")) return undefined;
  return segments[1];
}

export function deriveFleetViewModel(
  telemetry: ConsoleTelemetryResponse | null,
  liveSessions: ConsoleActor[] = [],
  reclaimableSessions: ConsoleActor[] = [],
): FleetViewModel {
  const actors = deriveActors(telemetry);
  const owners = new Map<string, FleetActor[]>();
  for (const actor of actors) {
    for (const sessionId of actor.runtimeSessionIds) {
      owners.set(sessionId, [...(owners.get(sessionId) ?? []), actor]);
    }
  }

  const unjoinedActors: UnjoinedLivenessActor[] = [];
  const join = (sessions: ConsoleActor[], state: "fresh" | "reclaimable") => {
    for (const actor of sessions) {
      const sessionId = actorRuntimeSessionId(actor.actor);
      const matches = sessionId ? owners.get(sessionId) : undefined;
      if (!matches || matches.length !== 1) {
        unjoinedActors.push({ actor, state });
        continue;
      }
      const match = matches[0];
      if (state === "fresh" || !match.coordinationState) {
        match.coordinationState = state === "fresh" ? "held-fresh" : "reclaimable";
      }
    }
  };
  join(liveSessions, "fresh");
  join(reclaimableSessions, "reclaimable");
  return { actors, unjoinedActors };
}

export function FleetSection({ telemetry, liveSessions, reclaimableSessions, onOpen }: FleetSectionProps) {
  const view = useMemo(
    () => deriveFleetViewModel(telemetry, liveSessions, reclaimableSessions),
    [telemetry, liveSessions, reclaimableSessions],
  );
  const actors = view.actors;
  const sessions = telemetry?.totals.sessionCount ?? 0;
  const unjoined = view.unjoinedActors;

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
        {unjoined.length > 0 ? (
          <p className="fleet-note">
            <span className="mono">{unjoined.length}</span> live session{unjoined.length === 1 ? "" : "s"} via the liveness relay:{" "}
            {unjoined.slice(0, 6).map(({ actor, state }, i) => (
              <span key={`${state}:${actor.id}`} className="mono">
                {i > 0 ? ", " : ""}{actor.actor} on {actor.subjectId} ({state})
              </span>
            ))}
            {unjoined.length > 6 ? ", …" : ""}
          </p>
        ) : (
          <p className="fleet-note">
            Coordination state joins liveness sessions to telemetry by runtime session id.
          </p>
        )}
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
