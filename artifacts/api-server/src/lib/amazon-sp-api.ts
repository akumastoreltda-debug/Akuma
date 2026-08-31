import { createHash } from "node:crypto";
import { supabaseRequest, toNumber } from "./supabase";

const SP_API_ENDPOINT = "https://sellingpartnerapi-na.amazon.com";
const LWA_TOKEN_ENDPOINT = "https://api.amazon.com/auth/o2/token";
const DEFAULT_MARKETPLACE_ID = "A2Q3Y263D00KWC";
const SP_API_USER_AGENT =
  "Amazon Profit Manager/1.0 (Language=TypeScript; Platform=Node.js)";

type JsonRecord = Record<string, unknown>;
export type AmazonSyncKind = "orders" | "finances" | "inventory";
export type AmazonFailureCategory =
  | "authorization"
  | "signature"
  | "throttling"
  | "configuration"
  | "payload"
  | "availability"
  | "latency"
  | "unknown";
export type AmazonSmokeCheck = {
  type: AmazonSyncKind;
  status: "completed" | "failed";
  count: number;
  durationMs: number;
  errorCategory: AmazonFailureCategory | null;
  error: string | null;
};

export class AmazonConfigurationError extends Error {
  constructor(public readonly missingSecrets: string[]) {
    super("A integração Amazon ainda não está configurada");
  }
}

export class AmazonApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export class AmazonPayloadError extends AmazonApiError {
  constructor(
    public readonly resource: AmazonSyncKind,
    public readonly field: string,
    reason: string,
  ) {
    super(
      `Formato inesperado no payload Amazon de ${resource} (${field}): ${reason}`,
    );
    this.name = "AmazonPayloadError";
  }
}

export function getAmazonConfig() {
  const entries = {
    AMAZON_LWA_CLIENT_ID: process.env.AMAZON_LWA_CLIENT_ID,
    AMAZON_LWA_CLIENT_SECRET: process.env.AMAZON_LWA_CLIENT_SECRET,
    AMAZON_LWA_REFRESH_TOKEN: process.env.AMAZON_LWA_REFRESH_TOKEN,
  };
  const missingSecrets = Object.entries(entries)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return {
    clientId: entries.AMAZON_LWA_CLIENT_ID ?? "",
    clientSecret: entries.AMAZON_LWA_CLIENT_SECRET ?? "",
    refreshToken: entries.AMAZON_LWA_REFRESH_TOKEN ?? "",
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID?.trim() || DEFAULT_MARKETPLACE_ID,
    missingSecrets,
  };
}

export function sanitizeAmazonError(error: unknown): string {
  if (error instanceof AmazonConfigurationError) {
    return `Secrets ausentes: ${error.missingSecrets.join(", ")}`;
  }
  if (error instanceof AmazonApiError) return redactAmazonSecrets(error.message).slice(0, 300);
  if (error instanceof Error) {
    return redactAmazonSecrets(error.message).slice(0, 300);
  }
  return "Falha inesperada na integração Amazon";
}

function redactAmazonSecrets(message: string): string {
  return message
    .replace(/Atzr\|[A-Za-z0-9._-]+/g, "[refresh-token]")
    .replace(/Atza\|[A-Za-z0-9._-]+/g, "[access-token]")
    .replace(/bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [token]")
    .replace(
      /(client[_-]?secret|refresh[_-]?token|access[_-]?token|x-amz-access-token)=([^&\s]+)/gi,
      "$1=[redacted]",
    )
    .replace(
      /((?:client[_-]?secret|refresh[_-]?token|access[_-]?token|x-amz-access-token)["']?\s*:\s*["']?)([^"',\s}&]+)/gi,
      "$1[redacted]",
    );
}

export function classifyAmazonError(error: unknown): AmazonFailureCategory {
  if (error instanceof AmazonConfigurationError) return "configuration";
  if (error instanceof AmazonPayloadError) return "payload";

  const message = sanitizeAmazonError(error).toLowerCase();
  if (message.includes("assinatura")) return "signature";
  if (
    (error instanceof AmazonApiError &&
      (error.status === 401 || error.status === 403)) ||
    message.includes("credenciais") ||
    message.includes("autorização")
  ) {
    return "authorization";
  }
  if (error instanceof AmazonApiError && error.status === 429) return "throttling";
  if (message.includes("limitou") || message.includes("throttl")) {
    return "throttling";
  }
  if (
    (error instanceof AmazonApiError && error.status !== undefined && error.status >= 500) ||
    message.includes("indispon") ||
    message.includes("temporar")
  ) {
    return "availability";
  }
  return "unknown";
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function amountValue(value: unknown): number {
  const item = record(value);
  return toNumber(
    item.CurrencyAmount ?? item.currencyAmount ?? item.Amount ?? value,
  );
}

function moneyCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) * 100);
}

function sharedMoneyAmount(
  total: number,
  salesCount: number,
  saleIndex: number,
): number {
  const cents = moneyCents(total);
  const baseCents = Math.trunc(cents / salesCount);
  const remainder = cents - baseCents * salesCount;
  const remainderCents =
    saleIndex < Math.abs(remainder) ? Math.sign(remainder) : 0;
  return (baseCents + remainderCents) / 100;
}

