-- Per-session revocation (#104). Session cookies carry a random session id (sid);
-- revoking a sid invalidates that session server-side BEFORE its signed max-age
-- expires, so logout (or a targeted revoke) actually terminates the session rather
-- than only clearing the client cookie. Only revoked sids are stored, each with the
-- session's signed expiry, so the table stays bounded and prunable.
create table if not exists console_revoked_sessions (
  sid text primary key,
  tenant_id text not null,
  revoked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists console_revoked_sessions_expires_idx
  on console_revoked_sessions (expires_at);
