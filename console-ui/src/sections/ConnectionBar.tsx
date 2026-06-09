import type { FormEvent } from "react";
import { Button, StatusBadge, Topbar } from "@kontourai/console-kit/react";
import type { ConnectionStatus } from "../types";

interface ConnectionBarProps {
  draftHubUrl: string;
  draftAuthToken: string;
  draftTenantId: string;
  status: ConnectionStatus;
  onDraftHubUrlChange(value: string): void;
  onDraftAuthTokenChange(value: string): void;
  onDraftTenantIdChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

export function ConnectionBar({ draftHubUrl, draftAuthToken, draftTenantId, status, onDraftHubUrlChange, onDraftAuthTokenChange, onDraftTenantIdChange, onSubmit }: ConnectionBarProps) {
  return (
    <Topbar
      eyebrow="Console"
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
            <label htmlFor="hub-tenant">Tenant</label>
            <input
              id="hub-tenant"
              value={draftTenantId}
              onChange={(event) => onDraftTenantIdChange(event.target.value)}
              spellCheck={false}
            />
            <label htmlFor="hub-token">Token</label>
            <input
              id="hub-token"
              type="password"
              value={draftAuthToken}
              onChange={(event) => onDraftAuthTokenChange(event.target.value)}
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
