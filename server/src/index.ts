import { Hono } from "hono";
import { cors } from "hono/cors";
import { crudRouter } from "./crud";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { productsRoutes } from "./routes/products";
import { purchasesRoutes } from "./routes/purchases";

import { salesRoutes } from "./routes/sales";
import type { Env, AuthUser } from "./types";

const app = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>();

// Node compatibility shim: on Cloudflare, c.env is auto-populated from
// Worker bindings/secrets. On plain Node (Render, etc.) there's no such
// thing, so expose process.env the same way every route already expects.
// Always merge (rather than only-if-undefined) since some adapters give
// an empty object instead of undefined, which would otherwise skip this.
app.use("*", async (c, next) => {
  (c as any).env = { ...process.env, ...(c.env || {}) };
  await next();
});

app.use(
  "*",
  cors({
    origin: "*", // tighten to your frontend's real domain once deployed
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

app.get("/", (c) => c.json({ ok: true, service: "hikma-business-os-api" }));
app.get("/health", (c) => c.json({ status: "healthy" }));

// Temporary diagnostics — safe to keep, doesn't leak secret values.
app.get("/debug", async (c) => {
  const hasMongoUri = !!c.env.MONGODB_URI;
  const hasJwtSecret = !!c.env.JWT_SECRET;
  let dbOk = false;
  let dbError: string | null = null;
  if (hasMongoUri) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb(c.env.MONGODB_URI);
      await db.command({ ping: 1 });

      const admin = db.admin();
      const hello = await admin.command({ hello: 1 });

      dbOk = true;

      (c as any).transactionDiagnostics = {
        setName: hello.setName || null,
        msg: hello.msg || null,
        isWritablePrimary: !!hello.isWritablePrimary,
        logicalSessionTimeoutMinutes:
          hello.logicalSessionTimeoutMinutes ?? null,
        transactionCapable: !!(
          hello.setName ||
          hello.msg === "isdbgrid"
        ),
      };
    } catch (e: any) {
      dbError = e?.message || String(e);
    }
  }
  return c.json({
    hasMongoUri,
    hasJwtSecret,
    dbOk,
    dbError,
    transactionDiagnostics: (c as any).transactionDiagnostics || null,
  });
});

app.route("/api/auth", authRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/products", productsRoutes);
app.route("/api/purchases", purchasesRoutes);

app.route("/api/sales", salesRoutes);
app.route("/api/customers", crudRouter("customers"));
app.route("/api/suppliers", crudRouter("suppliers"));
app.route("/api/services", crudRouter("services"));
app.route("/api/expenses", crudRouter("expenses"));
app.route("/api/employees", crudRouter("employees"));

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
