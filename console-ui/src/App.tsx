import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_HUB_URL, IS_SAME_ORIGIN, getTelemetry, getEconomics, getEconomicsValue, getEconomicsDelegations, getSession, getFlowRunProjection, postSessionLogout } from "./hubClient";
import { useHubConnection } from "./hooks/useHubConnection";
import { useTheme } from "./hooks/useTheme";
import { useThrottledRefresh } from "./hooks/useThrottledRefresh";
import type { ConsoleEconomicsRollup, ConsoleEconomicsDelegationRollup, ConsoleTelemetryResponse, ConsoleValueComparison, TelemetryQueryInput } from "./serverApiTypes";
import { ConnectionBar } from "./sections/ConnectionBar";
import { EconomicsSection } from "./sections/EconomicsSection";
import { StageBand } from "./sections/StageBand";
import { TelemetrySection } from "./sections/TelemetrySection";
import { TimelineSection } from "./sections/TimelineSection";
import { withDrilldownFilter, type TelemetryRouteState } from "./utils/telemetryQuery";
import {
  parseAppRoute,
  serializeBoardPath,
  serializeEconomicsPath,
  serializeOperatePath,
  serializeOverviewPath,
  serializeTelemetryRoute,
  type AppView,
  type FleetRouteState,
} from "./utils/appRoute";
import type { FleetBucket } from "./sections/workers/derive";
import { WorkGrid } from "./sections/WorkGrid";
import { OverviewSection, type OverviewTarget } from "./sections/OverviewSection";
import { BoardSection } from "./sections/BoardSection";

// SSE-triggered HTTP refetches (telemetry, economics) are throttled to at
// most one per this many ms (console#252) — a burst of `record.accepted`
// events during a busy stretch collapses into a single refetch instead of one
// HTTP request per event. The OperatingState-derived views (fleet grid, Board,
// WorkGrid, "Needs you", "At a glance") need no such throttling: they render
// directly from `state`, which useHubConnection already updates in place from
// the SSE payload itself — there is no separate fetch to coalesce there.
const SSE_REFRESH_THROTTLE_MS = 1500;

const CONNECTION_STORAGE_KEY = "kontour.console.connection.v1";

interface StoredConnection {
  hubUrl?: string;
  token?: string;
  tenantId?: string;
}

