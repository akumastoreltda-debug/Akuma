import { strictEqual } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, it } from "node:test";
import { chromium } from "playwright";

const artifactDir = new URL(".", import.meta.url).pathname;
const port = 25731;
const basePath = "/amazon-profit-manager";
const baseUrl = `http://127.0.0.1:${port}${basePath}`;

const pages = [
  {
    route: "/dashboard",
    apiPath: "/api/dashboard/summary",
    marker: "R$ 12.500",
    response: {
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
  },
  {
    route: "/products",
    apiPath: "/api/products",
    marker: "Produto recuperado",
    response: [{
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
      leadTimeDays: 7,
    }],
  },
  {
    route: "/sales",
    apiPath: "/api/sales",
    marker: "701-RECUPERADO",
    response: [{
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
  },
  {
    route: "/inventory",
    apiPath: "/api/inventory",
    marker: "Estoque recuperado",
    response: [{
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
  },
];

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // The Vite process is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not start at ${url}`);
}

async function startVite() {
  const server = spawn(
    "pnpm",
    ["exec", "vite", "--config", "vite.config.ts", "--host", "127.0.0.1"],
    {
      cwd: artifactDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        BASE_PATH: basePath,
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
      },
      stdio: "ignore",
    },
  );
  await waitForServer(`${baseUrl}/browser-smoke.html`);
  return server;
}

async function stopProcess(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    once(process, "exit"),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

describe("Amazon browser persistence smoke test", () => {
  it("recovers and reloads dashboard, products, sales, and inventory in a real browser", async () => {
    const vite = await startVite();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let apiRecovered = false;
    const requestCounts = new Map();

    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith("/api/__clerk/")) {
        await route.abort();
        return;
      }

      if (url.pathname === "/api/alerts") {
        await route.fulfill(jsonResponse([]));
        return;
      }

      const pageFixture = pages.find(item => item.apiPath === url.pathname);
      if (!pageFixture) {
        await route.continue();
        return;
      }

      requestCounts.set(
        pageFixture.apiPath,
        (requestCounts.get(pageFixture.apiPath) || 0) + 1,
      );
      if (!apiRecovered) {
        await route.fulfill(jsonResponse({ error: "API indisponível durante a sincronização" }, 503));
        return;
      }
      await route.fulfill(jsonResponse(pageFixture.response));
    });

    try {
      for (const fixture of pages) {
        apiRecovered = false;
        await page.goto(
          `${baseUrl}/browser-smoke.html?route=${encodeURIComponent(fixture.route)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.getByText("Não foi possível carregar estes dados.").waitFor();

        apiRecovered = true;
        await page.getByRole("button", { name: "Tentar novamente" }).click();
        await page.getByText(fixture.marker, { exact: false }).waitFor();

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByText(fixture.marker, { exact: false }).waitFor();
        strictEqual(
          await page.getByText(fixture.marker, { exact: false }).count() > 0,
          true,
          `expected ${fixture.route} to display recovered data after reload`,
        );

        strictEqual(
          requestCounts.get(fixture.apiPath) >= 3,
          true,
          `expected ${fixture.apiPath} to be requested during failure, recovery, and reload`,
        );
      }
    } finally {
      await page.close();
      await browser.close();
      await stopProcess(vite);
    }
  });
});