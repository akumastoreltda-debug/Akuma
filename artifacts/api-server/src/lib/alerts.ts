import {
  checkAlertsSchema,
  supabaseRequest,
  type AlertsSchemaCheck,
} from "./supabase";

export type AlertRecord = {
  id: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  acknowledgedAt: string | null;
};

type JsonRecord = Record<string, unknown>;

const ALERTS_SCHEMA_CACHE_TTL_MS = 60_000;
const acknowledgementUpdateQueues = new Map<string, Promise<unknown>>();

export class AlertsSchemaError extends Error {
  constructor(public readonly check: AlertsSchemaCheck) {
    const migration =
      check.missingTables.includes("alerts")
        ? "0001_amazon_profit_manager.sql e 0006_alert_acknowledgements.sql"
        : "0006_alert_acknowledgements.sql";
    const missingObjects = [
      check.missingTables.length
        ? `tabelas: ${check.missingTables.join(", ")}`
        : "",
      check.missingFunctions.length
        ? `funções RPC: ${check.missingFunctions.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    super(
      check.unavailable
        ? "Não foi possível verificar o schema do Supabase da central de alertas. Confirme que o projeto configurado está disponível e tente novamente."
        : `A central de alertas está temporariamente indisponível porque o schema do Supabase está incompleto. Aplique a migration ${migration} no projeto configurado e tente novamente. Objetos ausentes: ${missingObjects}.`,
    );
    this.name = "AlertsSchemaError";
  }
}

export function createCachedAlertsSchemaCheck(
  checkSchema: typeof checkAlertsSchema,
): () => Promise<AlertsSchemaCheck> {
  let cached:
    | { check: AlertsSchemaCheck; expiresAt: number }
    | undefined;
  let inFlight: Promise<AlertsSchemaCheck> | undefined;

  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.check;
    if (inFlight) return inFlight;

    inFlight = checkSchema()
      .then((check) => {
        cached = {
          check,
          expiresAt: Date.now() + ALERTS_SCHEMA_CACHE_TTL_MS,
        };
        return check;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

export const getCachedAlertsSchemaCheck =
  createCachedAlertsSchemaCheck(checkAlertsSchema);

type AlertAcknowledgementRpcRow = JsonRecord & {
  id: unknown;
  severity: unknown;
  title: unknown;
  message: unknown;
  created_at: unknown;
  read: unknown;
  acknowledged_at: unknown;
};

/**
 * Serializes acknowledgement writes for one owner and alert.
 *
 * A quick pair of requests can otherwise finish in a different order than
 * they were accepted by this process, allowing an older response to win in
 * the client cache. Failed writes still release the queue for the next
 * request.
 */
export function serializeAlertAcknowledgement<T>(
  ownerClerkId: string,
  alertId: string,
  update: () => Promise<T>,
): Promise<T> {
  const key = `${ownerClerkId}:${alertId}`;
  const previous = acknowledgementUpdateQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(update);
  let settled: Promise<T>;
  settled = current.finally(() => {
    if (acknowledgementUpdateQueues.get(key) === settled) {
      acknowledgementUpdateQueues.delete(key);
    }
  });
  acknowledgementUpdateQueues.set(key, settled);
  return settled;
}

/**
 * Persists an acknowledgement through the database transaction that owns the
 * per-alert lock. The returned row is the state written by that transaction,
 * rather than a best-effort echo of the request body.
 */
export async function updateAlertAcknowledgement(
  ownerClerkId: string,
  alertId: string,
  read: boolean,
  request: typeof supabaseRequest = supabaseRequest,
): Promise<AlertAcknowledgementRpcRow | null> {
  const rows = await request<AlertAcknowledgementRpcRow[]>(
    "rpc/update_alert_acknowledgement",
    {
      method: "POST",
      body: {
        p_owner_clerk_id: ownerClerkId,
        p_alert_id: alertId,
        p_read: read,
      },
    },
  );
  return rows[0] ?? null;
}

export async function listAlertsForOwner(
  ownerClerkId: string,
  options: { unreadOnly?: boolean } = {},
  request: typeof supabaseRequest = supabaseRequest,
): Promise<AlertRecord[]> {
  const [alertRows, acknowledgementRows] = await Promise.all([
    request<JsonRecord[]>("alerts", {
      query: {
        select: "id,severity,title,message,created_at,read",
        owner_clerk_id: `eq.${ownerClerkId}`,
        order: "created_at.desc",
      },
    }),
    request<JsonRecord[]>("alert_acknowledgements", {
      query: {
        select: "alert_id,read,read_at",
        owner_clerk_id: `eq.${ownerClerkId}`,
      },
    }),
  ]);

  const readByAlertId = new Map(
    acknowledgementRows.map((row) => [String(row.alert_id), Boolean(row.read)]),
  );
  const acknowledgedAtByAlertId = new Map(
    acknowledgementRows.map((row) => [
      String(row.alert_id),
      row.read && row.read_at ? String(row.read_at) : null,
    ]),
  );
  const alerts = alertRows.map((alert) => ({
    id: String(alert.id),
    severity: String(alert.severity),
    title: String(alert.title),
    message: String(alert.message),
    createdAt: String(alert.created_at),
    read: readByAlertId.has(String(alert.id))
      ? readByAlertId.get(String(alert.id)) === true
      : Boolean(alert.read),
    acknowledgedAt: acknowledgedAtByAlertId.get(String(alert.id)) ?? null,
  }));

  return options.unreadOnly ? alerts.filter((alert) => !alert.read) : alerts;
}