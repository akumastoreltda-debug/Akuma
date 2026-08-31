import { supabaseRequest } from "../lib/supabase";
import type { AmazonSmokeCheck } from "../lib/amazon-sp-api";

export async function persistAmazonConnectionTest(
  ownerClerkId: string,
  testedAt: string,
  durationMs: number,
  checks: AmazonSmokeCheck[],
  request: typeof supabaseRequest = supabaseRequest,
  onPruneFailure: (error: unknown) => void = () => undefined,
) {
  await request("amazon_connection_tests", {
    method: "POST",
    returnRepresentation: true,
    body: {
      owner_clerk_id: ownerClerkId,
      tested_at: testedAt,
      duration_ms: Math.max(0, Math.trunc(durationMs)),
      success: checks.every((check) => check.status === "completed"),
      checks: checks.map((check) => ({
        type: check.type,
        status: check.status,
        count: check.count,
        durationMs: check.durationMs,
        errorCategory: check.errorCategory,
        error: check.error,
      })),
    },
  });

  try {
    await request<number>("rpc/prune_amazon_connection_tests", {
      method: "POST",
      body: {
        p_owner_clerk_id: ownerClerkId,
        p_retention_days: 90,
        p_max_rows: 1000,
      },
    });
  } catch (error) {
    onPruneFailure(error);
  }
}