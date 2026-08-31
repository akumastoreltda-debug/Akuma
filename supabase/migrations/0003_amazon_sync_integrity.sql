create table if not exists amazon_sync_locks (
  owner_clerk_id text primary key,
  lock_token text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create or replace function acquire_amazon_sync_lock(
  p_owner_clerk_id text,
  p_lock_token text,
  p_ttl_seconds integer default 7200
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  insert into amazon_sync_locks(owner_clerk_id, lock_token, acquired_at, expires_at)
  values (p_owner_clerk_id, p_lock_token, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (owner_clerk_id) do update
    set lock_token = excluded.lock_token,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where amazon_sync_locks.expires_at < now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function release_amazon_sync_lock(
  p_owner_clerk_id text,
  p_lock_token text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from amazon_sync_locks
  where owner_clerk_id = p_owner_clerk_id and lock_token = p_lock_token;
$$;

create or replace function renew_amazon_sync_lock(
  p_owner_clerk_id text,
  p_lock_token text,
  p_ttl_seconds integer default 120
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update amazon_sync_locks
  set expires_at = now() + make_interval(secs => p_ttl_seconds)
  where owner_clerk_id = p_owner_clerk_id
    and lock_token = p_lock_token
    and expires_at >= now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function apply_amazon_inventory_sync(
  p_owner_clerk_id text,
  p_marketplace_id text,
  p_sku text,
  p_asin text,
  p_available integer,
  p_reserved integer,
  p_inbound integer,
  p_total integer,
  p_synced_at timestamptz,
  p_snapshot_key text,
  p_movement_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product_id uuid;
  previous_available integer;
  stock_delta integer;
begin
  insert into amazon_inventory_snapshots(
    owner_clerk_id, marketplace_id, sku, asin, available, reserved,
    inbound, total, synced_at, source, external_snapshot_key
  ) values (
    p_owner_clerk_id, p_marketplace_id, p_sku, p_asin, p_available, p_reserved,
    p_inbound, p_total, p_synced_at, 'amazon_fba', p_snapshot_key
  )
  on conflict (owner_clerk_id, marketplace_id, external_snapshot_key) do update
    set asin = excluded.asin,
        available = excluded.available,
        reserved = excluded.reserved,
        inbound = excluded.inbound,
        total = excluded.total,
        synced_at = excluded.synced_at;

  select id, available_stock
    into target_product_id, previous_available
  from products
  where owner_clerk_id = p_owner_clerk_id and sku = p_sku
  for update;

  if target_product_id is null then
    return false;
  end if;

  stock_delta := p_available - coalesce(previous_available, 0);
  update products
  set available_stock = p_available,
      reserved_stock = p_reserved,
      inbound_stock = p_inbound,
      updated_at = p_synced_at
  where id = target_product_id and owner_clerk_id = p_owner_clerk_id;

  if stock_delta <> 0 then
    insert into inventory_movements(
      owner_clerk_id, product_id, movement_type, quantity,
      occurred_at, notes, external_movement_key
    ) values (
      p_owner_clerk_id, target_product_id, 'adjustment', stock_delta,
      p_synced_at, 'Sincronização Amazon FBA', p_movement_key
    )
    on conflict (owner_clerk_id, external_movement_key)
      where external_movement_key is not null
    do update set
      quantity = excluded.quantity,
      occurred_at = excluded.occurred_at;
  end if;

  return true;
end;
$$;

revoke all on function acquire_amazon_sync_lock(text, text, integer) from public, anon, authenticated;
revoke all on function release_amazon_sync_lock(text, text) from public, anon, authenticated;
revoke all on function renew_amazon_sync_lock(text, text, integer) from public, anon, authenticated;
revoke all on function apply_amazon_inventory_sync(
  text, text, text, text, integer, integer, integer, integer,
  timestamptz, text, text
) from public, anon, authenticated;
grant execute on function acquire_amazon_sync_lock(text, text, integer) to service_role;
grant execute on function release_amazon_sync_lock(text, text) to service_role;
grant execute on function renew_amazon_sync_lock(text, text, integer) to service_role;
grant execute on function apply_amazon_inventory_sync(
  text, text, text, text, integer, integer, integer, integer,
  timestamptz, text, text
) to service_role;