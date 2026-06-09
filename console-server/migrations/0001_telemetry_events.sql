create table if not exists console_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists console_telemetry_events (
  id bigserial primary key,
  tenant_id text not null,
  event_id text not null,
  schema_version text not null,
  event_type text not null,
  session_id text not null,
  observed_at timestamptz,
  received_at timestamptz not null default now(),
  payload jsonb not null,
  unique (tenant_id, event_id)
);

create index if not exists console_telemetry_events_tenant_received_idx
  on console_telemetry_events (tenant_id, received_at desc);

create index if not exists console_telemetry_events_tenant_observed_idx
  on console_telemetry_events (tenant_id, observed_at desc);

create index if not exists console_telemetry_events_tenant_event_type_idx
  on console_telemetry_events (tenant_id, event_type);

create index if not exists console_telemetry_events_tenant_session_idx
  on console_telemetry_events (tenant_id, session_id);

create index if not exists console_telemetry_events_payload_gin_idx
  on console_telemetry_events using gin (payload);
