import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import express, { type RequestHandler } from "express";
import { request as httpRequest } from "node:http";
import {
  createAmazonSyncRouter,
  amazonOwnerTransferAuditCsv,
  type AmazonOwnerTransferResult,
} from "./amazon";
import type { SupabaseOptions } from "../lib/supabase";

type Row = Record<string, unknown>;
type MockRequest = <T>(table: string, options?: SupabaseOptions) => Promise<T>;

function authMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

async function requestJson(
  app: express.Express,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Row }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");

  try {
    return await new Promise((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port: address.port, path, method, headers: body ? { "content-type": "application/json" } : undefined },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { data += chunk; });
          response.on("end", () => {
            try {
              resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) as Row });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", reject);
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function requestText(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");

  try {
    return await new Promise((resolve, reject) => {
      const request = httpRequest(
        { hostname: "127.0.0.1", port: address.port, path, method: "GET" },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { data += chunk; });
          response.on("end", () => resolve({
            status: response.statusCode ?? 0,
            body: data,
            headers: response.headers,
          }));
        },
      );
      request.on("error", reject);
      request.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function appForTransfer(
  actorClerkId: string,
  request: MockRequest,
  isAdmin: (clerkId: string) => boolean,
  validateTarget: (clerkId: string) => Promise<boolean> = async () => true,
) {
  const app = express();
  app.use(express.json());
  app.use(
    createAmazonSyncRouter({
      requireAuth: authMiddleware(),
      getAuthenticatedUserId: () => actorClerkId,
      isAmazonTransferAdmin: isAdmin,
      validateAmazonTransferTarget: validateTarget,
      supabaseRequest: request,
    }),
  );
  return app;
}

describe("Amazon administrative owner transfer", () => {
  it("rejects audit history access for a non-administrator before reading audit data", async () => {
    let reads = 0;
    const app = appForTransfer(
      "regular-user",
      async <T>() => {
        reads += 1;
        return [] as T;
      },
      () => false,
    );

    const response = await requestJson(app, "GET", "/amazon/owner-transfer/audit");

    strictEqual(response.status, 403);
    strictEqual(reads, 0);
  });

  it("returns only the newest explicitly selected audit fields for administrators", async () => {
    const auditRows = [
      {
        id: "audit-2",
        actor_clerk_id: "admin-2",
        previous_owner_clerk_id: "owner-2",
        new_owner_clerk_id: "owner-3",
        reason: "Troca mais recente autorizada pelo suporte",
        transferred_at: "2026-08-31T14:00:00.000Z",
        internal_only_value: "must not be returned",
      },
      {
        id: "audit-1",
        actor_clerk_id: "admin-1",
        previous_owner_clerk_id: "owner-1",
        new_owner_clerk_id: "owner-2",
        reason: "Troca anterior autorizada pelo suporte",
        transferred_at: "2026-08-31T12:00:00.000Z",
      },
    ];
    let requestOptions: SupabaseOptions | undefined;
    const request: MockRequest = async <T>(table: string, options: SupabaseOptions = {}) => {
      strictEqual(table, "amazon_owner_transfer_audit");
      requestOptions = options;
      return auditRows as T;
    };
    const app = appForTransfer("admin-1", request, (id) => id === "admin-1");

    const response = await requestJson(app, "GET", "/amazon/owner-transfer/audit");

    strictEqual(response.status, 200);
    deepStrictEqual(requestOptions?.query, {
      select: "id,actor_clerk_id,previous_owner_clerk_id,new_owner_clerk_id,reason,transferred_at",
      order: "transferred_at.desc,id.desc",
      limit: 20,
    });
    deepStrictEqual(response.body, [
      {
        id: "audit-2",
        actorClerkId: "admin-2",
        previousOwnerClerkId: "owner-2",
        newOwnerClerkId: "owner-3",
        reason: "Troca mais recente autorizada pelo suporte",
        transferredAt: "2026-08-31T14:00:00.000Z",
      },
      {
        id: "audit-1",
        actorClerkId: "admin-1",
        previousOwnerClerkId: "owner-1",
        newOwnerClerkId: "owner-2",
        reason: "Troca anterior autorizada pelo suporte",
        transferredAt: "2026-08-31T12:00:00.000Z",
      },
    ]);
  });

  it("rejects audit CSV export for a non-administrator before reading audit data", async () => {
    let reads = 0;
    const app = appForTransfer(
      "regular-user",
      async <T>() => {
        reads += 1;
        return [] as T;
      },
      () => false,
    );

    const response = await requestText(app, "/amazon/owner-transfer/audit/export");

    strictEqual(response.status, 403);
    strictEqual(reads, 0);
  });

  it("exports the limited audit fields with an explicit UTC generation timestamp", async () => {
    const auditRows = [
      {
        id: "audit-2",
        actor_clerk_id: "admin-2",
        previous_owner_clerk_id: "owner-2",
        new_owner_clerk_id: "owner-3",
        reason: "Motivo com vírgula, aspas \"e\" quebra de linha\npreservada",
        transferred_at: "2026-08-31T14:00:00.000Z",
        internal_only_value: "must not be returned",
      },
    ];
    const request: MockRequest = async <T>(table: string) => {
      strictEqual(table, "amazon_owner_transfer_audit");
      return auditRows as T;
    };
    const app = appForTransfer("admin-1", request, (id) => id === "admin-1");

    const response = await requestText(app, "/amazon/owner-transfer/audit/export");

    strictEqual(response.status, 200);
    strictEqual(response.headers["content-type"], "text/csv; charset=utf-8");
    strictEqual(response.headers["cache-control"], "no-store");
    strictEqual(typeof response.headers["content-disposition"], "string");
    strictEqual(typeof response.headers["x-generated-at"], "string");
    strictEqual(response.body.startsWith("\uFEFF\"Relatório\",\"Histórico de transferências Amazon\""), true);
    strictEqual(response.body.includes("\"Data de geração (UTC)\","), true);
    strictEqual(response.body.includes("\"id\",\"actorClerkId\",\"previousOwnerClerkId\",\"newOwnerClerkId\",\"reason\",\"transferredAt\""), true);
    strictEqual(response.body.includes("\"internal_only_value\""), false);
    strictEqual(response.body.includes("\"Motivo com vírgula, aspas \"\"e\"\" quebra de linha\npreservada\""), true);
  });

  it("quotes CSV metadata and audit values without exposing additional fields", () => {
    const csv = amazonOwnerTransferAuditCsv([
      {
        id: "audit-1",
        actorClerkId: "admin-1",
        previousOwnerClerkId: "owner-1",
        newOwnerClerkId: "owner-2",
        reason: "reason",
        transferredAt: "2026-08-31T12:00:00.000Z",
      },
    ], "2026-08-31T15:00:00.000Z");

    strictEqual(csv.includes("\"Data de geração (UTC)\",\"2026-08-31T15:00:00.000Z\""), true);
    strictEqual(csv.includes("\"admin-1\""), true);
    strictEqual(csv.includes("tenant"), false);
    strictEqual(csv.includes("credential"), false);
  });

  it("rejects an authenticated non-administrator before reading tenant data", async () => {
    let reads = 0;
    const app = appForTransfer(
      "regular-user",
      async <T>() => {
        reads += 1;
        return [] as T;
      },
      () => false,
    );

    const response = await requestJson(app, "POST", "/amazon/owner-transfer", {
      currentOwnerClerkId: "owner-1",
      newOwnerClerkId: "owner-2",
      reason: "Troca autorizada pelo suporte",
    });

    strictEqual(response.status, 403);
    strictEqual(reads, 0);
  });

  it("validates the body and current owner before invoking the transfer RPC", async () => {
    let rpcCalls = 0;
    const request: MockRequest = async <T>(table: string, options: SupabaseOptions = {}) => {
      if (table === "amazon_connections") return [{ owner_clerk_id: "owner-1" }] as T;
      if (table === "rpc/transfer_amazon_owner" && options.method === "POST") {
        rpcCalls += 1;
      }
      throw new Error(`Unexpected request: ${table}`);
    };
    const app = appForTransfer("admin-1", request, (id) => id === "admin-1");

    const malformed = await requestJson(app, "POST", "/amazon/owner-transfer", {
      currentOwnerClerkId: "owner-1",
      newOwnerClerkId: "owner-2",
      reason: "curto",
    });
    strictEqual(malformed.status, 400);

    const staleOwner = await requestJson(app, "POST", "/amazon/owner-transfer", {
      currentOwnerClerkId: "owner-stale",
      newOwnerClerkId: "owner-2",
      reason: "Troca autorizada pelo suporte",
    });
    strictEqual(staleOwner.status, 409);
    strictEqual(rpcCalls, 0);
  });

  it("returns the audited transfer returned by the transactional RPC", async () => {
    const audit: AmazonOwnerTransferResult = {
      id: "audit-1",
      actorClerkId: "admin-1",
      previousOwnerClerkId: "owner-1",
      newOwnerClerkId: "owner-2",
      reason: "Troca autorizada pelo suporte",
      transferredAt: "2026-08-31T12:00:00.000Z",
    };
    let rpcBody: Row | undefined;
    const request: MockRequest = async <T>(table: string, options: SupabaseOptions = {}) => {
      if (table === "amazon_connections") return [{ owner_clerk_id: "owner-1" }] as T;
      if (table === "rpc/transfer_amazon_owner" && options.method === "POST") {
        rpcBody = options.body as Row;
        return [{
          id: audit.id,
          actor_clerk_id: audit.actorClerkId,
          previous_owner_clerk_id: audit.previousOwnerClerkId,
          new_owner_clerk_id: audit.newOwnerClerkId,
          reason: audit.reason,
          transferred_at: audit.transferredAt,
        }] as T;
      }
      throw new Error(`Unexpected request: ${table}`);
    };
    const app = appForTransfer("admin-1", request, (id) => id === "admin-1");

    const response = await requestJson(app, "POST", "/amazon/owner-transfer", {
      currentOwnerClerkId: "owner-1",
      newOwnerClerkId: "owner-2",
      reason: audit.reason,
    });

    strictEqual(response.status, 200);
    deepStrictEqual(response.body, audit);
    deepStrictEqual(rpcBody, {
      p_actor_clerk_id: "admin-1",
      p_current_owner_clerk_id: "owner-1",
      p_new_owner_clerk_id: "owner-2",
      p_reason: audit.reason,
    });
  });

  it("rejects a Clerk ID that does not resolve to an existing user", async () => {
    let rpcCalls = 0;
    const request: MockRequest = async <T>(table: string, options: SupabaseOptions = {}) => {
      if (table === "amazon_connections") return [{ owner_clerk_id: "owner-1" }] as T;
      if (table === "rpc/transfer_amazon_owner" && options.method === "POST") rpcCalls += 1;
      throw new Error(`Unexpected request: ${table}`);
    };
    const app = appForTransfer("admin-1", request, (id) => id === "admin-1", async () => false);

    const response = await requestJson(app, "POST", "/amazon/owner-transfer", {
      currentOwnerClerkId: "owner-1",
      newOwnerClerkId: "missing-user",
      reason: "Troca autorizada pelo suporte",
    });

    strictEqual(response.status, 400);
    strictEqual(rpcCalls, 0);
  });
});