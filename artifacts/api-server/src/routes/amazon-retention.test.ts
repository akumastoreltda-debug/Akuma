import { deepStrictEqual, strictEqual } from "node:assert";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  pruneInactiveAmazonConnectionTestHistory,
  type AmazonRetentionRequest,
} from "./amazon-retention";
import {
  AMAZON_RETENTION_MIGRATION,
  checkAmazonRetentionSchema,
  supabaseRequest,
  type SupabaseOptions,
} from "../lib/supabase";

type Row = Record<string, unknown>;
type HistoryRow = {
  id: string;
  owner_clerk_id: string;
  tested_at: string;
  expired: boolean;
};

const runSupabaseIntegrationTests =
  process.env.RUN_SUPABASE_INTEGRATION_TESTS === "1";
const hasSupabaseConfig = Boolean(
  process.env.SUPABASE_URL?.trim() &&
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
);

async function assertAmazonRetentionSchemaReady(): Promise<void> {
  const check = await checkAmazonRetentionSchema();
  if (check.complete) return;

  if (check.unavailable) {
    throw new Error(
      `Não foi possível consultar o schema remoto do Supabase antes do cenário de retenção. ` +
        `Isso indica falha de credencial ou indisponibilidade temporária; ` +
        `confirme o projeto configurado e tente novamente. ` +
        `${check.diagnostic ?? ""}`.trim(),
    );
  }

  throw new Error(
    `O schema remoto do Supabase está incompleto antes do cenário de retenção. ` +
      `Aplique a migration ${AMAZON_RETENTION_MIGRATION} por um canal SQL autorizado ` +
      `e tente novamente. Funções ausentes: ${check.missingFunctions.join(", ")}.`,
  );
}

function createRetentionLogger() {
  const warnings: Array<{ context: Row; message: string }> = [];
  const infos: Array<{ context: Row; message: string }> = [];
  return {
    warnings,
    infos,
    logger: {
      warn: (context: Row, message: string) =>
        warnings.push({ context, message }),
      info: (context: Row, message: string) => infos.push({ context, message }),
    },
  };
}

