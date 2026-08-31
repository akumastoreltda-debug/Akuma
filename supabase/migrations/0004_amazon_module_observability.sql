alter table amazon_sync_runs
  add column if not exists steps jsonb not null default '[]'::jsonb;

create table if not exists amazon_connection_tests (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  tested_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  success boolean not null default false,
  checks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checks) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists amazon_connection_tests_owner_tested_idx
  on amazon_connection_tests(owner_clerk_id, tested_at desc);

create table if not exists amazon_alert_settings (
  owner_clerk_id text primary key,
  sample_window integer not null default 3
    check (sample_window between 1 and 20),
  failure_threshold integer not null default 2
    check (failure_threshold between 1 and sample_window),
  latency_threshold_ms integer not null default 5000
    check (latency_threshold_ms between 100 and 600000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists amazon_module_alert_states (
  owner_clerk_id text not null,
  module text not null check (module in ('orders', 'finances', 'inventory')),
  is_degraded boolean not null default false,
  failure_category text check (failure_category in (
    'authorization', 'signature', 'throttling', 'configuration',
    'payload', 'availability', 'latency', 'unknown'
  )),
  observed_latency_ms integer not null default 0 check (observed_latency_ms >= 0),
  degraded_samples integer not null default 0 check (degraded_samples >= 0),
  sample_window integer not null default 3 check (sample_window >= 1),
  evaluated_at timestamptz not null default now(),
  last_alert_at timestamptz,
  primary key (owner_clerk_id, module)
);

create index if not exists amazon_module_alert_states_active_idx
  on amazon_module_alert_states(owner_clerk_id, is_degraded, evaluated_at desc);