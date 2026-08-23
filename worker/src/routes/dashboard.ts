import { Hono } from "hono";
import { getDb } from "../db";
import { requireAuth } from "../auth";
import type { Env, AuthUser } from "../types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use("*", requireAuth);

function daysAgoISO(d: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString().split("T")[0];
}

dashboardRoutes.get("/summary", async (c) => {
  const user = c.get("user");
  const db = await getDb(c.env.MONGODB_URI);
  const businessId = user.businessId;
  const today = new Date().toISOString().split("T")[0];
  const from30 = daysAgoISO(30);

  const sales = db.collection("sales");
  const products = db.collection("products");
  const customers = db.collection("customers");
  const expenses = db.collection("expenses");

  const [todaySales, monthSales, allProducts, custCount, monthExpenses] = await Promise.all([
    sales.find({ businessId, date: today }).toArray(),
    sales.find({ businessId, date: { $gte: from30 } }).toArray(),
    products.find({ businessId }).toArray(),
    customers.countDocuments({ businessId }),
    expenses.find({ businessId, date: { $gte: from30 } }).toArray(),
  ]);

  const sum = (arr: any[], key: string) => arr.reduce((a, s) => a + (s[key] || 0), 0);
  const todayRevenue = sum(todaySales, "totalPrice");
  const todayProfit = sum(todaySales, "profit");
  const monthRevenue = sum(monthSales, "totalPrice");
  const monthProfit = sum(monthSales, "profit");
  const monthExpenseTotal = sum(monthExpenses, "amount");
  const stockValue = allProducts.reduce((a, p) => a + p.stock * p.costPrice, 0);
  const lowStock = allProducts.filter((p) => p.stock <= p.reorderLevel);

  return c.json({
    todayRevenue,
    todayProfit,
    todayTransactions: todaySales.length,
    monthRevenue,
    monthProfit,
    monthExpenseTotal,
    netIncome: monthProfit - monthExpenseTotal,
    stockValue,
    productCount: allProducts.length,
    customerCount: custCount,
    lowStock,
  });
});
