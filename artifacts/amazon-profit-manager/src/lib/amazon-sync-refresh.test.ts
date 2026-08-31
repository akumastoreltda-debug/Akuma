import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryOptions,
  getGetAmazonStatusQueryKey,
  getGetDashboardSummaryQueryKey,
  getListInventoryQueryOptions,
  getListAlertsQueryKey,
  getListAmazonSyncRunsQueryKey,
  getListInventoryQueryKey,
  getListProductsQueryOptions,
  getListProductsQueryKey,
  getListSalesQueryOptions,
  getListSalesQueryKey,
} from "@workspace/api-client-react";
import { ClerkProvider } from "@clerk/react";
import { Router as WouterRouter } from "wouter";
import Dashboard from "../pages/dashboard";
import Products from "../pages/products";
import Sales from "../pages/sales";
import Inventory from "../pages/inventory";
import { refreshAmazonSyncQueries } from "./amazon-sync-refresh";

type Fixture = {
  queryKey: readonly unknown[];
  failed: unknown;
  recovered: unknown;
};

describe("Amazon sync query refresh", () => {
  it("updates status, history, and filtered dashboard readings after recovery", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    let recovered = false;
    const fixtures: Fixture[] = [
      {
        queryKey: getGetAmazonStatusQueryKey(),
        failed: { connectionStatus: "error", lastError: "token expirado" },
        recovered: { connectionStatus: "connected", lastError: null },
      },
      {
        queryKey: getListAmazonSyncRunsQueryKey(),
        failed: [{ id: "run-failed", status: "failed", counts: { orders: 0 } }],
        recovered: [{ id: "run-recovered", status: "completed", counts: { orders: 12 } }],
      },
      {
        queryKey: getGetDashboardSummaryQueryKey(),
        failed: { totalRevenue: 0, totalProfit: 0 },
        recovered: { totalRevenue: 1250, totalProfit: 310 },
      },
      {
        queryKey: getListProductsQueryKey(),
        failed: [{ sku: "SKU-RECOVERY", stock: 0 }],
        recovered: [{ sku: "SKU-RECOVERY", stock: 12 }],
      },
      {
        queryKey: getListSalesQueryKey({ search: "SKU-RECOVERY" }),
        failed: [],
        recovered: [{ sku: "SKU-RECOVERY", quantity: 3 }],
      },
      {
        queryKey: getListInventoryQueryKey({ search: "SKU-RECOVERY" }),
        failed: [{ sku: "SKU-RECOVERY", available: 0 }],
        recovered: [{ sku: "SKU-RECOVERY", available: 12 }],
      },
    ];

    await Promise.all(
      fixtures.map(async ({ queryKey, failed, recovered: recoveredData }) => {
        await queryClient.fetchQuery({
          queryKey,
          queryFn: async () => (recovered ? recoveredData : failed),
        });
      }),
    );
    strictEqual(queryClient.getQueryData(getGetAmazonStatusQueryKey())?.connectionStatus, "error");
    deepStrictEqual(
      queryClient.getQueryData(getListInventoryQueryKey({ search: "SKU-RECOVERY" })),
      [{ sku: "SKU-RECOVERY", available: 0 }],
    );

    recovered = true;

    await refreshAmazonSyncQueries(queryClient);

    for (const fixture of fixtures) {
      strictEqual(
        JSON.stringify(queryClient.getQueryData(fixture.queryKey)),
        JSON.stringify(fixture.recovered),
        `expected ${JSON.stringify(fixture.queryKey)} to show recovered data`,
      );
    }
  });

  it("shows recovered values on every opened page without a browser reload", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const recoveredPages = [
      {
        path: "/dashboard",
        queryKey: getGetDashboardSummaryQueryKey(),
        recovered: {
          metrics: [
            { label: "Receita recuperada", value: "R$ 12.500", change: "+18%", tone: "positive" },
            { label: "Lucro recuperado", value: "R$ 3.100", change: "+22%", tone: "positive" },
          ],
          chart: [{ label: "Jun", revenue: 12500, profit: 3100 }],
          periodLabel: "Período recuperado",
          unreadAlertsCount: 0,
          recentAlerts: [],
          productSales: [],
          mostProfitable: [],
        },
        render: () => React.createElement(Dashboard),
        marker: "R$ 12.500",
      },
      {
        path: "/products",
        queryKey: getListProductsQueryKey({ search: undefined, status: undefined }),
        recovered: [{
          id: "product-recovered",
          name: "Produto recuperado",
          sku: "SKU-RECUPERADO",
          asin: "B0RECUPERADO",
          status: "healthy",
          salePrice: 149.9,
          currentCost: 70,
          availableStock: 42,
          reservedStock: 3,
          daysOfCover: 21,
          dailyAverage: 2,
          minimumMargin: 15,
        }],
        render: () => React.createElement(Products),
        marker: "Produto recuperado",
      },
      {
        path: "/sales",
        queryKey: getListSalesQueryKey({ search: undefined, from: undefined, to: undefined }),
        recovered: [{
          id: "sale-recovered",
          soldAt: "2025-06-18T12:00:00.000Z",
          amazonOrderNumber: "701-RECUPERADO",
          productName: "Venda recuperada",
          sku: "SKU-RECUPERADO",
          quantity: 4,
          revenueTotal: 599.6,
          fbaFee: 30,
          commission: 60,
          otherFees: 5,
          productCost: 280,
          netProfit: 224.6,
          netMargin: 37.45,
        }],
        render: () => React.createElement(Sales),
        marker: "701-RECUPERADO",
      },
      {
        path: "/inventory",
        queryKey: getListInventoryQueryKey({ search: undefined, risk: undefined }),
        recovered: [{
          id: "inventory-recovered",
          productName: "Estoque recuperado",
          sku: "SKU-RECUPERADO",
          asin: "B0RECUPERADO",
          available: 42,
          reserved: 3,
          inbound: 10,
          total: 55,
          coverageDays: 21,
          status: "healthy",
          lastSyncedAt: "2025-06-18T12:00:00.000Z",
        }],
        render: () => React.createElement(Inventory),
        marker: "Estoque recuperado",
      },
    ] as const;

    // AppShell also queries the unread alert badge whenever a page is opened.
    queryClient.setQueryData(getListAlertsQueryKey({ unreadOnly: true }), []);

    let recovered = false;
    let refetchCount = 0;
    await Promise.all(
      recoveredPages.map(async ({ queryKey, recovered: recoveredData }) => {
        try {
          await queryClient.fetchQuery({
            queryKey,
            queryFn: async () => {
              if (!recovered) throw new Error("API indisponível durante a sincronização");
              refetchCount += 1;
              return recoveredData;
            },
          });
        } catch {
          // The first pass intentionally models the failed synchronization.
        }
      }),
    );
    for (const page of recoveredPages) {
      strictEqual(queryClient.getQueryState(page.queryKey)?.status, "error");
    }

    recovered = true;
    await refreshAmazonSyncQueries(queryClient);
    strictEqual(refetchCount, recoveredPages.length);

    for (const page of recoveredPages) {
      const markup = renderToStaticMarkup(
        React.createElement(
          ClerkProvider,
          { publishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" },
          React.createElement(
            WouterRouter,
            { hook: () => [page.path, () => undefined] },
            React.createElement(
              QueryClientProvider,
              { client: queryClient },
              page.render(),
            ),
          ),
        ),
      );
      strictEqual(
        markup.includes(page.marker),
        true,
        `expected ${page.path} to display its recovered value`,
      );
    }
  });

  it("rebuilds recovered values from mocked API responses after a full browser reload", async () => {
    const recoveredPages = [
      {
        path: "/dashboard",
        queryKey: getGetDashboardSummaryQueryKey(),
        queryOptions: getGetDashboardSummaryQueryOptions,
        recovered: {
          metrics: [
            { label: "Receita recuperada", value: "R$ 12.500", change: "+18%", tone: "positive" },
            { label: "Lucro recuperado", value: "R$ 3.100", change: "+22%", tone: "positive" },
          ],
          chart: [{ label: "Jun", revenue: 12500, profit: 3100 }],
          periodLabel: "Período recuperado",
          unreadAlertsCount: 0,
          recentAlerts: [],
          productSales: [],
          mostProfitable: [],
        },
        render: () => React.createElement(Dashboard),
        marker: "R$ 12.500",
      },
      {
        path: "/products",
        queryKey: getListProductsQueryKey({ search: undefined, status: undefined }),
        queryOptions: () => getListProductsQueryOptions({ search: undefined, status: undefined }),
        recovered: [{
          id: "product-recovered",
          name: "Produto recuperado",
          sku: "SKU-RECUPERADO",
          asin: "B0RECUPERADO",
          status: "healthy",
          salePrice: 149.9,
          currentCost: 70,
          availableStock: 42,
          reservedStock: 3,
          daysOfCover: 21,
          dailyAverage: 2,
          minimumMargin: 15,
        }],
        render: () => React.createElement(Products),
        marker: "Produto recuperado",
      },
      {
        path: "/sales",
        queryKey: getListSalesQueryKey({ search: undefined, from: undefined, to: undefined }),
        queryOptions: () => getListSalesQueryOptions({ search: undefined, from: undefined, to: undefined }),
        recovered: [{
          id: "sale-recovered",
          soldAt: "2025-06-18T12:00:00.000Z",
          amazonOrderNumber: "701-RECUPERADO",
          productName: "Venda recuperada",
          sku: "SKU-RECUPERADO",
          quantity: 4,
          revenueTotal: 599.6,
          fbaFee: 30,
          commission: 60,
          otherFees: 5,
          productCost: 280,
          netProfit: 224.6,
          netMargin: 37.45,
        }],
        render: () => React.createElement(Sales),
        marker: "701-RECUPERADO",
      },
      {
        path: "/inventory",
        queryKey: getListInventoryQueryKey({ search: undefined, risk: undefined }),
        queryOptions: () => getListInventoryQueryOptions({ search: undefined, risk: undefined }),
        recovered: [{
          id: "inventory-recovered",
          productName: "Estoque recuperado",
          sku: "SKU-RECUPERADO",
          asin: "B0RECUPERADO",
          available: 42,
          reserved: 3,
          inbound: 10,
          total: 55,
          coverageDays: 21,
          status: "healthy",
          lastSyncedAt: "2025-06-18T12:00:00.000Z",
        }],
        render: () => React.createElement(Inventory),
        marker: "Estoque recuperado",
      },
    ] as const;

    const routes = new Map(
      recoveredPages.map((page) => [
        String(page.queryKey[0]),
        { queryKey: page.queryKey, recovered: page.recovered },
      ]),
    );
    const requestCounts = new Map<string, number>();
    let apiRecovered = false;
    const originalFetch = globalThis.fetch;
    const mockFetch: typeof fetch = async (input, _init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        "http://amazon-profit-manager.test",
      );
      const route = routes.get(url.pathname);
      if (!route) throw new Error(`Unexpected API request: ${url.pathname}`);

      requestCounts.set(url.pathname, (requestCounts.get(url.pathname) || 0) + 1);
      if (!apiRecovered) {
        return new Response(
          JSON.stringify({ error: "API indisponível durante a sincronização" }),
          { status: 503, statusText: "Service Unavailable", headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(route.recovered), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    globalThis.fetch = mockFetch;

    try {
      const firstBrowserSession = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      firstBrowserSession.setQueryData(getListAlertsQueryKey({ unreadOnly: true }), []);

      await Promise.all(
        recoveredPages.map(async (page) => {
          try {
            await firstBrowserSession.fetchQuery(page.queryOptions());
          } catch {
            // The first browser session intentionally models the failed sync.
          }
        }),
      );
      for (const page of recoveredPages) {
        strictEqual(firstBrowserSession.getQueryState(page.queryKey)?.status, "error");
      }

      apiRecovered = true;
      await refreshAmazonSyncQueries(firstBrowserSession);

      // A full reload creates a new client and cannot read the first session's cache.
      const reloadedBrowserSession = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      reloadedBrowserSession.setQueryData(getListAlertsQueryKey({ unreadOnly: true }), []);
      await Promise.all(
        recoveredPages.map((page) => reloadedBrowserSession.fetchQuery(page.queryOptions())),
      );

      for (const page of recoveredPages) {
        const markup = renderToStaticMarkup(
          React.createElement(
            ClerkProvider,
            { publishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" },
            React.createElement(
              WouterRouter,
              { hook: () => [page.path, () => undefined] },
              React.createElement(
                QueryClientProvider,
                { client: reloadedBrowserSession },
                page.render(),
              ),
            ),
          ),
        );
        strictEqual(
          markup.includes(page.marker),
          true,
          `expected ${page.path} to display its recovered value after reload`,
        );
        deepStrictEqual(
          reloadedBrowserSession.getQueryData(page.queryKey),
          page.recovered,
          `expected ${page.path} to use the recovered API response after reload`,
        );
      }

      // Each endpoint was called once for the failure, once for recovery, and once
      // by the new browser session after reload.
      for (const page of recoveredPages) {
        const apiPath = String(page.queryKey[0]);
        strictEqual(requestCounts.get(apiPath), 3, `expected ${apiPath} to be fetched after reload`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
