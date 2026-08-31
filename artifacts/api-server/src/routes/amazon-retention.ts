import {
  toNumber,
  type SupabaseOptions,
  type supabaseRequest,
} from "../lib/supabase";
import { randomUUID } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type AmazonRetentionRequest = <T>(
  table: string,
  options?: SupabaseOptions,
) => Promise<T>;

export type AmazonRetentionLogger = {
  warn: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
};

const AMAZON_TEST_RETENTION_DAYS = 90;
const AMAZON_TEST_MAX_ROWS = 1000;
const AMAZON_TEST_RETENTION_OWNER_BATCH_SIZE = 100;
const AMAZON_TEST_RETENTION_SCAN_LIMIT = 1000;
const AMAZON_TEST_RETENTION_LOCK_TTL_SECONDS = 60 * 60;

let amazonConnectionTestRetentionRunning = false;

export async function pruneInactiveAmazonConnectionTestHistory(
  request: AmazonRetentionRequest,
  retentionLogger: AmazonRetentionLogger,
): Promise<void> {
  if (amazonConnectionTestRetentionRunning) return;
  amazonConnectionTestRetentionRunning = true;
  const lockToken = randomUUID();
  let distributedLockAcquired = false;

  try {
    distributedLockAcquired = await request<boolean>(
      "rpc/acquire_amazon_retention_lock",
      {
        method: "POST",
        body: {
          p_lock_token: lockToken,
          p_ttl_seconds: AMAZON_TEST_RETENTION_LOCK_TTL_SECONDS,
        },
      },
    );
    if (!distributedLockAcquired) {
      retentionLogger.info(
        {},
        "Skipped periodic Amazon connection test history retention because another instance is running",
      );
      return;
    }

    const cutoff = new Date(
      Date.now() - AMAZON_TEST_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const candidates = await request<JsonRecord[]>("amazon_connection_tests", {
      query: {
        select: "owner_clerk_id,tested_at",
        tested_at: `lt.${cutoff}`,
        order: "tested_at.asc,id.asc",
        limit: AMAZON_TEST_RETENTION_SCAN_LIMIT,
      },
    });
    const owners = [
      ...new Set(
        candidates
          .map((candidate) => String(candidate.owner_clerk_id ?? "").trim())
          .filter(Boolean),
      ),
    ].slice(0, AMAZON_TEST_RETENTION_OWNER_BATCH_SIZE);

    let deletedCount = 0;
    let failedOwners = 0;
    for (const [ownerIndex, ownerClerkId] of owners.entries()) {
      try {
        const deleted = await request<number>(
          "rpc/prune_amazon_connection_tests",
          {
            method: "POST",
            body: {
              p_owner_clerk_id: ownerClerkId,
              p_retention_days: AMAZON_TEST_RETENTION_DAYS,
              p_max_rows: AMAZON_TEST_MAX_ROWS,
            },
          },
        );
        deletedCount += toNumber(deleted);
      } catch (error) {
        failedOwners += 1;
        retentionLogger.warn(
          { err: error, ownerBatchPosition: ownerIndex + 1 },
          "Failed to prune inactive Amazon connection test history for owner",
        );
      }
    }

    retentionLogger.info(
      {
        candidatesScanned: candidates.length,
        ownersProcessed: owners.length,
        failedOwners,
        deletedCount,
      },
      "Completed periodic Amazon connection test history retention",
    );
  } catch (error) {
    retentionLogger.warn(
      { err: error },
      "Failed to scan inactive Amazon connection test history",
    );
  } finally {
    if (distributedLockAcquired) {
      try {
        await request("rpc/release_amazon_retention_lock", {
          method: "POST",
          body: { p_lock_token: lockToken },
        });
      } catch (error) {
        retentionLogger.warn(
          { err: error },
          "Failed to release Amazon connection test history retention lock",
        );
      }
    }
    amazonConnectionTestRetentionRunning = false;
  }
}
