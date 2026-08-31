import { Router, type IRouter } from "express";
import {
  CreateProductBody,
  GetProductParams,
  ListProductsQueryParams,
  UpdateProductBody,
  UpdateProductParams,
} from "@workspace/api-zod";
import {
  supabaseRequest,
  toDateOnly,
  toNumber,
} from "../lib/supabase";
import {
  getAuthenticatedUserId,
  requireAuth,
} from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

function productFromRow(row: Record<string, unknown>) {
  const availableStock = toNumber(row.available_stock);
  const dailyAverage = toNumber(row.daily_average);
  const daysOfCover = dailyAverage > 0 ? availableStock / dailyAverage : 999;
  const stockout = daysOfCover < 999
    ? new Date(Date.now() + daysOfCover * 86400000)
    : null;

  return {
    id: String(row.id),
    sku: String(row.sku ?? ""),
    asin: String(row.asin ?? ""),
    name: String(row.name ?? ""),
    imageUrl: row.image_url ? String(row.image_url) : null,
    category: String(row.category ?? "Sem categoria"),
    supplier: String(row.supplier ?? "Sem fornecedor"),
    currentCost: toNumber(row.current_cost),
    averageCost: toNumber(row.average_cost),
    salePrice: toNumber(row.sale_price),
    availableStock,
    reservedStock: toNumber(row.reserved_stock),
    inboundStock: toNumber(row.inbound_stock),
    safetyStock: toNumber(row.safety_stock),
    leadTimeDays: toNumber(row.lead_time_days),
    minimumOrderQuantity: toNumber(row.minimum_order_quantity) || 1,
    minimumMargin: toNumber(row.minimum_margin),
    status: String(row.status ?? "healthy"),
    unitsSoldMonth: toNumber(row.units_sold_month),
    dailyAverage,
    daysOfCover,
    projectedStockout: toDateOnly(stockout),
  };
}

function baseProductPayload(body: Record<string, unknown>) {
  return {
    sku: body.sku,
    asin: body.asin,
    name: body.name,
    image_url: body.imageUrl ?? null,
    category: body.category ?? "Sem categoria",
    supplier: body.supplier ?? "Sem fornecedor",
    current_cost: body.currentCost ?? 0,
    average_cost: body.averageCost ?? body.currentCost ?? 0,
    sale_price: body.salePrice ?? 0,
    available_stock: body.availableStock ?? 0,
    reserved_stock: body.reservedStock ?? 0,
    inbound_stock: body.inboundStock ?? 0,
    safety_stock: body.safetyStock ?? 0,
    lead_time_days: body.leadTimeDays ?? 0,
    minimum_order_quantity: body.minimumOrderQuantity ?? 1,
    minimum_margin: body.minimumMargin ?? 0.2,
  };
}

router.get("/products", async (req, res) => {
  try {
    const parsed = ListProductsQueryParams.parse(req.query);
    const userId = getAuthenticatedUserId(req);
    const filters: Record<string, string> = {
      owner_clerk_id: `eq.${userId}`,
      order: "created_at.desc",
    };
    if (parsed.search) {
      const search = parsed.search.replace(/[(),]/g, "");
      filters.or = `(sku.ilike.*${search}*,name.ilike.*${search}*,asin.ilike.*${search}*)`;
    }
    if (parsed.status) filters.status = `eq.${parsed.status}`;

    const rows = await supabaseRequest<Record<string, unknown>[]>("products", {
      query: {
        select: "*",
        ...filters,
      },
    });
    res.json(rows.map(productFromRow));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to list products");
    res.status(500).json({ error: "Não foi possível carregar os produtos" });
  }
});

router.post("/products", async (req, res) => {
  try {
    const body = CreateProductBody.parse(req.body);
    const userId = getAuthenticatedUserId(req);
    const rows = await supabaseRequest<Record<string, unknown>[]>("products", {
      method: "POST",
      returnRepresentation: true,
      body: { ...baseProductPayload(body), owner_clerk_id: userId },
    });
    res.status(201).json(productFromRow(rows[0]));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to create product");
    res.status(400).json({ error: "Não foi possível criar o produto" });
  }
});

router.get("/products/:id", async (req, res) => {
  try {
    const { id } = GetProductParams.parse(req.params);
    const userId = getAuthenticatedUserId(req);
    const rows = await supabaseRequest<Record<string, unknown>[]>("products", {
      query: { select: "*", id: `eq.${id}`, owner_clerk_id: `eq.${userId}` },
    });
    if (!rows[0]) {
      res.status(404).json({ error: "Produto não encontrado" });
      return;
    }
    res.json(productFromRow(rows[0]));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to get product");
    res.status(400).json({ error: "Produto inválido" });
  }
});

router.patch("/products/:id", async (req, res) => {
  try {
    const { id } = UpdateProductParams.parse(req.params);
    const body = UpdateProductBody.parse(req.body);
    const userId = getAuthenticatedUserId(req);
    const rows = await supabaseRequest<Record<string, unknown>[]>("products", {
      method: "PATCH",
      returnRepresentation: true,
      query: { id: `eq.${id}`, owner_clerk_id: `eq.${userId}` },
      body: baseProductPayload({ ...body, ...req.body }),
    });
    if (!rows[0]) {
      res.status(404).json({ error: "Produto não encontrado" });
      return;
    }
    res.json(productFromRow(rows[0]));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to update product");
    res.status(400).json({ error: "Não foi possível atualizar o produto" });
  }
});

router.delete("/products/:id", async (req, res) => {
  try {
    const { id } = GetProductParams.parse(req.params);
    const userId = getAuthenticatedUserId(req);
    await supabaseRequest("products", {
      method: "DELETE",
      query: { id: `eq.${id}`, owner_clerk_id: `eq.${userId}` },
    });
    res.status(204).send();
  } catch (error) {
    req.log?.error({ err: error }, "Failed to delete product");
    res.status(400).json({ error: "Não foi possível excluir o produto" });
  }
});

export default router;