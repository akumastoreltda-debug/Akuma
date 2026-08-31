create table if not exists amazon_retention_locks (
  lock_name text primary key,
  lock_token text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create or replace function acquire_amazon_retention_lock(
  p_lock_token text,
  p_ttl_seconds integer default 3600
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if nullif(trim(p_lock_token), '') is null then
    raise exception 'lock token is required';
  end if;

  if p_ttl_seconds is null or p_ttl_seconds < 1 then
    raise exception 'lock TTL must be positive';
  end if;

  insert into amazon_retention_locks(
    lock_name, lock_token, acquired_at, expires_at
  ) values (
    'amazon_connection_test_history',
    p_lock_token,
    now(),
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (lock_name) do update
    set lock_token = excluded.lock_token,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
    where amazon_retention_locks.expires_at < now();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function release_amazon_retention_lock(
  p_lock_token text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from amazon_retention_locks
  where lock_name = 'amazon_connection_test_history'
    and lock_token = p_lock_token;
$$;

create or replace function prune_amazon_connection_tests(
  p_owner_clerk_id text,
  p_retention_days integer default 90,
  p_max_rows integer default 1000
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if nullif(trim(p_owner_clerk_id), '') is null then
    raise exception 'owner_clerk_id is required';
  end if;

  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention days must be positive';
  end if;

  if p_max_rows is null or p_max_rows < 1 then
    raise exception 'maximum retained rows must be positive';
  end if;

  if p_max_rows > 1000 then
    raise exception 'maximum retained rows cannot exceed 1000';
  end if;

  with retained_tests as (
    select id
    from amazon_connection_tests
    where owner_clerk_id = p_owner_clerk_id
    order by tested_at desc, id desc
    limit p_max_rows
  ),
  deleted_tests as (
    delete from amazon_connection_tests
    where owner_clerk_id = p_owner_clerk_id
      and (
        tested_at < now() - make_interval(days => p_retention_days)
        or id not in (select id from retained_tests)
      )
    returning id
  )
  select count(*) into deleted_count from deleted_tests;

  return deleted_count;
end;
$$;

revoke all on function acquire_amazon_retention_lock(text, integer)
  from public, anon, authenticated;
revoke all on function release_amazon_retention_lock(text)
  from public, anon, authenticated;
revoke all on function prune_amazon_connection_tests(text, integer, integer)
  from public, anon, authenticated;
grant execute on function acquire_amazon_retention_lock(text, integer)
  to service_role;
grant execute on function release_amazon_retention_lock(text)
  to service_role;
grant execute on function prune_amazon_connection_tests(text, integer, integer)
  to service_role;