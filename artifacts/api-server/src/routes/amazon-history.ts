import { Router, type IRouter, type RequestHandler } from "express";
import { getAmazonConfig } from "../lib/amazon-sp-api";
import { supabaseRequest, toNumber } from "../lib/supabase";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/requireAuth";

type JsonRecord = Record<string, unknown>;

type HistorySupabaseOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  returnRepresentation?: boolean;
  prefer?: string;
};

type HistorySupabaseRequest = <T>(
  table: string,
  options?: HistorySupabaseOptions,
) => Promise<T>;

type AmazonHistoryDependencies = {
  requireAuth?: RequestHandler;
  getAuthenticatedUserId?: (req: Parameters<RequestHandler>[0]) => string;
  getAmazonConfig?: () => { missingSecrets: string[] };
  supabaseRequest?: HistorySupabaseRequest;
};

const AMAZON_TEST_HISTORY_LIMIT = 20;

const AMAZON_MODULES = ["orders", "finances", "inventory"] as const;
const AMAZON_FAILURE_CATEGORIES = [
  "authorization",
  "signature",
  "throttling",
  "configuration",
  "payload",
  "availability",
  "latency",
  "unknown",
] as const;

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function connectionTestResponse(row: JsonRecord) {
  const checks = Array.isArray(row.checks)
    ? row.checks.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const check = item as JsonRecord;
        const type = String(check.type);
        const status = String(check.status);
        if (
          !AMAZON_MODULES.includes(type as (typeof AMAZON_MODULES)[number]) ||
          (status !== "completed" && status !== "failed")
        ) {
          return [];
        }
        const errorCategory =
          check.errorCategory &&
          AMAZON_FAILURE_CATEGORIES.includes(
            check.errorCategory as (typeof AMAZON_FAILURE_CATEGORIES)[number],
          )
            ? check.errorCategory
            : null;
        return [
          {
            type,
            status,
            count: Math.max(0, Math.trunc(toNumber(check.count))),
            durationMs: Math.max(0, Math.trunc(toNumber(check.durationMs))),
            errorCategory,
            error: check.error ? String(check.error).slice(0, 300) : null,
          },
        ];
      })
    : [];

  return {
    id: String(row.id),
    testedAt: String(row.tested_at),
    durationMs: Math.max(0, Math.trunc(toNumber(row.duration_ms))),
    success: Boolean(row.success),
    checks,
  };
}

function syncRunResponse(row: JsonRecord) {
  const steps = Array.isArray(row.steps)
    ? row.steps.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const step = item as JsonRecord;
        const type = String(step.type);
        const status = String(step.status);
        if (
          !AMAZON_MODULES.includes(type as (typeof AMAZON_MODULES)[number]) ||
          !["completed", "failed", "skipped"].includes(status)
        ) {
          return [];
        }
        const errorCategory =
          step.errorCategory &&
          AMAZON_FAILURE_CATEGORIES.includes(
            step.errorCategory as (typeof AMAZON_FAILURE_CATEGORIES)[number],
          )
            ? step.errorCategory
            : null;
        return [
          {
            type,
            status,
            count: Math.max(0, Math.trunc(toNumber(step.count))),
            durationMs: Math.max(0, Math.trunc(toNumber(step.durationMs))),
            errorCategory,
            error: step.error ? String(step.error).slice(0, 300) : null,
          },
        ];
      })
    : [];

  return {
    id: String(row.id),
    syncType: String(row.sync_type),
    status: String(row.status),
    startedAt: String(row.started_at),
    completedAt: iso(row.completed_at),
    durationMs: toNumber(row.duration_ms),
    counts: {
      orders: toNumber(row.orders_count),
      finances: toNumber(row.finances_count),
      inventory: toNumber(row.inventory_count),
    },
    steps,
    error: row.error_message ? String(row.error_message) : null,
  };
}

export function createAmazonHistoryRouter(
  dependencies: AmazonHistoryDependencies = {},
): IRouter {
  const authenticate = dependencies.requireAuth ?? requireAuth;
  const authenticatedUserId =
    dependencies.getAuthenticatedUserId ?? getAuthenticatedUserId;
  const amazonConfig = dependencies.getAmazonConfig ?? getAmazonConfig;
  const request = dependencies.supabaseRequest ?? supabaseRequest;
  const router: IRouter = Router();

  router.use(authenticate);

  router.get("/amazon/test-history", async (req, res): Promise<void> => {
    try {
      if (amazonConfig().missingSecrets.length) {
        res.json([]);
        return;
      }
      const ownerClerkId = authenticatedUserId(req);
      const rows = await request<JsonRecord[]>("amazon_connection_tests", {
        query: {
          select: "id,tested_at,duration_ms,success,checks",
          owner_clerk_id: `eq.${ownerClerkId}`,
          order: "tested_at.desc,id.desc",
          limit: AMAZON_TEST_HISTORY_LIMIT,
        },
      });
      res.json(rows.map(connectionTestResponse));
    } catch {
      res.status(500).json({
        error: "Não foi possível carregar o histórico de disponibilidade Amazon",
      });
    }
  });

  router.get("/amazon/sync-runs", async (req, res): Promise<void> => {
    try {
      if (amazonConfig().missingSecrets.length) {
        res.json([]);
        return;
      }
      const ownerClerkId = authenticatedUserId(req);
      const rows = await request<JsonRecord[]>("amazon_sync_runs", {
        query: {
          select: "*",
          owner_clerk_id: `eq.${ownerClerkId}`,
          status: "neq.processing",
          order: "started_at.desc",
          limit: 20,
        },
      });
      res.json(rows.map(syncRunResponse));
    } catch {
      res.status(500).json({
        error: "Não foi possível carregar o histórico de sincronizações",
      });
    }
  });

  return router;
}

export default createAmazonHistoryRouter();