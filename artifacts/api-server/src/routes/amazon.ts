import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/express";
import {
  SyncAmazonBody,
  SyncAmazonTypeBody,
  SyncAmazonTypeParams,
  UpdateAmazonAlertSettingsBody,
  GetAmazonOwnerTransferResponse,
  ListAmazonOwnerTransferAuditResponse,
  TransferAmazonOwnerBody,
  TransferAmazonOwnerResponse,
} from "@workspace/api-zod";
import {
  AmazonConfigurationError,
  AmazonSpApiClient,
  classifyAmazonError,
  type AmazonFailureCategory,
  type AmazonSmokeCheck,
  type AmazonSyncKind,
  getAmazonConfig,
  sanitizeAmazonError,
  smokeTestAmazon,
  syncFinances,
  syncInventory,
  syncOrders,
} from "../lib/amazon-sp-api";
import {
  checkAmazonSyncSchema,
  supabaseRequest,
  toNumber,
  type AmazonSyncSchemaCheck,
} from "../lib/supabase";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/requireAuth";
import { createAmazonHistoryRouter } from "./amazon-history";
import { persistAmazonConnectionTest } from "./amazon-test-history";
import { pruneInactiveAmazonConnectionTestHistory } from "./amazon-retention";
import { logger } from "../lib/logger";
import {
  AMAZON_NOTIFICATION_CHANNELS,
  decryptNotificationDestination,
  encryptNotificationDestination,
  sendAmazonDegradationNotification,
  validateNotificationDestination,
  AmazonNotificationConfigurationError,
  type AmazonNotificationChannel,
} from "../lib/amazon-notifications";

const router: IRouter = Router();
router.use(requireAuth);

type JsonRecord = Record<string, unknown>;
type SyncStep = {
  type: AmazonSyncKind;
  status: "completed" | "failed" | "skipped";
  count: number;
  durationMs: number;
  errorCategory: AmazonFailureCategory | null;
  error: string | null;
};

const AMAZON_MODULES: AmazonSyncKind[] = ["orders", "finances", "inventory"];
const AMAZON_FAILURE_CATEGORIES: AmazonFailureCategory[] = [
  "authorization",
  "signature",
  "throttling",
  "configuration",
  "payload",
  "availability",
  "latency",
  "unknown",
];

const DEFAULT_AMAZON_ALERT_SETTINGS = {
  sampleWindow: 3,
  failureThreshold: 2,
  latencyThresholdMs: 5000,
  enabled: true,
};
const AMAZON_TEST_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SINGLE_TENANT_CONNECTION_ID = "00000000-0000-0000-0000-000000000001";
const AMAZON_OWNER_TRANSFER_AUDIT_LIMIT = 20;

type AmazonSyncRouterOptions = {
  requireAuth?: RequestHandler;
  getAuthenticatedUserId?: (req: Request) => string;
  checkAmazonSyncSchema?: () => Promise<AmazonSyncSchemaCheck>;
  assertAmazonOwner?: (ownerClerkId: string) => Promise<void>;
  isAmazonTransferAdmin?: (clerkId: string) => boolean;
  validateAmazonTransferTarget?: (clerkId: string) => Promise<boolean>;
  supabaseRequest?: AmazonConnectionRequest;
};

export class AmazonOwnershipError extends Error {
  constructor() {
    super("Esta conta Amazon já está vinculada a outro usuário");
  }
}

class AmazonSyncLockError extends Error {
  constructor() {
    super("A trava da sincronização Amazon foi perdida; a execução foi interrompida com segurança");
  }
}

class AmazonSchemaError extends Error {
  constructor(
    public readonly check: AmazonSyncSchemaCheck,
  ) {
    const migrations = [
      ...new Set([
        ...check.missingColumns.map((column) => column.migration),
        ...(check.missingTables.length || check.missingFunctions.length
          ? [
              "0001_amazon_profit_manager.sql",
              "0002_amazon_selling_partner.sql",
              "0003_amazon_sync_integrity.sql",
            ]
          : []),
      ]),
    ];
    super(
      check.unavailable
        ? "Não foi possível verificar o schema do Supabase remoto. Confirme que o projeto configurado está disponível e tente novamente; nenhuma chamada à Amazon foi iniciada."
        : `O schema do Supabase remoto está incompleto. Aplique as migrations ${migrations.join(", ")} no projeto configurado e tente novamente.${[
            check.missingTables.length
              ? ` Tabelas ausentes: ${check.missingTables.join(", ")}.`
              : "",
            check.missingFunctions.length
              ? ` Funções ausentes: ${check.missingFunctions.join(", ")}.`
              : "",
            check.missingColumns.length
              ? ` Colunas ausentes: ${check.missingColumns
                  .map(({ table, column, migration }) => `${table}.${column} (em ${migration})`)
                  .join(", ")}.`
              : "",
          ].join("")}`,
    );
  }
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asAmazonChecks(value: unknown): AmazonSmokeCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as JsonRecord;
    const type = String(row.type);
    const status = String(row.status);
    if (
      !AMAZON_MODULES.includes(type as AmazonSyncKind) ||
      (status !== "completed" && status !== "failed")
    ) {
      return [];
    }
    const category =
      row.errorCategory && AMAZON_FAILURE_CATEGORIES.includes(row.errorCategory as AmazonFailureCategory)
        ? (row.errorCategory as AmazonFailureCategory)
        : null;
    return [{
      type: type as AmazonSyncKind,
      status: status as AmazonSmokeCheck["status"],
      count: Math.max(0, Math.trunc(toNumber(row.count))),
      durationMs: Math.max(0, Math.trunc(toNumber(row.durationMs))),
      errorCategory: category,
      error: row.error ? String(row.error).slice(0, 300) : null,
    }];
  });
}

