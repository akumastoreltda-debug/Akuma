import { Router, type IRouter, type RequestHandler } from "express";
import { ListAlertsQueryParams, UpdateAlertBody, UpdateAlertParams } from "@workspace/api-zod";
import {
  AlertsSchemaError,
  createCachedAlertsSchemaCheck,
  getCachedAlertsSchemaCheck,
  listAlertsForOwner,
  serializeAlertAcknowledgement,
  updateAlertAcknowledgement,
} from "../lib/alerts";
import {
  checkAlertsSchema,
  supabaseRequest,
} from "../lib/supabase";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/requireAuth";

type AlertsRouterDependencies = {
  requireAuth?: RequestHandler;
  getAuthenticatedUserId?: (req: Parameters<typeof getAuthenticatedUserId>[0]) => string;
  listAlertsForOwner?: typeof listAlertsForOwner;
  serializeAlertAcknowledgement?: typeof serializeAlertAcknowledgement;
  updateAlertAcknowledgement?: typeof updateAlertAcknowledgement;
  supabaseRequest?: typeof supabaseRequest;
  checkAlertsSchema?: typeof checkAlertsSchema;
};

export function createAlertsRouter(
  dependencies: AlertsRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const authenticate = dependencies.requireAuth ?? requireAuth;
  const getOwner = dependencies.getAuthenticatedUserId ?? getAuthenticatedUserId;
  const listAlerts = dependencies.listAlertsForOwner ?? listAlertsForOwner;
  const serializeUpdate =
    dependencies.serializeAlertAcknowledgement ?? serializeAlertAcknowledgement;
  const updateAcknowledgement =
    dependencies.updateAlertAcknowledgement ?? updateAlertAcknowledgement;
  const requestSupabase = dependencies.supabaseRequest ?? supabaseRequest;
  const getSchemaCheck = dependencies.checkAlertsSchema
    ? createCachedAlertsSchemaCheck(dependencies.checkAlertsSchema)
    : getCachedAlertsSchemaCheck;
  const assertSchema = async (): Promise<void> => {
    const check = await getSchemaCheck();
    if (!check.complete) throw new AlertsSchemaError(check);
  };
  router.use(authenticate);

  router.get("/alerts", async (req, res) => {
    try {
      await assertSchema();
      const params = ListAlertsQueryParams.parse(req.query);
      const ownerClerkId = getOwner(req);
      res.json(await listAlerts(ownerClerkId, params));
    } catch (error) {
      if (error instanceof AlertsSchemaError) {
        req.log?.error({ err: error.check }, "Alerts schema is not ready");
        res.status(503).json({
          error: error.message,
          code: error.check.unavailable
            ? "ALERTS_SCHEMA_UNAVAILABLE"
            : "ALERTS_SCHEMA_INCOMPLETE",
          missingTables: error.check.missingTables,
          missingFunctions: error.check.missingFunctions,
        });
        return;
      }
      req.log?.error({ err: error }, "Failed to list alerts");
      res.status(500).json({ error: "Não foi possível carregar os alertas" });
    }
  });

  router.patch("/alerts/:id", async (req, res) => {
    try {
      await assertSchema();
      const { id } = UpdateAlertParams.parse(req.params);
      const body = UpdateAlertBody.parse(req.body);
      const ownerClerkId = getOwner(req);
      const updateResult = await serializeUpdate(
        ownerClerkId,
        id,
        () =>
          updateAcknowledgement(
            ownerClerkId,
            id,
            body.read,
            requestSupabase,
          ).then((persisted) =>
            persisted
              ? {
                  alert: persisted,
                  acknowledgement: {
                    read: persisted.read === true,
                    acknowledgedAt:
                      persisted.read === true && persisted.acknowledged_at
                        ? String(persisted.acknowledged_at)
                        : null,
                  },
                }
              : { alert: null, acknowledgement: null },
          ),
      );

      if (!updateResult.alert || !updateResult.acknowledgement) {
        res.status(404).json({ error: "Alerta não encontrado" });
        return;
      }

      const { alert, acknowledgement } = updateResult;
      res.json({
        id: String(alert.id),
        severity: String(alert.severity),
        title: String(alert.title),
        message: String(alert.message),
        createdAt: String(alert.created_at),
        read: acknowledgement.read,
        acknowledgedAt: acknowledgement.acknowledgedAt,
      });
    } catch (error) {
      if (error instanceof AlertsSchemaError) {
        req.log?.error({ err: error.check }, "Alerts schema is not ready");
        res.status(503).json({
          error: error.message,
          code: error.check.unavailable
            ? "ALERTS_SCHEMA_UNAVAILABLE"
            : "ALERTS_SCHEMA_INCOMPLETE",
          missingTables: error.check.missingTables,
          missingFunctions: error.check.missingFunctions,
        });
        return;
      }
      req.log?.error({ err: error }, "Failed to update alert acknowledgement");
      res.status(400).json({ error: "Não foi possível atualizar o reconhecimento do alerta" });
    }
  });

  return router;
}

export default createAlertsRouter();