function requiredRecord(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AmazonPayloadError(resource, field, "objeto obrigatório ausente");
  return value as JsonRecord;
}

function requiredArray(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): unknown[] {
  if (!Array.isArray(value))
    throw new AmazonPayloadError(resource, field, "lista obrigatória ausente");
  return value;
}

function requiredString(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim())
    throw new AmazonPayloadError(resource, field, "texto obrigatório ausente");
  return value;
}

function optionalString(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, resource, field);
}

function requiredNumber(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): number {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim()) ||
    !Number.isFinite(Number(value))
  )
    throw new AmazonPayloadError(resource, field, "número obrigatório ausente");
  return Number(value);
}

function requiredAmount(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): number {
  const amount = record(value);
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (amount.CurrencyAmount ??
        amount.currencyAmount ??
        amount.Amount ??
        undefined)
      : value;
  return requiredNumber(raw, resource, field);
}

function aliasedValue(
  value: JsonRecord,
  aliases: string[],
  resource: AmazonSyncKind,
  field: string,
): unknown {
  const alias = aliases.find(
    (key) => value[key] !== undefined && value[key] !== null,
  );
  if (!alias)
    throw new AmazonPayloadError(resource, field, "campo obrigatório ausente");
  return value[alias];
}

function validateOrdersPage(
  page: JsonRecord,
  pageNumber: number,
): { orders: JsonRecord[]; nextToken?: string } {
  const payload =
    page.payload === undefined
      ? page
      : requiredRecord(page.payload, "orders", `página ${pageNumber}.payload`);
  const orders = requiredArray(
    payload.orders,
    "orders",
    `página ${pageNumber}.orders`,
  ).map((value, orderIndex) => {
    const order = requiredRecord(value, "orders", `orders[${orderIndex}]`);
    requiredString(order.orderId, "orders", `orders[${orderIndex}].orderId`);
    requiredString(
      order.createdTime,
      "orders",
      `orders[${orderIndex}].createdTime`,
    );
    const items = requiredArray(
      order.orderItems,
      "orders",
      `orders[${orderIndex}].orderItems`,
    );
    items.forEach((value, itemIndex) => {
      const item = requiredRecord(
        value,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}]`,
      );
      requiredString(
        item.orderItemId,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].orderItemId`,
      );
      requiredNumber(
        item.quantityOrdered,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].quantityOrdered`,
      );
      const product = requiredRecord(
        item.product,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].product`,
      );
      requiredString(
        product.sellerSku,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].product.sellerSku`,
      );
      const unitPrice = requiredRecord(
        record(product.price).unitPrice,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].product.price.unitPrice`,
      );
      requiredAmount(
        unitPrice.amount,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].product.price.unitPrice.amount`,
      );
      const proceedsTotal = requiredRecord(
        record(item.proceeds).proceedsTotal,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].proceeds.proceedsTotal`,
      );
      requiredAmount(
        proceedsTotal.amount,
        "orders",
        `orders[${orderIndex}].orderItems[${itemIndex}].proceeds.proceedsTotal.amount`,
      );
    });
    return order;
  });
  const pagePagination =
    page.pagination === undefined
      ? undefined
      : requiredRecord(
          page.pagination,
          "orders",
          `página ${pageNumber}.pagination`,
        );
  const payloadPagination =
    payload.pagination === undefined
      ? undefined
      : requiredRecord(
          payload.pagination,
          "orders",
          `página ${pageNumber}.payload.pagination`,
        );
  const nextToken =
    optionalString(
      page.nextToken,
      "orders",
      `página ${pageNumber}.nextToken`,
    ) ??
    optionalString(
      payload.nextToken,
      "orders",
      `página ${pageNumber}.nextToken`,
    ) ??
    optionalString(
      pagePagination?.nextToken,
      "orders",
      `página ${pageNumber}.pagination.nextToken`,
    ) ??
    optionalString(
      payloadPagination?.nextToken,
      "orders",
      `página ${pageNumber}.payload.pagination.nextToken`,
    );
  return { orders, nextToken };
}

function validateIdentifierList(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): JsonRecord[] {
  return requiredArray(value, resource, field).map((entry, index) =>
    requiredRecord(entry, resource, `${field}[${index}]`),
  );
}

function validateBreakdowns(
  value: unknown,
  resource: AmazonSyncKind,
  field: string,
): void {
  const breakdowns = requiredArray(value, resource, field);
  if (!breakdowns.length)
    throw new AmazonPayloadError(resource, field, "lista não pode estar vazia");
  breakdowns.forEach((entry, index) => {
    const breakdown = requiredRecord(entry, resource, `${field}[${index}]`);
    if (breakdown.breakdowns !== undefined) {
      const children = requiredArray(
        breakdown.breakdowns,
        resource,
        `${field}[${index}].breakdowns`,
      );
      if (children.length) {
        validateBreakdowns(children, resource, `${field}[${index}].breakdowns`);
        return;
      }
    }
    requiredString(
      breakdown.breakdownType,
      resource,
      `${field}[${index}].breakdownType`,
    );
    requiredAmount(
      breakdown.breakdownAmount,
      resource,
      `${field}[${index}].breakdownAmount`,
    );
  });
}

