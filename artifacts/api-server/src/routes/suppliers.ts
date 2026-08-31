import { Router, type IRouter } from "express";
import { CreateSupplierBody } from "@workspace/api-zod";
import { supabaseRequest, toNumber } from "../lib/supabase";
import { getAuthenticatedUserId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

function supplierFromRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    cnpj: row.cnpj ? String(row.cnpj) : null,
    phone: row.phone ? String(row.phone) : null,
    whatsapp: row.whatsapp ? String(row.whatsapp) : null,
    email: row.email ? String(row.email) : null,
    deliveryDays: toNumber(row.delivery_days),
    notes: row.notes ? String(row.notes) : null,
    productsCount: toNumber(row.products_count),
  };
}

router.get("/suppliers", async (req, res) => {
  try {
    const ownerClerkId = getAuthenticatedUserId(req);
    const rows = await supabaseRequest<Record<string, unknown>[]>("suppliers", {
      query: {
        select: "*",
        owner_clerk_id: `eq.${ownerClerkId}`,
        order: "name.asc",
      },
    });
    res.json(rows.map(supplierFromRow));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to list suppliers");
    res.status(500).json({ error: "Não foi possível carregar os fornecedores" });
  }
});

router.post("/suppliers", async (req, res) => {
  try {
    const body = CreateSupplierBody.parse(req.body);
    const ownerClerkId = getAuthenticatedUserId(req);
    const rows = await supabaseRequest<Record<string, unknown>[]>("suppliers", {
      method: "POST",
      returnRepresentation: true,
      body: {
        owner_clerk_id: ownerClerkId,
        name: body.name,
        cnpj: body.cnpj ?? null,
        phone: body.phone ?? null,
        whatsapp: body.whatsapp ?? null,
        email: body.email ?? null,
        delivery_days: body.deliveryDays ?? 0,
        notes: body.notes ?? null,
      },
    });
    res.status(201).json(supplierFromRow(rows[0]));
  } catch (error) {
    req.log?.error({ err: error }, "Failed to create supplier");
    res.status(400).json({ error: "Não foi possível criar o fornecedor" });
  }
});

export default router;