import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { DEFAULT_HUB_URL, getTelemetry } from "./hubClient";
import { useHubConnection } from "./hooks/useHubConnection";
import type { ConsoleTelemetryResponse } from "./serverApiTypes";
import { ConnectionBar } from "./sections/ConnectionBar";
import { StageBand } from "./sections/StageBand";
import { TelemetrySection } from "./sections/TelemetrySection";
import { TimelineSection } from "./sections/TimelineSection";
import { WorkGrid } from "./sections/WorkGrid";

type AppView = "operate" | "telemetry";

export default function App() {
  const [hubUrl, setHubUrl] = useState(DEFAULT_HUB_URL);
  const [draftHubUrl, setDraftHubUrl] = useState(DEFAULT_HUB_URL);
  const [authToken, setAuthToken] = useState("");
  const [draftAuthToken, setDraftAuthToken] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [draftTenantId, setDraftTenantId] = useState("");
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname));
  const [telemetry, setTelemetry] = useState<ConsoleTelemetryResponse | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const auth = { token: authToken || undefined, tenantId: tenantId || undefined };
  const { status, state, lastAccepted, lastTelemetryUpdated, error } = useHubConnection(hubUrl, auth);

  useEffect(() => {
    function syncViewFromHistory() {
      setView(viewFromPath(window.location.pathname));
    }
    window.addEventListener("popstate", syncViewFromHistory);
    return () => window.removeEventListener("popstate", syncViewFromHistory);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshTelemetry() {
      try {
        const nextTelemetry = await getTelemetry(hubUrl, auth);
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
  }, [hubUrl, authToken, tenantId, lastAccepted?.delivery?.recordId, lastTelemetryUpdated?.telemetry?.generatedAt]);

  function submitHubUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHubUrl(draftHubUrl.trim() || DEFAULT_HUB_URL);
    setAuthToken(draftAuthToken.trim());
    setTenantId(draftTenantId.trim());
  }

  function selectView(nextView: AppView) {
    setView(nextView);
    const nextPath = nextView === "telemetry" ? "/telemetry" : "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  return (
    <main className="shell">
      <ConnectionBar
        draftHubUrl={draftHubUrl}
        draftAuthToken={draftAuthToken}
        draftTenantId={draftTenantId}
        status={status}
        onDraftHubUrlChange={setDraftHubUrl}
        onDraftAuthTokenChange={setDraftAuthToken}
        onDraftTenantIdChange={setDraftTenantId}
        onSubmit={submitHubUrl}
      />
      <nav className="view-tabs" aria-label="Console views">
        <button type="button" className={view === "operate" ? "active" : ""} onClick={() => selectView("operate")}>Operate</button>
        <button type="button" className={view === "telemetry" ? "active" : ""} onClick={() => selectView("telemetry")}>Telemetry</button>
      </nav>
      {view === "operate" ? (
        <>
          <StageBand state={state} />
          {error ? <div className="notice">{error}</div> : null}
          <WorkGrid state={state} />
          <TimelineSection state={state} lastAccepted={lastAccepted} />
        </>
      ) : (
        <TelemetrySection
          telemetry={telemetry}
          error={telemetryError}
          liveStatus={status === "connected" ? "live stream connected" : `stream ${status}`}
          lastLiveAt={lastTelemetryUpdated?.telemetry?.generatedAt || null}
        />
      )}
    </main>
  );
}

function viewFromPath(pathname: string): AppView {
  return pathname === "/telemetry" ? "telemetry" : "operate";
}
