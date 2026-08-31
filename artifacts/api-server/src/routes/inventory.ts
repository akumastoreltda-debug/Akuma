import { Router, type IRouter } from "express";
import { ListInventoryQueryParams } from "@workspace/api-zod";
import { supabaseRequest, toNumber } from "../lib/supabase";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/inventory", async (req, res): Promise<void> => {
  try {
    const params = ListInventoryQueryParams.parse(req.query);
    const ownerClerkId = getAuthenticatedUserId(req);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [products, snapshots, recentSales] = await Promise.all([
      supabaseRequest<Record<string, unknown>[]>("products", {
        query: { select: "*", owner_clerk_id: `eq.${ownerClerkId}`, order: "name.asc" },
      }),
      supabaseRequest<Record<string, unknown>[]>("amazon_inventory_snapshots", {
        query: { select: "*", owner_clerk_id: `eq.${ownerClerkId}`, order: "synced_at.desc" },
      }),
      supabaseRequest<Record<string, unknown>[]>("sales", {
        query: {
          select: "sku,quantity,sold_at",
          owner_clerk_id: `eq.${ownerClerkId}`,
          sold_at: `gte.${thirtyDaysAgo}`,
        },
      }),
    ]);
    const unitsBySku = new Map<string, number>();
    recentSales.forEach((sale) => {
      const sku = String(sale.sku);
      unitsBySku.set(sku, (unitsBySku.get(sku) ?? 0) + toNumber(sale.quantity));
    });
    const latest = new Map<string, Record<string, unknown>>();
    snapshots.forEach((snapshot) => {
      const sku = String(snapshot.sku);
      if (!latest.has(sku)) latest.set(sku, snapshot);
    });
    const productsBySku = new Map(products.map((product) => [String(product.sku), product]));
    const skus = new Set([...productsBySku.keys(), ...latest.keys()]);
    let result = [...skus].map((sku) => {
      const product = productsBySku.get(sku);
      const snapshot = latest.get(sku);
      const available = toNumber(snapshot?.available ?? product?.available_stock);
      const reserved = toNumber(snapshot?.reserved ?? product?.reserved_stock);
      const inbound = toNumber(snapshot?.inbound ?? product?.inbound_stock);
      const dailyAverage = (unitsBySku.get(sku) ?? 0) / 30;
      const coverageDays = dailyAverage > 0 ? available / dailyAverage : 999;
      const status = !product ? "unknown" : available <= toNumber(product.safety_stock) || coverageDays < toNumber(product.lead_time_days)
        ? "attention"
        : "healthy";
      return {
        id: String(product?.id ?? snapshot?.id),
        sku,
        asin: product?.asin ? String(product.asin) : snapshot?.asin ? String(snapshot.asin) : null,
        productName: product?.name ? String(product.name) : "SKU não cadastrado",
        available,
        reserved,
        inbound,
        total: available + reserved + inbound,
        coverageDays,
        status,
        lastSyncedAt: snapshot?.synced_at ? String(snapshot.synced_at) : null,
        source: snapshot ? "Amazon FBA" : "Catálogo",
      };
    });
    if (params.search) {
      const search = params.search.toLocaleLowerCase("pt-BR");
      result = result.filter((item) =>
        item.sku.toLocaleLowerCase("pt-BR").includes(search)
        || item.productName.toLocaleLowerCase("pt-BR").includes(search)
        || item.asin?.toLocaleLowerCase("pt-BR").includes(search));
    }
    if (params.risk && params.risk !== "all") {
      result = result.filter((item) => item.status === params.risk);
    }
    res.json(result);
  } catch (error) {
    req.log?.error({ err: error }, "Failed to list inventory");
    res.status(500).json({ error: "Não foi possível carregar o estoque" });
  }
});

export default router;