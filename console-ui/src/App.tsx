import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { DEFAULT_HUB_URL, getTelemetry } from "./hubClient";
import { useHubConnection } from "./hooks/useHubConnection";
import { useTheme } from "./hooks/useTheme";
import type { ConsoleTelemetryResponse, TelemetryQueryInput } from "./serverApiTypes";
import { ConnectionBar } from "./sections/ConnectionBar";
import { StageBand } from "./sections/StageBand";
import { TelemetrySection } from "./sections/TelemetrySection";
import { TimelineSection } from "./sections/TimelineSection";
import { DEFAULT_TELEMETRY_QUERY, parseTelemetryRoute, serializeTelemetryRoute, withDrilldownFilter, type TelemetryRouteState } from "./utils/telemetryQuery";
import { WorkGrid } from "./sections/WorkGrid";

type AppView = "operate" | "telemetry";

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
  const auth = { token: authToken || undefined, tenantId: tenantId || undefined };
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
  }, [hubUrl, authToken, tenantId, telemetryQuery, lastAccepted?.delivery?.recordId, lastTelemetryUpdated?.telemetry?.generatedAt]);

  function submitHubUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHubUrl(draftHubUrl.trim() || DEFAULT_HUB_URL);
    setAuthToken(draftAuthToken.trim());
    setTenantId(draftTenantId.trim());
  }

  function selectView(nextView: AppView) {
    setView(nextView);
    const nextPath = nextView === "telemetry" ? serializeTelemetryRoute(telemetryQuery, telemetryRoute.drilldown) : "/";
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
        onDraftHubUrlChange={setDraftHubUrl}
        onDraftAuthTokenChange={setDraftAuthToken}
        onDraftTenantIdChange={setDraftTenantId}
        onSubmit={submitHubUrl}
        onThemeToggle={toggleTheme}
      />
      <nav className="view-tabs" aria-label="Console views">
        <button type="button" className={view === "operate" ? "active" : ""} onClick={() => selectView("operate")}>Operate</button>
        <button type="button" className={view === "telemetry" ? "active" : ""} onClick={() => selectView("telemetry")}>Telemetry</button>
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
      ) : (
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
      )}
    </main>
  );
}

function viewFromPath(pathname: string): AppView {
  return pathname === "/telemetry" || pathname.startsWith("/telemetry/") ? "telemetry" : "operate";
}