function failedChecks(message: string, errorCategory: AmazonFailureCategory): AmazonSmokeCheck[] {
  return AMAZON_MODULES.map((type) => ({
    type,
    status: "failed" as const,
    count: 0,
    durationMs: 0,
    errorCategory,
    error: message,
  }));
}

function asSyncSteps(value: unknown): SyncStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as JsonRecord;
    const type = String(row.type);
    const status = String(row.status);
    if (
      !AMAZON_MODULES.includes(type as AmazonSyncKind) ||
      !["completed", "failed", "skipped"].includes(status)
    ) {
      return [];
    }
    const category =
      row.errorCategory && AMAZON_FAILURE_CATEGORIES.includes(row.errorCategory as AmazonFailureCategory)
        ? (row.errorCategory as AmazonFailureCategory)
        : null;
    return [{
      type: type as AmazonSyncKind,
      status: status as SyncStep["status"],
      count: Math.max(0, Math.trunc(toNumber(row.count))),
      durationMs: Math.max(0, Math.trunc(toNumber(row.durationMs))),
      errorCategory: category,
      error: row.error ? String(row.error).slice(0, 300) : null,
    }];
  });
}

function failureMessage(check: AmazonSmokeCheck): string {
  const category = check.errorCategory ? ` [${check.errorCategory}]` : "";
  return `${check.error ?? "falha não identificada"}${category}`;
}

function amazonAlertSettingsResponse(row?: JsonRecord) {
  const notificationChannel = AMAZON_NOTIFICATION_CHANNELS.includes(
    String(row?.notification_channel) as AmazonNotificationChannel,
  )
    ? (String(row?.notification_channel) as AmazonNotificationChannel)
    : null;
  const notificationConfigured = Boolean(row?.notification_destination_encrypted);
  return {
    sampleWindow: Math.max(1, Math.trunc(toNumber(row?.sample_window ?? DEFAULT_AMAZON_ALERT_SETTINGS.sampleWindow))),
    failureThreshold: Math.max(1, Math.trunc(toNumber(row?.failure_threshold ?? DEFAULT_AMAZON_ALERT_SETTINGS.failureThreshold))),
    latencyThresholdMs: Math.max(100, Math.trunc(toNumber(row?.latency_threshold_ms ?? DEFAULT_AMAZON_ALERT_SETTINGS.latencyThresholdMs))),
    enabled: row?.enabled === undefined ? DEFAULT_AMAZON_ALERT_SETTINGS.enabled : Boolean(row.enabled),
    notificationChannel,
    notificationConfigured,
    notificationDestinationHint: notificationConfigured ? "Destino protegido" : null,
  };
}

async function getAmazonAlertSettingsRow(ownerClerkId: string) {
  const rows = await supabaseRequest<JsonRecord[]>("amazon_alert_settings", {
    query: {
      select: "sample_window,failure_threshold,latency_threshold_ms,enabled,notification_channel,notification_destination_encrypted",
      owner_clerk_id: `eq.${ownerClerkId}`,
      limit: 1,
    },
  });
  return rows[0];
}

async function getAmazonAlertSettings(ownerClerkId: string) {
  return amazonAlertSettingsResponse(await getAmazonAlertSettingsRow(ownerClerkId));
}

async function saveAmazonAlertSettings(ownerClerkId: string, values: {
  sampleWindow: number;
  failureThreshold: number;
  latencyThresholdMs: number;
  enabled: boolean;
  notificationChannel: AmazonNotificationChannel | null;
  notificationDestination?: string | null;
}) {
  const current = await getAmazonAlertSettingsRow(ownerClerkId);
  let encryptedDestination = current?.notification_destination_encrypted
    ? String(current.notification_destination_encrypted)
    : null;

  if (!values.notificationChannel) {
    encryptedDestination = null;
  } else if (values.notificationDestination?.trim()) {
    const destination = validateNotificationDestination(
      values.notificationChannel,
      values.notificationDestination,
    );
    encryptedDestination = encryptNotificationDestination(destination);
  } else if (
    !encryptedDestination ||
    String(current?.notification_channel ?? "") !== values.notificationChannel
  ) {
    throw new AmazonNotificationConfigurationError(
      "Informe o novo destino ao trocar o canal de notificação",
    );
  }

  const rows = await supabaseRequest<JsonRecord[]>("amazon_alert_settings", {
    method: "POST",
    query: { on_conflict: "owner_clerk_id" },
    prefer: "resolution=merge-duplicates",
    returnRepresentation: true,
    body: {
      owner_clerk_id: ownerClerkId,
      sample_window: values.sampleWindow,
      failure_threshold: values.failureThreshold,
      latency_threshold_ms: values.latencyThresholdMs,
      enabled: values.enabled,
      notification_channel: values.notificationChannel,
      notification_destination_encrypted: encryptedDestination,
      updated_at: new Date().toISOString(),
    },
  });
  return amazonAlertSettingsResponse(rows[0]);
}

function amazonModuleLabel(type: AmazonSyncKind): string {
  return type === "orders" ? "Pedidos" : type === "finances" ? "Finanças" : "Estoque";
}

function amazonAlertCategoryLabel(category: AmazonFailureCategory): string {
  return category === "authorization"
    ? "autorização"
    : category === "signature"
      ? "assinatura"
      : category === "throttling"
        ? "throttling"
        : category === "configuration"
          ? "configuração"
          : category === "payload"
            ? "payload"
            : category === "availability"
              ? "disponibilidade"
              : category === "latency"
                ? "latência"
                : "não classificado";
}