describe("Amazon connection test history retention", () => {
  it("detects missing migration 0005 functions without invoking a retention RPC", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const requestedUrls: string[] = [];
    process.env.SUPABASE_URL = "https://supabase.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/rpc/")) {
        throw new Error("Retention preflight must not invoke RPCs");
      }
      requestedUrls.push(url);
      return new Response(
        JSON.stringify({
          paths: {
            "/rpc/acquire_amazon_retention_lock": {},
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const check = await checkAmazonRetentionSchema();

      strictEqual(requestedUrls[0], "https://supabase.example.test/rest/v1/");
      strictEqual(check.complete, false);
      strictEqual(check.unavailable, false);
      deepStrictEqual(check.missingFunctions, [
        "release_amazon_retention_lock",
        "prune_amazon_connection_tests",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = originalUrl;
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  it("reports remote Supabase unavailability separately and redacts credentials", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const serviceRoleKey = "test-service-role-key";
    process.env.SUPABASE_URL = "https://supabase.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
    globalThis.fetch = async () => {
      throw new Error(`Supabase rejected ${serviceRoleKey}`);
    };

    try {
      const check = await checkAmazonRetentionSchema();

      strictEqual(check.complete, false);
      strictEqual(check.unavailable, true);
      deepStrictEqual(check.missingFunctions, []);
      strictEqual(check.diagnostic?.includes(serviceRoleKey), false);
      strictEqual(check.diagnostic?.includes("[redacted]"), true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = originalUrl;
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  it("classifies unauthorized schema responses as invalid credentials", async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = "https://supabase.example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Invalid JWT" }), { status: 401 });

    try {
      const check = await checkAmazonRetentionSchema();

      strictEqual(check.complete, false);
      strictEqual(check.unavailable, true);
      strictEqual(check.failureReason, "invalid_credentials");
      deepStrictEqual(check.missingFunctions, []);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = originalUrl;
      if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  it("removes expired history per owner while preserving recent history", async () => {
    const rows: HistoryRow[] = [
      {
        id: "owner-1-expired",
        owner_clerk_id: "owner-1",
        tested_at: "2026-01-01T00:00:00.000Z",
        expired: true,
      },
      {
        id: "owner-1-recent",
        owner_clerk_id: "owner-1",
        tested_at: "2026-08-30T00:00:00.000Z",
        expired: false,
      },
      {
        id: "owner-2-expired",
        owner_clerk_id: "owner-2",
        tested_at: "2026-01-02T00:00:00.000Z",
        expired: true,
      },
      {
        id: "owner-2-recent",
        owner_clerk_id: "owner-2",
        tested_at: "2026-08-29T00:00:00.000Z",
        expired: false,
      },
    ];
    const rpcOwners: string[] = [];
    const retentionLog = createRetentionLogger();
    const request: AmazonRetentionRequest = async <T>(
      table: string,
      options: SupabaseOptions = {},
    ) => {
      if (table === "amazon_connection_tests") {
        strictEqual(options.query?.limit, 1000);
        return rows.filter((row) => row.expired) as T;
      }
      if (table === "rpc/acquire_amazon_retention_lock") {
        strictEqual(options.method, "POST");
        strictEqual((options.body as Row).p_ttl_seconds, 3600);
        return true as T;
      }
      if (table === "rpc/release_amazon_retention_lock") {
        strictEqual(options.method, "POST");
        strictEqual(typeof (options.body as Row).p_lock_token, "string");
        return undefined as T;
      }
      strictEqual(table, "rpc/prune_amazon_connection_tests");
      strictEqual(options.method, "POST");
      strictEqual((options.body as Row).p_retention_days, 90);
      strictEqual((options.body as Row).p_max_rows, 1000);
      const owner = String((options.body as Row).p_owner_clerk_id);
      rpcOwners.push(owner);
      const ownerRows = rows.filter((row) => row.owner_clerk_id === owner);
      const retainedIds = new Set(
        [...ownerRows]
          .sort((left, right) => right.tested_at.localeCompare(left.tested_at))
          .slice(0, Number((options.body as Row).p_max_rows))
          .map((row) => row.id),
      );
      const before = rows.length;
      rows.splice(
        0,
        rows.length,
        ...rows.filter((row) => retainedIds.has(row.id) || !row.expired),
      );
      return (before - rows.length) as T;
    };

    await pruneInactiveAmazonConnectionTestHistory(
      request,
      retentionLog.logger,
    );

    strictEqual(rows.length, 2);
    deepStrictEqual(
      rows.map((row) => row.id),
      ["owner-1-recent", "owner-2-recent"],
    );
    deepStrictEqual(rpcOwners, ["owner-1", "owner-2"]);
    strictEqual(retentionLog.warnings.length, 0);
    strictEqual(retentionLog.infos[0]?.context.candidatesScanned, 2);
    strictEqual(retentionLog.infos[0]?.context.ownersProcessed, 2);
    strictEqual(retentionLog.infos[0]?.context.deletedCount, 2);
  });

  it("skips the scan when another instance owns the distributed lock", async () => {
    const calls: string[] = [];
    const retentionLog = createRetentionLogger();
    const request: AmazonRetentionRequest = async <T>(table: string) => {
      calls.push(table);
      if (table === "rpc/acquire_amazon_retention_lock") return false as T;
      throw new Error(`Unexpected table: ${table}`);
    };

    await pruneInactiveAmazonConnectionTestHistory(
      request,
      retentionLog.logger,
    );

    deepStrictEqual(calls, ["rpc/acquire_amazon_retention_lock"]);
    strictEqual(retentionLog.warnings.length, 0);
    strictEqual(
      retentionLog.infos[0]?.message,
      "Skipped periodic Amazon connection test history retention because another instance is running",
    );
  });

  it("limits candidate scanning and owner processing, then continues after an owner failure", async () => {
    const rows: HistoryRow[] = Array.from({ length: 1001 }, (_, index) => ({
      id: `expired-${index}`,
      owner_clerk_id: `owner-${index}`,
      tested_at: "2026-01-01T00:00:00.000Z",
      expired: true,
    }));
    const rpcOwners: string[] = [];
    const retentionLog = createRetentionLogger();
    const request: AmazonRetentionRequest = async <T>(
      table: string,
      options: SupabaseOptions = {},
    ) => {
      if (table === "amazon_connection_tests") {
        strictEqual(options.query?.limit, 1000);
        return rows
          .filter((row) => row.expired)
          .slice(0, Number(options.query?.limit)) as T;
      }
      if (table === "rpc/acquire_amazon_retention_lock") {
        strictEqual(options.method, "POST");
        return true as T;
      }
      if (table === "rpc/release_amazon_retention_lock") {
        strictEqual(options.method, "POST");
        return undefined as T;
      }
      strictEqual(table, "rpc/prune_amazon_connection_tests");
      const body = options.body as Row;
      strictEqual(options.method, "POST");
      strictEqual(body.p_retention_days, 90);
      strictEqual(body.p_max_rows, 1000);
      const owner = String(body.p_owner_clerk_id);
      rpcOwners.push(owner);
      if (owner === "owner-1") throw new Error("owner cleanup unavailable");
      return 1 as T;
    };

    await pruneInactiveAmazonConnectionTestHistory(
      request,
      retentionLog.logger,
    );

    strictEqual(rpcOwners.length, 100);
    strictEqual(rpcOwners[0], "owner-0");
    strictEqual(rpcOwners[1], "owner-1");
    strictEqual(rpcOwners[99], "owner-99");
    strictEqual(retentionLog.warnings.length, 1);
    strictEqual(
      retentionLog.warnings[0]?.message,
      "Failed to prune inactive Amazon connection test history for owner",
    );
    strictEqual(retentionLog.warnings[0]?.context.ownerBatchPosition, 2);
    strictEqual(retentionLog.infos[0]?.context.candidatesScanned, 1000);
    strictEqual(retentionLog.infos[0]?.context.ownersProcessed, 100);
    strictEqual(retentionLog.infos[0]?.context.failedOwners, 1);
    strictEqual(retentionLog.infos[0]?.context.deletedCount, 99);
  });

  it("releases the distributed lock when the owner scan fails", async () => {
    const calls: string[] = [];
    const retentionLog = createRetentionLogger();
    const request: AmazonRetentionRequest = async <T>(table: string) => {
      calls.push(table);
      if (table === "rpc/acquire_amazon_retention_lock") return true as T;
      if (table === "amazon_connection_tests") {
        throw new Error("history unavailable");
      }
      if (table === "rpc/release_amazon_retention_lock") return undefined as T;
      throw new Error(`Unexpected table: ${table}`);
    };

    await pruneInactiveAmazonConnectionTestHistory(
      request,
      retentionLog.logger,
    );

    deepStrictEqual(calls, [
      "rpc/acquire_amazon_retention_lock",
      "amazon_connection_tests",
      "rpc/release_amazon_retention_lock",
    ]);
    strictEqual(retentionLog.warnings.length, 1);
    strictEqual(
      retentionLog.warnings[0]?.message,
      "Failed to scan inactive Amazon connection test history",
    );
  });

  it(
    "reacquires an expired lock without allowing the old token to release it",
    {
      skip:
        !runSupabaseIntegrationTests || !hasSupabaseConfig
          ? "Set RUN_SUPABASE_INTEGRATION_TESTS=1 with the Supabase project credentials to run against the migration database"
          : false,
    },
    async () => {
      await assertAmazonRetentionSchemaReady();

      const oldToken = `task45-old-${randomUUID()}`;
      const newToken = `task45-new-${randomUUID()}`;

      let firstAcquisition = false;
      try {
        firstAcquisition = await supabaseRequest<boolean>(
          "rpc/acquire_amazon_retention_lock",
          {
            method: "POST",
            body: {
              p_lock_token: oldToken,
              p_ttl_seconds: 1,
            },
          },
        );
        strictEqual(firstAcquisition, true);

        await new Promise((resolve) => setTimeout(resolve, 1200));

        const reacquired = await supabaseRequest<boolean>(
          "rpc/acquire_amazon_retention_lock",
          {
            method: "POST",
            body: {
              p_lock_token: newToken,
              p_ttl_seconds: 60,
            },
          },
        );
        strictEqual(reacquired, true);

        await supabaseRequest("rpc/release_amazon_retention_lock", {
          method: "POST",
          body: { p_lock_token: oldToken },
        });

        const currentLocks = await supabaseRequest<
          Array<{ lock_token: string }>
        >("amazon_retention_locks", {
          query: {
            select: "lock_token",
            lock_name: "eq.amazon_connection_test_history",
          },
        });
        strictEqual(currentLocks.length, 1);
        strictEqual(currentLocks[0]?.lock_token, newToken);
      } finally {
        if (firstAcquisition) {
          await supabaseRequest("rpc/release_amazon_retention_lock", {
            method: "POST",
            body: { p_lock_token: newToken },
          });
          await supabaseRequest("rpc/release_amazon_retention_lock", {
            method: "POST",
            body: { p_lock_token: oldToken },
          });
        }
      }
    },
  );
});
