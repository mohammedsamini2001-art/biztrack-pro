import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../db";
import { requireAuth, requireRole } from "../auth";
import type { Env, AuthUser } from "../types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
export const productsRoutes = new Hono<AppEnv>();
productsRoutes.use("*", requireAuth);

// A "variant" lets one product have multiple sellable options
// (e.g. Size: M, Color: Blue) each with their own stock/price/SKU,
// so the same model works whether a business sells loose items
// (drinks, groceries) or variant-based items (clothes, shoes).
type Variant = {
  id: string;
  label: string; // e.g. "Blue / Medium"
  sku?: string;
  stock: number;
  costPrice: number;
  sellPrice: number;
};

type ProductInput = {
  name: string;
  category: string;
  unit: string;
  sku?: string; // barcode / stock-keeping unit for the base product
  stock: number;
  costPrice: number;
  sellPrice: number;
  reorderLevel: number;
  expiryDate?: string; // ISO date, optional — for perishables/pharma
  images?: string[]; // URLs (host images externally, e.g. Cloudflare R2/Images)
  variants?: Variant[]; // optional — leave empty for simple products
  customFields?: Record<string, string | number | boolean>; // business-specific extras
};

function validate(body: any): string | null {
  if (!body.name || typeof body.name !== "string") return "name is required";
  if (!body.category || typeof body.category !== "string") return "category is required";
  if (!body.unit || typeof body.unit !== "string") return "unit is required";
  if (body.stock !== undefined && typeof body.stock !== "number") return "stock must be a number";
  if (body.costPrice !== undefined && typeof body.costPrice !== "number") return "costPrice must be a number";
  if (body.sellPrice !== undefined && typeof body.sellPrice !== "number") return "sellPrice must be a number";
  if (body.images && !Array.isArray(body.images)) return "images must be an array of URLs";
  if (body.variants && !Array.isArray(body.variants)) return "variants must be an array";
  if (body.customFields && typeof body.customFields !== "object") return "customFields must be an object";
  return null;
}

productsRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const category = c.req.query("category");
  const search = c.req.query("q");
  const filter: Record<string, unknown> = { businessId: user.businessId };
  if (category && category !== "All") filter.category = category;
  if (search) filter.name = { $regex: search, $options: "i" };
  const docs = await db.collection("products").find(filter).sort({ _id: -1 }).limit(2000).toArray();
  return c.json(docs);
});

productsRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const doc = await db.collection("products").findOne({ _id: new ObjectId(c.req.param("id")), businessId: user.businessId });
  if (!doc) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});

productsRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body: ProductInput = await c.req.json();
  const err = validate(body);
  if (err) return c.json({ error: err }, 400);

  const db = await getDb(c.env.MONGODB_URI);
  const doc = {
    businessId: user.businessId,
    name: body.name,
    category: body.category,
    unit: body.unit,
    sku: body.sku || null,
    stock: body.stock ?? 0,
    costPrice: body.costPrice ?? 0,
    sellPrice: body.sellPrice ?? 0,
    reorderLevel: body.reorderLevel ?? 0,
    expiryDate: body.expiryDate || null,
    images: body.images || [],
    variants: (body.variants || []).map((v) => ({ ...v, id: v.id || crypto.randomUUID() })),
    customFields: body.customFields || {},
    createdAt: new Date().toISOString(),
  };
  const result = await db.collection("products").insertOne(doc);
  return c.json({ ...doc, _id: result.insertedId }, 201);
});

productsRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body: Partial<ProductInput> = await c.req.json();
  const err = validate({ name: "x", category: "x", unit: "x", ...body });
  if (err) return c.json({ error: err }, 400);

  const update = { ...body, updatedAt: new Date().toISOString() };
  delete (update as any)._id;
  if (update.variants) update.variants = update.variants.map((v) => ({ ...v, id: v.id || crypto.randomUUID() }));

  const db = await getDb(c.env.MONGODB_URI);
  const result = await db
    .collection("products")
    .findOneAndUpdate({ _id: new ObjectId(id), businessId: user.businessId }, { $set: update }, { returnDocument: "after" });
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

productsRoutes.delete("/:id", requireRole("CEO", "Manager"), async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const result = await db.collection("products").deleteOne({ _id: new ObjectId(c.req.param("id")), businessId: user.businessId });
  if (result.deletedCount === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true });
});
