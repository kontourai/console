create table if not exists console_economics_records (
  tenant_id text not null,
  record_id text not null,
  observed_at timestamptz not null default now(),
  sequence bigserial,
  payload jsonb not null,
  primary key (tenant_id, record_id)
);

create index if not exists console_economics_records_tenant_sequence_idx
  on console_economics_records (tenant_id, sequence asc);
