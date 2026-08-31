import { Router, type IRouter, type RequestHandler } from "express";
import {
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/requireAuth";
import {
  checkAlertsSchema,
  supabaseRequest,
  toNumber,
} from "../lib/supabase";
import {
  AlertsSchemaError,
  createCachedAlertsSchemaCheck,
  getCachedAlertsSchemaCheck,
  listAlertsForOwner,
} from "../lib/alerts";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function metric(label: string, value: string, change: string, tone: string) {
  return { label, value, change, tone };
}

function moneyMetric(label: string, value: number, tone: string) {
  return metric(label, brl.format(value), "", tone);
}

type DashboardRouterDependencies = {
  requireAuth?: RequestHandler;
  getAuthenticatedUserId?: (req: Parameters<typeof getAuthenticatedUserId>[0]) => string;
  supabaseRequest?: typeof supabaseRequest;
  listAlertsForOwner?: typeof listAlertsForOwner;
  checkAlertsSchema?: typeof checkAlertsSchema;
};

export function createDashboardRouter(
  dependencies: DashboardRouterDependencies = {},
): IRouter {
  const router: IRouter = Router();
  const authenticate = dependencies.requireAuth ?? requireAuth;
  const getOwner =
    dependencies.getAuthenticatedUserId ?? getAuthenticatedUserId;
  const requestSupabase = dependencies.supabaseRequest ?? supabaseRequest;
  const listAlerts = dependencies.listAlertsForOwner ?? listAlertsForOwner;
  const getSchemaCheck = dependencies.checkAlertsSchema
    ? createCachedAlertsSchemaCheck(dependencies.checkAlertsSchema)
    : getCachedAlertsSchemaCheck;

  router.use(authenticate);

  router.get("/dashboard/summary", async (req, res) => {
    try {
      const ownerClerkId = getOwner(req);
      const alertsSchema = await getSchemaCheck();
      if (!alertsSchema.complete) throw new AlertsSchemaError(alertsSchema);
      const [sales, products, expenses, cash, alerts] = await Promise.all([
        requestSupabase<Record<string, unknown>[]>("sales", {
          query: {
            select: "sold_at,revenue_total,net_profit,quantity,product_name,sku,amazon_commission,fba_fee,other_amazon_fees,attributed_advertising,tax,product_cost,other_expenses",
            owner_clerk_id: `eq.${ownerClerkId}`,
            order: "sold_at.asc",
          },
        }),
        requestSupabase<Record<string, unknown>[]>("products", {
          query: {
            select: "*",
            owner_clerk_id: `eq.${ownerClerkId}`,
            order: "created_at.desc",
          },
        }),
        requestSupabase<Record<string, unknown>[]>("expenses", {
          query: {
            select: "amount,expense_type,occurred_at",
            owner_clerk_id: `eq.${ownerClerkId}`,
          },
        }),
        requestSupabase<Record<string, unknown>[]>("cash_transactions", {
          query: {
            select: "amount,transaction_type",
            owner_clerk_id: `eq.${ownerClerkId}`,
          },
        }),
        listAlerts(ownerClerkId),
      ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthSales = sales.filter((sale) => new Date(String(sale.sold_at)) >= monthStart);
    const revenue = monthSales.reduce((sum, sale) => sum + toNumber(sale.revenue_total), 0);
    const profit = monthSales.reduce((sum, sale) => sum + toNumber(sale.net_profit), 0);
    const units = monthSales.reduce((sum, sale) => sum + toNumber(sale.quantity), 0);
    const fees = monthSales.reduce(
      (sum, sale) =>
        sum +
        toNumber(sale.amazon_commission) +
        toNumber(sale.fba_fee) +
        toNumber(sale.other_amazon_fees),
      0,
    );
    const advertising = monthSales.reduce((sum, sale) => sum + toNumber(sale.attributed_advertising), 0);
    const taxes = monthSales.reduce((sum, sale) => sum + toNumber(sale.tax), 0);
    const cogs = monthSales.reduce((sum, sale) => sum + toNumber(sale.product_cost), 0);
    const otherExpenses = monthSales.reduce((sum, sale) => sum + toNumber(sale.other_expenses), 0) +
      expenses
        .filter((expense) => String(expense.expense_type) === "other")
        .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const cashBalance = cash.reduce((sum, transaction) => {
      const type = String(transaction.transaction_type);
      const isIncome = ["amazon_payout", "other_income", "capital_injection"].includes(type);
      const amount = toNumber(transaction.amount);
      return sum + (isIncome ? amount : -amount);
    }, 0);
    const todayRevenue = monthSales
      .filter((sale) => new Date(String(sale.sold_at)).toDateString() === now.toDateString())
      .reduce((sum, sale) => sum + toNumber(sale.revenue_total), 0);

    const byProduct = new Map<string, { productName: string; sku: string; revenue: number; profit: number; margin: number; units: number }>();
    for (const sale of monthSales) {
      const sku = String(sale.sku ?? "");
      const current = byProduct.get(sku) ?? {
        productName: String(sale.product_name ?? "Produto"),
        sku,
        revenue: 0,
        profit: 0,
        margin: 0,
        units: 0,
      };
      current.revenue += toNumber(sale.revenue_total);
      current.profit += toNumber(sale.net_profit);
      current.units += toNumber(sale.quantity);
      current.margin = current.revenue > 0 ? current.profit / current.revenue : 0;
      byProduct.set(sku, current);
    }
    const rankings = [...byProduct.values()];
    const chart = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(now);
      day.setDate(now.getDate() - (6 - index));
      const daySales = monthSales.filter((sale) => new Date(String(sale.sold_at)).toDateString() === day.toDateString());
      return {
        label: day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        revenue: daySales.reduce((sum, sale) => sum + toNumber(sale.revenue_total), 0),
        profit: daySales.reduce((sum, sale) => sum + toNumber(sale.net_profit), 0),
      };
    });

    res.json({
      periodLabel: now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
      metrics: [
        moneyMetric("Faturamento hoje", todayRevenue, "positive"),
        moneyMetric("Faturamento no mês", revenue, "positive"),
        moneyMetric("Lucro bruto", revenue - fees - cogs, "positive"),
        moneyMetric("Lucro líquido", profit, profit >= 0 ? "positive" : "negative"),
        metric("Margem líquida", `${(revenue ? (profit / revenue) * 100 : 0).toFixed(1)}%`, "", profit >= 0 ? "positive" : "negative"),
        moneyMetric("Taxas Amazon", fees, "neutral"),
        moneyMetric("CMV", cogs, "neutral"),
        moneyMetric("Publicidade", advertising, "warning"),
        moneyMetric("Impostos", taxes, "neutral"),
        moneyMetric("Outras despesas", otherExpenses, "neutral"),
        moneyMetric("Saldo de caixa", cashBalance, cashBalance >= 0 ? "positive" : "negative"),
        moneyMetric("Saldo projetado", cashBalance + profit, cashBalance + profit >= 0 ? "positive" : "negative"),
        metric("Produtos vendidos", units.toLocaleString("pt-BR"), "", "neutral"),
        metric("Pedidos", monthSales.length.toLocaleString("pt-BR"), "", "neutral"),
        moneyMetric("Ticket médio", monthSales.length ? revenue / monthSales.length : 0, "neutral"),
      ],
      chart,
      productSales: rankings.sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      mostProfitable: [...rankings].sort((a, b) => b.profit - a.profit).slice(0, 5),
      recentAlerts: alerts.slice(0, 5),
      unreadAlertsCount: alerts.filter((alert) => !alert.read).length,
      productCount: products.length,
    });
    } catch (error) {
      if (error instanceof AlertsSchemaError) {
        req.log?.error({ err: error.check }, "Alerts schema is not ready for dashboard");
        res.status(503).json({
          error: error.message,
          code: error.check.unavailable
            ? "ALERTS_SCHEMA_UNAVAILABLE"
            : "ALERTS_SCHEMA_INCOMPLETE",
          missingTables: error.check.missingTables,
          missingFunctions: error.check.missingFunctions,
        });
        return;
      }
      req.log?.error({ err: error }, "Failed to build dashboard summary");
      res.status(500).json({ error: "Não foi possível carregar o dashboard" });
    }
  });

  return router;
}

export default createDashboardRouter();