async function evaluateAmazonModuleAlerts(ownerClerkId: string) {
  const settingsRow = await getAmazonAlertSettingsRow(ownerClerkId);
  const settings = {
    ...amazonAlertSettingsResponse(settingsRow),
    notificationDestinationEncrypted: settingsRow?.notification_destination_encrypted
      ? String(settingsRow.notification_destination_encrypted)
      : null,
  };
  const tests = await supabaseRequest<JsonRecord[]>("amazon_connection_tests", {
    query: {
      select: "tested_at,checks",
      owner_clerk_id: `eq.${ownerClerkId}`,
      order: "tested_at.desc",
      limit: settings.sampleWindow,
    },
  });
  const evaluatedAt = new Date().toISOString();

  for (const type of AMAZON_MODULES) {
    const samples = tests.flatMap((test) => {
      const check = asAmazonChecks(test.checks).find((item) => item.type === type);
      return check ? [check] : [];
    });
    const degradedSamples = samples.filter((sample) =>
      sample.status === "failed" || sample.durationMs >= settings.latencyThresholdMs,
    );
    const isDegraded = settings.enabled &&
      samples.length >= settings.sampleWindow &&
      degradedSamples.length >= settings.failureThreshold;
    const categoryCandidates = degradedSamples.map((sample) =>
      sample.status === "failed" ? (sample.errorCategory ?? "unknown") : "latency",
    );
    const categoryCounts = new Map<AmazonFailureCategory, number>();
    for (const category of categoryCandidates) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    const category = categoryCandidates.reduce<AmazonFailureCategory | null>((selected, candidate) => {
      if (!selected || (categoryCounts.get(candidate) ?? 0) > (categoryCounts.get(selected) ?? 0)) {
        return candidate;
      }
      return selected;
    }, null);
    const observedLatencyMs = degradedSamples.reduce(
      (maximum, sample) => Math.max(maximum, sample.durationMs),
      0,
    );
    const shouldAlert = await supabaseRequest<boolean>("rpc/claim_amazon_module_alert", {
      method: "POST",
      body: {
        p_owner_clerk_id: ownerClerkId,
        p_module: type,
        p_is_degraded: isDegraded,
        p_failure_category: isDegraded ? category : null,
        p_observed_latency_ms: observedLatencyMs,
        p_degraded_samples: degradedSamples.length,
        p_sample_window: settings.sampleWindow,
        p_evaluated_at: evaluatedAt,
      },
    });

    if (shouldAlert && category) {
      await supabaseRequest("alerts", {
        method: "POST",
        returnRepresentation: true,
        body: {
          owner_clerk_id: ownerClerkId,
          severity: "danger",
          title: `Amazon · ${amazonModuleLabel(type)} degradado`,
          message: `${amazonModuleLabel(type)} apresentou ${degradedSamples.length} de ${samples.length} amostras degradadas. Categoria: ${amazonAlertCategoryLabel(category)}. Latência observada: ${observedLatencyMs} ms. Execute um novo teste e verifique a configuração da integração.`,
        },
      });
      if (settings.notificationChannel && settings.notificationDestinationEncrypted) {
        try {
          await sendAmazonDegradationNotification({
            channel: settings.notificationChannel,
            destination: decryptNotificationDestination(settings.notificationDestinationEncrypted),
            module: amazonModuleLabel(type),
            category: amazonAlertCategoryLabel(category),
            degradedSamples: degradedSamples.length,
            sampleWindow: samples.length,
            observedLatencyMs,
          });
        } catch (error) {
          logger.warn(
            { err: sanitizeAmazonError(error), channel: settings.notificationChannel },
            "Failed to send Amazon degradation notification",
          );
        }
      }
    }
  }
}

export async function saveConnectionTest(
  ownerClerkId: string,
  testedAt: string,
  durationMs: number,
  checks: AmazonSmokeCheck[],
  request: typeof supabaseRequest = supabaseRequest,
  evaluateAlerts: (owner: string) => Promise<void> = evaluateAmazonModuleAlerts,
) {
  await persistAmazonConnectionTest(
    ownerClerkId,
    testedAt,
    durationMs,
    checks,
    request,
    (error) => {
      logger.warn(
        { err: sanitizeAmazonError(error) },
        "Failed to prune Amazon connection test history",
      );
    },
  );
  try {
    await evaluateAlerts(ownerClerkId);
  } catch (error) {
    logger.error({ err: sanitizeAmazonError(error) }, "Failed to evaluate Amazon module alerts");
  }
}