function validateFinancesPage(
  page: JsonRecord,
  pageNumber: number,
): { transactions: JsonRecord[]; nextToken?: string } {
  const payload =
    page.payload === undefined
      ? page
      : requiredRecord(
          page.payload,
          "finances",
          `página ${pageNumber}.payload`,
        );
  const transactions = requiredArray(
    payload.transactions,
    "finances",
    `página ${pageNumber}.transactions`,
  ).map((value, transactionIndex) => {
    const transaction = requiredRecord(
      value,
      "finances",
      `transactions[${transactionIndex}]`,
    );
    requiredString(
      transaction.transactionId,
      "finances",
      `transactions[${transactionIndex}].transactionId`,
    );
    const transactionType = requiredString(
      transaction.transactionType,
      "finances",
      `transactions[${transactionIndex}].transactionType`,
    );
    requiredString(
      transaction.postedDate,
      "finances",
      `transactions[${transactionIndex}].postedDate`,
    );
    if (transaction.relatedIdentifiers !== undefined)
      validateIdentifierList(
        transaction.relatedIdentifiers,
        "finances",
        `transactions[${transactionIndex}].relatedIdentifiers`,
      );

    const description = stringValue(transaction.description);
    const discriminator = `${transactionType} ${description}`.toLowerCase();
    const isPayout =
      discriminator.includes("disbursement") ||
      discriminator.includes("transfer") ||
      discriminator.includes("payout");
    if (isPayout) {
      requiredAmount(
        transaction.totalAmount,
        "finances",
        `transactions[${transactionIndex}].totalAmount`,
      );
      return transaction;
    }

    const items =
      transaction.items === undefined
        ? undefined
        : validateIdentifierList(
            transaction.items,
            "finances",
            `transactions[${transactionIndex}].items`,
          );
    const topLevelBreakdowns = transaction.breakdowns;
    if (items === undefined && topLevelBreakdowns === undefined)
      throw new AmazonPayloadError(
        "finances",
        `transactions[${transactionIndex}].items`,
        "lista de itens ou breakdowns obrigatória ausente",
      );
    if (topLevelBreakdowns !== undefined)
      validateBreakdowns(
        topLevelBreakdowns,
        "finances",
        `transactions[${transactionIndex}].breakdowns`,
      );

    const isRefundOrAdjustment =
      discriminator.includes("refund") || discriminator.includes("adjust");
    if (items) {
      if (!items.length && isRefundOrAdjustment)
        requiredAmount(
          transaction.totalAmount,
          "finances",
          `transactions[${transactionIndex}].totalAmount`,
        );
      items.forEach((item, itemIndex) => {
        if (item.relatedIdentifiers !== undefined)
          validateIdentifierList(
            item.relatedIdentifiers,
            "finances",
            `transactions[${transactionIndex}].items[${itemIndex}].relatedIdentifiers`,
          );
        if (item.contexts !== undefined)
          validateIdentifierList(
            item.contexts,
            "finances",
            `transactions[${transactionIndex}].items[${itemIndex}].contexts`,
          );
        if (isRefundOrAdjustment) {
          requiredAmount(
            item.totalAmount,
            "finances",
            `transactions[${transactionIndex}].items[${itemIndex}].totalAmount`,
          );
        } else if (item.breakdowns === undefined) {
          throw new AmazonPayloadError(
            "finances",
            `transactions[${transactionIndex}].items[${itemIndex}].breakdowns`,
            "lista obrigatória ausente",
          );
        } else {
          validateBreakdowns(
            item.breakdowns,
            "finances",
            `transactions[${transactionIndex}].items[${itemIndex}].breakdowns`,
          );
        }
      });
    }
    if (
      (transactionType.toLowerCase().includes("order") ||
        discriminator.includes("refund")) &&
      !relatedIdentifier(transaction.relatedIdentifiers, false)
    ) {
      throw new AmazonPayloadError(
        "finances",
        `transactions[${transactionIndex}].relatedIdentifiers`,
        "identificador ORDER_ID obrigatório ausente",
      );
    }
    return transaction;
  });
  const nextToken = optionalString(
    payload.nextToken,
    "finances",
    `página ${pageNumber}.nextToken`,
  );
  return { transactions, nextToken };
}

