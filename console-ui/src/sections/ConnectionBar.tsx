import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { StatusBadge, Topbar } from "@kontourai/console-kit/react";
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
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmit(event);
    setOpen(false);
  }

  return (
    <Topbar
      eyebrow="KONTOUR CONSOLE"
      title="Operating plane"
      ariaLabel="Hub connection"
      actions={
        <div className="topbar-actions">
          {/* Tenant badge when cookie auth */}
          {cookieAuth && sessionTenantId ? (
            <span className="topbar-tenant-badge" aria-label="Signed-in tenant">
              {sessionTenantId}
            </span>
          ) : null}

          {/* Connection status dot + badge */}
          <div className="topbar-status-row">
            <span
              className="conn-dot"
              data-status={status}
              role="img"
              aria-label={`Connection: ${status}`}
            />
            <StatusBadge status={status} />
          </div>

          {/* Session: sign-out button */}
          {cookieAuth ? (
            <button
              type="button"
              className="connection-disclosure-trigger"
              aria-label="Sign out of this session"
              onClick={onSignOut}
            >
              Sign out
            </button>
          ) : (
            /* Connection disclosure popover */
            <div className="connection-disclosure" ref={popoverRef}>
              <button
                type="button"
                className="connection-disclosure-trigger"
                aria-haspopup="true"
                aria-expanded={open}
                aria-controls="connection-popover"
                onClick={() => setOpen((v) => !v)}
              >
                Connection
              </button>
              {open ? (
                <div className="connection-popover" id="connection-popover" role="region" aria-label="Hub connection settings">
                  <p className="connection-popover-title">Hub connection</p>
                  <form className="hub-form" onSubmit={handleSubmit}>
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
                    <button type="submit">Reconnect</button>
                  </form>
                </div>
              ) : null}
            </div>
          )}

          {/* Theme toggle */}
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
      }
    />
  );
}
