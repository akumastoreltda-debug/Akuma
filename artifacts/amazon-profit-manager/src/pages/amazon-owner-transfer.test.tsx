import { strictEqual } from "node:assert";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router as WouterRouter } from "wouter";
import {
  getGetAmazonAlertSettingsQueryKey,
  getGetAmazonOwnerTransferQueryKey,
  getGetAmazonStatusQueryKey,
  getListAlertsQueryKey,
  getListAmazonConnectionTestsQueryKey,
  getListAmazonModuleAlertsQueryKey,
  getListAmazonOwnerTransferAuditQueryKey,
  getListAmazonSyncRunsQueryKey,
} from "@workspace/api-client-react";
import AmazonConnection from "./amazon";

const clerkPublishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

const auditEvents = [
  {
    id: "audit-1",
    actorClerkId: "admin-1",
    previousOwnerClerkId: "owner-1",
    newOwnerClerkId: "owner-2",
    reason: "Troca autorizada em homologação",
    transferredAt: "2026-08-31T12:00:00.000Z",
  },
];

function queryClientForOwnerTransfer(isAdmin: boolean): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  queryClient.setQueryData(getListAlertsQueryKey({ unreadOnly: true }), []);
  queryClient.setQueryData(getGetAmazonStatusQueryKey(), {
    configured: false,
    marketplaceId: "A2Q3Y263D00KWC",
    marketplaceName: "Brasil",
    connectionStatus: "not_configured",
    lastTestAt: null,
    lastSyncAt: null,
    lastError: null,
    missingSecrets: [],
  });
  queryClient.setQueryData(getListAmazonSyncRunsQueryKey(), []);
  queryClient.setQueryData(getListAmazonConnectionTestsQueryKey(), []);
  queryClient.setQueryData(getListAmazonModuleAlertsQueryKey(), []);
  queryClient.setQueryData(getGetAmazonAlertSettingsQueryKey(), {
    sampleWindow: 3,
    failureThreshold: 2,
    latencyThresholdMs: 5000,
    enabled: true,
    notificationChannel: null,
    notificationConfigured: false,
    notificationDestinationHint: null,
  });
  queryClient.setQueryData(getGetAmazonOwnerTransferQueryKey(), {
    isAdmin,
    currentOwnerClerkId: isAdmin ? "owner-1" : null,
  });
  queryClient.setQueryData(
    getListAmazonOwnerTransferAuditQueryKey(),
    auditEvents,
  );

  return queryClient;
}

function renderAmazonPage(queryClient: QueryClient): string {
  const locationHook: [string, (path: string, ...args: any[]) => any] = [
    "/amazon",
    () => undefined,
  ];
  return renderToStaticMarkup(
    React.createElement(
      ClerkProvider,
      {
        publishableKey: clerkPublishableKey,
        children: React.createElement(
          WouterRouter,
          {
            hook: () => locationHook,
            children: React.createElement(
              QueryClientProvider,
              { client: queryClient, children: React.createElement(AmazonConnection) },
            ),
          },
        ),
      },
    ),
  );
}

describe("Amazon owner transfer history visibility", () => {
  it("does not render the administrative transfer card for a regular user", () => {
    const markup = renderAmazonPage(queryClientForOwnerTransfer(false));

    strictEqual(markup.includes("Histórico de transferências"), false);
    strictEqual(markup.includes("Troca autorizada em homologação"), false);
    strictEqual(markup.includes("Transferência administrativa"), false);
  });

  it("renders the transfer history events for an administrator", () => {
    const markup = renderAmazonPage(queryClientForOwnerTransfer(true));

    strictEqual(markup.includes("Histórico de transferências"), true);
    strictEqual(markup.includes("admin-1"), true);
    strictEqual(markup.includes("owner-1"), true);
    strictEqual(markup.includes("owner-2"), true);
    strictEqual(markup.includes("Troca autorizada em homologação"), true);
    strictEqual(markup.includes("Baixar CSV"), true);
  });
});