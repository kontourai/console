import type { FormEvent } from "react";
import { Button, StatusBadge, Topbar } from "@kontourai/console-kit/react";
import type { ConnectionStatus } from "../types";

interface ConnectionBarProps {
  draftHubUrl: string;
  draftAuthToken: string;
  draftTenantId: string;
  status: ConnectionStatus;
  theme: "dark" | "light";
  /** When true, auth is via session cookie — hide token/tenant inputs, show sign-out. */
  cookieAuth?: boolean;
  /** Tenant ID from the active session (displayed when cookieAuth is true). */
  sessionTenantId?: string | null;
  onDraftHubUrlChange(value: string): void;
  onDraftAuthTokenChange(value: string): void;
  onDraftTenantIdChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onThemeToggle(): void;
  onSignOut?(): void;
}

export function ConnectionBar({
  draftHubUrl,
  draftAuthToken,
  draftTenantId,
  status,
  theme,
  cookieAuth,
  sessionTenantId,
  onDraftHubUrlChange,
  onDraftAuthTokenChange,
  onDraftTenantIdChange,
  onSubmit,
  onThemeToggle,
  onSignOut,
}: ConnectionBarProps) {
  return (
    <Topbar
      eyebrow="Console"
      title="Local operating plane"
      ariaLabel="Hub connection"
      actions={
        <>
          {cookieAuth ? (
            <div className="hub-form hub-form--session">
              {sessionTenantId ? (
                <span className="hub-session-tenant" aria-label="Signed-in tenant">{sessionTenantId}</span>
              ) : null}
              <Button variant="primary" type="button" onClick={onSignOut}>Sign out</Button>
            </div>
          ) : (
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
          )}
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