export function startAmazonConnectionTestRetentionMaintenance(): () => void {
  const runMaintenance = (): void => {
    void pruneInactiveAmazonConnectionTestHistory(supabaseRequest, {
      warn: (context, message) =>
        logger.warn(
          { ...context, ...(context.err ? { err: sanitizeAmazonError(context.err) } : {}) },
          message,
        ),
      info: (context, message) => logger.info(context, message),
    });
  };

  runMaintenance();
  const timer = setInterval(runMaintenance, AMAZON_TEST_RETENTION_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

type AmazonConnectionRequest = typeof supabaseRequest;

function isConflictError(error: unknown): boolean {
  return error instanceof Error && /\b409\b/.test(error.message);
}

async function getRegisteredAmazonOwner(
  request: AmazonConnectionRequest = supabaseRequest,
): Promise<string | null> {
  const rows = await request<JsonRecord[]>("amazon_connections", {
    query: {
      select: "owner_clerk_id",
      order: "created_at.asc,id.asc",
      limit: 1,
    },
  });
  const owner = rows[0]?.owner_clerk_id;
  return typeof owner === "string" && owner.trim() ? owner : null;
}

function isConfiguredAmazonTransferAdmin(clerkId: string): boolean {
  const configured = (
    process.env.AMAZON_TRANSFER_ADMIN_CLERK_IDS ??
    process.env.AMAZON_ADMIN_CLERK_IDS ??
    process.env.ADMIN_CLERK_USER_IDS ??
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(clerkId);
}

async function isExistingClerkUser(clerkId: string): Promise<boolean> {
  try {
    await clerkClient.users.getUser(clerkId);
    return true;
  } catch (error) {
    logger.warn({ err: sanitizeAmazonError(error) }, "Amazon owner transfer target is not a Clerk user");
    return false;
  }
}

type AmazonOwnerTransferValues = {
  actorClerkId: string;
  currentOwnerClerkId: string;
  newOwnerClerkId: string;
  reason: string;
};

export type AmazonOwnerTransferResult = {
  id: string;
  actorClerkId: string;
  previousOwnerClerkId: string;
  newOwnerClerkId: string;
  reason: string;
  transferredAt: string;
};

export type AmazonOwnerTransferAuditResult = AmazonOwnerTransferResult;

function amazonOwnerTransferAuditResponse(row: JsonRecord): AmazonOwnerTransferAuditResult {
  return {
    id: String(row.id),
    actorClerkId: String(row.actor_clerk_id),
    previousOwnerClerkId: String(row.previous_owner_clerk_id),
    newOwnerClerkId: String(row.new_owner_clerk_id),
    reason: String(row.reason),
    transferredAt: String(row.transferred_at),
  };
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function amazonOwnerTransferAuditCsv(
  audit: AmazonOwnerTransferAuditResult[],
  generatedAt: string,
): string {
  const lines = [
    ["Relatório", "Histórico de transferências Amazon"],
    ["Data de geração (UTC)", generatedAt],
    [],
    [
      "id",
      "actorClerkId",
      "previousOwnerClerkId",
      "newOwnerClerkId",
      "reason",
      "transferredAt",
    ],
    ...audit.map((event) => [
      event.id,
      event.actorClerkId,
      event.previousOwnerClerkId,
      event.newOwnerClerkId,
      event.reason,
      event.transferredAt,
    ]),
  ];

  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export async function listAmazonOwnerTransferAudit(
  request: AmazonConnectionRequest = supabaseRequest,
): Promise<AmazonOwnerTransferAuditResult[]> {
  const rows = await request<JsonRecord[]>("amazon_owner_transfer_audit", {
    query: {
      select: "id,actor_clerk_id,previous_owner_clerk_id,new_owner_clerk_id,reason,transferred_at",
      order: "transferred_at.desc,id.desc",
      limit: AMAZON_OWNER_TRANSFER_AUDIT_LIMIT,
    },
  });
  return rows.map(amazonOwnerTransferAuditResponse);
}

function isOwnerTransferConflict(error: unknown): boolean {
  return error instanceof Error &&
    /Amazon owner|Amazon synchronization|owner already has|registered owner/i.test(error.message);
}

export async function transferAmazonOwner(
  values: AmazonOwnerTransferValues,
  request: AmazonConnectionRequest = supabaseRequest,
): Promise<AmazonOwnerTransferResult> {
  const rows = await request<JsonRecord[]>("rpc/transfer_amazon_owner", {
    method: "POST",
    body: {
      p_actor_clerk_id: values.actorClerkId,
      p_current_owner_clerk_id: values.currentOwnerClerkId,
      p_new_owner_clerk_id: values.newOwnerClerkId,
      p_reason: values.reason,
    },
  });
  const row = rows[0];
  if (!row) throw new Error("A transferência não retornou um registro de auditoria");
  return {
    id: String(row.id),
    actorClerkId: String(row.actor_clerk_id),
    previousOwnerClerkId: String(row.previous_owner_clerk_id),
    newOwnerClerkId: String(row.new_owner_clerk_id),
    reason: String(row.reason),
    transferredAt: String(row.transferred_at),
  };
}

export function registerAmazonOwnerTransferRoutes(
  target: IRouter,
  options: Pick<
    AmazonSyncRouterOptions,
    | "getAuthenticatedUserId"
    | "isAmazonTransferAdmin"
    | "validateAmazonTransferTarget"
    | "supabaseRequest"
  > = {},
): void {
  const getOwner = options.getAuthenticatedUserId ?? getAuthenticatedUserId;
  const isAdmin = options.isAmazonTransferAdmin ?? isConfiguredAmazonTransferAdmin;
  const validateTarget = options.validateAmazonTransferTarget ?? isExistingClerkUser;
  const request = options.supabaseRequest ?? supabaseRequest;

  target.get("/amazon/owner-transfer", async (req, res): Promise<void> => {
    const actorClerkId = getOwner(req);
    if (!isAdmin(actorClerkId)) {
      res.status(403).json({ error: "Ação administrativa não autorizada" });
      return;
    }

    try {
      const response = {
        isAdmin: true,
        currentOwnerClerkId: await getRegisteredAmazonOwner(request),
      };
      res.json(GetAmazonOwnerTransferResponse.parse(response));
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to read Amazon owner transfer access");
      res.status(503).json({
        error: "Não foi possível verificar o proprietário Amazon para esta ação administrativa",
      });
    }
  });

  target.get("/amazon/owner-transfer/audit", async (req, res): Promise<void> => {
    const actorClerkId = getOwner(req);
    if (!isAdmin(actorClerkId)) {
      res.status(403).json({ error: "Ação administrativa não autorizada" });
      return;
    }

    try {
      const audit = await listAmazonOwnerTransferAudit(request);
      res.json(ListAmazonOwnerTransferAuditResponse.parse(audit));
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to read Amazon owner transfer audit");
      res.status(503).json({
        error: "Não foi possível carregar o histórico de transferências Amazon",
      });
    }
  });

  target.get("/amazon/owner-transfer/audit/export", async (req, res): Promise<void> => {
    const actorClerkId = getOwner(req);
    if (!isAdmin(actorClerkId)) {
      res.status(403).json({ error: "Ação administrativa não autorizada" });
      return;
    }

    try {
      const generatedAt = new Date().toISOString();
      const audit = await listAmazonOwnerTransferAudit(request);
      const filenameDate = generatedAt.slice(0, 10);
      res
        .status(200)
        .set({
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="amazon-owner-transfer-audit-${filenameDate}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
          "X-Generated-At": generatedAt,
        })
        .send(amazonOwnerTransferAuditCsv(audit, generatedAt));
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to export Amazon owner transfer audit");
      res.status(503).json({
        error: "Não foi possível exportar o histórico de transferências Amazon",
      });
    }
  });

  target.post("/amazon/owner-transfer", async (req, res): Promise<void> => {
    const actorClerkId = getOwner(req);
    if (!isAdmin(actorClerkId)) {
      res.status(403).json({ error: "Ação administrativa não autorizada" });
      return;
    }

    const parsed = TransferAmazonOwnerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const values = {
      actorClerkId,
      currentOwnerClerkId: parsed.data.currentOwnerClerkId.trim(),
      newOwnerClerkId: parsed.data.newOwnerClerkId.trim(),
      reason: parsed.data.reason.trim(),
    };
    if (values.currentOwnerClerkId === values.newOwnerClerkId) {
      res.status(400).json({ error: "O novo proprietário deve ser diferente do proprietário atual" });
      return;
    }

    try {
      const registeredOwner = await getRegisteredAmazonOwner(request);
      if (!registeredOwner) {
        res.status(409).json({ error: "Não existe um proprietário Amazon registrado para transferir" });
        return;
      }
      if (registeredOwner !== values.currentOwnerClerkId) {
        res.status(409).json({ error: "O proprietário atual informado não corresponde ao registro Amazon" });
        return;
      }
      if (!(await validateTarget(values.newOwnerClerkId))) {
        res.status(400).json({ error: "O novo proprietário não corresponde a um usuário Clerk válido" });
        return;
      }

      const result = await transferAmazonOwner(values, request);
      res.json(TransferAmazonOwnerResponse.parse(result));
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to transfer Amazon owner");
      if (isOwnerTransferConflict(error)) {
        res.status(409).json({ error: sanitizeAmazonError(error) });
        return;
      }
      res.status(503).json({
        error: "Não foi possível concluir a transferência administrativa do proprietário Amazon",
      });
    }
  });
}

export async function ensureAmazonOwner(
  ownerClerkId: string,
  request: AmazonConnectionRequest = supabaseRequest,
): Promise<void> {
  const currentOwner = await getRegisteredAmazonOwner(request);
  if (currentOwner) {
    if (currentOwner !== ownerClerkId) throw new AmazonOwnershipError();
    return;
  }

  const config = getAmazonConfig();
  try {
    await request("amazon_connections", {
      method: "POST",
      query: { on_conflict: "id" },
      prefer: "resolution=ignore-duplicates",
      returnRepresentation: true,
      body: {
        id: SINGLE_TENANT_CONNECTION_ID,
        owner_clerk_id: ownerClerkId,
        marketplace_id: config.marketplaceId,
        marketplace_name: "Amazon.com.br",
        connection_status: "not_configured",
      },
    });
  } catch (error) {
    if (!isConflictError(error)) throw error;
  }

  const claimedOwner = await getRegisteredAmazonOwner(request);
  if (claimedOwner !== ownerClerkId) throw new AmazonOwnershipError();
}

async function upsertConnection(ownerClerkId: string, values: JsonRecord) {
  await ensureAmazonOwner(ownerClerkId);
  const config = getAmazonConfig();
  const rows = await supabaseRequest<JsonRecord[]>("amazon_connections", {
    method: "POST",
    query: { on_conflict: "owner_clerk_id" },
    prefer: "resolution=merge-duplicates",
    returnRepresentation: true,
    body: {
      owner_clerk_id: ownerClerkId,
      marketplace_id: config.marketplaceId,
      marketplace_name: "Amazon.com.br",
      updated_at: new Date().toISOString(),
      ...values,
    },
  });
  return rows[0];
}

async function getConnection(ownerClerkId: string) {
  const rows = await supabaseRequest<JsonRecord[]>("amazon_connections", {
    query: { select: "*", owner_clerk_id: `eq.${ownerClerkId}`, limit: 1 },
  });
  return rows[0];
}

async function assertAmazonOwner(ownerClerkId: string) {
  await ensureAmazonOwner(ownerClerkId);
}

router.get("/amazon/status", async (req, res): Promise<void> => {
  try {
    const ownerClerkId = getAuthenticatedUserId(req);
    const config = getAmazonConfig();
    const registeredOwner = await getRegisteredAmazonOwner();
    if (registeredOwner && registeredOwner !== ownerClerkId) {
      res.status(403).json({ error: "Esta conta Amazon já está vinculada a outro usuário" });
      return;
    }
    if (config.missingSecrets.length) {
      res.json({
        configured: false,
        marketplaceId: config.marketplaceId,
        marketplaceName: "Amazon.com.br",
        connectionStatus: "not_configured",
        lastTestAt: null,
        lastSyncAt: null,
        lastError: null,
        missingSecrets: config.missingSecrets,
      });
      return;
    }
    await ensureAmazonOwner(ownerClerkId);
    const connection = await getConnection(ownerClerkId);
    res.json({
      configured: config.missingSecrets.length === 0,
      marketplaceId: config.marketplaceId,
      marketplaceName: "Amazon.com.br",
      connectionStatus: config.missingSecrets.length
        ? "not_configured"
        : String(connection?.connection_status ?? "not_configured"),
      lastTestAt: iso(connection?.last_test_at),
      lastSyncAt: iso(connection?.last_sync_at),
      lastError: connection?.last_error ? String(connection.last_error) : null,
      missingSecrets: config.missingSecrets,
    });
  } catch (error) {
    req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to read Amazon status");
    res.status(error instanceof AmazonOwnershipError ? 403 : 500).json({
      error: error instanceof AmazonOwnershipError
        ? error.message
        : "Não foi possível carregar o estado da Amazon",
    });
  }
});

router.post("/amazon/test", async (req, res): Promise<void> => {
  const ownerClerkId = getAuthenticatedUserId(req);
  const startedAt = Date.now();
  let checks: AmazonSmokeCheck[] = [];
  try {
    await assertAmazonOwner(ownerClerkId);
    const client = new AmazonSpApiClient();
    checks = await smokeTestAmazon(client);
    const failures = checks.filter((check) => check.status === "failed");
    const message = checks
      .map((check) => {
        const label =
          check.type === "orders"
            ? "Pedidos"
            : check.type === "finances"
              ? "Finanças"
              : "Estoque FBA";
        return check.status === "completed"
          ? `${label}: leitura concluída (${check.count} registro${check.count === 1 ? "" : "s"})`
          : `${label}: ${failureMessage(check)}`;
      })
      .join("; ");
    const success = failures.length === 0;
    const testedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    await saveConnectionTest(ownerClerkId, testedAt, durationMs, checks);
    await upsertConnection(ownerClerkId, {
      connection_status: success ? "connected" : "invalid",
      last_test_at: testedAt,
      last_error: success ? null : message,
    });
    res.json({
      success,
      message: success
        ? `Conexão Amazon validada com sucesso. ${message}`
        : `Smoke test Amazon não concluído. ${message}`,
      testedAt,
      durationMs,
      checks,
    });
  } catch (error) {
    if (error instanceof AmazonOwnershipError) {
      res.status(403).json({ error: error.message });
      return;
    }
    const message = sanitizeAmazonError(error);
    checks = checks.length ? checks : failedChecks(message, classifyAmazonError(error));
    const testedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    await saveConnectionTest(ownerClerkId, testedAt, durationMs, checks).catch((saveError) => {
      req.log?.error({ err: sanitizeAmazonError(saveError) }, "Failed to save Amazon connection test");
    });
    await upsertConnection(ownerClerkId, {
      connection_status: error instanceof AmazonConfigurationError ? "not_configured" : "invalid",
      last_test_at: testedAt,
      last_error: message,
    }).catch(() => undefined);
    res.json({
      success: false,
      message,
      testedAt,
      durationMs,
      checks,
    });
  }
});

router.get("/amazon/alert-settings", async (req, res): Promise<void> => {
  try {
    res.json(await getAmazonAlertSettings(getAuthenticatedUserId(req)));
  } catch (error) {
    req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to read Amazon alert settings");
    res.status(500).json({ error: "Não foi possível carregar as configurações de alertas Amazon" });
  }
});

router.patch("/amazon/alert-settings", async (req, res): Promise<void> => {
  try {
    const values = UpdateAmazonAlertSettingsBody.parse(req.body ?? {});
    if (values.failureThreshold > values.sampleWindow) {
      res.status(400).json({ error: "O limiar de falhas não pode ser maior que a janela de amostras" });
      return;
    }
    const ownerClerkId = getAuthenticatedUserId(req);
    const settings = await saveAmazonAlertSettings(ownerClerkId, values);
    try {
      await evaluateAmazonModuleAlerts(ownerClerkId);
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to re-evaluate Amazon module alerts");
    }
    res.json(settings);
  } catch (error) {
    req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to update Amazon alert settings");
    res.status(error instanceof AmazonNotificationConfigurationError ? 400 : 500).json({
      error: error instanceof AmazonNotificationConfigurationError
        ? error.message
        : "Não foi possível atualizar as configurações de alertas Amazon",
    });
  }
});

router.get("/amazon/module-alerts", async (req, res): Promise<void> => {
  try {
    const ownerClerkId = getAuthenticatedUserId(req);
    const rows = await supabaseRequest<JsonRecord[]>("amazon_module_alert_states", {
      query: {
        select: "module,failure_category,observed_latency_ms,degraded_samples,sample_window,evaluated_at,last_alert_at",
        owner_clerk_id: `eq.${ownerClerkId}`,
        is_degraded: "eq.true",
        order: "evaluated_at.desc",
      },
    });
    res.json(rows.flatMap((row) => {
      const module = String(row.module);
      const failureCategory = String(row.failure_category ?? "");
      if (
        !AMAZON_MODULES.includes(module as AmazonSyncKind) ||
        !AMAZON_FAILURE_CATEGORIES.includes(failureCategory as AmazonFailureCategory)
      ) {
        return [];
      }
      return [{
        module: module as AmazonSyncKind,
        failureCategory: failureCategory as AmazonFailureCategory,
        observedLatencyMs: Math.max(0, Math.trunc(toNumber(row.observed_latency_ms))),
        degradedSamples: Math.max(0, Math.trunc(toNumber(row.degraded_samples))),
        sampleWindow: Math.max(1, Math.trunc(toNumber(row.sample_window))),
        evaluatedAt: String(row.evaluated_at),
        lastAlertAt: iso(row.last_alert_at),
      }];
    }));
  } catch (error) {
    req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to list Amazon module alerts");
    res.status(500).json({ error: "Não foi possível carregar os alertas dos módulos Amazon" });
  }
});

async function cursorSince(ownerClerkId: string, type: AmazonSyncKind, requested: Date | null | undefined) {
  if (requested) return requested.toISOString();
  const rows = await supabaseRequest<JsonRecord[]>("amazon_sync_cursors", {
    query: {
      select: "last_synced_at",
      owner_clerk_id: `eq.${ownerClerkId}`,
      sync_type: `eq.${type}`,
      limit: 1,
    },
  });
  const previous = iso(rows[0]?.last_synced_at);
  if (!previous) return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const overlapMs = type === "finances" ? 72 * 60 * 60 * 1000 : 15 * 60 * 1000;
  return new Date(new Date(previous).getTime() - overlapMs).toISOString();
}

async function saveCursor(ownerClerkId: string, type: AmazonSyncKind, syncedAt: string) {
  await supabaseRequest("amazon_sync_cursors", {
    method: "POST",
    query: { on_conflict: "owner_clerk_id,sync_type" },
    prefer: "resolution=merge-duplicates",
    body: {
      owner_clerk_id: ownerClerkId,
      sync_type: type,
      cursor_value: syncedAt,
      last_synced_at: syncedAt,
      updated_at: syncedAt,
    },
  });
}

async function runSyncUnlocked(
  ownerClerkId: string,
  syncType: "full" | AmazonSyncKind,
  requestedSince?: Date | null,
  ensureLease: () => void = () => undefined,
) {
  const startedAt = new Date();
  await assertAmazonOwner(ownerClerkId);
  const created = await supabaseRequest<JsonRecord[]>("amazon_sync_runs", {
    method: "POST",
    returnRepresentation: true,
    body: { owner_clerk_id: ownerClerkId, sync_type: syncType, status: "processing" },
  });
  const runId = String(created[0]?.id ?? "");
  const kinds: AmazonSyncKind[] = syncType === "full"
    ? ["orders", "finances", "inventory"]
    : [syncType];
  const steps: SyncStep[] = [];
  let client: AmazonSpApiClient;
  try {
    client = new AmazonSpApiClient();
  } catch (error) {
    const message = sanitizeAmazonError(error);
    for (const type of kinds) {
      steps.push({
        type,
        status: "skipped",
        count: 0,
        durationMs: 0,
        errorCategory: "configuration",
        error: message,
      });
    }
    const completedAt = new Date();
    const response = {
      runId,
      syncType,
      status: "skipped" as const,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      steps,
      totals: { orders: 0, finances: 0, inventory: 0 },
      error: message,
    };
    await finishRun(ownerClerkId, response);
    return response;
  }

  for (const type of kinds) {
    const stepStarted = Date.now();
    try {
      ensureLease();
      const since = await cursorSince(ownerClerkId, type, requestedSince);
      const count = type === "orders"
        ? await syncOrders(ownerClerkId, client, since)
        : type === "finances"
          ? await syncFinances(ownerClerkId, client, since)
          : await syncInventory(ownerClerkId, client, runId);
      const syncedAt = new Date().toISOString();
      ensureLease();
      await saveCursor(ownerClerkId, type, syncedAt);
      steps.push({
        type,
        status: "completed",
        count,
        durationMs: Date.now() - stepStarted,
        errorCategory: null,
        error: null,
      });
    } catch (error) {
      steps.push({
        type,
        status: "failed",
        count: 0,
        durationMs: Date.now() - stepStarted,
        errorCategory: classifyAmazonError(error),
        error: sanitizeAmazonError(error),
      });
      if (error instanceof AmazonSyncLockError) break;
    }
  }
  for (const type of kinds.slice(steps.length)) {
    steps.push({
      type,
      status: "skipped",
      count: 0,
      durationMs: 0,
      errorCategory: "availability",
      error: "Sincronização interrompida após perda da trava",
    });
  }

  const completedAt = new Date();
  const failed = steps.filter((step) => step.status === "failed");
  const status = failed.length === 0 ? "completed" : failed.length === steps.length ? "failed" : "partial";
  const response = {
    runId,
    syncType,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    steps,
    totals: {
      orders: steps.find((step) => step.type === "orders")?.count ?? 0,
      finances: steps.find((step) => step.type === "finances")?.count ?? 0,
      inventory: steps.find((step) => step.type === "inventory")?.count ?? 0,
    },
    error: failed.map((step) => `${step.type}: ${step.error}`).join("; ") || null,
  };
  await finishRun(ownerClerkId, response);
  return response;
}

async function runSync(
  ownerClerkId: string,
  syncType: "full" | AmazonSyncKind,
  requestedSince?: Date | null,
  checkSchema: () => Promise<AmazonSyncSchemaCheck> = checkAmazonSyncSchema,
  assertOwner: (ownerClerkId: string) => Promise<void> = assertAmazonOwner,
) {
  await assertOwner(ownerClerkId);
  const schemaCheck = await checkSchema();
  if (!schemaCheck.complete) throw new AmazonSchemaError(schemaCheck);
  const lockToken = randomUUID();
  const lockTtlSeconds = 120;
  const acquired = await supabaseRequest<boolean>("rpc/acquire_amazon_sync_lock", {
    method: "POST",
    body: { p_owner_clerk_id: ownerClerkId, p_lock_token: lockToken, p_ttl_seconds: lockTtlSeconds },
  });
  if (!acquired) throw new Error("Já existe uma sincronização Amazon em andamento");
  let leaseValid = true;
  let leaseExpiresAt = Date.now() + lockTtlSeconds * 1000;
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing || !leaseValid) return;
    renewing = true;
    try {
      leaseValid = await supabaseRequest<boolean>("rpc/renew_amazon_sync_lock", {
        method: "POST",
        body: {
          p_owner_clerk_id: ownerClerkId,
          p_lock_token: lockToken,
          p_ttl_seconds: lockTtlSeconds,
        },
      });
      if (leaseValid) leaseExpiresAt = Date.now() + lockTtlSeconds * 1000;
    } catch {
      leaseValid = false;
    } finally {
      renewing = false;
    }
  }, 30_000);
  heartbeat.unref();
  try {
    return await runSyncUnlocked(ownerClerkId, syncType, requestedSince, () => {
      if (!leaseValid || Date.now() >= leaseExpiresAt) throw new AmazonSyncLockError();
    });
  } finally {
    clearInterval(heartbeat);
    await supabaseRequest("rpc/release_amazon_sync_lock", {
      method: "POST",
      body: { p_owner_clerk_id: ownerClerkId, p_lock_token: lockToken },
    }).catch(() => undefined);
  }
}

async function finishRun(ownerClerkId: string, result: {
  runId: string;
  status: string;
  completedAt: string | null;
  durationMs: number;
  totals: { orders: number; finances: number; inventory: number };
  steps: SyncStep[];
  error: string | null;
}) {
  await Promise.all([
    supabaseRequest("amazon_sync_runs", {
      method: "PATCH",
      query: { id: `eq.${result.runId}`, owner_clerk_id: `eq.${ownerClerkId}` },
      body: {
        status: result.status,
        completed_at: result.completedAt,
        duration_ms: result.durationMs,
        orders_count: result.totals.orders,
        finances_count: result.totals.finances,
        inventory_count: result.totals.inventory,
        steps: result.steps,
        error_message: result.error,
      },
    }),
    upsertConnection(ownerClerkId, {
      connection_status: result.status === "completed" || result.status === "partial" ? "connected" : "error",
      last_sync_at: result.completedAt,
      last_error: result.error,
    }),
  ]);
}

export function registerAmazonSyncRoutes(
  target: IRouter,
  options: Omit<AmazonSyncRouterOptions, "requireAuth"> = {},
): void {
  const getOwner = options.getAuthenticatedUserId ?? getAuthenticatedUserId;
  const checkSchema = options.checkAmazonSyncSchema ?? checkAmazonSyncSchema;
  const assertOwner = options.assertAmazonOwner ?? assertAmazonOwner;

  target.post("/amazon/sync", async (req, res): Promise<void> => {
    try {
      const body = SyncAmazonBody.parse(req.body ?? {});
      res.json(await runSync(getOwner(req), "full", body.since, checkSchema, assertOwner));
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to run Amazon synchronization");
      if (error instanceof AmazonSchemaError) {
        res.status(503).json({
          code: error.check.unavailable
            ? "SUPABASE_SCHEMA_UNAVAILABLE"
            : "AMAZON_SCHEMA_INCOMPLETE",
          error: error.message,
          missingTables: error.check.missingTables,
          missingFunctions: error.check.missingFunctions,
          missingColumns: error.check.missingColumns,
        });
        return;
      }
      res.status(error instanceof AmazonOwnershipError ? 403 : 500).json({ error: sanitizeAmazonError(error) });
    }
  });

  target.post("/amazon/sync/:type", async (req, res): Promise<void> => {
    try {
      const { type } = SyncAmazonTypeParams.parse(req.params);
      const body = SyncAmazonTypeBody.parse(req.body ?? {});
      res.json(await runSync(getOwner(req), type, body.since, checkSchema, assertOwner));
    } catch (error) {
      req.log?.error({ err: sanitizeAmazonError(error) }, "Failed to run Amazon partial synchronization");
      if (error instanceof AmazonSchemaError) {
        res.status(503).json({
          code: error.check.unavailable
            ? "SUPABASE_SCHEMA_UNAVAILABLE"
            : "AMAZON_SCHEMA_INCOMPLETE",
          error: error.message,
          missingTables: error.check.missingTables,
          missingFunctions: error.check.missingFunctions,
          missingColumns: error.check.missingColumns,
        });
        return;
      }
      res.status(error instanceof AmazonOwnershipError ? 403 : 500).json({ error: sanitizeAmazonError(error) });
    }
  });
}

export function createAmazonSyncRouter(options: AmazonSyncRouterOptions = {}): IRouter {
  const syncRouter = Router();
  syncRouter.use(options.requireAuth ?? requireAuth);
  registerAmazonSyncRoutes(syncRouter, options);
  registerAmazonOwnerTransferRoutes(syncRouter, options);
  return syncRouter;
}

registerAmazonSyncRoutes(router);
registerAmazonOwnerTransferRoutes(router);
router.use(createAmazonHistoryRouter());

export default router;