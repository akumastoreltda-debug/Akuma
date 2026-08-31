import { ReplitConnectors } from "@replit/connectors-sdk";

export type SupabaseOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  returnRepresentation?: boolean;
  prefer?: string;
};

type DirectSupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

type SupabaseOpenApiDocument = {
  paths?: Record<string, unknown>;
  definitions?: Record<string, SupabaseOpenApiSchema>;
  components?: {
    schemas?: Record<string, SupabaseOpenApiSchema>;
  };
};

type SupabaseOpenApiSchema = {
  properties?: Record<string, unknown>;
  items?: SupabaseOpenApiSchema;
  $ref?: string;
  [key: string]: unknown;
};

export const AMAZON_SYNC_REQUIRED_TABLES = [
  "products",
  "sales",
  "amazon_financial_events",
  "amazon_inventory_snapshots",
  "inventory_movements",
  "amazon_connections",
  "amazon_sync_runs",
  "amazon_sync_cursors",
  "amazon_sync_locks",
] as const;

export const AMAZON_SYNC_REQUIRED_FUNCTIONS = [
  "acquire_amazon_sync_lock",
  "release_amazon_sync_lock",
  "renew_amazon_sync_lock",
  "apply_amazon_inventory_sync",
] as const;

export const AMAZON_SYNC_REQUIRED_COLUMNS = [
  // Orders read products and write sales.
  { table: "products", column: "id", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "owner_clerk_id", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "sku", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "asin", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "name", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "current_cost", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "available_stock", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "reserved_stock", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "inbound_stock", migration: "0001_amazon_profit_manager.sql" },
  { table: "products", column: "updated_at", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "id", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "owner_clerk_id", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "product_id", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "sold_at", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "amazon_order_number", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "sku", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "asin", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "product_name", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "quantity", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "unit_price", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "revenue_total", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "amazon_commission", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "fba_fee", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "other_amazon_fees", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "tax", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "product_cost", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "other_expenses", migration: "0001_amazon_profit_manager.sql" },
  { table: "sales", column: "marketplace_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "sales", column: "external_order_item_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "sales", column: "refunds", migration: "0002_amazon_selling_partner.sql" },
  { table: "sales", column: "adjustments", migration: "0002_amazon_selling_partner.sql" },
  { table: "sales", column: "payout", migration: "0002_amazon_selling_partner.sql" },
  { table: "sales", column: "updated_at", migration: "0002_amazon_selling_partner.sql" },
  // Finances persist events and then update the corresponding sales.
  { table: "amazon_financial_events", column: "owner_clerk_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "marketplace_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "external_event_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "amazon_order_number", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "order_item_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "sku", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "event_type", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "amount", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "currency", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "occurred_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "raw_category", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_financial_events", column: "updated_at", migration: "0002_amazon_selling_partner.sql" },
  // Inventory is applied atomically by the inventory RPC.
  { table: "amazon_inventory_snapshots", column: "owner_clerk_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "marketplace_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "sku", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "asin", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "available", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "reserved", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "inbound", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "total", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "synced_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "source", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_inventory_snapshots", column: "external_snapshot_key", migration: "0002_amazon_selling_partner.sql" },
  { table: "inventory_movements", column: "owner_clerk_id", migration: "0001_amazon_profit_manager.sql" },
  { table: "inventory_movements", column: "product_id", migration: "0001_amazon_profit_manager.sql" },
  { table: "inventory_movements", column: "movement_type", migration: "0001_amazon_profit_manager.sql" },
  { table: "inventory_movements", column: "quantity", migration: "0001_amazon_profit_manager.sql" },
  { table: "inventory_movements", column: "occurred_at", migration: "0001_amazon_profit_manager.sql" },
  { table: "inventory_movements", column: "notes", migration: "0001_amazon_profit_manager.sql" },
  { table: "inventory_movements", column: "external_movement_key", migration: "0002_amazon_selling_partner.sql" },
  // Connection and synchronization state are used before and after each run.
  { table: "amazon_connections", column: "owner_clerk_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "marketplace_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "marketplace_name", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "connection_status", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "last_test_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "last_sync_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "last_error", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_connections", column: "updated_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "owner_clerk_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "sync_type", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "status", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "started_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "completed_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "duration_ms", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "orders_count", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "finances_count", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "inventory_count", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "error_message", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_runs", column: "steps", migration: "0004_amazon_module_observability.sql" },
  { table: "amazon_sync_cursors", column: "owner_clerk_id", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_cursors", column: "sync_type", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_cursors", column: "cursor_value", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_cursors", column: "last_synced_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_cursors", column: "updated_at", migration: "0002_amazon_selling_partner.sql" },
  { table: "amazon_sync_locks", column: "owner_clerk_id", migration: "0003_amazon_sync_integrity.sql" },
  { table: "amazon_sync_locks", column: "lock_token", migration: "0003_amazon_sync_integrity.sql" },
  { table: "amazon_sync_locks", column: "acquired_at", migration: "0003_amazon_sync_integrity.sql" },
  { table: "amazon_sync_locks", column: "expires_at", migration: "0003_amazon_sync_integrity.sql" },
] as const;

export const ALERTS_REQUIRED_TABLES = [
  "alerts",
  "alert_acknowledgements",
] as const;

export const ALERTS_REQUIRED_FUNCTIONS = [
  "update_alert_acknowledgement",
] as const;

export const AMAZON_RETENTION_REQUIRED_FUNCTIONS = [
  "acquire_amazon_retention_lock",
  "release_amazon_retention_lock",
  "prune_amazon_connection_tests",
] as const;

export const AMAZON_RETENTION_MIGRATION = "0005_amazon_connection_test_retention.sql";

export type AmazonSyncSchemaMissingColumn = {
  table: string;
  column: string;
  migration: string;
};

export type AmazonSyncSchemaCheck = {
  complete: boolean;
  unavailable: boolean;
  missingTables: string[];
  missingFunctions: string[];
  missingColumns: AmazonSyncSchemaMissingColumn[];
  diagnostic?: string;
};

export type AlertsSchemaCheck = {
  complete: boolean;
  unavailable: boolean;
  missingTables: string[];
  missingFunctions: string[];
  diagnostic?: string;
};

export type AmazonRetentionSchemaCheck = {
  complete: boolean;
  unavailable: boolean;
  failureReason?: "invalid_credentials" | "temporarily_unavailable";
  missingFunctions: string[];
  diagnostic?: string;
};

function getDirectSupabaseConfig(): DirectSupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return {
    url: url.replace(/\/+$/, ""),
    serviceRoleKey,
  };
}

