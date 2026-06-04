import type { FormEvent } from "react";
import { useState } from "react";
import { DEFAULT_HUB_URL } from "./hubClient";
import { useHubConnection } from "./hooks/useHubConnection";
import { ConnectionBar } from "./sections/ConnectionBar";
import { StageBand } from "./sections/StageBand";
import { TimelineSection } from "./sections/TimelineSection";
import { WorkGrid } from "./sections/WorkGrid";

export default function App() {
  const [hubUrl, setHubUrl] = useState(DEFAULT_HUB_URL);
  const [draftHubUrl, setDraftHubUrl] = useState(DEFAULT_HUB_URL);
  const { status, state, lastAccepted, error } = useHubConnection(hubUrl);

  function submitHubUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHubUrl(draftHubUrl.trim() || DEFAULT_HUB_URL);
  }

  return (
    <main className="shell">
      <ConnectionBar
        draftHubUrl={draftHubUrl}
        status={status}
        onDraftHubUrlChange={setDraftHubUrl}
        onSubmit={submitHubUrl}
      />
      <StageBand state={state} />
      {error ? <div className="notice">{error}</div> : null}
      <WorkGrid state={state} />
      <TimelineSection state={state} lastAccepted={lastAccepted} />
    </main>
  );
}