function validateInventorySummary(
  summary: JsonRecord,
  summaryIndex: number,
): void {
  const field = `inventorySummaries[${summaryIndex}]`;
  const sku = aliasedValue(
    summary,
    ["sellerSku", "SellerSKU"],
    "inventory",
    `${field}.sellerSku`,
  );
  requiredString(sku, "inventory", `${field}.sellerSku`);
  requiredNumber(
    aliasedValue(
      summary,
      ["totalQuantity"],
      "inventory",
      `${field}.totalQuantity`,
    ),
    "inventory",
    `${field}.totalQuantity`,
  );
  const details = requiredRecord(
    aliasedValue(
      summary,
      ["inventoryDetails", "InventoryDetails"],
      "inventory",
      `${field}.inventoryDetails`,
    ),
    "inventory",
    `${field}.inventoryDetails`,
  );
  requiredNumber(
    summary.fulfillableQuantity ?? details.fulfillableQuantity,
    "inventory",
    `${field}.fulfillableQuantity`,
  );
  const reserved = requiredRecord(
    details.reservedQuantity,
    "inventory",
    `${field}.inventoryDetails.reservedQuantity`,
  );
  requiredNumber(
    reserved.totalReservedQuantity,
    "inventory",
    `${field}.inventoryDetails.reservedQuantity.totalReservedQuantity`,
  );
  for (const key of [
    "inboundWorkingQuantity",
    "inboundShippedQuantity",
    "inboundReceivingQuantity",
  ]) {
    requiredNumber(
      details[key],
      "inventory",
      `${field}.inventoryDetails.${key}`,
    );
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function amazonRequestDate(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetch(url, init);
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt < attempts - 1) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 400 * 2 ** attempt + Math.floor(Math.random() * 150),
      );
    }
  }
  return response as Response;
}

export class AmazonSpApiClient {
  private accessToken: {
    value: string;
    expiresAt: number;
  } | null = null;
  private accessTokenRefresh: Promise<string> | null = null;
  readonly marketplaceId: string;

  constructor() {
    const config = getAmazonConfig();
    if (config.missingSecrets.length)
      throw new AmazonConfigurationError(config.missingSecrets);
    this.marketplaceId = config.marketplaceId;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.accessToken &&
      this.accessToken.expiresAt > Date.now()
    ) {
      return this.accessToken.value;
    }
    if (this.accessTokenRefresh) return this.accessTokenRefresh;

