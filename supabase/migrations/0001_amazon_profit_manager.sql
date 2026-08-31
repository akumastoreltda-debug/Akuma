create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  name text not null,
  cnpj text,
  phone text,
  whatsapp text,
  email text,
  delivery_days integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  sku text not null,
  asin text not null,
  name text not null,
  image_url text,
  category text not null default 'Sem categoria',
  supplier text not null default 'Sem fornecedor',
  current_cost numeric(14,2) not null default 0,
  average_cost numeric(14,2) not null default 0,
  sale_price numeric(14,2) not null default 0,
  available_stock integer not null default 0,
  reserved_stock integer not null default 0,
  inbound_stock integer not null default 0,
  safety_stock integer not null default 0,
  lead_time_days integer not null default 0,
  minimum_order_quantity integer not null default 1,
  minimum_margin numeric(7,4) not null default 0.20,
  status text not null default 'healthy' check (status in ('healthy','low_stock','buy_now','out_of_stock','low_margin','loss')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_clerk_id, sku)
);

create table if not exists product_suppliers (
  product_id uuid not null references products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  is_primary boolean not null default false,
  last_unit_cost numeric(14,2),
  last_purchase_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (product_id, supplier_id)
);

create table if not exists purchase_batches (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  product_id uuid not null references products(id),
  supplier_id uuid references suppliers(id),
  purchased_at date not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  freight numeric(14,2) not null default 0,
  taxes numeric(14,2) not null default 0,
  other_costs numeric(14,2) not null default 0,
  total_cost numeric(14,2) generated always as ((quantity * unit_cost) + freight + taxes + other_costs) stored,
  real_unit_cost numeric(14,4) generated always as (((quantity * unit_cost) + freight + taxes + other_costs) / nullif(quantity, 0)) stored,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  product_id uuid references products(id),
  sold_at timestamptz not null,
  amazon_order_number text not null,
  sku text not null,
  asin text,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14,2) not null,
  revenue_total numeric(14,2) not null,
  amazon_commission numeric(14,2) not null default 0,
  fba_fee numeric(14,2) not null default 0,
  other_amazon_fees numeric(14,2) not null default 0,
  attributed_advertising numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  product_cost numeric(14,2) not null default 0,
  other_expenses numeric(14,2) not null default 0,
  net_profit numeric(14,2) generated always as (revenue_total - amazon_commission - fba_fee - other_amazon_fees - attributed_advertising - tax - product_cost - other_expenses) stored,
  net_margin numeric(9,6) generated always as (case when revenue_total = 0 then 0 else (revenue_total - amazon_commission - fba_fee - other_amazon_fees - attributed_advertising - tax - product_cost - other_expenses) / revenue_total end) stored,
  created_at timestamptz not null default now()
);

create table if not exists amazon_fees (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  sale_id uuid references sales(id) on delete cascade,
  fee_type text not null,
  amount numeric(14,2) not null,
  occurred_at timestamptz not null,
  source_import_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  product_id uuid not null references products(id),
  movement_type text not null check (movement_type in ('purchase','sale','adjustment','reservation','release','inbound')),
  quantity integer not null,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  notes text
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  expense_type text not null check (expense_type in ('advertising','tax','logistics','tools','accounting','supplier','other')),
  description text not null,
  amount numeric(14,2) not null,
  occurred_at date not null,
  created_at timestamptz not null default now()
);

create table if not exists cash_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  transaction_type text not null check (transaction_type in ('amazon_payout','other_income','capital_injection','inventory_purchase','supplier','advertising','tax','logistics','tools','accounting','other_expense')),
  description text not null,
  amount numeric(14,2) not null,
  occurred_at date not null,
  created_at timestamptz not null default now()
);

create table if not exists amazon_imports (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  import_type text not null check (import_type in ('orders','sales','fees','inventory','refunds')),
  file_name text not null,
  storage_path text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  rows_imported integer not null default 0,
  error_message text,
  imported_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null,
  severity text not null check (severity in ('success','warning','danger','info')),
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  owner_clerk_id text not null unique,
  default_minimum_margin numeric(7,4) not null default 0.20,
  safety_stock_days integer not null default 7,
  sales_average_period_days integer not null default 30,
  monthly_profit_goal numeric(14,2) not null default 0,
  monthly_revenue_goal numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_owner_status_idx on products(owner_clerk_id, status);
create index if not exists products_owner_category_idx on products(owner_clerk_id, category);
create index if not exists sales_owner_sold_at_idx on sales(owner_clerk_id, sold_at);
create index if not exists purchases_owner_purchased_at_idx on purchase_batches(owner_clerk_id, purchased_at);
create index if not exists cash_owner_occurred_at_idx on cash_transactions(owner_clerk_id, occurred_at);
create index if not exists alerts_owner_read_idx on alerts(owner_clerk_id, read, created_at desc);