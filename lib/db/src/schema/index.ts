import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const money = (name: string, precision = 14, scale = 2) => numeric(name, { precision, scale }).notNull().default("0");

export const usersTable = pgTable("users", {
  id: id(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const suppliersTable = pgTable("suppliers", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  name: text("name").notNull(),
  cnpj: text("cnpj"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  deliveryDays: integer("delivery_days").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productsTable = pgTable("products", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  sku: text("sku").notNull(),
  asin: text("asin").notNull(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  category: text("category").notNull().default("Sem categoria"),
  supplier: text("supplier").notNull().default("Sem fornecedor"),
  currentCost: money("current_cost"),
  averageCost: money("average_cost"),
  salePrice: money("sale_price"),
  availableStock: integer("available_stock").notNull().default(0),
  reservedStock: integer("reserved_stock").notNull().default(0),
  inboundStock: integer("inbound_stock").notNull().default(0),
  safetyStock: integer("safety_stock").notNull().default(0),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  minimumOrderQuantity: integer("minimum_order_quantity").notNull().default(1),
  minimumMargin: numeric("minimum_margin", { precision: 7, scale: 4 }).notNull().default("0.20"),
  status: text("status").notNull().default("healthy"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productSuppliersTable = pgTable("product_suppliers", {
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  lastUnitCost: numeric("last_unit_cost", { precision: 14, scale: 2 }),
  lastPurchaseAt: timestamp("last_purchase_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => ({ pk: primaryKey({ columns: [table.productId, table.supplierId] }) }));

export const purchaseBatchesTable = pgTable("purchase_batches", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  productId: uuid("product_id").notNull().references(() => productsTable.id),
  supplierId: uuid("supplier_id").references(() => suppliersTable.id),
  purchasedAt: date("purchased_at").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: money("unit_cost"),
  freight: money("freight"),
  taxes: money("taxes"),
  otherCosts: money("other_costs"),
  createdAt: createdAt(),
});

export const salesTable = pgTable("sales", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  productId: uuid("product_id").references(() => productsTable.id),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
  amazonOrderNumber: text("amazon_order_number").notNull(),
  marketplaceId: text("marketplace_id").notNull().default("A2Q3Y263D00KWC"),
  externalOrderItemId: text("external_order_item_id").notNull(),
  sku: text("sku").notNull(),
  asin: text("asin"),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price"),
  revenueTotal: money("revenue_total"),
  amazonCommission: money("amazon_commission"),
  fbaFee: money("fba_fee"),
  otherAmazonFees: money("other_amazon_fees"),
  refunds: money("refunds"),
  adjustments: money("adjustments"),
  payout: money("payout"),
  attributedAdvertising: money("attributed_advertising"),
  tax: money("tax"),
  productCost: money("product_cost"),
  otherExpenses: money("other_expenses"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const amazonFeesTable = pgTable("amazon_fees", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  saleId: uuid("sale_id").references(() => salesTable.id, { onDelete: "cascade" }),
  feeType: text("fee_type").notNull(),
  amount: money("amount"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  sourceImportId: uuid("source_import_id"),
  createdAt: createdAt(),
});

export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  productId: uuid("product_id").notNull().references(() => productsTable.id),
  movementType: text("movement_type").notNull(),
  quantity: integer("quantity").notNull(),
  referenceId: uuid("reference_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  notes: text("notes"),
  externalMovementKey: text("external_movement_key"),
});

export const expensesTable = pgTable("expenses", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  expenseType: text("expense_type").notNull(),
  description: text("description").notNull(),
  amount: money("amount"),
  occurredAt: date("occurred_at").notNull(),
  createdAt: createdAt(),
});

export const cashTransactionsTable = pgTable("cash_transactions", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  transactionType: text("transaction_type").notNull(),
  description: text("description").notNull(),
  amount: money("amount"),
  occurredAt: date("occurred_at").notNull(),
  createdAt: createdAt(),
});

export const amazonImportsTable = pgTable("amazon_imports", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  importType: text("import_type").notNull(),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path"),
  status: text("status").notNull().default("pending"),
  rowsImported: integer("rows_imported").notNull().default(0),
  errorMessage: text("error_message"),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const alertsTable = pgTable("alerts", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: createdAt(),
});

export const settingsTable = pgTable("settings", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull().unique(),
  defaultMinimumMargin: numeric("default_minimum_margin", { precision: 7, scale: 4 }).notNull().default("0.20"),
  safetyStockDays: integer("safety_stock_days").notNull().default(7),
  salesAveragePeriodDays: integer("sales_average_period_days").notNull().default(30),
  monthlyProfitGoal: money("monthly_profit_goal"),
  monthlyRevenueGoal: money("monthly_revenue_goal"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const amazonConnectionsTable = pgTable("amazon_connections", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull().unique(),
  marketplaceId: text("marketplace_id").notNull().default("A2Q3Y263D00KWC"),
  marketplaceName: text("marketplace_name").notNull().default("Amazon.com.br"),
  connectionStatus: text("connection_status").notNull().default("not_configured"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const amazonSyncRunsTable = pgTable("amazon_sync_runs", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  syncType: text("sync_type").notNull(),
  status: text("status").notNull().default("processing"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms").notNull().default(0),
  ordersCount: integer("orders_count").notNull().default(0),
  financesCount: integer("finances_count").notNull().default(0),
  inventoryCount: integer("inventory_count").notNull().default(0),
  steps: jsonb("steps").notNull().default([]),
  errorMessage: text("error_message"),
  createdAt: createdAt(),
});

export const amazonConnectionTestsTable = pgTable("amazon_connection_tests", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  testedAt: timestamp("tested_at", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms").notNull().default(0),
  success: boolean("success").notNull().default(false),
  checks: jsonb("checks").notNull().default([]),
  createdAt: createdAt(),
});

export const amazonSyncCursorsTable = pgTable("amazon_sync_cursors", {
  ownerClerkId: text("owner_clerk_id").notNull(),
  syncType: text("sync_type").notNull(),
  cursorValue: text("cursor_value"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  updatedAt: updatedAt(),
}, (table) => ({ pk: primaryKey({ columns: [table.ownerClerkId, table.syncType] }) }));

export const amazonFinancialEventsTable = pgTable("amazon_financial_events", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  marketplaceId: text("marketplace_id").notNull(),
  externalEventId: text("external_event_id").notNull(),
  amazonOrderNumber: text("amazon_order_number"),
  orderItemId: text("order_item_id"),
  sku: text("sku"),
  eventType: text("event_type").notNull(),
  amount: money("amount"),
  currency: text("currency").notNull().default("BRL"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  rawCategory: text("raw_category"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const amazonInventorySnapshotsTable = pgTable("amazon_inventory_snapshots", {
  id: id(),
  ownerClerkId: text("owner_clerk_id").notNull(),
  marketplaceId: text("marketplace_id").notNull(),
  sku: text("sku").notNull(),
  asin: text("asin"),
  available: integer("available").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  inbound: integer("inbound").notNull().default(0),
  total: integer("total").notNull().default(0),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  source: text("source").notNull().default("amazon_fba"),
  externalSnapshotKey: text("external_snapshot_key").notNull(),
  createdAt: createdAt(),
});