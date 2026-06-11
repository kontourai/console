import type { FormEvent } from "react";
import { Button, StatusBadge, Topbar } from "@kontourai/console-kit/react";
import type { ConnectionStatus } from "../types";

interface ConnectionBarProps {
  draftHubUrl: string;
  draftAuthToken: string;
  draftTenantId: string;
  status: ConnectionStatus;
  theme: "dark" | "light";
  onDraftHubUrlChange(value: string): void;
  onDraftAuthTokenChange(value: string): void;
  onDraftTenantIdChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onThemeToggle(): void;
}

export function ConnectionBar({
  draftHubUrl,
  draftAuthToken,
  draftTenantId,
  status,
  theme,
  onDraftHubUrlChange,
  onDraftAuthTokenChange,
  onDraftTenantIdChange,
  onSubmit,
  onThemeToggle,
}: ConnectionBarProps) {
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
          <div className="topbar-status-row">
            <StatusBadge status={status} />
            <button
              type="button"
              className="theme-toggle"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={theme === "light"}
              onClick={onThemeToggle}
            >
              {theme === "dark" ? "☀" : "◐"}
            </button>
          </div>
        </>
      }
    />
  );
}
