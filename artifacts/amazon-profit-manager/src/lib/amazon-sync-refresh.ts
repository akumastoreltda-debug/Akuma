import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  getGetAmazonStatusQueryKey,
  getGetDashboardSummaryQueryKey,
  getListAmazonSyncRunsQueryKey,
  getListInventoryQueryKey,
  getListProductsQueryKey,
  getListSalesQueryKey,
} from "@workspace/api-client-react";

/**
 * Queries whose data is written by an Amazon synchronization.
 *
 * The base keys intentionally invalidate parameterized list queries too, so
 * filters already open in another panel do not keep showing pre-sync data.
 */
export const amazonSyncRefreshQueryKeys: readonly QueryKey[] = [
  getGetAmazonStatusQueryKey(),
  getListAmazonSyncRunsQueryKey(),
  getGetDashboardSummaryQueryKey(),
  getListProductsQueryKey(),
  getListSalesQueryKey(),
  getListInventoryQueryKey(),
];

export async function refreshAmazonSyncQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    amazonSyncRefreshQueryKeys.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
        refetchType: "all",
      }),
    ),
  );
}