function supabaseErrorText(text: string, serviceRoleKey?: string): string {
  const sanitized = serviceRoleKey ? text.split(serviceRoleKey).join("[redacted]") : text;
  return sanitized.slice(0, 1000);
}

function supabaseAvailabilityFailureReason(
  error: unknown,
): "invalid_credentials" | "temporarily_unavailable" {
  const message = error instanceof Error ? error.message : "";
  const status = Number(message.match(/Supabase request failed \((\d{3})\)/)?.[1]);
  return status === 401 || status === 403
    ? "invalid_credentials"
    : "temporarily_unavailable";
}

function schemaProperties(
  document: SupabaseOpenApiDocument,
  table: string,
): Record<string, unknown> {
  const definitions = {
    ...(document.definitions ?? {}),
    ...(document.components?.schemas ?? {}),
  };
  const direct = definitions[table];
  if (direct?.properties) return direct.properties;

  const path = document.paths?.[`/${table}`];
  if (!path || typeof path !== "object") return {};
  const references = new Set<string>();
  const collectReferences = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collectReferences);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === "string") references.add(record.$ref);
    Object.values(record).forEach(collectReferences);
  };
  collectReferences(path);
  for (const reference of references) {
    const name = reference.split("/").pop();
    if (name && definitions[name]?.properties) return definitions[name].properties;
  }
  return {};
}

