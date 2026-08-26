import { Hono } from "hono";
import { cors } from "hono/cors";
import { crudRouter } from "./crud";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { productsRoutes } from "./routes/products";
import type { Env, AuthUser } from "./types";

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

app.use(
  "*",
  cors({
    origin: "*", // tighten to your Pages domain once deployed
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.get("/", (c) => c.json({ ok: true, service: "biztrack-pro-api" }));
app.get("/health", (c) => c.json({ status: "healthy" }));

// Temporary diagnostics endpoint — remove once MongoDB connection is confirmed working.
// Reveals whether secrets are bound and, if a DB connection is attempted, the real error.
app.get("/debug", async (c) => {
  const hasMongoUri = !!c.env.MONGODB_URI;
  const hasJwtSecret = !!c.env.JWT_SECRET;
  const mongoUriPrefix = c.env.MONGODB_URI ? c.env.MONGODB_URI.slice(0, 20) : null;

  let dbError: string | null = null;
  let dbOk = false;
  if (hasMongoUri) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb(c.env.MONGODB_URI);
      await db.command({ ping: 1 });
      dbOk = true;
    } catch (e: any) {
      dbError = e?.message || String(e);
    }
  }

  return c.json({ hasMongoUri, hasJwtSecret, mongoUriPrefix, dbOk, dbError });
});

app.route("/api/auth", authRoutes);
app.route("/api/dashboard", dashboardRoutes);

// Products has a dedicated router (variants, images, custom fields, expiry, SKU, search)
app.route("/api/products", productsRoutes);

// Tenant-scoped CRUD collections
app.route("/api/sales", crudRouter("sales"));
app.route("/api/customers", crudRouter("customers"));
app.route("/api/suppliers", crudRouter("suppliers"));
app.route("/api/services", crudRouter("services"));
app.route("/api/expenses", crudRouter("expenses"));

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  // TEMP: verbose error output for debugging deployment. Remove once MongoDB connection is confirmed working.
  return c.json({ error: "Internal server error", debug: String(err && err.stack ? err.stack : err) }, 500);
});

export default app;
