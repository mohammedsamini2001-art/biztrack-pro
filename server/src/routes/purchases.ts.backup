import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../db";
import { requireAuth, requireRole } from "../auth";
import type { Env, AuthUser } from "../types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
export const purchasesRoutes = new Hono<AppEnv>();
purchasesRoutes.use("*", requireAuth);

// A purchase order line — one product, quantity, and cost at time of purchase.
type PurchaseItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
};

type PurchaseInput = {
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  paymentMethod: "Cash" | "M-Pesa" | "Bank Transfer" | "Credit";
  status?: "pending" | "received" | "cancelled"; // received = stock has been added
  notes?: string;
};

function validate(body: any): string | null {
  if (!body.supplierId) return "supplierId is required";
  if (!body.supplierName) return "supplierName is required";
  if (!Array.isArray(body.items) || body.items.length === 0) return "at least one item is required";
  for (const item of body.items) {
    if (!item.productId || !item.productName) return "each item needs productId and productName";
    if (typeof item.quantity !== "number" || item.quantity <= 0) return "each item needs a positive quantity";
    if (typeof item.unitCost !== "number" || item.unitCost < 0) return "each item needs a valid unitCost";
  }
  return null;
}

function total(items: PurchaseItem[]) {
  return items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
}

// List purchases, newest first. ?supplierId= filters to one supplier.
purchasesRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const supplierId = c.req.query("supplierId");
  const filter: Record<string, unknown> = { businessId: user.businessId };
  if (supplierId) filter.supplierId = supplierId;
  const docs = await db.collection("purchases").find(filter).sort({ _id: -1 }).limit(2000).toArray();
  return c.json(docs);
});

purchasesRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const doc = await db.collection("purchases").findOne({ _id: new ObjectId(c.req.param("id")), businessId: user.businessId });
  if (!doc) return c.json({ error: "Not found" }, 404);
  return c.json(doc);
});

// Create a purchase order. If status is "received" (default), stock is
// added immediately and — for Credit purchases — the supplier's balance
// (amount owed to them) goes up by the purchase total.
purchasesRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body: PurchaseInput = await c.req.json();
  const err = validate(body);
  if (err) return c.json({ error: err }, 400);

  const db = await getDb(c.env.MONGODB_URI);
  const status = body.status || "received";
  const totalCost = total(body.items);

  const doc = {
    businessId: user.businessId,
    supplierId: body.supplierId,
    supplierName: body.supplierName,
    items: body.items,
    totalCost,
    paymentMethod: body.paymentMethod,
    status,
    notes: body.notes || "",
    date: new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
  };
  const result = await db.collection("purchases").insertOne(doc);

  if (status === "received") {
    // Add received quantities to each product's stock.
    for (const item of body.items) {
      await db.collection("products").updateOne(
        { _id: new ObjectId(item.productId), businessId: user.businessId },
        { $inc: { stock: item.quantity } }
      );
    }
    // Credit purchases increase what the business owes the supplier.
    if (body.paymentMethod === "Credit") {
      await db.collection("suppliers").updateOne(
        { _id: new ObjectId(body.supplierId), businessId: user.businessId },
        { $inc: { balance: totalCost } }
      );
    }
  }

  return c.json({ ...doc, _id: result.insertedId }, 201);
});

// Mark a pending purchase as received — adds stock and (for Credit) updates
// the supplier balance, exactly once (guarded by the status check).
purchasesRoutes.post("/:id/receive", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = await getDb(c.env.MONGODB_URI);
  const purchase = await db.collection("purchases").findOne({ _id: new ObjectId(id), businessId: user.businessId });
  if (!purchase) return c.json({ error: "Not found" }, 404);
  if (purchase.status === "received") return c.json({ error: "Already received" }, 400);

  for (const item of purchase.items as PurchaseItem[]) {
    await db.collection("products").updateOne(
      { _id: new ObjectId(item.productId), businessId: user.businessId },
      { $inc: { stock: item.quantity } }
    );
  }
  if (purchase.paymentMethod === "Credit") {
    await db.collection("suppliers").updateOne(
      { _id: new ObjectId(purchase.supplierId), businessId: user.businessId },
      { $inc: { balance: purchase.totalCost } }
    );
  }
  const updated = await db.collection("purchases").findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { status: "received", receivedAt: new Date().toISOString() } },
    { returnDocument: "after" }
  );
  return c.json(updated);
});

purchasesRoutes.delete("/:id", requireRole("CEO", "Manager"), async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const result = await db.collection("purchases").deleteOne({ _id: new ObjectId(c.req.param("id")), businessId: user.businessId });
  if (result.deletedCount === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ deleted: true });
});
