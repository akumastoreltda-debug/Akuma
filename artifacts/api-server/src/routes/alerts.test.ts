import { deepStrictEqual, strictEqual } from "node:assert";
import { request as httpRequest } from "node:http";
import { describe, it } from "node:test";
import express, { type RequestHandler } from "express";
import {
  listAlertsForOwner,
  updateAlertAcknowledgement,
} from "../lib/alerts";
import { supabaseRequest, type AlertsSchemaCheck } from "../lib/supabase";
import { createAlertsRouter } from "./alerts";

type Row = Record<string, unknown>;

const owner = "owner-1";
const completeAlertsSchema: AlertsSchemaCheck = {
  complete: true,
  unavailable: false,
  missingTables: [],
  missingFunctions: [],
};

function authMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

async function requestJson(
  app: ReturnType<typeof express>,
  path: string,
  method: "GET" | "PATCH",
  body?: unknown,
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
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method,
          headers: payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : undefined,
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
      if (payload) req.write(payload);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("Alert acknowledgements", () => {
  it("returns only the owner's acknowledgement timestamp and ignores stale unread timestamps", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://supabase.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      strictEqual(url.searchParams.get("owner_clerk_id"), `eq.${owner}`);
      if (url.pathname.endsWith("/alerts")) {
        return new Response(
          JSON.stringify([
            {
              id: "alert-1",
              severity: "danger",
              title: "Falha",
              message: "Falha na operação",
              created_at: "2026-08-31T12:00:00.000Z",
              read: false,
            },
            {
              id: "alert-2",
              severity: "warning",
              title: "Atenção",
              message: "Verifique a operação",
              created_at: "2026-08-31T11:00:00.000Z",
              read: false,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname.endsWith("/alert_acknowledgements")) {
        return new Response(
          JSON.stringify([
            {
              alert_id: "alert-1",
              read: true,
              read_at: "2026-08-31T12:34:56.000Z",
            },
            {
              alert_id: "alert-2",
              read: false,
              read_at: "2026-08-31T12:30:00.000Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected path: ${url.pathname}`);
    };

    try {
      const alerts = await listAlertsForOwner(owner);
      deepStrictEqual(alerts, [
        {
          id: "alert-1",
          severity: "danger",
          title: "Falha",
          message: "Falha na operação",
          createdAt: "2026-08-31T12:00:00.000Z",
          read: true,
          acknowledgedAt: "2026-08-31T12:34:56.000Z",
        },
        {
          id: "alert-2",
          severity: "warning",
          title: "Atenção",
          message: "Verifique a operação",
          createdAt: "2026-08-31T11:00:00.000Z",
          read: false,
          acknowledgedAt: null,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = originalUrl;
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  it("returns the new timestamp when acknowledging and clears only the current state when unacknowledging", async () => {
    const calls: Array<{ table: string; options?: Row }> = [];
    const acknowledgementBodies: Row[] = [];
    const supabase = async <T>(
      table: string,
      options?: { query?: Row; body?: unknown; method?: string; prefer?: string },
    ): Promise<T> => {
      calls.push({ table, options: options as Row | undefined });
      if (table === "rpc/update_alert_acknowledgement") {
        strictEqual(options?.method, "POST");
        strictEqual(options?.body && (options.body as Row).p_owner_clerk_id, owner);
        strictEqual(options?.body && (options.body as Row).p_alert_id, "alert-1");
        acknowledgementBodies.push(options?.body as Row);
        const persistedRead = Boolean((options?.body as Row).p_read);
        return [
          {
            id: "alert-1",
            severity: "danger",
            title: "Falha",
            message: "Falha na operação",
            created_at: "2026-08-31T12:00:00.000Z",
            read: persistedRead,
            acknowledged_at: persistedRead
              ? "2026-08-31T12:34:56.000Z"
              : null,
          },
        ] as T;
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const app = express();
    app.use(express.json());
    app.use(
      createAlertsRouter({
        requireAuth: authMiddleware(),
        getAuthenticatedUserId: () => owner,
        supabaseRequest: supabase,
        checkAlertsSchema: async () => completeAlertsSchema,
      }),
    );

    const acknowledged = await requestJson(app, "/alerts/alert-1", "PATCH", {
      read: true,
    });
    const acknowledgedBody = acknowledged.body as Row;
    strictEqual(acknowledged.status, 200);
    strictEqual(acknowledgedBody.read, true);
    strictEqual(typeof acknowledgedBody.acknowledgedAt, "string");
    strictEqual(acknowledgementBodies[0].p_read, true);

    const unacknowledged = await requestJson(app, "/alerts/alert-1", "PATCH", {
      read: false,
    });
    const unacknowledgedBody = unacknowledged.body as Row;
    strictEqual(unacknowledged.status, 200);
    strictEqual(unacknowledgedBody.read, false);
    strictEqual(unacknowledgedBody.acknowledgedAt, null);
    strictEqual(acknowledgementBodies[1].p_read, false);
    strictEqual(calls.length, 2);
  });

  it("serializes concurrent acknowledge and unacknowledge writes and returns the persisted state", async () => {
    const acknowledgementBodies: Row[] = [];
    let releaseFirstWrite!: () => void;
    let firstWriteStarted!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const firstWriteObserved = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });

    const supabase = async <T>(
      table: string,
      options?: {
        query?: Row;
        body?: unknown;
        method?: string;
        prefer?: string;
        returnRepresentation?: boolean;
      },
    ): Promise<T> => {
      if (table === "rpc/update_alert_acknowledgement") {
        const body = options?.body as Row;
        acknowledgementBodies.push(body);
        if (acknowledgementBodies.length === 1) {
          firstWriteStarted();
          await firstWrite;
        }
        const persistedRead = Boolean(body.p_read);
        return [
          {
            id: "alert-1",
            severity: "danger",
            title: "Falha",
            message: "Falha na operação",
            created_at: "2026-08-31T12:00:00.000Z",
            read: persistedRead,
            acknowledged_at: persistedRead
              ? "2026-08-31T12:34:56.000Z"
              : null,
          },
        ] as T;
      }
      throw new Error(`Unexpected table: ${table}`);
    };

    const app = express();
    app.use(express.json());
    app.use(
      createAlertsRouter({
        requireAuth: authMiddleware(),
        getAuthenticatedUserId: () => owner,
        supabaseRequest: supabase,
        checkAlertsSchema: async () => completeAlertsSchema,
      }),
    );

    const acknowledgedRequest = requestJson(app, "/alerts/alert-1", "PATCH", {
      read: true,
    });
    await firstWriteObserved;
    const unacknowledgedRequest = requestJson(app, "/alerts/alert-1", "PATCH", {
      read: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    strictEqual(acknowledgementBodies.length, 1);
    strictEqual(acknowledgementBodies[0].p_read, true);

    releaseFirstWrite();
    const [acknowledged, unacknowledged] = await Promise.all([
      acknowledgedRequest,
      unacknowledgedRequest,
    ]);
    const acknowledgedBody = acknowledged.body as Row;
    const unacknowledgedBody = unacknowledged.body as Row;

    strictEqual(acknowledged.status, 200);
    strictEqual(acknowledgedBody.read, true);
    strictEqual(acknowledgedBody.acknowledgedAt, "2026-08-31T12:34:56.000Z");
    strictEqual(unacknowledged.status, 200);
    strictEqual(unacknowledgedBody.read, false);
    strictEqual(unacknowledgedBody.acknowledgedAt, null);
    deepStrictEqual(
      acknowledgementBodies.map((body) => body.p_read),
      [true, false],
    );
  });

  it("serializes writes from independent clients through the database RPC", async () => {
    let persistedRead = false;
    let rpcQueue = Promise.resolve();
    const rpcCalls: boolean[] = [];

    const supabase = async <T>(
      table: string,
      options?: { body?: unknown; method?: string },
    ): Promise<T> => {
      strictEqual(table, "rpc/update_alert_acknowledgement");
      strictEqual(options?.method, "POST");
      const body = options?.body as Row;
      const previous = rpcQueue;
      let release!: () => void;
      rpcQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;

      // This critical section stands in for pg_advisory_xact_lock plus the
      // upsert inside the Supabase transaction.
      await new Promise((resolve) => setTimeout(resolve, 5));
      persistedRead = body.p_read === true;
      rpcCalls.push(persistedRead);
      release();
      return [
        {
          id: "alert-1",
          severity: "danger",
          title: "Falha",
          message: "Falha na operação",
          created_at: "2026-08-31T12:00:00.000Z",
          read: persistedRead,
          acknowledged_at: persistedRead
            ? "2026-08-31T12:34:56.000Z"
            : null,
        },
      ] as T;
    };

    const [acknowledged, unacknowledged] = await Promise.all([
      updateAlertAcknowledgement(owner, "alert-1", true, supabase),
      updateAlertAcknowledgement(owner, "alert-1", false, supabase),
    ]);

    strictEqual(acknowledged?.read, true);
    strictEqual(unacknowledged?.read, false);
    strictEqual(persistedRead, false);
    deepStrictEqual(rpcCalls, [true, false]);

    const alerts = await listAlertsForOwner(
      owner,
      { unreadOnly: true },
      async <T>(table: string): Promise<T> => {
        if (table === "alerts") {
          return [
            {
              id: "alert-1",
              severity: "danger",
              title: "Falha",
              message: "Falha na operação",
              created_at: "2026-08-31T12:00:00.000Z",
              read: false,
            },
          ] as T;
        }
        if (table === "alert_acknowledgements") {
          return [
            {
              alert_id: "alert-1",
              read: persistedRead,
              read_at: null,
            },
          ] as T;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    );
    strictEqual(alerts.length, 1);
    strictEqual(alerts[0]?.read, false);
  });
});