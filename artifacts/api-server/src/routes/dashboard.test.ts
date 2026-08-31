import { deepStrictEqual, strictEqual } from "node:assert";
import { request as httpRequest } from "node:http";
import { describe, it } from "node:test";
import express, { type RequestHandler } from "express";
import { createDashboardRouter } from "./dashboard";
import type { AlertRecord } from "../lib/alerts";
import type {
  AlertsSchemaCheck,
  SupabaseOptions,
} from "../lib/supabase";

type Row = Record<string, unknown>;

const owner = "owner-1";

function authMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

async function requestJson(
  app: ReturnType<typeof express>,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not expose a TCP address");
  }

  try {
    return await new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method: "GET",
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                body: text ? JSON.parse(text) : null,
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function appForDashboard({
  schema,
  supabaseRequest = async <T>(
    _table: string,
    _options?: SupabaseOptions,
  ) => [] as T,
  listAlertsForOwner = async () => [] as AlertRecord[],
}: {
  schema: AlertsSchemaCheck;
  supabaseRequest?: <T>(
    table: string,
    options?: SupabaseOptions,
  ) => Promise<T>;
  listAlertsForOwner?: typeof import("../lib/alerts").listAlertsForOwner;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    createDashboardRouter({
      requireAuth: authMiddleware(),
      getAuthenticatedUserId: () => owner,
      checkAlertsSchema: async () => schema,
      supabaseRequest,
      listAlertsForOwner,
    }),
  );
  return app;
}

describe("Dashboard summary diagnostics", () => {
  it("returns the incomplete alerts schema diagnosis before querying financial tables", async () => {
    let financialRequests = 0;
    let alertsRequests = 0;
    const result = await requestJson(
      appForDashboard({
        schema: {
          complete: false,
          unavailable: false,
          missingTables: ["alert_acknowledgements"],
          missingFunctions: ["update_alert_acknowledgement"],
        },
        supabaseRequest: async <T>() => {
          financialRequests += 1;
          return [] as T;
        },
        listAlertsForOwner: async () => {
          alertsRequests += 1;
          return [];
        },
      }),
      "/dashboard/summary",
    );
    const body = result.body as Row;

    strictEqual(result.status, 503);
    strictEqual(body.code, "ALERTS_SCHEMA_INCOMPLETE");
    strictEqual(
      String(body.error).includes("0006_alert_acknowledgements.sql"),
      true,
    );
    deepStrictEqual(body.missingTables, ["alert_acknowledgements"]);
    deepStrictEqual(body.missingFunctions, ["update_alert_acknowledgement"]);
    strictEqual(financialRequests, 0);
    strictEqual(alertsRequests, 0);
  });

  it("keeps financial table failures as the generic 500 response", async () => {
    const result = await requestJson(
      appForDashboard({
        schema: {
          complete: true,
          unavailable: false,
          missingTables: [],
          missingFunctions: [],
        },
        supabaseRequest: async <T>(table: string) => {
          if (table === "sales") throw new Error("sales table unavailable");
          return [] as T;
        },
      }),
      "/dashboard/summary",
    );
    const body = result.body as Row;

    strictEqual(result.status, 500);
    strictEqual(body.error, "Não foi possível carregar o dashboard");
    strictEqual(JSON.stringify(body).includes("0006_alert_acknowledgements.sql"), false);
    strictEqual("code" in body, false);
  });
});