// Persist the token-auth connection so an operator connects once instead of
// re-entering the hub URL/tenant/token on every reload. Token auth only — the
// hosted HttpOnly cookie session (same-origin) remains the more secure path and
// is never written here. Tradeoff: a token in localStorage is readable by XSS;
// acceptable for a self-hosted operator console, and the suite's strict CSP +
// telemetry redaction limit that surface.
function loadStoredConnection(): StoredConnection {
  try {
    const raw = window.localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredConnection;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredConnection(value: StoredConnection): void {
  try {
    window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures (private mode / quota); the session still works in-memory.
  }
}

export default function App() {
  const initialRoute = parseAppRoute(window.location.pathname, window.location.search);
  const [storedConnection] = useState(loadStoredConnection);
  const [hubUrl, setHubUrl] = useState(storedConnection.hubUrl || DEFAULT_HUB_URL);
  const [draftHubUrl, setDraftHubUrl] = useState(storedConnection.hubUrl || DEFAULT_HUB_URL);
  const [authToken, setAuthToken] = useState(storedConnection.token || "");
  const [draftAuthToken, setDraftAuthToken] = useState(storedConnection.token || "");
  const [tenantId, setTenantId] = useState(storedConnection.tenantId || "");
  const [draftTenantId, setDraftTenantId] = useState(storedConnection.tenantId || "");
  const [view, setView] = useState<AppView>(initialRoute.view);
  const [telemetryRoute, setTelemetryRoute] = useState<TelemetryRouteState>(initialRoute.telemetry);
  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQueryInput>(initialRoute.telemetry.query);
  const [telemetry, setTelemetry] = useState<ConsoleTelemetryResponse | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [economics, setEconomics] = useState<ConsoleEconomicsRollup | null>(null);
  const [economicsValue, setEconomicsValue] = useState<ConsoleValueComparison | null>(null);
  const [economicsDelegations, setEconomicsDelegations] = useState<ConsoleEconomicsDelegationRollup | null>(null);
  const [economicsError, setEconomicsError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialRoute.gateId ? `gate:${initialRoute.gateId}` : null
  );
  // A pending deep-link target for the Operate WorkGrid: when a "Needs you" card
  // or a `/gate/:id` route routes here, this names the node ("<kind>:<id>") to
  // scroll to + highlight (#135, #252).
  const [operateAnchor, setOperateAnchor] = useState<string | null>(null);
  // A `/gate/:id` deep-link target that hasn't matched a rendered gate row yet —
  // e.g. the page just loaded and the hub's initial SSE `state` hasn't arrived.
  // Re-checked below every time `state` changes; consumed (cleared) once found,
  // at which point it seeds `operateAnchor` for WorkGrid's scroll-into-view.
  const [pendingGateId, setPendingGateId] = useState<string | null>(initialRoute.gateId);
  // Board's focused work item (`/run/:id`, console#252) — the underlying
  // process id. BoardSection renders its drill-down once the id matches a
  // rendered card, so no anchor/retry plumbing is needed here (unlike gates).
  const [boardFocusId, setBoardFocusId] = useState<string | null>(initialRoute.runId);
  const [fleetFilter, setFleetFilter] = useState<FleetBucket | null>(initialRoute.fleet.filter);
  const [fleetArchiveOpen, setFleetArchiveOpen] = useState<boolean>(initialRoute.fleet.archiveOpen);
  const { theme, toggleTheme } = useTheme();

  // Hosted session state: set when GET /session returns 200 at the same origin.
  // When true, auth is via the HttpOnly session cookie — no Authorization header needed.
  const [cookieAuth, setCookieAuth] = useState(false);
  const [sessionTenantId, setSessionTenantId] = useState<string | null>(null);

  // On startup: check for a hosted session when running at the same origin.
  useEffect(() => {
    if (!IS_SAME_ORIGIN) return;
    getSession(DEFAULT_HUB_URL).then((session) => {
      if (session) {
        setCookieAuth(true);
        setSessionTenantId(session.tenantId);
        // Pre-fill the connect bar's draft tenant field so it reflects the session.
        setTenantId(session.tenantId);
        setDraftTenantId(session.tenantId);
      }
    });
  }, []);

  // Memoized so downstream fetchers (BoardSection/WorkGrid projection reads)
  // keep a stable identity across SSE-driven re-renders — otherwise an open
  // drill-down would refetch and flicker on every incoming event.
  const auth = useMemo(
    () =>
      cookieAuth
        ? { useCookie: true as const, tenantId: sessionTenantId || undefined }
        : { token: authToken || undefined, tenantId: tenantId || undefined },
    [cookieAuth, sessionTenantId, authToken, tenantId]
  );

  const { status, state, lastAccepted, lastTelemetryUpdated, error } = useHubConnection(hubUrl, auth);

  const fetchProjection = useCallback(
    (runId: string) => getFlowRunProjection(hubUrl, runId, auth),
    [hubUrl, auth]
  );

  // `/gate/:id` deep link (console#252): once the target gate appears in a
  // live `state` update, seed `operateAnchor` so WorkGrid's existing #135
  // scroll-into-view + select mechanism picks it up, then stop re-checking.
  useEffect(() => {
    if (!pendingGateId) return;
    const found = (state.gates || []).some((gate) => gate.id === pendingGateId);
    if (found) {
      setOperateAnchor(`gate:${pendingGateId}`);
      setPendingGateId(null);
    }
  }, [state, pendingGateId]);

  useEffect(() => {
    function syncViewFromHistory() {
      const route = parseAppRoute(window.location.pathname, window.location.search);
      setView(route.view);
      setFleetFilter(route.fleet.filter);
      setFleetArchiveOpen(route.fleet.archiveOpen);
      setBoardFocusId(route.runId);
      setSelectedNodeId(route.gateId ? `gate:${route.gateId}` : null);
      setPendingGateId(route.gateId);
      if (route.view === "telemetry") {
        setTelemetryRoute(route.telemetry);
        setTelemetryQuery(route.telemetry.query);
      }
    }
    window.addEventListener("popstate", syncViewFromHistory);
    return () => window.removeEventListener("popstate", syncViewFromHistory);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshTelemetry() {
      try {
        const nextTelemetry = await getTelemetry(hubUrl, auth, telemetryQuery);
        if (cancelled) return;
        setTelemetry(nextTelemetry);
        setTelemetryError(null);
      } catch (refreshError) {
        if (cancelled) return;
        setTelemetryError(refreshError instanceof Error ? refreshError.message : "Telemetry unavailable");
      }
    }

    refreshTelemetry();
    const intervalId = window.setInterval(refreshTelemetry, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // The throttled SSE trigger below covers live record/telemetry updates;
    // this effect's own deps cover hub/auth/query changes and the steady poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubUrl, authToken, tenantId, cookieAuth, telemetryQuery]);

  // Live SSE trigger for telemetry (console#252): throttled so a burst of
  // `record.accepted`/`telemetry.updated` events collapses into at most one
  // refetch per SSE_REFRESH_THROTTLE_MS, instead of one HTTP request per event.
  const telemetrySseTrigger = `${lastAccepted?.delivery?.recordId ?? ""}:${lastTelemetryUpdated?.telemetry?.generatedAt ?? ""}`;
  useThrottledRefresh(
    telemetrySseTrigger,
    SSE_REFRESH_THROTTLE_MS,
    useCallback(() => {
      getTelemetry(hubUrl, auth, telemetryQuery)
        .then((next) => setTelemetry(next))
        .catch((refreshError) => setTelemetryError(refreshError instanceof Error ? refreshError.message : "Telemetry unavailable"));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hubUrl, auth, telemetryQuery])
  );

  // Economics read-models are polled only while the Economics view is open (the
  // rollups are cheap to rebuild server-side, but there's no reason to poll them
  // from other views).
  useEffect(() => {
    if (view !== "economics") return;
    let cancelled = false;

    async function refreshEconomics() {
      try {
        const [rollup, value, delegationsRollup] = await Promise.all([
          getEconomics(hubUrl, auth),
          getEconomicsValue(hubUrl, auth),
          getEconomicsDelegations(hubUrl, auth)
        ]);
        if (cancelled) return;
        setEconomics(rollup);
        setEconomicsValue(value);
        setEconomicsDelegations(delegationsRollup);
        setEconomicsError(null);
      } catch (refreshError) {
        if (cancelled) return;
        setEconomicsError(refreshError instanceof Error ? refreshError.message : "Economics unavailable");
      }
    }

    refreshEconomics();
    const intervalId = window.setInterval(refreshEconomics, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hubUrl, authToken, tenantId, cookieAuth]);

  // Live SSE trigger for economics — same throttle as telemetry, only while open.
  useThrottledRefresh(
    view === "economics" ? lastAccepted?.delivery?.recordId ?? "" : "",
    SSE_REFRESH_THROTTLE_MS,
    useCallback(() => {
      if (view !== "economics") return;
      Promise.all([getEconomics(hubUrl, auth), getEconomicsValue(hubUrl, auth), getEconomicsDelegations(hubUrl, auth)])
        .then(([rollup, value, delegationsRollup]) => {
          setEconomics(rollup);
          setEconomicsValue(value);
          setEconomicsDelegations(delegationsRollup);
        })
        .catch((refreshError) => setEconomicsError(refreshError instanceof Error ? refreshError.message : "Economics unavailable"));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, hubUrl, auth])
  );

  function submitHubUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextHubUrl = draftHubUrl.trim() || DEFAULT_HUB_URL;
    const nextToken = draftAuthToken.trim();
    const nextTenant = draftTenantId.trim();
    setHubUrl(nextHubUrl);
    setAuthToken(nextToken);
    setTenantId(nextTenant);
    // Persist so the operator connects once instead of re-entering on every reload.
    saveStoredConnection({ hubUrl: nextHubUrl, token: nextToken, tenantId: nextTenant });
  }

  async function handleSignOut() {
    await postSessionLogout(hubUrl);
    setCookieAuth(false);
    setSessionTenantId(null);
    // Reload to land on the gate page.
    window.location.reload();
  }

  function pushPath(nextPath: string) {
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  function currentGateId(): string | null {
    return selectedNodeId && selectedNodeId.startsWith("gate:") ? selectedNodeId.slice("gate:".length) : null;
  }

  function pathForView(nextView: AppView): string {
    switch (nextView) {
      case "telemetry":
        return serializeTelemetryRoute(telemetryQuery, telemetryRoute.drilldown);
      case "board":
        return serializeBoardPath(boardFocusId);
      case "operate":
        return serializeOperatePath(currentGateId());
      case "economics":
        return serializeEconomicsPath();
      default:
        return serializeOverviewPath({ filter: fleetFilter, archiveOpen: fleetArchiveOpen });
    }
  }

  function selectView(nextView: AppView) {
    setView(nextView);
    pushPath(pathForView(nextView));
  }

  function changeTelemetryQuery(nextQuery: TelemetryQueryInput) {
    const scopedQuery = withDrilldownFilter(nextQuery, telemetryRoute.drilldown);
    const nextUrl = serializeTelemetryRoute(scopedQuery, telemetryRoute.drilldown);
    setTelemetryQuery(scopedQuery);
    setTelemetryRoute({ ...telemetryRoute, path: nextUrl.split("?")[0], query: scopedQuery });
    pushPath(nextUrl);
  }

  function openTelemetryRoute(nextRoute: TelemetryRouteState) {
    const scopedQuery = withDrilldownFilter(nextRoute.query, nextRoute.drilldown);
    const nextUrl = serializeTelemetryRoute(scopedQuery, nextRoute.drilldown);
    setView("telemetry");
    setTelemetryRoute({ ...nextRoute, path: nextUrl.split("?")[0], query: scopedQuery });
    setTelemetryQuery(scopedQuery);
    pushPath(nextUrl);
  }

  // Fleet header (console#251/#252): the count-filter + archive toggle sync to
  // the URL (`/`, `/archive`, `?filter=`) so a filtered/archived view is
  // shareable and survives reload.
  function changeFleetFilter(next: FleetBucket | null) {
    setFleetFilter(next);
    pushPath(serializeOverviewPath({ filter: next, archiveOpen: fleetArchiveOpen }));
  }

  function changeFleetArchiveOpen(next: boolean) {
    setFleetArchiveOpen(next);
    pushPath(serializeOverviewPath({ filter: fleetFilter, archiveOpen: next }));
  }

  // Board card selection (console#252): syncs `/run/:id` so a focused work
  // item is a real, bookmarkable/shareable URL, not just in-memory state.
  function changeBoardFocusId(nextId: string | null) {
    setBoardFocusId(nextId);
    pushPath(serializeBoardPath(nextId));
  }

  // WorkGrid node selection (console#252): only a GATE selection is reflected
  // into the URL (`/gate/:id`) — claim/action selection stays local-only, same
  // scope boundary the task calls out (full drill-in is #253).
  function handleNodeSelect(nodeId: string | null) {
    setSelectedNodeId(nodeId);
    const gateId = nodeId && nodeId.startsWith("gate:") ? nodeId.slice("gate:".length) : null;
    pushPath(serializeOperatePath(gateId));
  }

  return (
    <main className="shell">
      <ConnectionBar
        draftHubUrl={draftHubUrl}
        draftAuthToken={draftAuthToken}
        draftTenantId={draftTenantId}
        status={status}
        theme={theme}
        cookieAuth={cookieAuth}
        sessionTenantId={sessionTenantId}
        onDraftHubUrlChange={setDraftHubUrl}
        onDraftAuthTokenChange={setDraftAuthToken}
        onDraftTenantIdChange={setDraftTenantId}
        onSubmit={submitHubUrl}
        onThemeToggle={toggleTheme}
        onSignOut={handleSignOut}
      />
      <nav className="view-tabs" aria-label="Console views">
        <ViewTab view="overview" current={view} href={pathForView("overview")} label="Overview" onSelect={selectView} />
        <ViewTab view="board" current={view} href={pathForView("board")} label="Board" onSelect={selectView} />
        <ViewTab view="operate" current={view} href={pathForView("operate")} label="Operate" onSelect={selectView} />
        <ViewTab view="telemetry" current={view} href={pathForView("telemetry")} label="Telemetry" onSelect={selectView} />
        <ViewTab view="economics" current={view} href={pathForView("economics")} label="Economics" onSelect={selectView} />
      </nav>
      {view === "overview" ? (
        <OverviewSection
          state={state}
          telemetry={telemetry}
          liveStatus={status === "connected" ? "live" : `stream ${status}`}
          fleetFilter={fleetFilter}
          onFleetFilterChange={changeFleetFilter}
          fleetArchiveOpen={fleetArchiveOpen}
          onFleetArchiveOpenChange={changeFleetArchiveOpen}
          onOpen={(target: OverviewTarget, anchor?: string) => {
            if (target === "operate") {
              // Bypass selectView here: it would build the Operate URL from
              // the CURRENT (stale, pre-update) selectedNodeId, not the anchor
              // this click is about to select.
              setOperateAnchor(anchor ?? null);
              setSelectedNodeId(anchor ?? null);
              setView(target);
              const gateId = anchor && anchor.startsWith("gate:") ? anchor.slice("gate:".length) : null;
              pushPath(serializeOperatePath(gateId));
              return;
            }
            setOperateAnchor(null);
            selectView(target);
          }}
        />
      ) : view === "board" ? (
        <BoardSection
          state={state}
          fetchProjection={fetchProjection}
          selectedId={boardFocusId}
          onSelectedIdChange={changeBoardFocusId}
        />
      ) : view === "operate" ? (
        <>
          <StageBand state={state} />
          {error ? <div className="notice">{error}</div> : null}
          <WorkGrid
            state={state}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            anchor={operateAnchor}
            onAnchorConsumed={() => setOperateAnchor(null)}
            fetchChildProjection={fetchProjection}
          />
          <TimelineSection state={state} lastAccepted={lastAccepted} />
        </>
      ) : view === "telemetry" ? (
        <TelemetrySection
          telemetry={telemetry}
          error={telemetryError}
          query={telemetryQuery}
          drilldown={telemetryRoute.drilldown}
          onQueryChange={changeTelemetryQuery}
          onOpenRoute={openTelemetryRoute}
          liveStatus={status === "connected" ? "live stream connected" : `stream ${status}`}
          lastLiveAt={lastTelemetryUpdated?.telemetry?.generatedAt || null}
        />
      ) : (
        <EconomicsSection
          rollup={economics}
          value={economicsValue}
          delegations={economicsDelegations}
          error={economicsError}
          liveStatus={status === "connected" ? "live stream connected" : `stream ${status}`}
          lastLiveAt={lastTelemetryUpdated?.telemetry?.generatedAt || null}
        />
      )}
    </main>
  );
}

// A real <a href> (console#252 a11y constraint): cmd/ctrl/middle-click opens
// a new tab/window like any ordinary link instead of being swallowed by a
// fake button, while a plain left-click still does an in-place SPA
// navigation via `history.pushState` (no full page reload).
function ViewTab({
  view,
  current,
  href,
  label,
  onSelect,
}: {
  view: AppView;
  current: AppView;
  href: string;
  label: string;
  onSelect: (view: AppView) => void;
}) {
  return (
    <a
      href={href}
      className={current === view ? "active" : ""}
      aria-current={current === view ? "page" : undefined}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // let the browser handle it
        event.preventDefault();
        onSelect(view);
      }}
    >
      {label}
    </a>
  );
}
