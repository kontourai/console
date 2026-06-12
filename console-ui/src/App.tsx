import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { DEFAULT_HUB_URL, IS_SAME_ORIGIN, getTelemetry, getSession, postSessionLogout } from "./hubClient";
import { useHubConnection } from "./hooks/useHubConnection";
import { useTheme } from "./hooks/useTheme";
import type { ConsoleTelemetryResponse, TelemetryQueryInput } from "./serverApiTypes";
import { ConnectionBar } from "./sections/ConnectionBar";
import { EnvironmentSection } from "./sections/EnvironmentSection";
import { StageBand } from "./sections/StageBand";
import { TelemetrySection } from "./sections/TelemetrySection";
import { TimelineSection } from "./sections/TimelineSection";
import { DEFAULT_TELEMETRY_QUERY, parseTelemetryRoute, serializeTelemetryRoute, withDrilldownFilter, type TelemetryRouteState } from "./utils/telemetryQuery";
import { WorkGrid } from "./sections/WorkGrid";

type AppView = "operate" | "telemetry" | "environment";

export default function App() {
  const initialRoute = parseTelemetryRoute(window.location.pathname, window.location.search);
  const [hubUrl, setHubUrl] = useState(DEFAULT_HUB_URL);
  const [draftHubUrl, setDraftHubUrl] = useState(DEFAULT_HUB_URL);
  const [authToken, setAuthToken] = useState("");
  const [draftAuthToken, setDraftAuthToken] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [draftTenantId, setDraftTenantId] = useState("");
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname));
  const [telemetryRoute, setTelemetryRoute] = useState<TelemetryRouteState>(initialRoute);
  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQueryInput>(() => viewFromPath(window.location.pathname) === "telemetry" ? initialRoute.query : DEFAULT_TELEMETRY_QUERY);
  const [telemetry, setTelemetry] = useState<ConsoleTelemetryResponse | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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

  const auth = cookieAuth
    ? { useCookie: true as const, tenantId: sessionTenantId || undefined }
    : { token: authToken || undefined, tenantId: tenantId || undefined };

  const { status, state, lastAccepted, lastTelemetryUpdated, error } = useHubConnection(hubUrl, auth);

  useEffect(() => {
    function syncViewFromHistory() {
      const nextView = viewFromPath(window.location.pathname);
      setView(nextView);
      if (nextView === "telemetry") {
        const nextRoute = parseTelemetryRoute(window.location.pathname, window.location.search);
        setTelemetryRoute(nextRoute);
        setTelemetryQuery(nextRoute.query);
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
  }, [hubUrl, authToken, tenantId, cookieAuth, telemetryQuery, lastAccepted?.delivery?.recordId, lastTelemetryUpdated?.telemetry?.generatedAt]);

  function submitHubUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHubUrl(draftHubUrl.trim() || DEFAULT_HUB_URL);
    setAuthToken(draftAuthToken.trim());
    setTenantId(draftTenantId.trim());
  }

  async function handleSignOut() {
    await postSessionLogout(hubUrl);
    setCookieAuth(false);
    setSessionTenantId(null);
    // Reload to land on the gate page.
    window.location.reload();
  }

  function selectView(nextView: AppView) {
    setView(nextView);
    const nextPath = nextView === "telemetry"
      ? serializeTelemetryRoute(telemetryQuery, telemetryRoute.drilldown)
      : nextView === "environment"
        ? "/environment"
        : "/";
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  function changeTelemetryQuery(nextQuery: TelemetryQueryInput) {
    const scopedQuery = withDrilldownFilter(nextQuery, telemetryRoute.drilldown);
    const nextUrl = serializeTelemetryRoute(scopedQuery, telemetryRoute.drilldown);
    setTelemetryQuery(scopedQuery);
    setTelemetryRoute({ ...telemetryRoute, path: nextUrl.split("?")[0], query: scopedQuery });
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  }

  function openTelemetryRoute(nextRoute: TelemetryRouteState) {
    const scopedQuery = withDrilldownFilter(nextRoute.query, nextRoute.drilldown);
    const nextUrl = serializeTelemetryRoute(scopedQuery, nextRoute.drilldown);
    setView("telemetry");
    setTelemetryRoute({ ...nextRoute, path: nextUrl.split("?")[0], query: scopedQuery });
    setTelemetryQuery(scopedQuery);
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.pushState(null, "", nextUrl);
    }
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
        <button type="button" className={view === "operate" ? "active" : ""} onClick={() => selectView("operate")}>Operate</button>
        <button type="button" className={view === "telemetry" ? "active" : ""} onClick={() => selectView("telemetry")}>Telemetry</button>
        <button type="button" className={view === "environment" ? "active" : ""} onClick={() => selectView("environment")}>Environment</button>
      </nav>
      {view === "operate" ? (
        <>
          <StageBand state={state} />
          {error ? <div className="notice">{error}</div> : null}
          <WorkGrid
            state={state}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
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
        <EnvironmentSection
          state={state}
          telemetry={telemetry}
          liveStatus={status === "connected" ? "live stream connected" : `stream ${status}`}
          lastLiveAt={lastTelemetryUpdated?.telemetry?.generatedAt || null}
        />
      )}
    </main>
  );
}

function viewFromPath(pathname: string): AppView {
  if (pathname === "/telemetry" || pathname.startsWith("/telemetry/")) return "telemetry";
  if (pathname === "/environment") return "environment";
  return "operate";
}
