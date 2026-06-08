import type { FormEvent } from "react";
import { Button, StatusBadge, Topbar } from "@kontourai/console-kit/react";
import type { ConnectionStatus } from "../types";

interface ConnectionBarProps {
  draftHubUrl: string;
  status: ConnectionStatus;
  onDraftHubUrlChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function ConnectionBar({ draftHubUrl, status, onDraftHubUrlChange, onSubmit }: ConnectionBarProps) {
  return (
    <Topbar
      eyebrow="Kontour Console"
      title="Local operating plane"
      ariaLabel="Hub connection"
      actions={
        <>
          <form className="hub-form" onSubmit={onSubmit}>
            <label htmlFor="hub-url">Hub URL</label>
            <input
              id="hub-url"
              value={draftHubUrl}
              onChange={(event) => onDraftHubUrlChange(event.target.value)}
              spellCheck={false}
            />
            <Button variant="primary" type="submit">Reconnect</Button>
          </form>
          <StatusBadge status={status} />
        </>
      }
    />
  );
}
