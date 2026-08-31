create table if not exists amazon_owner_transfer_audit (
  id uuid primary key default gen_random_uuid(),
  actor_clerk_id text not null,
  previous_owner_clerk_id text not null,
  new_owner_clerk_id text not null,
  reason text not null check (char_length(trim(reason)) between 10 and 1000),
  transferred_at timestamptz not null default now()
);

create index if not exists amazon_owner_transfer_audit_transferred_idx
  on amazon_owner_transfer_audit(transferred_at desc);

create or replace function transfer_amazon_owner(
  p_actor_clerk_id text,
  p_current_owner_clerk_id text,
  p_new_owner_clerk_id text,
  p_reason text
) returns table (
  id uuid,
  actor_clerk_id text,
  previous_owner_clerk_id text,
  new_owner_clerk_id text,
  reason text,
  transferred_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  registered_owner text;
  audit_row amazon_owner_transfer_audit%rowtype;
  actor_id text := nullif(trim(coalesce(p_actor_clerk_id, '')), '');
  current_owner_id text := nullif(trim(coalesce(p_current_owner_clerk_id, '')), '');
  new_owner_id text := nullif(trim(coalesce(p_new_owner_clerk_id, '')), '');
  transfer_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if actor_id is null then
    raise exception 'Administrator identity is required';
  end if;
  if current_owner_id is null then
    raise exception 'Current Amazon owner is required';
  end if;
  if new_owner_id is null then
    raise exception 'New Amazon owner is required';
  end if;
  if current_owner_id = new_owner_id then
    raise exception 'New Amazon owner must be different';
  end if;
  if transfer_reason is null
    or char_length(transfer_reason) < 10
    or char_length(transfer_reason) > 1000 then
    raise exception 'A transfer reason must contain between 10 and 1000 characters';
  end if;

  -- The same transaction lock serializes transfers across API replicas.
  perform pg_advisory_xact_lock(hashtext('amazon-owner-transfer'));

  select owner_clerk_id
    into registered_owner
    from amazon_connections
   order by created_at asc, id asc
   limit 1
   for update;

  if registered_owner is null then
    raise exception 'Amazon owner is not registered';
  end if;
  if registered_owner <> current_owner_id then
    raise exception 'Current Amazon owner does not match the registered owner';
  end if;

  if exists (
    select 1
      from amazon_sync_locks
     where owner_clerk_id = current_owner_id
       and expires_at > now()
  ) then
    raise exception 'Amazon synchronization is running; try the transfer again after it finishes';
  end if;

  -- A target with existing tenant rows would create an ambiguous merge.
  -- Refuse it rather than silently combining two users' data.
  if exists (select 1 from suppliers where owner_clerk_id = new_owner_id)
    or exists (select 1 from products where owner_clerk_id = new_owner_id)
    or exists (select 1 from purchase_batches where owner_clerk_id = new_owner_id)
    or exists (select 1 from sales where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_fees where owner_clerk_id = new_owner_id)
    or exists (select 1 from inventory_movements where owner_clerk_id = new_owner_id)
    or exists (select 1 from expenses where owner_clerk_id = new_owner_id)
    or exists (select 1 from cash_transactions where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_imports where owner_clerk_id = new_owner_id)
    or exists (select 1 from alerts where owner_clerk_id = new_owner_id)
    or exists (select 1 from settings where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_connections where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_sync_runs where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_sync_cursors where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_financial_events where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_inventory_snapshots where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_connection_tests where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_alert_settings where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_module_alert_states where owner_clerk_id = new_owner_id)
    or exists (select 1 from alert_acknowledgements where owner_clerk_id = new_owner_id)
    or exists (select 1 from amazon_sync_locks where owner_clerk_id = new_owner_id)
  then
    raise exception 'New Amazon owner already has tenant data';
  end if;

  update suppliers set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update products set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update purchase_batches set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update sales set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_fees set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update inventory_movements set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update expenses set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update cash_transactions set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_imports set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update alerts set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update settings set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_connections set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_sync_runs set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_sync_cursors set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_financial_events set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_inventory_snapshots set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_connection_tests set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_alert_settings set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_module_alert_states set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update alert_acknowledgements set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;
  update amazon_sync_locks set owner_clerk_id = new_owner_id where owner_clerk_id = current_owner_id;

  insert into amazon_owner_transfer_audit (
    actor_clerk_id, previous_owner_clerk_id, new_owner_clerk_id, reason
  ) values (
    actor_id,
    current_owner_id,
    new_owner_id,
    transfer_reason
  )
  returning * into audit_row;

  return query
  select
    audit_row.id,
    audit_row.actor_clerk_id,
    audit_row.previous_owner_clerk_id,
    audit_row.new_owner_clerk_id,
    audit_row.reason,
    audit_row.transferred_at;
end;
$$;

revoke all on function transfer_amazon_owner(text, text, text, text)
  from public, anon, authenticated;
grant execute on function transfer_amazon_owner(text, text, text, text)
  to service_role;