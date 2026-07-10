alter table console_core_records
  add column if not exists liveness_order_ms bigint;

alter table console_core_records
  add column if not exists liveness_order_rank smallint;

-- Existing payloads predate the ordering column. Backfill parseable timestamps
-- one row at a time so a corrupted/hand-edited value cannot abort the migration.
do $$
declare
  candidate record;
begin
  for candidate in
    select tenant_id,
           record_id,
           payload ->> 'at' as at,
           substring(payload ->> 'at' from 1 for 19)
             || '.'
             || left(rpad(coalesce(substring(payload ->> 'at' from '[.]([0-9]{1,9})Z$'), ''), 3, '0'), 3)
             || 'Z' as at_ms
    from console_core_records
    where schema = 'kontour.console.liveness'
      and liveness_order_ms is null
      and payload ->> 'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
      and substring(payload ->> 'at' from 1 for 4) <> '0000'
  loop
    begin
      update console_core_records
      -- PostgreSQL rounds sub-microsecond timestamp text. Cast an exactly
      -- three-digit derivative so 4-9 digit fleet values use Date.parse's
      -- truncate-to-millisecond ordering (including .999999999 -> .999).
      set liveness_order_ms = floor(extract(epoch from candidate.at_ms::timestamptz) * 1000)::bigint,
          liveness_order_rank = case when payload ->> 'type' = 'release' then 1 else 0 end
      where tenant_id = candidate.tenant_id
        and record_id = candidate.record_id
        and substring(candidate.at from 1 for 4) <> '0000'
        and isfinite(candidate.at_ms::timestamptz)
        -- Reject calendar/time normalization while allowing the optional
        -- fractional text to normalize deterministically to epoch milliseconds.
        and to_char(candidate.at_ms::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
          = substring(candidate.at from 1 for 19);
    exception when others then
      null;
    end;
  end loop;
end $$;