async function supabasePathRequest<T>(
  path: string,
  options: SupabaseOptions = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }

  const requestPath = `${path}${params.size ? `?${params.toString()}` : ""}`;
  const directConfig = getDirectSupabaseConfig();
  const preferHeader =
    options.returnRepresentation || options.prefer
      ? [
          options.returnRepresentation ? "return=representation" : "",
          options.prefer ?? "",
        ]
          .filter(Boolean)
          .join(",")
      : undefined;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(preferHeader ? { Prefer: preferHeader } : {}),
  };

  let response: Response;
  if (directConfig) {
    response = await fetch(`${directConfig.url}${requestPath}`, {
      method: options.method ?? "GET",
      headers: {
        ...headers,
        apikey: directConfig.serviceRoleKey,
        Authorization: `Bearer ${directConfig.serviceRoleKey}`,
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  } else {
    const connectors = new ReplitConnectors();
    response = await connectors.proxy("supabase", requestPath, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Supabase request failed (${response.status}): ${supabaseErrorText(
        errorText,
        directConfig?.serviceRoleKey,
      )}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function supabaseRequest<T>(
  table: string,
  options: SupabaseOptions = {},
): Promise<T> {
  return supabasePathRequest<T>(`/rest/v1/${table}`, options);
}

/**
 * Checks the remote PostgREST contract used by Amazon synchronization.
 *
 * The OpenAPI document is served by the configured Supabase REST endpoint,
 * so this never consults the Replit PostgreSQL database or mutates seller data.
 */
export async function checkAmazonSyncSchema(): Promise<AmazonSyncSchemaCheck> {
  try {
    const document = await supabasePathRequest<SupabaseOpenApiDocument>("/rest/v1/");
    const paths = document.paths ?? {};
    const missingTables = AMAZON_SYNC_REQUIRED_TABLES.filter(
      (table) => !Object.prototype.hasOwnProperty.call(paths, `/${table}`),
    );
    const missingFunctions = AMAZON_SYNC_REQUIRED_FUNCTIONS.filter(
      (name) => !Object.prototype.hasOwnProperty.call(paths, `/rpc/${name}`),
    );
    const missingColumns = AMAZON_SYNC_REQUIRED_COLUMNS.filter(({ table, column }) => {
      const properties = schemaProperties(document, table);
      return (
        Object.prototype.hasOwnProperty.call(paths, `/${table}`) &&
        !Object.prototype.hasOwnProperty.call(properties, column)
      );
    }).map(({ table, column, migration }) => ({ table, column, migration }));
    return {
      complete:
        missingTables.length === 0 &&
        missingFunctions.length === 0 &&
        missingColumns.length === 0,
      unavailable: false,
      missingTables: [...missingTables],
      missingFunctions: [...missingFunctions],
      missingColumns,
    };
  } catch (error) {
    const directConfig = getDirectSupabaseConfig();
    return {
      complete: false,
      unavailable: true,
      missingTables: [],
      missingFunctions: [],
      missingColumns: [],
      diagnostic: supabaseErrorText(
        error instanceof Error ? error.message : "Falha desconhecida ao consultar o Supabase",
        directConfig?.serviceRoleKey,
      ),
    };
  }
}

/**
 * Checks the remote PostgREST contract used by the alerts center.
 *
 * This only reads the generated OpenAPI document. It does not query or
 * mutate alert data, so it is safe to run before either alert operation.
 */
export async function checkAlertsSchema(): Promise<AlertsSchemaCheck> {
  try {
    const document = await supabasePathRequest<SupabaseOpenApiDocument>("/rest/v1/");
    const paths = document.paths ?? {};
    const missingTables = ALERTS_REQUIRED_TABLES.filter(
      (table) => !Object.prototype.hasOwnProperty.call(paths, `/${table}`),
    );
    const missingFunctions = ALERTS_REQUIRED_FUNCTIONS.filter(
      (name) => !Object.prototype.hasOwnProperty.call(paths, `/rpc/${name}`),
    );
    return {
      complete: missingTables.length === 0 && missingFunctions.length === 0,
      unavailable: false,
      missingTables: [...missingTables],
      missingFunctions: [...missingFunctions],
    };
  } catch (error) {
    const directConfig = getDirectSupabaseConfig();
    return {
      complete: false,
      unavailable: true,
      missingTables: [],
      missingFunctions: [],
      diagnostic: supabaseErrorText(
        error instanceof Error ? error.message : "Falha desconhecida ao consultar o Supabase",
        directConfig?.serviceRoleKey,
      ),
    };
  }
}

/**
 * Checks the remote PostgREST contract required by Amazon history retention.
 *
 * The OpenAPI document exposes RPCs without invoking them, so this check is
 * read-only and cannot acquire the retention lock or change history data.
 */
export async function checkAmazonRetentionSchema(): Promise<AmazonRetentionSchemaCheck> {
  try {
    const document = await supabasePathRequest<SupabaseOpenApiDocument>("/rest/v1/");
    const paths = document.paths ?? {};
    const missingFunctions = AMAZON_RETENTION_REQUIRED_FUNCTIONS.filter(
      (name) => !Object.prototype.hasOwnProperty.call(paths, `/rpc/${name}`),
    );
    return {
      complete: missingFunctions.length === 0,
      unavailable: false,
      missingFunctions: [...missingFunctions],
    };
  } catch (error) {
    const directConfig = getDirectSupabaseConfig();
    return {
      complete: false,
      unavailable: true,
      failureReason: supabaseAvailabilityFailureReason(error),
      missingFunctions: [],
      diagnostic: supabaseErrorText(
        error instanceof Error ? error.message : "Falha desconhecida ao consultar o Supabase",
        directConfig?.serviceRoleKey,
      ),
    };
  }
}

export function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toDateOnly(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
