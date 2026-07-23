import type { FleetBucket } from "../sections/workers/derive";
import {
  DEFAULT_TELEMETRY_QUERY,
  parseTelemetryRoute,
  serializeTelemetryRoute,
  type TelemetryRouteState,
} from "./telemetryQuery";

/**
 * Top-level, URL-addressable app views (console#252). Deep-linkable +
 * history-synced: `parseAppRoute` reads the current `location.pathname` +
 * `location.search` into a typed route on load and on every `popstate`;
 * `serialize*Path` functions build the matching path back so a `pushState`
 * round-trips through `parseAppRoute` to the same route (see
 * `test/appRoute.test.ts`).
 *
 * Route shape:
 *   /                     -> overview
 *   /archive              -> overview, fleet archive section expanded
 *   /board                -> board
 *   /run/:id              -> board, focused on process/run :id (#253 fills the
 *                            drill-in body; this route + BoardSection's
 *                            selectedId wiring is the part #252 owns)
 *   /operate              -> operate
 *   /gate/:id             -> operate, focused on gate :id (reuses the existing
 *                            WorkGrid anchor/selection mechanism from #135)
 *   /telemetry[/...]      -> telemetry (delegates to utils/telemetryQuery.ts)
 *   /economics            -> economics
 *
 * `?filter=<bucket>` is carried on `/` and `/archive` for the fleet header's
 * count filter (console#251's WorkerFleetSection) so a filtered fleet view is
 * shareable/reloadable independent of the archive toggle.
 */
export type AppView = "overview" | "board" | "operate" | "telemetry" | "economics";

export interface FleetRouteState {
  filter: FleetBucket | null;
  archiveOpen: boolean;
}

export interface AppRoute {
  view: AppView;
  /** Set only for `/run/:id` — the Board's focused process/run id. */
  runId: string | null;
  /** Set only for `/gate/:id` — the Operate WorkGrid's focused gate id. */
  gateId: string | null;
  fleet: FleetRouteState;
  telemetry: TelemetryRouteState;
}

const FLEET_BUCKETS = new Set<FleetBucket>(["active", "waiting-on-you", "stalled", "archived"]);

export function parseAppRoute(pathname: string, search: string): AppRoute {
  const fleet = parseFleetRouteState(pathname, search);

  const runMatch = pathname.match(/^\/run\/([^/]+)\/?$/);
  if (runMatch) {
    const runId = decodeSegment(runMatch[1]);
    if (runId) return { view: "board", runId, gateId: null, fleet, telemetry: emptyTelemetryRoute() };
  }

  const gateMatch = pathname.match(/^\/gate\/([^/]+)\/?$/);
  if (gateMatch) {
    const gateId = decodeSegment(gateMatch[1]);
    if (gateId) return { view: "operate", runId: null, gateId, fleet, telemetry: emptyTelemetryRoute() };
  }

  if (pathname === "/telemetry" || pathname.startsWith("/telemetry/")) {
    return { view: "telemetry", runId: null, gateId: null, fleet, telemetry: parseTelemetryRoute(pathname, search) };
  }
  if (pathname === "/economics") return { view: "economics", runId: null, gateId: null, fleet, telemetry: emptyTelemetryRoute() };
  if (pathname === "/board") return { view: "board", runId: null, gateId: null, fleet, telemetry: emptyTelemetryRoute() };
  if (pathname === "/operate") return { view: "operate", runId: null, gateId: null, fleet, telemetry: emptyTelemetryRoute() };

  // "/", "/archive", and anything unrecognized fall back to the Overview —
  // an unknown path is never a hard 404 in this single-page shell.
  return { view: "overview", runId: null, gateId: null, fleet, telemetry: emptyTelemetryRoute() };
}

export function serializeOverviewPath(fleet: FleetRouteState): string {
  const path = fleet.archiveOpen ? "/archive" : "/";
  const params = new URLSearchParams();
  if (fleet.filter) params.set("filter", fleet.filter);
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function serializeBoardPath(runId?: string | null): string {
  return runId ? `/run/${encodeURIComponent(runId)}` : "/board";
}

export function serializeOperatePath(gateId?: string | null): string {
  return gateId ? `/gate/${encodeURIComponent(gateId)}` : "/operate";
}

export function serializeEconomicsPath(): string {
  return "/economics";
}

export { serializeTelemetryRoute };

function parseFleetRouteState(pathname: string, search: string): FleetRouteState {
  const params = new URLSearchParams(search);
  const filterParam = params.get("filter");
  const filter = filterParam && FLEET_BUCKETS.has(filterParam as FleetBucket) ? (filterParam as FleetBucket) : null;
  return { filter, archiveOpen: pathname === "/archive" };
}

function emptyTelemetryRoute(): TelemetryRouteState {
  return { path: "/telemetry", query: DEFAULT_TELEMETRY_QUERY };
}

function decodeSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded ? decoded : null;
  } catch {
    return null;
  }
}
