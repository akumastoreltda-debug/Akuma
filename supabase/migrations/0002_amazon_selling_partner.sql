create table if not exists amazon_connections (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null unique,
  marketplace_id text not null default 'A2Q3Y263D00KWC',
  marketplace_name text not null default 'Amazon.com.br',
  connection_status text not null default 'not_configured'
    check (connection_status in ('not_configured','connected','invalid','error')),
  last_test_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists amazon_sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  sync_type text not null check (sync_type in ('full','orders','finances','inventory')),
  status text not null default 'processing'
    check (status in ('processing','completed','partial','failed','skipped')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer not null default 0,
  orders_count integer not null default 0,
  finances_count integer not null default 0,
  inventory_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists amazon_sync_cursors (
  owner_clerk_id text not null,
  sync_type text not null check (sync_type in ('orders','finances','inventory')),
  cursor_value text,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_clerk_id, sync_type)
);

alter table sales add column if not exists marketplace_id text not null default 'A2Q3Y263D00KWC';
alter table sales add column if not exists external_order_item_id text;
alter table sales add column if not exists refunds numeric(14,2) not null default 0;
alter table sales add column if not exists adjustments numeric(14,2) not null default 0;
alter table sales add column if not exists payout numeric(14,2) not null default 0;
alter table sales add column if not exists updated_at timestamptz not null default now();

update sales
set external_order_item_id = amazon_order_number || ':' || sku
where external_order_item_id is null;

alter table sales alter column external_order_item_id set not null;
create unique index if not exists sales_owner_marketplace_item_uidx
  on sales(owner_clerk_id, marketplace_id, external_order_item_id);

alter table sales drop column if exists net_profit;
alter table sales drop column if exists net_margin;
alter table sales add column net_profit numeric(14,2)
  generated always as (
    revenue_total - amazon_commission - fba_fee - other_amazon_fees
    - refunds + adjustments - attributed_advertising - tax - product_cost - other_expenses
  ) stored;
alter table sales add column net_margin numeric(9,6)
  generated always as (
    case when revenue_total = 0 then 0 else (
      revenue_total - amazon_commission - fba_fee - other_amazon_fees
      - refunds + adjustments - attributed_advertising - tax - product_cost - other_expenses
    ) / revenue_total end
  ) stored;

create table if not exists amazon_financial_events (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  marketplace_id text not null,
  external_event_id text not null,
  amazon_order_number text,
  order_item_id text,
  sku text,
  event_type text not null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'BRL',
  occurred_at timestamptz not null,
  raw_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_clerk_id, marketplace_id, external_event_id)
);

create table if not exists amazon_inventory_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  marketplace_id text not null,
  sku text not null,
  asin text,
  available integer not null default 0,
  reserved integer not null default 0,
  inbound integer not null default 0,
  total integer not null default 0,
  synced_at timestamptz not null,
  source text not null default 'amazon_fba',
  external_snapshot_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_clerk_id, marketplace_id, external_snapshot_key)
);

alter table inventory_movements add column if not exists external_movement_key text;
create unique index if not exists inventory_movements_owner_external_uidx
  on inventory_movements(owner_clerk_id, external_movement_key)
  where external_movement_key is not null;

create index if not exists amazon_sync_runs_owner_started_idx
  on amazon_sync_runs(owner_clerk_id, started_at desc);
create index if not exists amazon_financial_events_owner_order_idx
  on amazon_financial_events(owner_clerk_id, amazon_order_number);
create index if not exists amazon_inventory_snapshots_owner_sku_idx
  on amazon_inventory_snapshots(owner_clerk_id, sku, synced_at desc);