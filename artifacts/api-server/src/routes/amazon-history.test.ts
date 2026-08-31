import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import express, { type RequestHandler } from "express";
import { request as httpRequest } from "node:http";
import {
  createAmazonHistoryRouter,
} from "./amazon-history";
import { persistAmazonConnectionTest } from "./amazon-test-history";
import type { AmazonSmokeCheck } from "../lib/amazon-sp-api";

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

function testRow(index: number, rowOwner = owner): Row {
  return {
    id: `test-${index}`,
    owner_clerk_id: rowOwner,
    tested_at: new Date(Date.UTC(2026, 7, 31, 12, 0, -index)).toISOString(),
    duration_ms: 100 + index,
    success: index % 2 === 0,
    checks: [
      {
        type: "orders",
        status: index % 2 === 0 ? "completed" : "failed",
        count: index,
        durationMs: 210 + index,
        errorCategory: index % 2 === 0 ? null : "authorization",
        error: index % 2 === 0 ? null : "token inválido",
      },
      {
        type: "finances",
        status: "completed",
        count: 4,
        durationMs: 320,
        errorCategory: null,
        error: null,
      },
      {
        type: "inventory",
        status: "failed",
        count: 0,
        durationMs: 4800,
        errorCategory: "latency",
        error: "tempo excedido",
      },
    ],
  };
}

describe("Amazon history routes", () => {
  it("returns only the authenticated owner's 20 newest tests in database order", async () => {
    const allRows = [
      ...Array.from({ length: 25 }, (_, index) => testRow(index)),
      testRow(99, "another-owner"),
    ];
    const calls: Array<{ table: string; options?: Record<string, unknown> }> = [];
    const supabase = async <T>(
      table: string,
      options?: { query?: Record<string, string | number | boolean | undefined> },
    ): Promise<T> => {
      calls.push({ table, options: options as Record<string, unknown> });
      const query = options?.query ?? {};
      strictEqual(query.owner_clerk_id, `eq.${owner}`);
      strictEqual(query.order, "tested_at.desc,id.desc");
      strictEqual(query.limit, 20);
      const rows = allRows
        .filter((row) => row.owner_clerk_id === owner)
        .slice(0, 20);
      return rows as T;
    };
    const app = express();
    app.use(
      createAmazonHistoryRouter({
        requireAuth: authMiddleware(),
        getAuthenticatedUserId: () => owner,
        getAmazonConfig: () => ({ missingSecrets: [] }),
        supabaseRequest: supabase,
      }),
    );

    const result = await requestJson(app, "/amazon/test-history");
    const body = result.body as Array<Row>;

    strictEqual(result.status, 200);
    strictEqual(body.length, 20);
    strictEqual(body[0].id, "test-0");
    strictEqual(body[19].id, "test-19");
    strictEqual(body.some((row) => row.id === "test-99"), false);
    strictEqual(calls.length, 1);
  });

  it("preserves module status, latency, and failure category in each recent check", async () => {
    const app = express();
    app.use(
      createAmazonHistoryRouter({
        requireAuth: authMiddleware(),
        getAuthenticatedUserId: () => owner,
        getAmazonConfig: () => ({ missingSecrets: [] }),
        supabaseRequest: async <T>() =>
          [testRow(1)] as T,
      }),
    );

    const result = await requestJson(app, "/amazon/test-history");
    const body = result.body as Array<Row>;
    const checks = body[0].checks as Array<Row>;

    strictEqual(result.status, 200);
    deepStrictEqual(
      checks.map((check) => ({
        type: check.type,
        status: check.status,
        durationMs: check.durationMs,
        errorCategory: check.errorCategory,
      })),
      [
        {
          type: "orders",
          status: "failed",
          durationMs: 211,
          errorCategory: "authorization",
        },
        {
          type: "finances",
          status: "completed",
          durationMs: 320,
          errorCategory: null,
        },
        {
          type: "inventory",
          status: "failed",
          durationMs: 4800,
          errorCategory: "latency",
        },
      ],
    );
  });

  it("keeps sync run step status, latency, and category scoped to the owner", async () => {
    const app = express();
    app.use(
      createAmazonHistoryRouter({
        requireAuth: authMiddleware(),
        getAuthenticatedUserId: () => owner,
        getAmazonConfig: () => ({ missingSecrets: [] }),
        supabaseRequest: async <T>() =>
          [
            {
              id: "run-1",
              owner_clerk_id: owner,
              sync_type: "full",
              status: "partial",
              started_at: "2026-08-31T12:00:00.000Z",
              completed_at: "2026-08-31T12:00:02.000Z",
              duration_ms: 2000,
              orders_count: 3,
              finances_count: 2,
              inventory_count: 0,
              steps: [
                {
                  type: "orders",
                  status: "completed",
                  count: 3,
                  durationMs: 700,
                  errorCategory: null,
                  error: null,
                },
                {
                  type: "finances",
                  status: "failed",
                  count: 0,
                  durationMs: 1300,
                  errorCategory: "throttling",
                  error: "limite",
                },
              ],
              error_message: "finances: limite",
            },
          ] as T,
      }),
    );

    const result = await requestJson(app, "/amazon/sync-runs");
    const body = result.body as Array<Row>;
    const steps = body[0].steps as Array<Row>;

    strictEqual(result.status, 200);
    strictEqual(body[0].status, "partial");
    strictEqual(body[0].durationMs, 2000);
    deepStrictEqual(
      steps.map((step) => ({
        type: step.type,
        status: step.status,
        durationMs: step.durationMs,
        errorCategory: step.errorCategory,
      })),
      [
        {
          type: "orders",
          status: "completed",
          durationMs: 700,
          errorCategory: null,
        },
        {
          type: "finances",
          status: "failed",
          durationMs: 1300,
          errorCategory: "throttling",
        },
      ],
    );
  });

  it("does not fail test persistence when historical cleanup fails", async () => {
    const calls: string[] = [];
    let savedBody: Row | undefined;
    const supabase = async <T>(
      table: string,
      options?: { body?: unknown },
    ): Promise<T> => {
      calls.push(table);
      if (table === "amazon_connection_tests") {
        savedBody = options?.body as Row;
        return [] as T;
      }
      if (table === "rpc/prune_amazon_connection_tests") {
        throw new Error("cleanup unavailable");
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    await persistAmazonConnectionTest(
      owner,
      "2026-08-31T12:00:00.000Z",
      987,
      [
        {
          type: "orders",
          status: "failed",
          count: 0,
          durationMs: 987,
          errorCategory: "availability",
          error: "indisponível",
        },
        {
          type: "finances",
          status: "completed",
          count: 2,
          durationMs: 321,
          errorCategory: null,
          error: null,
        },
        {
          type: "inventory",
          status: "completed",
          count: 4,
          durationMs: 654,
          errorCategory: null,
          error: null,
        },
      ] satisfies AmazonSmokeCheck[],
      supabase,
    );

    deepStrictEqual(calls, [
      "amazon_connection_tests",
      "rpc/prune_amazon_connection_tests",
    ]);
    strictEqual(savedBody?.owner_clerk_id, owner);
    strictEqual(savedBody?.duration_ms, 987);
  });
});