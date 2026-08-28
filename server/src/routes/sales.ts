import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../db";
import { requireAuth } from "../auth";
import type { Env, AuthUser } from "../types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };

export const salesRoutes = new Hono<AppEnv>();

salesRoutes.use("*", requireAuth);

/**
 * List sales for the logged-in business.
 */
salesRoutes.get("/", async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);

  const docs = await db
    .collection("sales")
    .find({ businessId: user.businessId })
    .sort({ _id: -1 })
    .limit(2000)
    .toArray();

  return c.json(docs);
});

/**
 * Create a sale directly from an inventory product.
 *
 * The server is authoritative:
 * - product must exist
 * - product must belong to the user's business
 * - stock must be sufficient
 * - price comes from inventory
 * - total and profit are calculated automatically
 * - stock is reduced automatically
 */
salesRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const productId = String(body.productId || "");
  const quantity = Number(body.quantity);

  if (!productId || !ObjectId.isValid(productId)) {
    return c.json({ error: "A valid productId is required" }, 400);
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return c.json({ error: "Quantity must be a positive whole number" }, 400);
  }

  const db = await getDb(c.env.MONGODB_URI);

  const product = await db.collection("products").findOne({
    _id: new ObjectId(productId),
    businessId: user.businessId,
  });

  if (!product) {
    return c.json({ error: "Product not found" }, 404);
  }

  const currentStock = Number(product.stock || 0);

  if (currentStock < quantity) {
    return c.json(
      {
        error: `Insufficient stock. Only ${currentStock} ${product.unit || "units"} available.`,
        availableStock: currentStock,
      },
      400
    );
  }

  const costPrice = Number(product.costPrice || 0);
  const sellPrice = Number(product.sellPrice || 0);

  const totalPrice = quantity * sellPrice;
  const profit = quantity * (sellPrice - costPrice);

  /*
   * Atomic stock deduction.
   *
   * The stock condition is included in the update so two sales
   * cannot both successfully consume the same final units.
   */
  const stockUpdate = await db.collection("products").updateOne(
    {
      _id: new ObjectId(productId),
      businessId: user.businessId,
      stock: { $gte: quantity },
    },
    {
      $inc: { stock: -quantity },
      $set: { updatedAt: new Date().toISOString() },
    }
  );

  if (stockUpdate.modifiedCount !== 1) {
    return c.json(
      {
        error: "Stock changed before the sale was completed. Please try again.",
      },
      409
    );
  }

  const sale = {
    businessId: user.businessId,
    productId: product._id,
    productName: product.name,
    category: product.category,
    unit: product.unit,
    quantity,
    unitPrice: sellPrice,
    costPrice,
    totalPrice,
    profit,
    customerName: body.customerName || "Walk-in",
    paymentMethod: body.paymentMethod || "Cash",
    date: body.date || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  };

  try {
    const result = await db.collection("sales").insertOne(sale);

    return c.json(
      {
        ...sale,
        _id: result.insertedId,
        remainingStock: currentStock - quantity,
      },
      201
    );
  } catch (error) {
    /*
     * If recording the sale fails after stock was deducted,
     * restore the stock so inventory remains consistent.
     */
    await db.collection("products").updateOne(
      {
        _id: new ObjectId(productId),
        businessId: user.businessId,
      },
      {
        $inc: { stock: quantity },
      }
    );

    throw error;
  }
});

export default salesRoutes;