    const refresh = this.fetchAccessToken();
    this.accessTokenRefresh = refresh;
    try {
      return await refresh;
    } finally {
      if (this.accessTokenRefresh === refresh) this.accessTokenRefresh = null;
    }
  }

  private async fetchAccessToken(): Promise<string> {
    const config = getAmazonConfig();
    const response = await fetchWithRetry(LWA_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    const data = record(await response.json().catch(() => ({})));
    if (!response.ok || !stringValue(data.access_token)) {
      throw new AmazonApiError(
        response.status === 429
          ? "A Amazon limitou temporariamente as requisições; tente novamente em instantes"
          : response.status === 400 || response.status === 401
            ? "Credenciais LWA inválidas ou autorização revogada"
            : "Não foi possível obter autorização da Amazon",
        response.status,
      );
    }
    const accessToken = stringValue(data.access_token);
    const expiresIn = Number(data.expires_in);
    this.accessToken = {
      value: accessToken,
      expiresAt:
        Number.isFinite(expiresIn) && expiresIn >= 0
          ? Date.now() + expiresIn * 1000
          : Number.POSITIVE_INFINITY,
    };
    return accessToken;
  }

  private async refreshAfterUnauthorized(failedToken: string): Promise<string> {
    if (this.accessToken?.value !== failedToken) return this.getAccessToken();
    this.accessToken = null;
    return this.getAccessToken(true);
  }

  private invalidateAccessToken(token: string): void {
    if (this.accessToken?.value === token) this.accessToken = null;
  }

  async request(
    path: string,
    query: Record<string, string | undefined> = {},
  ): Promise<JsonRecord> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, value);
    });
    let token = await this.getAccessToken();
    let response = await fetchWithRetry(
      `${SP_API_ENDPOINT}${path}${params.size ? `?${params}` : ""}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": SP_API_USER_AGENT,
          "x-amz-access-token": token,
          "x-amz-date": amazonRequestDate(),
        },
      },
    );
    if (response.status === 401) {
      token = await this.refreshAfterUnauthorized(token);
      response = await fetchWithRetry(
        `${SP_API_ENDPOINT}${path}${params.size ? `?${params}` : ""}`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": SP_API_USER_AGENT,
            "x-amz-access-token": token,
            "x-amz-date": amazonRequestDate(),
          },
        },
      );
      if (response.status === 401) this.invalidateAccessToken(token);
    }
    const data = record(await response.json().catch(() => ({})));
    if (!response.ok) {
      const errors = array(data.errors);
      const first = record(errors[0]);
      const code = stringValue(first.code);
      const normalizedCode = code.toLowerCase();
      const isSignatureError =
        normalizedCode.includes("signature") ||
        normalizedCode.includes("invalidaccesskey");
      const isAuthorizationError =
        response.status === 401 ||
        normalizedCode.includes("unauthorized") ||
        normalizedCode.includes("accessdenied") ||
        normalizedCode.includes("forbidden");
      throw new AmazonApiError(
        response.status === 429
          ? "A Amazon limitou temporariamente as requisições; tente novamente em instantes"
          : isSignatureError
            ? "A assinatura da requisição Amazon foi rejeitada; verifique a configuração da integração"
            : isAuthorizationError
            ? "Credenciais Amazon inválidas ou sem permissão para esta operação"
            : `A Amazon recusou a operação${code ? ` (${code})` : ""}`,
        response.status,
      );
    }
    return data;
  }

  async paginated(
    path: string,
    query: Record<string, string | undefined>,
    itemKeys: string[],
    tokenParam = "nextToken",
  ): Promise<JsonRecord[]> {
    const result: JsonRecord[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.request(path, {
        ...query,
        [tokenParam]: nextToken,
      });
      const payload =
        page.payload === undefined
          ? page
          : requiredRecord(page.payload, "inventory", "payload");
      const matchingKeys = itemKeys.filter((key) => payload[key] !== undefined);
      if (!matchingKeys.length)
        throw new AmazonPayloadError(
          "inventory",
          itemKeys.join(" ou "),
          "lista obrigatória ausente",
        );
      const items = matchingKeys
        .flatMap((key) => requiredArray(payload[key], "inventory", key))
        .map((item, index) =>
          requiredRecord(
            item,
            "inventory",
            `${matchingKeys.join("|")}[${index}]`,
          ),
        );
      result.push(...items);
      const pagination =
        payload.pagination === undefined
          ? undefined
          : requiredRecord(payload.pagination, "inventory", "pagination");
      nextToken =
        optionalString(payload.NextToken, "inventory", "NextToken") ??
        optionalString(payload.nextToken, "inventory", "nextToken") ??
        optionalString(
          pagination?.nextToken,
          "inventory",
          "pagination.nextToken",
        );
    } while (nextToken);
    return result;
  }
}

function inventoryPageSummaries(
  page: JsonRecord,
): JsonRecord[] {
  const payload =
    page.payload === undefined
      ? page
      : requiredRecord(page.payload, "inventory", "payload");
  const key = ["inventorySummaries", "InventorySummaries"].find(
    (candidate) => payload[candidate] !== undefined,
  );
  if (!key)
    throw new AmazonPayloadError(
      "inventory",
      "inventorySummaries ou InventorySummaries",
      "lista obrigatória ausente",
    );
  return requiredArray(payload[key], "inventory", key).map((item, index) =>
    requiredRecord(item, "inventory", `${key}[${index}]`),
  );
}

async function runSmokeCheck(
  type: AmazonSyncKind,
  run: () => Promise<number>,
): Promise<AmazonSmokeCheck> {
  const startedAt = Date.now();
  try {
    return {
      type,
      status: "completed",
      count: await run(),
      durationMs: Date.now() - startedAt,
      errorCategory: null,
      error: null,
    };
  } catch (error) {
    return {
      type,
      status: "failed",
      count: 0,
      durationMs: Date.now() - startedAt,
      errorCategory: classifyAmazonError(error),
      error: sanitizeAmazonError(error),
    };
  }
}

/**
 * Performs a read-only, bounded probe of each SP-API resource.
 *
 * This intentionally does not use the sync store: the connection test must
 * validate credentials, permissions, region and response envelopes without
 * importing or mutating any seller data.
 */
export async function smokeTestAmazon(
  client: AmazonSpApiClientLike,
  now = new Date(),
): Promise<AmazonSmokeCheck[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const checks: AmazonSmokeCheck[] = [];

  checks.push(
    await runSmokeCheck("orders", async () => {
      const page = await client.request("/orders/2026-01-01/orders", {
        marketplaceIds: client.marketplaceId,
        createdAfter: since,
        maxResultsPerPage: "1",
      });
      return validateOrdersPage(page, 1).orders.length;
    }),
  );

  checks.push(
    await runSmokeCheck("finances", async () => {
      const page = await client.request(
        "/finances/2024-06-19/transactions",
        {
          postedAfter: since,
          marketplaceId: client.marketplaceId,
        },
      );
      return validateFinancesPage(page, 1).transactions.length;
    }),
  );

  checks.push(
    await runSmokeCheck("inventory", async () => {
      const summaries = inventoryPageSummaries(
        await client.request("/fba/inventory/v1/summaries", {
          granularityType: "Marketplace",
          granularityId: client.marketplaceId,
          marketplaceIds: client.marketplaceId,
          details: "true",
        }),
      );
      summaries.forEach((summary, summaryIndex) =>
        validateInventorySummary(summary, summaryIndex),
      );
      return summaries.length;
    }),
  );

  return checks;
}

async function upsert(table: string, conflict: string, body: unknown) {
  return supabaseRequest<JsonRecord[]>(table, {
    method: "POST",
    query: { on_conflict: conflict },
    prefer: "resolution=merge-duplicates",
    returnRepresentation: true,
    body,
  });
}

export type AmazonSpApiClientLike = Pick<
  AmazonSpApiClient,
  "marketplaceId" | "request" | "paginated"
>;

export type InventorySyncInput = {
  ownerClerkId: string;
  marketplaceId: string;
  sku: string;
  asin: string | null;
  available: number;
  reserved: number;
  inbound: number;
  total: number;
  syncedAt: string;
  snapshotKey: string;
  movementKey: string;
};

export type AmazonSyncStore = {
  getProducts(ownerClerkId: string): Promise<JsonRecord[]>;
  saveSales(rows: JsonRecord[]): Promise<void>;
  saveFinancialEvents(rows: JsonRecord[]): Promise<void>;
  getFinancialEvents(
    ownerClerkId: string,
    marketplaceId: string,
    orderId: string,
  ): Promise<JsonRecord[]>;
  getSales(
    ownerClerkId: string,
    marketplaceId: string,
    orderId: string,
  ): Promise<JsonRecord[]>;
  updateSale(
    ownerClerkId: string,
    saleId: string,
    values: JsonRecord,
  ): Promise<void>;
  applyInventorySync(input: InventorySyncInput): Promise<void>;
};

const liveAmazonSyncStore: AmazonSyncStore = {
  async getProducts(ownerClerkId) {
    return supabaseRequest<JsonRecord[]>("products", {
      query: {
        select: "id,sku,asin,name,current_cost,available_stock",
        owner_clerk_id: `eq.${ownerClerkId}`,
      },
    });
  },
  async saveSales(rows) {
    if (rows.length)
      await upsert(
        "sales",
        "owner_clerk_id,marketplace_id,external_order_item_id",
        rows,
      );
  },
  async saveFinancialEvents(rows) {
    if (rows.length)
      await upsert(
        "amazon_financial_events",
        "owner_clerk_id,marketplace_id,external_event_id",
        rows,
      );
  },
  async getFinancialEvents(ownerClerkId, marketplaceId, orderId) {
    return supabaseRequest<JsonRecord[]>("amazon_financial_events", {
      query: {
        select: "event_type,amount,order_item_id,sku",
        owner_clerk_id: `eq.${ownerClerkId}`,
        marketplace_id: `eq.${marketplaceId}`,
        amazon_order_number: `eq.${orderId}`,
      },
    });
  },
  async getSales(ownerClerkId, marketplaceId, orderId) {
    return supabaseRequest<JsonRecord[]>("sales", {
      query: {
        select: "id,external_order_item_id,sku",
        owner_clerk_id: `eq.${ownerClerkId}`,
        marketplace_id: `eq.${marketplaceId}`,
        amazon_order_number: `eq.${orderId}`,
      },
    });
  },
  async updateSale(ownerClerkId, saleId, values) {
    await supabaseRequest("sales", {
      method: "PATCH",
      query: { id: `eq.${saleId}`, owner_clerk_id: `eq.${ownerClerkId}` },
      body: values,
    });
  },
  async applyInventorySync(input) {
    await supabaseRequest("rpc/apply_amazon_inventory_sync", {
      method: "POST",
      body: {
        p_owner_clerk_id: input.ownerClerkId,
        p_marketplace_id: input.marketplaceId,
        p_sku: input.sku,
        p_asin: input.asin,
        p_available: input.available,
        p_reserved: input.reserved,
        p_inbound: input.inbound,
        p_total: input.total,
        p_synced_at: input.syncedAt,
        p_snapshot_key: input.snapshotKey,
        p_movement_key: input.movementKey,
      },
    });
  },
};

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

export async function syncOrders(
  ownerClerkId: string,
  client: AmazonSpApiClientLike,
  since: string,
  store: AmazonSyncStore = liveAmazonSyncStore,
): Promise<number> {
  const orders: JsonRecord[] = [];
  let paginationToken: string | undefined;
  let pageNumber = 0;
  do {
    const page = await client.request("/orders/2026-01-01/orders", {
      marketplaceIds: client.marketplaceId,
      lastUpdatedAfter: since,
      includedData: "PROCEEDS,EXPENSE,FULFILLMENT",
      maxResultsPerPage: "100",
      paginationToken,
    });
    pageNumber += 1;
    const validatedPage = validateOrdersPage(page, pageNumber);
    orders.push(...validatedPage.orders);
    paginationToken = validatedPage.nextToken;
  } while (paginationToken);
  const products = new Map(
    (await store.getProducts(ownerClerkId)).map((product) => [
      stringValue(product.sku),
      product,
    ]),
  );
  const rows: JsonRecord[] = [];
  for (const order of orders) {
    const orderId = stringValue(order.orderId);
    if (!orderId) continue;
    const items = array(order.orderItems).map(record);
    for (const item of items) {
      const productData = record(item.product);
      const productPrice = record(productData.price);
      const unitPriceData = record(productPrice.unitPrice);
      const proceeds = record(item.proceeds);
      const proceedsTotal = record(proceeds.proceedsTotal);
      const sku = stringValue(productData.sellerSku);
      const product = products.get(sku);
      const quantity = Math.max(1, toNumber(item.quantityOrdered));
      const unitPrice = toNumber(unitPriceData.amount);
      const total = toNumber(proceedsTotal.amount) || unitPrice * quantity;
      const externalItemId =
        stringValue(item.orderItemId) || `${orderId}:${sku}`;
      rows.push({
        owner_clerk_id: ownerClerkId,
        product_id: product?.id ?? null,
        sold_at: stringValue(order.createdTime) || new Date().toISOString(),
        amazon_order_number: orderId,
        marketplace_id: client.marketplaceId,
        external_order_item_id: externalItemId,
        sku,
        asin: stringValue(productData.asin) || product?.asin || null,
        product_name:
          stringValue(productData.title) ||
          stringValue(product?.name) ||
          sku ||
          "Produto Amazon",
        quantity,
        unit_price: unitPrice || (quantity ? total / quantity : total),
        revenue_total: total,
        product_cost: toNumber(product?.current_cost) * quantity,
        updated_at: new Date().toISOString(),
      });
    }
  }
  const uniqueRows = dedupeBy(rows, (row) =>
    String(row.external_order_item_id),
  );
  await store.saveSales(uniqueRows);
  return uniqueRows.length;
}

type FinancialEvent = {
  externalId: string;
  orderId: string;
  orderItemId: string;
  sku: string;
  type:
    | "commission"
    | "fba"
    | "refund"
    | "adjustment"
    | "payout"
    | "tax"
    | "other_fee";
  amount: number;
  occurredAt: string;
  category: string;
};

function relatedIdentifier(value: unknown, item = false): string {
  const entries = array(value).map(record);
  const nameKey = item ? "itemRelatedIdentifierName" : "relatedIdentifierName";
  const valueKey = item
    ? "itemRelatedIdentifierValue"
    : "relatedIdentifierValue";
  return stringValue(
    entries.find((entry) =>
      stringValue(entry[nameKey])
        .toUpperCase()
        .includes(item ? "ITEM" : "ORDER_ID"),
    )?.[valueKey],
  );
}

function feeType(label: string): FinancialEvent["type"] | null {
  const value = label.toLowerCase();
  if (value.includes("commission")) return "commission";
  if (
    value.includes("fba") ||
    value.includes("fulfillment") ||
    value.includes("pick") ||
    value.includes("weight handling")
  )
    return "fba";
  if (value.includes("tax")) return "tax";
  if (value.includes("fee")) return "other_fee";
  return null;
}

function collectLeafFees(
  breakdowns: unknown,
  base: Omit<FinancialEvent, "externalId" | "type" | "amount" | "category">,
  transactionId: string,
  path = "breakdowns",
): FinancialEvent[] {
  return array(breakdowns)
    .map(record)
    .flatMap((breakdown, index) => {
      const children = array(breakdown.breakdowns);
      if (children.length)
        return collectLeafFees(
          children,
          base,
          transactionId,
          `${path}.${index}`,
        );
      const category = stringValue(breakdown.breakdownType);
      const type = feeType(category);
      const amount = amountValue(breakdown.breakdownAmount);
      if (!type) return [];
      return [
        {
          ...base,
          externalId: hash(`${transactionId}|${path}.${index}|${category}`),
          type,
          amount,
          category,
        },
      ];
    });
}

function mapTransaction(transaction: JsonRecord): FinancialEvent[] {
  const transactionId =
    stringValue(transaction.transactionId) || hash(JSON.stringify(transaction));
  const description = stringValue(transaction.description);
  const transactionType = stringValue(transaction.transactionType);
  const discriminator = `${transactionType} ${description}`.toLowerCase();
  const orderId = relatedIdentifier(transaction.relatedIdentifiers);
  const occurredAt =
    stringValue(transaction.postedDate) || new Date().toISOString();
  const totalAmount = amountValue(transaction.totalAmount);
  const base = { orderId, orderItemId: "", sku: "", occurredAt };
  const classifiedType = discriminator.includes("refund")
    ? "refund"
    : discriminator.includes("adjust")
      ? "adjustment"
      : null;
  if (classifiedType) {
    const classifiedItems = array(transaction.items)
      .map(record)
      .map((item, index) => {
        const productContext =
          array(item.contexts)
            .map(record)
            .find(
              (context) =>
                stringValue(context.contextType) === "ProductContext",
            ) ?? {};
        return {
          ...base,
          orderItemId: relatedIdentifier(item.relatedIdentifiers, true),
          sku: stringValue(productContext.sku),
          externalId: `${transactionId}:item:${index}`,
          type: classifiedType,
          amount: amountValue(item.totalAmount),
          category: description || transactionType,
        } satisfies FinancialEvent;
      });
    return classifiedItems.length
      ? classifiedItems
      : [
          {
            ...base,
            externalId: transactionId,
            type: classifiedType,
            amount: totalAmount,
            category: description || transactionType,
          },
        ];
  }
  if (
    discriminator.includes("disbursement") ||
    discriminator.includes("transfer") ||
    discriminator.includes("payout")
  ) {
    return [
      {
        ...base,
        externalId: transactionId,
        type: "payout",
        amount: totalAmount,
        category: description || transactionType,
      },
    ];
  }
  const items = array(transaction.items).map(record);
  const itemFees = items.flatMap((item, itemIndex) => {
    const productContext =
      array(item.contexts)
        .map(record)
        .find(
          (context) => stringValue(context.contextType) === "ProductContext",
        ) ?? {};
    const itemBase = {
      orderId,
      orderItemId: relatedIdentifier(item.relatedIdentifiers, true),
      sku: stringValue(productContext.sku),
      occurredAt,
    };
    return collectLeafFees(
      item.breakdowns,
      itemBase,
      transactionId,
      `items.${itemIndex}.breakdowns`,
    );
  });
  return itemFees.length
    ? itemFees
    : collectLeafFees(transaction.breakdowns, base, transactionId);
}

export async function syncFinances(
  ownerClerkId: string,
  client: AmazonSpApiClientLike,
  since: string,
  store: AmazonSyncStore = liveAmazonSyncStore,
): Promise<number> {
  const pages: JsonRecord[] = [];
  let nextToken: string | undefined;
  let pageNumber = 0;
  do {
    const page = await client.request("/finances/2024-06-19/transactions", {
      postedAfter: since,
      marketplaceId: client.marketplaceId,
      nextToken,
    });
    pageNumber += 1;
    const validatedPage = validateFinancesPage(page, pageNumber);
    pages.push(...validatedPage.transactions);
    nextToken = validatedPage.nextToken;
  } while (nextToken);
  const events = dedupeBy(
    pages.flatMap(mapTransaction),
    (event) => event.externalId,
  );
  if (events.length) {
    await store.saveFinancialEvents(
      events.map((event) => ({
        owner_clerk_id: ownerClerkId,
        marketplace_id: client.marketplaceId,
        external_event_id: event.externalId,
        amazon_order_number: event.orderId || null,
        order_item_id: event.orderItemId || null,
        sku: event.sku || null,
        event_type: event.type,
        amount: event.amount,
        currency: "BRL",
        occurred_at: event.occurredAt,
        raw_category: event.category,
        updated_at: new Date().toISOString(),
      })),
    );
  }

  const affectedOrders = [
    ...new Set(events.map((event) => event.orderId).filter(Boolean)),
  ];
  for (const orderId of affectedOrders) {
    const stored = await store.getFinancialEvents(
      ownerClerkId,
      client.marketplaceId,
      orderId,
    );
    const sales = await store.getSales(
      ownerClerkId,
      client.marketplaceId,
      orderId,
    );
    for (const [saleIndex, sale] of sales.entries()) {
      const specific = stored.filter((event) => {
        const eventItem = stringValue(event.order_item_id);
        const eventSku = stringValue(event.sku);
        return (
          (eventItem &&
            eventItem === stringValue(sale.external_order_item_id)) ||
          (eventSku && eventSku === stringValue(sale.sku))
        );
      });
      const orderWide = stored.filter(
        (event) => !event.order_item_id && !event.sku,
      );
      const sum = (type: FinancialEvent["type"], absolute = true) => {
        const normalize = (amount: unknown) =>
          absolute ? Math.abs(toNumber(amount)) : toNumber(amount);
        const direct = specific
          .filter((event) => event.event_type === type)
          .reduce((total, event) => total + normalize(event.amount), 0);
        const sharedTotal = orderWide
          .filter((event) => event.event_type === type)
          .reduce((total, event) => total + normalize(event.amount), 0);
        const shared = sharedMoneyAmount(
          sharedTotal,
          Math.max(1, sales.length),
          saleIndex,
        );
        return direct + shared;
      };
      await store.updateSale(ownerClerkId, String(sale.id), {
        amazon_commission: sum("commission"),
        fba_fee: sum("fba"),
        other_amazon_fees: sum("other_fee"),
        refunds: sum("refund", false),
        adjustments: sum("adjustment", false),
        payout: sum("payout", false),
        tax: sum("tax"),
        updated_at: new Date().toISOString(),
      });
    }
  }
  return events.length;
}

export async function syncInventory(
  ownerClerkId: string,
  client: AmazonSpApiClientLike,
  syncRunId: string,
  store: AmazonSyncStore = liveAmazonSyncStore,
): Promise<number> {
  const summaries = await client.paginated(
    "/fba/inventory/v1/summaries",
    {
      granularityType: "Marketplace",
      granularityId: client.marketplaceId,
      marketplaceIds: client.marketplaceId,
      details: "true",
    },
    ["inventorySummaries", "InventorySummaries"],
  );
  summaries.forEach((summary, summaryIndex) =>
    validateInventorySummary(summary, summaryIndex),
  );
  const syncedAt = new Date().toISOString();
  for (const summary of summaries) {
    const sku = stringValue(summary.sellerSku ?? summary.SellerSKU);
    if (!sku) continue;
    const details = record(
      summary.inventoryDetails ?? summary.InventoryDetails,
    );
    const available = toNumber(
      summary.fulfillableQuantity ?? details.fulfillableQuantity,
    );
    const reservedDetails = record(details.reservedQuantity);
    const inbound =
      toNumber(details.inboundWorkingQuantity) +
      toNumber(details.inboundShippedQuantity) +
      toNumber(details.inboundReceivingQuantity);
    const reserved = toNumber(
      reservedDetails.totalReservedQuantity ?? details.reservedQuantity,
    );
    const total =
      toNumber(summary.totalQuantity) || available + reserved + inbound;
    const snapshotKey = hash(`${syncRunId}|${client.marketplaceId}|${sku}`);
    await store.applyInventorySync({
      ownerClerkId,
      marketplaceId: client.marketplaceId,
      sku,
      asin: stringValue(summary.asin ?? summary.ASIN) || null,
      available,
      reserved,
      inbound,
      total,
      syncedAt,
      snapshotKey,
      movementKey: hash(
        `${syncRunId}|${client.marketplaceId}|${sku}|available`,
      ),
    });
  }
  return summaries.length;
}
