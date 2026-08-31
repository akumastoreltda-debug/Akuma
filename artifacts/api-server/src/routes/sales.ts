import { Router, type IRouter } from "express";
import { ListSalesQueryParams } from "@workspace/api-zod";
import { supabaseRequest, toNumber } from "../lib/supabase";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/sales", async (req, res): Promise<void> => {
  try {
    const params = ListSalesQueryParams.parse(req.query);
    const ownerClerkId = getAuthenticatedUserId(req);
    const query: Record<string, string | number | boolean | undefined> = {
      select: "*",
      owner_clerk_id: `eq.${ownerClerkId}`,
      order: "sold_at.desc",
    };
    if (params.search) {
      const search = params.search.replace(/[(),]/g, "");
      query.or = `(sku.ilike.*${search}*,product_name.ilike.*${search}*,amazon_order_number.ilike.*${search}*)`;
    }
    const dateFilters: string[] = [];
    if (params.from) dateFilters.push(`sold_at.gte.${params.from.toISOString()}`);
    if (params.to) {
      const to = new Date(params.to);
      to.setUTCDate(to.getUTCDate() + 1);
      dateFilters.push(`sold_at.lt.${to.toISOString()}`);
    }
    if (dateFilters.length === 1) {
      const [column, operator, ...value] = dateFilters[0].split(".");
      query[column] = `${operator}.${value.join(".")}`;
    } else if (dateFilters.length > 1) query.and = `(${dateFilters.join(",")})`;
    const rows = await supabaseRequest<Record<string, unknown>[]>("sales", { query });
    res.json(rows.map((row) => ({
      id: String(row.id),
      amazonOrderNumber: String(row.amazon_order_number),
      marketplaceId: String(row.marketplace_id),
      sku: String(row.sku),
      asin: row.asin ? String(row.asin) : null,
      productName: String(row.product_name),
      soldAt: String(row.sold_at),
      quantity: toNumber(row.quantity),
      unitPrice: toNumber(row.unit_price),
      revenueTotal: toNumber(row.revenue_total),
      commission: toNumber(row.amazon_commission),
      fbaFee: toNumber(row.fba_fee),
      otherFees: toNumber(row.other_amazon_fees),
      refunds: toNumber(row.refunds),
      adjustments: toNumber(row.adjustments),
      payout: toNumber(row.payout),
      productCost: toNumber(row.product_cost),
      netProfit: toNumber(row.net_profit),
      netMargin: toNumber(row.net_margin),
    })));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to list sales");
    res.status(500).json({ error: "Não foi possível carregar as vendas" });
  }
});

export default router;