import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../db";
import { requireAuth } from "../auth";
import type { Env, AuthUser } from "../types";

type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

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
    .sort({ createdAt: -1 })
    .limit(2000)
    .toArray();

  return c.json(docs);
});

/**
 * Create a sale.
 *
 * IMPORTANT:
 * The server is authoritative for:
 * - product
 * - quantity
 * - selling price
 * - cost
 * - total
 * - profit
 * - payment method
 * - cash amount
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
    return c.json(
      { error: "Quantity must be a positive whole number" },
      400
    );
  }

  const paymentMethod = String(body.paymentMethod || "Cash").trim();

  const allowedPayments = [
    "Cash",
    "M-Pesa",
    "Airtel Money",
    "Card",
    "Bank",
    "Other",
  ];

  if (!allowedPayments.includes(paymentMethod)) {
    return c.json(
      {
        error: `Invalid payment method. Allowed: ${allowedPayments.join(", ")}`,
      },
      400
    );
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
        error: `Insufficient stock. Only ${currentStock} ${
          product.unit || "units"
        } available.`,
        availableStock: currentStock,
      },
      400
    );
  }

  const costPrice = Number(product.costPrice || 0);
  const sellPrice = Number(product.sellPrice || 0);

  if (!Number.isFinite(sellPrice) || sellPrice < 0) {
    return c.json({ error: "Product selling price is invalid" }, 400);
  }

  const totalPrice = Number((quantity * sellPrice).toFixed(2));
  const profit = Number(
    (quantity * (sellPrice - costPrice)).toFixed(2)
  );

  /*
   * Cash/payment accounting.
   *
   * A completed sale contributes its full total to the selected
   * payment method. Cash sales explicitly persist cashAmount.
   */
  const paymentAmount = totalPrice;
  const cashAmount = paymentMethod === "Cash" ? totalPrice : 0;

  /*
   * Deduct stock atomically.
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
        error:
          "Stock changed before the sale was completed. Please try again.",
      },
      409
    );
  }

  const now = new Date().toISOString();
  const saleDate =
    body.date || now.slice(0, 10);

  const sale = {
    businessId: user.businessId,

    productId: product._id,
    productName: product.name,
    category: product.category,
    unit: product.unit,

    quantity,

    unitPrice: sellPrice,
    costPrice,

    // Canonical totals
    totalPrice,
    total: totalPrice,

    // Profit
    profit,

    // Payment/accounting
    paymentMethod,
    paymentAmount,
    cashAmount,

    customerName: String(
      body.customerName || "Walk-in"
    ).trim(),

    date: saleDate,
    createdAt: now,
    updatedAt: now,
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
     * Sale failed to save, so restore stock.
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
