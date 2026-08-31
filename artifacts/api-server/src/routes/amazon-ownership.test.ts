import { rejects, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseOptions } from "../lib/supabase";
import { ensureAmazonOwner } from "./amazon";

type Row = Record<string, unknown>;
type MockRequest = <T>(table: string, options?: SupabaseOptions) => Promise<T>;

function createConnectionStore(): {
  rows: Row[];
  request: MockRequest;
} {
  const rows: Row[] = [];
  const request: MockRequest = async <T>(
    table: string,
    options: SupabaseOptions = {},
  ) => {
    if (table !== "amazon_connections") throw new Error(`Unexpected table: ${table}`);
    if (options.method === "POST") {
      const body = options.body as Row;
      if (rows.some((row) => row.id === body.id)) {
        if (options.prefer?.includes("ignore-duplicates")) return [] as T;
        throw new Error("Supabase request failed (409): duplicate key");
      }
      rows.push({ ...body, created_at: new Date().toISOString() });
      return [body] as T;
    }

    return rows
      .slice()
      .sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)))
      .slice(0, Number(options.query?.limit ?? 1)) as T;
  };
  return { rows, request };
}

describe("Amazon single-tenant ownership", () => {
  it("registers the first owner and refuses a different authenticated user", async () => {
    const store = createConnectionStore();

    await ensureAmazonOwner("owner-1", store.request);
    await ensureAmazonOwner("owner-1", store.request);
    await rejects(
      ensureAmazonOwner("owner-2", store.request),
      /já está vinculada a outro usuário/,
    );

    strictEqual(store.rows.length, 1);
    strictEqual(store.rows[0]?.owner_clerk_id, "owner-1");
    strictEqual(store.rows[0]?.id, "00000000-0000-0000-0000-000000000001");
  });

  it("allows exactly one winner when two replicas claim an empty table concurrently", async () => {
    const store = createConnectionStore();
    let emptyReads = 0;
    let releaseReads: (() => void) | undefined;
    const bothReadEmpty = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const request: MockRequest = async <T>(
      table: string,
      options: SupabaseOptions = {},
    ) => {
      if (options.method !== "POST" && store.rows.length === 0 && emptyReads < 2) {
        emptyReads += 1;
        if (emptyReads === 2) releaseReads?.();
        await bothReadEmpty;
      }
      return store.request<T>(table, options);
    };

    const results = await Promise.allSettled([
      ensureAmazonOwner("owner-1", request),
      ensureAmazonOwner("owner-2", request),
    ]);

    strictEqual(store.rows.length, 1);
    strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    strictEqual(results.filter((result) => result.status === "rejected").length, 1);
    strictEqual(["owner-1", "owner-2"].includes(String(store.rows[0]?.owner_clerk_id)), true);
  });
});