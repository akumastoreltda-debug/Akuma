create table if not exists alert_acknowledgements (
  owner_clerk_id text not null,
  alert_id uuid not null references alerts(id) on delete cascade,
  read boolean not null default false,
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_clerk_id, alert_id)
);

create index if not exists alert_acknowledgements_owner_read_idx
  on alert_acknowledgements(owner_clerk_id, read, updated_at desc);

insert into alert_acknowledgements (owner_clerk_id, alert_id, read, read_at)
select owner_clerk_id, id, read, case when read then created_at else null end
from alerts
on conflict (owner_clerk_id, alert_id) do nothing;

-- A process-local queue cannot order writes when the API has more than one
-- replica. Keep the lock and the read/modify/write operation in the database
-- transaction so every replica shares the same serialization point.
create or replace function update_alert_acknowledgement(
  p_owner_clerk_id text,
  p_alert_id uuid,
  p_read boolean
)
returns table (
  id uuid,
  severity text,
  title text,
  message text,
  created_at timestamptz,
  read boolean,
  acknowledged_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  alert_row alerts%rowtype;
  acknowledgement_row alert_acknowledgements%rowtype;
  persisted_at timestamptz;
begin
  if nullif(trim(p_owner_clerk_id), '') is null then
    raise exception 'owner_clerk_id is required';
  end if;

  -- Advisory locks also serialize the first acknowledgement insert, for
  -- which there is no row yet that could be locked with FOR UPDATE.
  perform pg_advisory_xact_lock(
    hashtext(p_owner_clerk_id),
    hashtext(p_alert_id::text)
  );
  -- Take the timestamp after waiting for the shared lock so updated_at
  -- follows database commit order across replicas.
  persisted_at := clock_timestamp();

  select *
    into alert_row
    from alerts
   where id = p_alert_id
     and owner_clerk_id = p_owner_clerk_id
   for update;

  if not found then
    return;
  end if;

  insert into alert_acknowledgements (
    owner_clerk_id, alert_id, read, read_at, updated_at
  ) values (
    p_owner_clerk_id,
    p_alert_id,
    p_read,
    case when p_read then persisted_at else null end,
    persisted_at
  )
  on conflict (owner_clerk_id, alert_id) do update
    set read = excluded.read,
        read_at = excluded.read_at,
        updated_at = excluded.updated_at
  returning * into acknowledgement_row;

  return query
  select
    alert_row.id,
    alert_row.severity,
    alert_row.title,
    alert_row.message,
    alert_row.created_at,
    acknowledgement_row.read,
    case
      when acknowledgement_row.read then acknowledgement_row.read_at
      else null
    end;
end;
$$;

revoke all on function update_alert_acknowledgement(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function update_alert_acknowledgement(text, uuid, boolean)
  to service_role;