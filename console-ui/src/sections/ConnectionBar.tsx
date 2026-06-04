import type { FormEvent } from "react";
import { StatusBadge } from "../components/StatusBadge";
import type { ConnectionStatus } from "../types";

interface ConnectionBarProps {
  draftHubUrl: string;
  status: ConnectionStatus;
  onDraftHubUrlChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function ConnectionBar({ draftHubUrl, status, onDraftHubUrlChange, onSubmit }: ConnectionBarProps) {
  return (
    <section className="topbar" aria-label="Hub connection">
      <div>
        <p className="eyebrow">Kontour Console</p>
        <h1>Local operating plane</h1>
      </div>
      <form className="hub-form" onSubmit={onSubmit}>
        <label htmlFor="hub-url">Hub URL</label>
        <input
          id="hub-url"
          value={draftHubUrl}
          onChange={(event) => onDraftHubUrlChange(event.target.value)}
          spellCheck={false}
        />
        <button type="submit">Reconnect</button>
      </form>
      <StatusBadge status={status} />
    </section>
  );
}
