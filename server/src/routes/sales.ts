import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "../db";
import { requireAuth, requireRole } from "../auth";
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

/**
 * Delete a sale and restore its quantity to stock.
 * CEO and Manager only.
 */
salesRoutes.delete("/:id", requireRole("CEO", "Manager"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  if (!id || !ObjectId.isValid(id)) {
    return c.json({ error: "Invalid sale ID" }, 400);
  }

  const db = await getDb(c.env.MONGODB_URI);
  const sales = db.collection("sales");

  const sale = await sales.findOne({
    _id: new ObjectId(id),
    businessId: user.businessId,
  });

  if (!sale) {
    return c.json({ error: "Sale not found" }, 404);
  }

  const quantity = Number(sale.quantity || 0);

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return c.json({ error: "Sale has an invalid quantity" }, 400);
  }

  const productId = sale.productId;

  if (!productId || !ObjectId.isValid(String(productId))) {
    return c.json({ error: "Sale has an invalid product reference" }, 400);
  }

  const productUpdate = await db.collection("products").updateOne(
    {
      _id: new ObjectId(String(productId)),
      businessId: user.businessId,
    },
    {
      $inc: { stock: quantity },
      $set: { updatedAt: new Date().toISOString() },
    }
  );

  if (productUpdate.matchedCount !== 1) {
    return c.json(
      { error: "Product for this sale was not found. Sale was not deleted." },
      404
    );
  }

  try {
    const result = await sales.deleteOne({
      _id: new ObjectId(id),
      businessId: user.businessId,
    });

    if (result.deletedCount !== 1) {
      await db.collection("products").updateOne(
        {
          _id: new ObjectId(String(productId)),
          businessId: user.businessId,
        },
        { $inc: { stock: -quantity } }
      );

      return c.json({ error: "Sale could not be deleted" }, 409);
    }

    return c.json({
      success: true,
      message: "Sale deleted and stock restored",
      restoredQuantity: quantity,
    });
  } catch (error) {
    await db.collection("products").updateOne(
      {
        _id: new ObjectId(String(productId)),
        businessId: user.businessId,
      },
      { $inc: { stock: -quantity } }
    );

    throw error;
  }
});

/**
 * Clear all sales for the logged-in business.
 * Restores sold quantities to inventory.
 * CEO and Manager only.
 */
salesRoutes.delete("/reset/all", requireRole("CEO", "Manager"), async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);

  const sales = await db.collection("sales")
    .find({ businessId: user.businessId })
    .toArray();

  if (sales.length === 0) {
    return c.json({
      success: true,
      message: "No sales to clear",
      deletedSales: 0,
      restoredUnits: 0,
    });
  }

  const restore = new Map<string, number>();

  for (const sale of sales) {
    const productId = sale.productId;
    const quantity = Number(sale.quantity || 0);

    if (
      productId &&
      ObjectId.isValid(String(productId)) &&
      Number.isInteger(quantity) &&
      quantity > 0
    ) {
      const key = String(productId);
      restore.set(key, (restore.get(key) || 0) + quantity);
    }
  }

  for (const [productId, quantity] of restore) {
    await db.collection("products").updateOne(
      {
        _id: new ObjectId(productId),
        businessId: user.businessId,
      },
      {
        $inc: { stock: quantity },
        $set: { updatedAt: new Date().toISOString() },
      }
    );
  }

  const result = await db.collection("sales").deleteMany({
    businessId: user.businessId,
  });

  return c.json({
    success: true,
    message: "Sales history cleared and stock restored",
    deletedSales: result.deletedCount,
    restoredUnits: [...restore.values()].reduce((a, n) => a + n, 0),
  });
});

export default salesRoutes;
