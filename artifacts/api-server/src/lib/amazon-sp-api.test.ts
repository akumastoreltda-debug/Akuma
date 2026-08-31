import { deepStrictEqual, match, rejects, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import {
  AmazonApiError,
  AmazonConfigurationError,
  AmazonSpApiClient,
  AmazonPayloadError,
  classifyAmazonError,
  getAmazonConfig,
  sanitizeAmazonError,
  smokeTestAmazon,
  syncFinances,
  syncInventory,
  syncOrders,
  type AmazonSpApiClientLike,
  type AmazonSyncStore,
  type InventorySyncInput,
} from "./amazon-sp-api";
import {
  AMAZON_SYNC_REQUIRED_FUNCTIONS,
  AMAZON_SYNC_REQUIRED_COLUMNS,
  AMAZON_SYNC_REQUIRED_TABLES,
  checkAmazonSyncSchema,
} from "./supabase";

type Row = Record<string, unknown>;

const amazonSecretEnv = [
  "AMAZON_LWA_CLIENT_ID",
  "AMAZON_LWA_CLIENT_SECRET",
  "AMAZON_LWA_REFRESH_TOKEN",
  "AMAZON_MARKETPLACE_ID",
] as const;

const supabaseEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

async function withAmazonSecrets(run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(
    amazonSecretEnv.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    AMAZON_LWA_CLIENT_ID: "client-id",
    AMAZON_LWA_CLIENT_SECRET: "client-secret",
    AMAZON_LWA_REFRESH_TOKEN: "Atzr|refresh-token",
  });
  try {
    await run();
  } finally {
    for (const key of amazonSecretEnv) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("Amazon configuration", () => {
  it("requires only LWA credentials and defaults to the Brazilian marketplace", async () => {
    await withAmazonSecrets(async () => {
      delete process.env.AMAZON_MARKETPLACE_ID;
      const config = getAmazonConfig();

      deepStrictEqual(config.missingSecrets, []);
      strictEqual(config.marketplaceId, "A2Q3Y263D00KWC");
      strictEqual("ownerClerkId" in config, false);
    });
  });
});

async function withSupabaseConfig(run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(
    supabaseEnv.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "supabase-service-role-key",
  });
  try {
    await run();
  } finally {
    for (const key of supabaseEnv) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function financialTransaction(
  amount: number,
  transactionId = "transaction-1",
  orderId = "ORDER-1",
  itemId = "ITEM-1",
  sku = "SKU-1",
): Row {
  return {
    transactionId,
    transactionType: "Order",
    postedDate: "2026-08-31T10:00:00.000Z",
    relatedIdentifiers: [
      { relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: orderId },
    ],
    items: [
      {
        relatedIdentifiers: [
          {
            itemRelatedIdentifierName: "ORDER_ITEM_ID",
            itemRelatedIdentifierValue: itemId,
          },
        ],
        contexts: [{ contextType: "ProductContext", sku }],
        breakdowns: [
          {
            breakdownType: "Commission",
            breakdownAmount: { currencyAmount: amount, currencyCode: "BRL" },
          },
        ],
      },
    ],
  };
}

class AmazonFixtureClient implements AmazonSpApiClientLike {
  readonly marketplaceId = "MARKETPLACE-1";
  readonly orderCalls: Array<Record<string, string | undefined>> = [];
  orderPages: Row[] = [];
  financeAmount = 10;
  financePage: Row | undefined;
  inventoryPage: Row | undefined;
  inventoryAvailable = 10;
  inventorySummaries: Row[] = [];

  async request(
    path: string,
    query: Record<string, string | undefined> = {},
  ): Promise<Row> {
    if (path === "/orders/2026-01-01/orders") {
      this.orderCalls.push(query);
      return this.orderPages.shift() ?? { orders: [] };
    }
    if (path === "/finances/2024-06-19/transactions") {
      return (
        this.financePage ?? {
          payload: { transactions: [financialTransaction(this.financeAmount)] },
        }
      );
    }
    if (path === "/fba/inventory/v1/summaries") {
      return (
        this.inventoryPage ?? {
          payload: {
            inventorySummaries: [
              {
                sellerSku: "SKU-1",
                asin: "ASIN-1",
                fulfillableQuantity: this.inventoryAvailable,
                totalQuantity: this.inventoryAvailable,
                inventoryDetails: {
                  reservedQuantity: { totalReservedQuantity: 0 },
                  inboundWorkingQuantity: 0,
                  inboundShippedQuantity: 0,
                  inboundReceivingQuantity: 0,
                },
              },
            ],
          },
        }
      );
    }
    throw new Error(`Unexpected Amazon fixture path: ${path}`);
  }

  async paginated(): Promise<Row[]> {
    return this.inventorySummaries.length
      ? this.inventorySummaries
      : [
          {
            sellerSku: "SKU-1",
            asin: "ASIN-1",
            fulfillableQuantity: this.inventoryAvailable,
            totalQuantity: this.inventoryAvailable,
            inventoryDetails: {
              reservedQuantity: { totalReservedQuantity: 0 },
              inboundWorkingQuantity: 0,
              inboundShippedQuantity: 0,
              inboundReceivingQuantity: 0,
            },
          },
        ];
  }
}

class MemorySyncStore implements AmazonSyncStore {
  readonly products: Row[] = [
    {
      id: "product-1",
      sku: "SKU-1",
      asin: "ASIN-1",
      name: "Produto de fixture",
      current_cost: 3,
      available_stock: 10,
    },
  ];
  readonly savedSales = new Map<string, Row>();
  readonly financialEvents = new Map<string, Row>();
  readonly sales: Row[] = [
    {
      id: "sale-1",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-1",
      sku: "SKU-1",
    },
  ];
  readonly inventorySnapshots = new Map<string, InventorySyncInput>();
  readonly inventoryMovements = new Map<string, { quantity: number }>();

  async getProducts(): Promise<Row[]> {
    return this.products;
  }

  async saveSales(rows: Row[]): Promise<void> {
    for (const row of rows) {
      const key = `${row.owner_clerk_id}:${row.marketplace_id}:${row.external_order_item_id}`;
      this.savedSales.set(key, row);
    }
  }

  async saveFinancialEvents(rows: Row[]): Promise<void> {
    for (const row of rows) {
      this.financialEvents.set(String(row.external_event_id), row);
    }
  }

  async getFinancialEvents(
    _owner: string,
    _marketplace: string,
    orderId: string,
  ): Promise<Row[]> {
    return [...this.financialEvents.values()].filter(
      (event) => event.amazon_order_number === orderId,
    );
  }

  async getSales(
    _owner: string,
    _marketplace: string,
    orderId: string,
  ): Promise<Row[]> {
    return this.sales.filter((sale) => sale.amazon_order_number === orderId);
  }

  async updateSale(_owner: string, saleId: string, values: Row): Promise<void> {
    const sale = this.sales.find((item) => item.id === saleId);
    if (!sale) throw new Error(`Unknown sale: ${saleId}`);
    Object.assign(sale, values);
  }

  async applyInventorySync(input: InventorySyncInput): Promise<void> {
    this.inventorySnapshots.set(input.snapshotKey, input);
    const product = this.products.find((item) => item.sku === input.sku);
    if (!product) return;

    const delta = input.available - Number(product.available_stock ?? 0);
    product.available_stock = input.available;
    if (delta !== 0)
      this.inventoryMovements.set(input.movementKey, { quantity: delta });
  }
}

describe("Amazon SP-API request transport", () => {
  it("sends the common required headers for Orders, Finances, and FBA Inventory", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).includes("/auth/o2/token")) {
        return new Response(JSON.stringify({ access_token: "Atza|access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        for (const path of [
          "/orders/2026-01-01/orders",
          "/finances/2024-06-19/transactions",
          "/fba/inventory/v1/summaries",
        ]) {
          await client.request(path, { marketplaceIds: "MARKETPLACE-1" });
        }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(calls.length, 4);
    const apiCalls = calls.filter(({ url }) => !url.includes("/auth/o2/token"));
    strictEqual(apiCalls.length, 3);
    for (const call of apiCalls) {
      const headers = new Headers(call.init?.headers);
      strictEqual(headers.get("accept"), "application/json");
      strictEqual(
        headers.get("user-agent"),
        "Amazon Profit Manager/1.0 (Language=TypeScript; Platform=Node.js)",
      );
      strictEqual(headers.get("x-amz-access-token"), "Atza|access-token");
      match(headers.get("x-amz-date") ?? "", /^\d{8}T\d{6}Z$/);
      strictEqual(
        new URL(call.url).searchParams.get("marketplaceIds"),
        "MARKETPLACE-1",
      );
    }
  });

  it("expires the cached access token according to the LWA TTL", async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    let now = 1_000_000;
    let tokenCalls = 0;
    Date.now = () => now;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `Atza|access-token-${tokenCalls}`,
            expires_in: 60,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          orders: [],
          token: headers.get("x-amz-access-token"),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await client.request("/orders/2026-01-01/orders");
        now += 59_999;
        await client.request("/orders/2026-01-01/orders");
        strictEqual(tokenCalls, 1);
        now += 1;
        await client.request("/orders/2026-01-01/orders");
        strictEqual(tokenCalls, 2);
      });
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    }
  });

  it("renews once after a 401 and retries the request with the new token", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let tokenCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `Atza|access-token-${tokenCalls}`,
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const token = new Headers(init?.headers).get("x-amz-access-token");
      return token === "Atza|access-token-1"
        ? new Response(
            JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          )
        : new Response(JSON.stringify({ orders: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };

    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await client.request("/orders/2026-01-01/orders", {
          marketplaceIds: "MARKETPLACE-1",
        });
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(tokenCalls, 2);
    strictEqual(calls.length, 4);
    strictEqual(
      new Headers(calls[1].init?.headers).get("x-amz-access-token"),
      "Atza|access-token-1",
    );
    strictEqual(
      new Headers(calls[3].init?.headers).get("x-amz-access-token"),
      "Atza|access-token-2",
    );
    strictEqual(new URL(calls[1].url).search, "?marketplaceIds=MARKETPLACE-1");
    strictEqual(new URL(calls[3].url).search, "?marketplaceIds=MARKETPLACE-1");
  });

  it("deduplicates token renewal for concurrent requests receiving 401", async () => {
    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    let initialApiCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `Atza|access-token-${tokenCalls}`,
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const token = new Headers(init?.headers).get("x-amz-access-token");
      if (token === "Atza|access-token-1") {
        initialApiCalls += 1;
        return new Response(
          JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ orders: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await Promise.all([
          client.request("/orders/2026-01-01/orders"),
          client.request("/orders/2026-01-01/orders"),
          client.request("/orders/2026-01-01/orders"),
        ]);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(initialApiCalls, 3);
    strictEqual(tokenCalls, 2);
  });

  it("sanitizes tokens in generic and Amazon API errors", () => {
    const generic = sanitizeAmazonError(
      new Error(
        'Authorization bearer abc.def-123 access_token=Atza|access-token refresh_token=Atzr|refresh-token {"client_secret":"secret-value"}',
      ),
    );
    strictEqual(
      generic,
      "Authorization Bearer [token] access_token=[redacted] refresh_token=[redacted] {\"client_secret\":\"[redacted]\"}",
    );

    const amazonApi = sanitizeAmazonError(
      new AmazonApiError(
        'Amazon response: {"x-amz-access-token":"Atza|access-token"}',
      ),
    );
    strictEqual(
      amazonApi,
      'Amazon response: {"x-amz-access-token":"[redacted]"}',
    );
    strictEqual(
      sanitizeAmazonError(
        new AmazonConfigurationError(["AMAZON_LWA_CLIENT_SECRET"]),
      ),
      "Secrets ausentes: AMAZON_LWA_CLIENT_SECRET",
    );
  });

  it("classifies signature and throttling failures without exposing response data", async () => {
    const originalFetch = globalThis.fetch;
    let apiStatus = 403;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return new Response(JSON.stringify({ access_token: "Atza|access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          errors: [
            {
              code: apiStatus === 403 ? "InvalidSignature" : "QuotaExceeded",
              message: "sensitive response details",
            },
          ],
        }),
        { status: apiStatus, headers: { "content-type": "application/json" } },
      );
    };

    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await rejects(
          client.request("/orders/2026-01-01/orders"),
          /assinatura da requisição Amazon foi rejeitada/i,
        );
        apiStatus = 429;
        await rejects(
          client.request("/orders/2026-01-01/orders"),
          /Amazon limitou temporariamente/i,
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the request headers and query when retrying a transient SP-API error", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let apiAttempt = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/auth/o2/token")) {
        return new Response(JSON.stringify({ access_token: "Atza|access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      apiAttempt += 1;
      if (apiAttempt === 1) {
        return new Response(JSON.stringify({ errors: [{ code: "ServiceUnavailable" }] }), {
          status: 503,
          headers: { "retry-after": "0.001" },
        });
      }
      return new Response(JSON.stringify({ orders: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await client.request("/orders/2026-01-01/orders", {
          marketplaceIds: "MARKETPLACE-1",
          createdAfter: "2026-08-01T00:00:00Z",
        });
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(calls.length, 3);
    strictEqual(apiAttempt, 2);
    const firstAttempt = new Headers(calls[1].init?.headers);
    const secondAttempt = new Headers(calls[2].init?.headers);
    strictEqual(firstAttempt.get("x-amz-access-token"), "Atza|access-token");
    strictEqual(
      secondAttempt.get("x-amz-access-token"),
      "Atza|access-token",
    );
    match(firstAttempt.get("x-amz-date") ?? "", /^\d{8}T\d{6}Z$/);
    match(secondAttempt.get("x-amz-date") ?? "", /^\d{8}T\d{6}Z$/);
    strictEqual(
      new URL(calls[1].url).search,
      new URL(calls[2].url).search,
    );
  });
});

describe("Amazon synchronization fixtures", () => {
  it("runs a bounded read-only smoke test for all three SP-API resources", async () => {
    const client = new AmazonFixtureClient();
    const checks = await smokeTestAmazon(
      client,
      new Date("2026-08-31T12:00:00.000Z"),
    );

    deepStrictEqual(
      checks.map(({ type, status, count, error }) => ({
        type,
        status,
        count,
        error,
      })),
      [
        { type: "orders", status: "completed", count: 0, error: null },
        { type: "finances", status: "completed", count: 1, error: null },
        { type: "inventory", status: "completed", count: 1, error: null },
      ],
    );
    strictEqual(checks.every((check) => check.errorCategory === null), true);
  });

  it("keeps authorization, signature, and throttling visible per module", async () => {
    const client = new AmazonFixtureClient();
    client.request = async (path) => {
      if (path.includes("/orders/")) {
        throw new AmazonApiError("Credenciais Amazon inválidas", 401);
      }
      if (path.includes("/finances/")) {
        throw new AmazonApiError("A assinatura da requisição Amazon foi rejeitada", 403);
      }
      throw new AmazonApiError("A Amazon limitou temporariamente as requisições", 429);
    };

    const checks = await smokeTestAmazon(client);

    deepStrictEqual(
      checks.map(({ type, status, errorCategory }) => ({
        type,
        status,
        errorCategory,
      })),
      [
        { type: "orders", status: "failed", errorCategory: "authorization" },
        { type: "finances", status: "failed", errorCategory: "signature" },
        { type: "inventory", status: "failed", errorCategory: "throttling" },
      ],
    );
    strictEqual(checks.every((check) => check.durationMs >= 0), true);
    strictEqual(classifyAmazonError(new AmazonApiError("forbidden", 403)), "authorization");
    strictEqual(
      classifyAmazonError(new AmazonApiError("Credenciais LWA inválidas", 400)),
      "authorization",
    );
  });

  it("loads both Orders pages from pagination.nextToken without losing an order", async () => {
    const client = new AmazonFixtureClient();
    client.orderPages = [
      {
        orders: [
          {
            orderId: "ORDER-1",
            createdTime: "2026-08-31T09:00:00.000Z",
            orderItems: [
              {
                orderItemId: "ITEM-1",
                quantityOrdered: 1,
                product: {
                  sellerSku: "SKU-1",
                  asin: "ASIN-1",
                  title: "Produto 1",
                  price: { unitPrice: { amount: 20 } },
                },
                proceeds: { proceedsTotal: { amount: 20 } },
              },
            ],
          },
        ],
        pagination: { nextToken: "orders-page-2" },
      },
      {
        payload: {
          orders: [
            {
              orderId: "ORDER-2",
              createdTime: "2026-08-31T09:30:00.000Z",
              orderItems: [
                {
                  orderItemId: "ITEM-2",
                  quantityOrdered: 2,
                  product: {
                    sellerSku: "SKU-1",
                    asin: "ASIN-1",
                    title: "Produto 1",
                    price: { unitPrice: { amount: 15 } },
                  },
                  proceeds: { proceedsTotal: { amount: 30 } },
                },
              ],
            },
          ],
        },
      },
    ];
    const store = new MemorySyncStore();

    const count = await syncOrders(
      "owner-1",
      client,
      "2026-08-01T00:00:00.000Z",
      store,
    );

    strictEqual(count, 2);
    deepStrictEqual(
      client.orderCalls.map((query) => query.paginationToken),
      [undefined, "orders-page-2"],
    );
    strictEqual(store.savedSales.size, 2);
    deepStrictEqual(
      [...store.savedSales.values()]
        .map((row) => row.external_order_item_id)
        .sort(),
      ["ITEM-1", "ITEM-2"],
    );
  });

  it("renews once when a later Orders page expires the token and keeps all items", async () => {
    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    const apiTokens: string[] = [];
    const paginationTokens: Array<string | null> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `Atza|sync-token-${tokenCalls}`,
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const requestUrl = new URL(url);
      const token = new Headers(init?.headers).get("x-amz-access-token");
      apiTokens.push(token ?? "");
      paginationTokens.push(requestUrl.searchParams.get("paginationToken"));

      if (token === "Atza|sync-token-1" && paginationTokens.length === 2) {
        return new Response(
          JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (token === "Atza|sync-token-1") {
        return new Response(
          JSON.stringify({
            orders: [
              {
                orderId: "ORDER-1",
                createdTime: "2026-08-31T09:00:00.000Z",
                orderItems: [
                  {
                    orderItemId: "ITEM-1",
                    quantityOrdered: 1,
                    product: {
                      sellerSku: "SKU-1",
                      asin: "ASIN-1",
                      title: "Produto 1",
                      price: { unitPrice: { amount: 20 } },
                    },
                    proceeds: { proceedsTotal: { amount: 20 } },
                  },
                ],
              },
            ],
            pagination: { nextToken: "orders-page-2" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          payload: {
            orders: [
              {
                orderId: "ORDER-2",
                createdTime: "2026-08-31T09:30:00.000Z",
                orderItems: [
                  {
                    orderItemId: "ITEM-2",
                    quantityOrdered: 2,
                    product: {
                      sellerSku: "SKU-1",
                      asin: "ASIN-1",
                      title: "Produto 1",
                      price: { unitPrice: { amount: 15 } },
                    },
                    proceeds: { proceedsTotal: { amount: 30 } },
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const store = new MemorySyncStore();
    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        strictEqual(
          await syncOrders(
            "owner-1",
            client,
            "2026-08-01T00:00:00.000Z",
            store,
          ),
          2,
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(tokenCalls, 2);
    deepStrictEqual(apiTokens, [
      "Atza|sync-token-1",
      "Atza|sync-token-1",
      "Atza|sync-token-2",
    ]);
    deepStrictEqual(paginationTokens, [null, "orders-page-2", "orders-page-2"]);
    strictEqual(store.savedSales.size, 2);
    deepStrictEqual(
      [...store.savedSales.values()]
        .map((row) => row.external_order_item_id)
        .sort(),
      ["ITEM-1", "ITEM-2"],
    );
  });

  it("renews once when a later Finances page expires the token and keeps all events", async () => {
    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    const apiTokens: string[] = [];
    const paginationTokens: Array<string | null> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `Atza|finance-token-${tokenCalls}`,
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const requestUrl = new URL(url);
      const token = new Headers(init?.headers).get("x-amz-access-token");
      apiTokens.push(token ?? "");
      paginationTokens.push(requestUrl.searchParams.get("nextToken"));

      if (
        token === "Atza|finance-token-1" &&
        requestUrl.searchParams.get("nextToken") === "finance-page-2"
      ) {
        return new Response(
          JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        );
      }

      const isFirstPage = requestUrl.searchParams.get("nextToken") === null;
      return new Response(
        JSON.stringify({
          payload: {
            transactions: [
              financialTransaction(
                isFirstPage ? 10 : 12.5,
                isFirstPage ? "transaction-1" : "transaction-2",
              ),
            ],
            ...(isFirstPage ? { nextToken: "finance-page-2" } : {}),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const store = new MemorySyncStore();
    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        strictEqual(
          await syncFinances(
            "owner-1",
            client,
            "2026-08-01T00:00:00.000Z",
            store,
          ),
          2,
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(tokenCalls, 2);
    deepStrictEqual(apiTokens, [
      "Atza|finance-token-1",
      "Atza|finance-token-1",
      "Atza|finance-token-2",
    ]);
    deepStrictEqual(paginationTokens, [
      null,
      "finance-page-2",
      "finance-page-2",
    ]);
    strictEqual(store.financialEvents.size, 2);
    deepStrictEqual(
      [...store.financialEvents.values()]
        .map((event) => ({
          type: event.event_type,
          amount: event.amount,
          orderId: event.amazon_order_number,
          itemId: event.order_item_id,
          sku: event.sku,
        }))
        .sort((left, right) => Number(left.amount) - Number(right.amount)),
      [
        {
          type: "commission",
          amount: 10,
          orderId: "ORDER-1",
          itemId: "ITEM-1",
          sku: "SKU-1",
        },
        {
          type: "commission",
          amount: 12.5,
          orderId: "ORDER-1",
          itemId: "ITEM-1",
          sku: "SKU-1",
        },
      ],
    );
  });

  it("renews once when a later Inventory page expires the token and keeps all summaries", async () => {
    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    const apiTokens: string[] = [];
    const paginationTokens: Array<string | null> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `Atza|inventory-token-${tokenCalls}`,
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const requestUrl = new URL(url);
      const token = new Headers(init?.headers).get("x-amz-access-token");
      apiTokens.push(token ?? "");
      paginationTokens.push(requestUrl.searchParams.get("nextToken"));

      if (
        token === "Atza|inventory-token-1" &&
        requestUrl.searchParams.get("nextToken") === "inventory-page-2"
      ) {
        return new Response(
          JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        );
      }

      const isFirstPage = requestUrl.searchParams.get("nextToken") === null;
      const sku = isFirstPage ? "SKU-1" : "SKU-2";
      const available = isFirstPage ? 10 : 7;
      return new Response(
        JSON.stringify({
          payload: {
            inventorySummaries: [
              {
                sellerSku: sku,
                asin: `ASIN-${isFirstPage ? "1" : "2"}`,
                fulfillableQuantity: available,
                totalQuantity: available,
                inventoryDetails: {
                  reservedQuantity: { totalReservedQuantity: 0 },
                  inboundWorkingQuantity: 0,
                  inboundShippedQuantity: 0,
                  inboundReceivingQuantity: 0,
                },
              },
            ],
            ...(isFirstPage ? { nextToken: "inventory-page-2" } : {}),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const store = new MemorySyncStore();
    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        strictEqual(
          await syncInventory("owner-1", client, "run-expired-token", store),
          2,
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(tokenCalls, 2);
    deepStrictEqual(apiTokens, [
      "Atza|inventory-token-1",
      "Atza|inventory-token-1",
      "Atza|inventory-token-2",
    ]);
    deepStrictEqual(paginationTokens, [
      null,
      "inventory-page-2",
      "inventory-page-2",
    ]);
    strictEqual(store.inventorySnapshots.size, 2);
    deepStrictEqual(
      [...store.inventorySnapshots.values()]
        .map((snapshot) => snapshot.sku)
        .sort(),
      ["SKU-1", "SKU-2"],
    );
  });

  it("does not persist partial Finances data when renewal also returns 401", async () => {
    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    const apiTokens: string[] = [];
    let financeCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token:
              tokenCalls === 1
                ? "Atza|finance-original"
                : "Atza|finance-renewed",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      financeCalls += 1;
      const token = new Headers(init?.headers).get("x-amz-access-token");
      apiTokens.push(token ?? "");
      if (financeCalls === 1) {
        return new Response(
          JSON.stringify({
            payload: {
              transactions: [financialTransaction(10)],
              nextToken: "finance-page-2",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    };

    const store = new MemorySyncStore();
    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await rejects(
          syncFinances(
            "owner-1",
            client,
            "2026-08-01T00:00:00.000Z",
            store,
          ),
          (error: unknown) =>
            error instanceof AmazonApiError &&
            error.status === 401 &&
            classifyAmazonError(error) === "authorization",
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(tokenCalls, 2);
    deepStrictEqual(apiTokens, [
      "Atza|finance-original",
      "Atza|finance-original",
      "Atza|finance-renewed",
    ]);
    strictEqual(store.financialEvents.size, 0);
    strictEqual(store.sales[0].refunds, undefined);
    strictEqual(store.sales[0].amazon_commission, undefined);
  });

  it("does not persist partial Inventory data when renewal also returns 401", async () => {
    const originalFetch = globalThis.fetch;
    let tokenCalls = 0;
    const apiTokens: string[] = [];
    let inventoryCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token:
              tokenCalls === 1
                ? "Atza|inventory-original"
                : "Atza|inventory-renewed",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      inventoryCalls += 1;
      const token = new Headers(init?.headers).get("x-amz-access-token");
      apiTokens.push(token ?? "");
      if (inventoryCalls === 1) {
        return new Response(
          JSON.stringify({
            payload: {
              inventorySummaries: [
                {
                  sellerSku: "SKU-1",
                  asin: "ASIN-1",
                  fulfillableQuantity: 4,
                  totalQuantity: 4,
                  inventoryDetails: {
                    reservedQuantity: { totalReservedQuantity: 0 },
                    inboundWorkingQuantity: 0,
                    inboundShippedQuantity: 0,
                    inboundReceivingQuantity: 0,
                  },
                },
              ],
              nextToken: "inventory-page-2",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ errors: [{ code: "Unauthorized" }] }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    };

    const store = new MemorySyncStore();
    try {
      await withAmazonSecrets(async () => {
        const client = new AmazonSpApiClient();
        await rejects(
          syncInventory("owner-1", client, "run-renewal-failed", store),
          (error: unknown) =>
            error instanceof AmazonApiError &&
            error.status === 401 &&
            classifyAmazonError(error) === "authorization",
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    strictEqual(tokenCalls, 2);
    deepStrictEqual(apiTokens, [
      "Atza|inventory-original",
      "Atza|inventory-original",
      "Atza|inventory-renewed",
    ]);
    strictEqual(store.inventorySnapshots.size, 0);
    strictEqual(store.inventoryMovements.size, 0);
    strictEqual(store.products[0].available_stock, 10);
  });

  it("accepts the direct Finances response envelope", async () => {
    const client = new AmazonFixtureClient();
    client.financePage = {
      transactions: [financialTransaction(10)],
    };
    const store = new MemorySyncStore();

    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      1,
    );
    strictEqual(store.financialEvents.size, 1);
  });

  it("persists refunds, adjustments, and payouts and updates the matching sale", async () => {
    const client = new AmazonFixtureClient();
    client.financePage = {
      payload: {
        transactions: [
          {
            transactionId: "refund-1",
            transactionType: "Refund",
            postedDate: "2026-08-31T11:00:00.000Z",
            relatedIdentifiers: [
              {
                relatedIdentifierName: "ORDER_ID",
                relatedIdentifierValue: "ORDER-1",
              },
            ],
            items: [
              {
                relatedIdentifiers: [
                  {
                    itemRelatedIdentifierName: "ORDER_ITEM_ID",
                    itemRelatedIdentifierValue: "ITEM-1",
                  },
                ],
                contexts: [
                  { contextType: "ProductContext", sku: "SKU-1" },
                ],
                totalAmount: {
                  currencyAmount: -18.75,
                  currencyCode: "BRL",
                },
              },
            ],
          },
          {
            transactionId: "adjustment-1",
            transactionType: "Adjustment",
            postedDate: "2026-08-31T12:00:00.000Z",
            relatedIdentifiers: [
              {
                relatedIdentifierName: "ORDER_ID",
                relatedIdentifierValue: "ORDER-1",
              },
            ],
            items: [
              {
                relatedIdentifiers: [
                  {
                    itemRelatedIdentifierName: "ORDER_ITEM_ID",
                    itemRelatedIdentifierValue: "ITEM-1",
                  },
                ],
                contexts: [
                  { contextType: "ProductContext", sku: "SKU-1" },
                ],
                totalAmount: {
                  currencyAmount: 4.5,
                  currencyCode: "BRL",
                },
              },
            ],
          },
          {
            transactionId: "payout-1",
            transactionType: "Disbursement",
            postedDate: "2026-08-31T13:00:00.000Z",
            relatedIdentifiers: [
              {
                relatedIdentifierName: "ORDER_ID",
                relatedIdentifierValue: "ORDER-1",
              },
            ],
            totalAmount: {
              currencyAmount: 42.5,
              currencyCode: "BRL",
            },
          },
        ],
      },
    };
    const store = new MemorySyncStore();

    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      3,
    );
    strictEqual(store.financialEvents.size, 3);
    deepStrictEqual(
      [...store.financialEvents.values()]
        .map((event) => ({
          type: event.event_type,
          amount: event.amount,
          orderId: event.amazon_order_number,
          itemId: event.order_item_id,
          sku: event.sku,
          currency: event.currency,
        }))
        .sort((left, right) => String(left.type).localeCompare(String(right.type))),
      [
        {
          type: "adjustment",
          amount: 4.5,
          orderId: "ORDER-1",
          itemId: "ITEM-1",
          sku: "SKU-1",
          currency: "BRL",
        },
        {
          type: "payout",
          amount: 42.5,
          orderId: "ORDER-1",
          itemId: null,
          sku: null,
          currency: "BRL",
        },
        {
          type: "refund",
          amount: -18.75,
          orderId: "ORDER-1",
          itemId: "ITEM-1",
          sku: "SKU-1",
          currency: "BRL",
        },
      ],
    );
    strictEqual(store.sales[0].refunds, -18.75);
    strictEqual(store.sales[0].adjustments, 4.5);
    strictEqual(store.sales[0].payout, 42.5);
    strictEqual(store.sales[0].amazon_commission, 0);
  });

  it("preserves a negative shared refund total when distributing cents across three sales", async () => {
    const client = new AmazonFixtureClient();
    client.financePage = {
      payload: {
        transactions: [
          {
            transactionId: "shared-refund-1",
            transactionType: "Refund",
            postedDate: "2026-08-31T16:00:00.000Z",
            relatedIdentifiers: [
              {
                relatedIdentifierName: "ORDER_ID",
                relatedIdentifierValue: "ORDER-1",
              },
            ],
            items: [],
            totalAmount: {
              currencyAmount: -12.01,
              currencyCode: "BRL",
            },
          },
        ],
      },
    };
    const store = new MemorySyncStore();
    store.sales.push({
      id: "sale-2",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-2",
      sku: "SKU-2",
    });
    store.sales.push({
      id: "sale-3",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-3",
      sku: "SKU-3",
    });

    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      1,
    );

    const persistedEventAmount = Number(
      [...store.financialEvents.values()][0].amount,
    );
    const allocations = store.sales.map((sale) => Number(sale.refunds));

    deepStrictEqual(allocations, [-4.01, -4, -4]);
    strictEqual(allocations.every((amount) => amount < 0), true);
    strictEqual(persistedEventAmount, -12.01);
    strictEqual(
      allocations.reduce((total, amount) => total + amount, 0),
      persistedEventAmount,
    );
  });

  it("distributes an item-less financial event in cents without losing the total", async () => {
    const client = new AmazonFixtureClient();
    client.financePage = {
      payload: {
        transactions: [
          {
            transactionId: "shared-adjustment-1",
            transactionType: "Adjustment",
            postedDate: "2026-08-31T14:00:00.000Z",
            relatedIdentifiers: [
              {
                relatedIdentifierName: "ORDER_ID",
                relatedIdentifierValue: "ORDER-1",
              },
            ],
            items: [],
            totalAmount: {
              currencyAmount: 12.01,
              currencyCode: "BRL",
            },
          },
        ],
      },
    };
    const store = new MemorySyncStore();
    store.sales.push({
      id: "sale-2",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-2",
      sku: "SKU-2",
    });
    store.sales.push({
      id: "sale-3",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-3",
      sku: "SKU-3",
    });

    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      1,
    );
    strictEqual(store.financialEvents.size, 1);
    deepStrictEqual([...store.financialEvents.values()][0], {
      owner_clerk_id: "owner-1",
      marketplace_id: "MARKETPLACE-1",
      external_event_id: "shared-adjustment-1",
      amazon_order_number: "ORDER-1",
      order_item_id: null,
      sku: null,
      event_type: "adjustment",
      amount: 12.01,
      currency: "BRL",
      occurred_at: "2026-08-31T14:00:00.000Z",
      raw_category: "Adjustment",
      updated_at: [...store.financialEvents.values()][0].updated_at,
    });
    deepStrictEqual(
      store.sales.map((sale) => sale.adjustments),
      [4.01, 4, 4],
    );
    const persistedEventAmount = Number(
      [...store.financialEvents.values()][0].amount,
    );
    strictEqual(
      store.sales.reduce(
        (total, sale) => total + Number(sale.adjustments),
        0,
      ),
      persistedEventAmount,
    );
  });

  it("preserves the sign when distributing a negative item-less financial event in cents", async () => {
    const client = new AmazonFixtureClient();
    client.financePage = {
      payload: {
        transactions: [
          {
            transactionId: "shared-negative-adjustment-1",
            transactionType: "Adjustment",
            postedDate: "2026-08-31T15:00:00.000Z",
            relatedIdentifiers: [
              {
                relatedIdentifierName: "ORDER_ID",
                relatedIdentifierValue: "ORDER-1",
              },
            ],
            items: [],
            totalAmount: {
              currencyAmount: -12.01,
              currencyCode: "BRL",
            },
          },
        ],
      },
    };
    const store = new MemorySyncStore();
    store.sales.push({
      id: "sale-2",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-2",
      sku: "SKU-2",
    });
    store.sales.push({
      id: "sale-3",
      amazon_order_number: "ORDER-1",
      external_order_item_id: "ITEM-3",
      sku: "SKU-3",
    });

    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      1,
    );
    const persistedEventAmount = Number(
      [...store.financialEvents.values()][0].amount,
    );
    const allocations = store.sales.map((sale) => Number(sale.adjustments));

    deepStrictEqual(allocations, [-4.01, -4, -4]);
    strictEqual(allocations.every((amount) => amount < 0), true);
    strictEqual(persistedEventAmount, -12.01);
    strictEqual(
      allocations.reduce((total, amount) => total + amount, 0),
      persistedEventAmount,
    );
  });

  it("accepts the capitalized Inventory response fields", async () => {
    const client = new AmazonFixtureClient();
    client.inventorySummaries = [
      {
        SellerSKU: "SKU-1",
        ASIN: "ASIN-1",
        totalQuantity: 10,
        InventoryDetails: {
          fulfillableQuantity: 10,
          reservedQuantity: { totalReservedQuantity: 0 },
          inboundWorkingQuantity: 0,
          inboundShippedQuantity: 0,
          inboundReceivingQuantity: 0,
        },
      },
    ];
    const store = new MemorySyncStore();

    strictEqual(
      await syncInventory("owner-1", client, "run-capitalized", store),
      1,
    );
    strictEqual(store.inventorySnapshots.size, 1);
    strictEqual(store.products[0].available_stock, 10);
  });

  it("rejects an Orders payload missing orderId before saving sales", async () => {
    const client = new AmazonFixtureClient();
    client.orderPages = [
      {
        orders: [
          {
            createdTime: "2026-08-31T09:00:00.000Z",
            orderItems: [],
          },
        ],
      },
    ];
    const store = new MemorySyncStore();

    await rejects(
      syncOrders("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      (error: unknown) =>
        error instanceof AmazonPayloadError &&
        /orders.*orderId.*texto obrigatório ausente/i.test(error.message),
    );
    strictEqual(store.savedSales.size, 0);
  });

  it("rejects a Finances payload missing transactionId before saving events", async () => {
    const transaction = financialTransaction(10);
    delete transaction.transactionId;
    const client = new AmazonFixtureClient();
    client.financePage = { payload: { transactions: [transaction] } };
    const store = new MemorySyncStore();

    await rejects(
      syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      (error: unknown) =>
        error instanceof AmazonPayloadError &&
        /finances.*transactionId.*texto obrigatório ausente/i.test(
          error.message,
        ),
    );
    strictEqual(store.financialEvents.size, 0);
  });

  it("rejects an Inventory summary missing sellerSku before applying a snapshot", async () => {
    const client = new AmazonFixtureClient();
    client.inventorySummaries = [
      {
        asin: "ASIN-1",
        fulfillableQuantity: 10,
        totalQuantity: 10,
        inventoryDetails: {
          reservedQuantity: { totalReservedQuantity: 0 },
          inboundWorkingQuantity: 0,
          inboundShippedQuantity: 0,
          inboundReceivingQuantity: 0,
        },
      },
    ];
    const store = new MemorySyncStore();

    await rejects(
      syncInventory("owner-1", client, "run-invalid", store),
      (error: unknown) =>
        error instanceof AmazonPayloadError &&
        /inventory.*sellerSku.*campo obrigatório ausente/i.test(error.message),
    );
    strictEqual(store.inventorySnapshots.size, 0);
  });

  it("updates a corrected financial breakdown in place instead of duplicating the event", async () => {
    const client = new AmazonFixtureClient();
    const store = new MemorySyncStore();

    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      1,
    );
    strictEqual(store.financialEvents.size, 1);
    strictEqual(store.sales[0].amazon_commission, 10);

    client.financeAmount = 7;
    strictEqual(
      await syncFinances("owner-1", client, "2026-08-01T00:00:00.000Z", store),
      1,
    );

    strictEqual(store.financialEvents.size, 1);
    strictEqual([...store.financialEvents.values()][0].amount, 7);
    strictEqual(store.sales[0].amazon_commission, 7);
  });

  it("records only real inventory deltas for 10 to 5 to 10 and a repeated 10", async () => {
    const client = new AmazonFixtureClient();
    const store = new MemorySyncStore();

    await syncInventory("owner-1", client, "run-1", store);
    client.inventoryAvailable = 5;
    await syncInventory("owner-1", client, "run-2", store);
    client.inventoryAvailable = 10;
    await syncInventory("owner-1", client, "run-3", store);
    await syncInventory("owner-1", client, "run-4", store);

    strictEqual(store.products[0].available_stock, 10);
    deepStrictEqual(
      [...store.inventoryMovements.values()].map(
        (movement) => movement.quantity,
      ),
      [-5, 5],
    );
    strictEqual(store.inventoryMovements.size, 2);
    strictEqual(store.inventorySnapshots.size, 4);
  });
});

describe("Supabase Amazon schema smoke check", () => {
  it("confirms the required remote tables and RPC functions", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      const paths = Object.fromEntries([
        ...AMAZON_SYNC_REQUIRED_TABLES.map((table) => [`/${table}`, {}]),
        ...AMAZON_SYNC_REQUIRED_FUNCTIONS.map((name) => [`/rpc/${name}`, {}]),
      ]);
      const definitions = Object.fromEntries(
        [...new Set(AMAZON_SYNC_REQUIRED_COLUMNS.map(({ table }) => table))].map(
          (table) => [
            table,
            {
              properties: Object.fromEntries(
                AMAZON_SYNC_REQUIRED_COLUMNS
                  .filter((column) => column.table === table)
                  .map(({ column }) => [column, {}]),
              ),
            },
          ],
        ),
      );
      return new Response(JSON.stringify({ paths, definitions }), { status: 200 });
    };

    try {
      await withSupabaseConfig(async () => {
        strictEqual((await checkAmazonSyncSchema()).complete, true);
        strictEqual(calls.length, 1);
        strictEqual(calls[0], "https://example.supabase.co/rest/v1/");
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports a missing column from a partially applied migration", async () => {
    const originalFetch = globalThis.fetch;
    const paths = Object.fromEntries([
      ...AMAZON_SYNC_REQUIRED_TABLES.map((table) => [`/${table}`, {}]),
      ...AMAZON_SYNC_REQUIRED_FUNCTIONS.map((name) => [`/rpc/${name}`, {}]),
    ]);
    const missingColumn = AMAZON_SYNC_REQUIRED_COLUMNS.find(
      ({ table, column }) => table === "sales" && column === "updated_at",
    );
    if (!missingColumn) throw new Error("sales.updated_at must be part of the schema contract");
    const definitions = Object.fromEntries(
      [...new Set(AMAZON_SYNC_REQUIRED_COLUMNS.map(({ table }) => table))].map(
        (table) => [
          table,
          {
            properties: Object.fromEntries(
              AMAZON_SYNC_REQUIRED_COLUMNS
                .filter(
                  (column) =>
                    column.table === table &&
                    !(column.table === missingColumn.table && column.column === missingColumn.column),
                )
                .map(({ column }) => [column, {}]),
            ),
          },
        ],
      ),
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ paths, definitions }), { status: 200 });

    try {
      await withSupabaseConfig(async () => {
        const result = await checkAmazonSyncSchema();
        strictEqual(result.complete, false);
        strictEqual(result.unavailable, false);
        deepStrictEqual(result.missingColumns, [missingColumn]);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports missing remote objects without attempting an Amazon request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          paths: {
            "/products": {},
            "/rpc/acquire_amazon_sync_lock": {},
          },
          definitions: {
            products: {
              properties: Object.fromEntries(
                AMAZON_SYNC_REQUIRED_COLUMNS
                  .filter(({ table }) => table === "products")
                  .map(({ column }) => [column, {}]),
              ),
            },
          },
        }),
        { status: 200 },
      );

    try {
      await withSupabaseConfig(async () => {
        const result = await checkAmazonSyncSchema();
        strictEqual(result.complete, false);
        strictEqual(result.unavailable, false);
        strictEqual(result.missingTables.includes("sales"), true);
        strictEqual(result.missingFunctions.includes("renew_amazon_sync_lock"), true);
        strictEqual(result.missingColumns.length, 0);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not expose the service role key when the remote schema cannot be checked", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("request failed with supabase-service-role-key");
    };

    try {
      await withSupabaseConfig(async () => {
        const result = await checkAmazonSyncSchema();
        strictEqual(result.complete, false);
        strictEqual(result.unavailable, true);
        strictEqual(result.missingColumns.length, 0);
        strictEqual(result.diagnostic?.includes("supabase-service-role-key"), false);
        strictEqual(result.diagnostic?.includes("[redacted]"), true);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
