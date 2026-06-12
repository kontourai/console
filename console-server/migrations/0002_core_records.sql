create table if not exists console_core_records (
  tenant_id text not null,
  record_id text not null,
  schema text not null,
  type text not null,
  occurred_at timestamptz,
  observed_at timestamptz not null default now(),
  sequence bigserial,
  payload jsonb not null,
  primary key (tenant_id, record_id)
);

create index if not exists console_core_records_tenant_sequence_idx
  on console_core_records (tenant_id, sequence asc);

create index if not exists console_core_records_tenant_observed_idx
  on console_core_records (tenant_id, observed_at asc);
