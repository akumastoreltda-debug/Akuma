import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  AMAZON_RETENTION_MIGRATION,
  AMAZON_RETENTION_REQUIRED_FUNCTIONS,
  checkAmazonRetentionSchema,
  type AmazonRetentionSchemaCheck,
} from "../lib/supabase";

export type HealthRouterOptions = {
  checkAmazonRetentionSchema?: () => Promise<AmazonRetentionSchemaCheck>;
};

function retentionHealthStatus(check: AmazonRetentionSchemaCheck) {
  if (check.complete) {
    return {
      status: "ready" as const,
      migration: AMAZON_RETENTION_MIGRATION,
      requiredFunctions: [...AMAZON_RETENTION_REQUIRED_FUNCTIONS],
      missingFunctions: [],
    };
  }

  if (check.unavailable) {
    const isInvalidCredentials = check.failureReason === "invalid_credentials";
    return {
      status: isInvalidCredentials
        ? ("invalid_credentials" as const)
        : ("temporarily_unavailable" as const),
      migration: AMAZON_RETENTION_MIGRATION,
      requiredFunctions: [...AMAZON_RETENTION_REQUIRED_FUNCTIONS],
      missingFunctions: [],
      diagnostic: isInvalidCredentials
        ? "Não foi possível validar a retenção remota: a credencial do Supabase é inválida ou não tem autorização para consultar o schema."
        : "Não foi possível validar a retenção remota: o Supabase está temporariamente indisponível. Tente novamente.",
    };
  }

  const missingFunctions = [...check.missingFunctions];
  return {
    status: "schema_incomplete" as const,
    migration: AMAZON_RETENTION_MIGRATION,
    requiredFunctions: [...AMAZON_RETENTION_REQUIRED_FUNCTIONS],
    missingFunctions,
    diagnostic:
      `O schema remoto não contém a migration ${AMAZON_RETENTION_MIGRATION}. ` +
      `Funções ausentes: ${missingFunctions.join(", ")}.`,
  };
}

export function createHealthRouter(
  options: HealthRouterOptions = {},
): IRouter {
  const checkSchema =
    options.checkAmazonRetentionSchema ?? checkAmazonRetentionSchema;
  const router: IRouter = Router();

  router.get("/healthz", async (_req, res) => {
    const amazonRetention = retentionHealthStatus(await checkSchema());
    const data = HealthCheckResponse.parse({
      status: amazonRetention.status === "ready" ? "ok" : "degraded",
      amazonRetention,
    });
    res.json(data);
  });

  return router;
}

export default createHealthRouter();
