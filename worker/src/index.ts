import { Hono } from "hono";
import { cors } from "hono/cors";
import { crudRouter } from "./crud";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
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

app.route("/api/auth", authRoutes);
app.route("/api/dashboard", dashboardRoutes);

// Tenant-scoped CRUD collections
app.route("/api/products", crudRouter("products"));
app.route("/api/sales", crudRouter("sales"));
app.route("/api/customers", crudRouter("customers"));
app.route("/api/suppliers", crudRouter("suppliers"));
app.route("/api/services", crudRouter("services"));
app.route("/api/expenses", crudRouter("expenses"));

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
