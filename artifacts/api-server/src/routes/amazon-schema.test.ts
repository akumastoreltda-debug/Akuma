import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import express, { type RequestHandler } from "express";
import { request as httpRequest } from "node:http";
import { AmazonOwnershipError, createAmazonSyncRouter } from "./amazon";
import type { AmazonSyncSchemaCheck } from "../lib/supabase";

type Row = Record<string, unknown>;

const owner = "owner-1";
const amazonSecretEnv = [
  "AMAZON_LWA_CLIENT_ID",
  "AMAZON_LWA_CLIENT_SECRET",
  "AMAZON_LWA_REFRESH_TOKEN",
  "AMAZON_MARKETPLACE_ID",
] as const;

function authMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

async function withAmazonSecrets<T>(run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(
    amazonSecretEnv.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    AMAZON_LWA_CLIENT_ID: "client-id",
    AMAZON_LWA_CLIENT_SECRET: "client-secret",
    AMAZON_LWA_REFRESH_TOKEN: "Atzr|refresh-token",
  });
  try {
    return await run();
  } finally {
    for (const key of amazonSecretEnv) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": 2,
          },
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
      req.write("{}");
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function appForSchema(
  schema: AmazonSyncSchemaCheck,
  assertAmazonOwner: (ownerClerkId: string) => Promise<void> = async () => undefined,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createAmazonSyncRouter({
      requireAuth: authMiddleware(),
      getAuthenticatedUserId: () => owner,
      checkAmazonSyncSchema: async () => schema,
      assertAmazonOwner,
    }),
  );
  return app;
}

describe("Amazon sync schema error responses", () => {
  it("preserves the incomplete and unavailable codes on both sync endpoints", async () => {
    const missingColumns = [
      {
        table: "sales",
        column: "updated_at",
        migration: "0002_amazon_selling_partner.sql",
      },
    ];
    const schemas: Array<{
      schema: AmazonSyncSchemaCheck;
      code: string;
    }> = [
      {
        schema: {
          complete: false,
          unavailable: false,
          missingTables: ["amazon_sync_runs"],
          missingFunctions: ["acquire_amazon_sync_lock"],
          missingColumns,
        },
        code: "AMAZON_SCHEMA_INCOMPLETE",
      },
      {
        schema: {
          complete: false,
          unavailable: true,
          missingTables: [],
          missingFunctions: [],
          missingColumns: [],
          diagnostic: "request failed with supabase-service-role-key",
        },
        code: "SUPABASE_SCHEMA_UNAVAILABLE",
      },
    ];

    await withAmazonSecrets(async () => {
      for (const { schema, code } of schemas) {
        for (const path of ["/amazon/sync", "/amazon/sync/orders"]) {
          const result = await requestJson(appForSchema(schema), path);
          const body = result.body as Row;

          strictEqual(result.status, 503);
          strictEqual(body.code, code);
          deepStrictEqual(body.missingColumns, schema.missingColumns);
          strictEqual(
            JSON.stringify(body).includes("supabase-service-role-key"),
            false,
          );
        }
      }
    });
  });

  it("includes table, column, and migration for every reported missing column", async () => {
    const missingColumns = [
      {
        table: "sales",
        column: "updated_at",
        migration: "0002_amazon_selling_partner.sql",
      },
      {
        table: "amazon_sync_runs",
        column: "steps",
        migration: "0004_amazon_module_observability.sql",
      },
    ];
    const result = await withAmazonSecrets(async () =>
      requestJson(
        appForSchema({
          complete: false,
          unavailable: false,
          missingTables: [],
          missingFunctions: [],
          missingColumns,
        }),
        "/amazon/sync",
      ),
    );
    const body = result.body as Row;

    strictEqual(result.status, 503);
    deepStrictEqual(body.missingColumns, missingColumns);
    for (const column of missingColumns) {
      const returned: Row | undefined = (body.missingColumns as Array<Row>).find(
        (item) => item.table === column.table && item.column === column.column,
      );
      deepStrictEqual(returned, column);
    }
  });

  it("returns 403 before either sync path can run for another owner", async () => {
    await withAmazonSecrets(async () => {
      const schema: AmazonSyncSchemaCheck = {
        complete: true,
        unavailable: false,
        missingTables: [],
        missingFunctions: [],
        missingColumns: [],
      };
      for (const path of ["/amazon/sync", "/amazon/sync/orders"]) {
        const result = await requestJson(
          appForSchema(schema, async () => {
            throw new AmazonOwnershipError();
          }),
          path,
        );

        strictEqual(result.status, 403);
        strictEqual((result.body as Row).error, "Esta conta Amazon já está vinculada a outro usuário");
      }
    });
  });
});