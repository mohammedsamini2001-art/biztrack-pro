import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import { requireAuth, requireRole } from "./auth";
import type { Env, AuthUser } from "./types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };

// Builds a scoped CRUD router for a collection. Every document is
// implicitly scoped to the caller's businessId so tenants never see
// each other's data.
export function crudRouter(collectionName: string) {
  const app = new Hono<AppEnv>();
  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const user = c.get("user");
    const db = await getDb(c.env.MONGODB_URI);
    const docs = await db
      .collection(collectionName)
      .find({ businessId: user.businessId })
      .sort({ _id: -1 })
      .limit(2000)
      .toArray();
    return c.json(docs);
  });

  app.get("/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");

    if (!ObjectId.isValid(id)) {
      return c.json({ error: "Invalid ID" }, 400);
    }

    const db = await getDb(c.env.MONGODB_URI);

    const doc = await db.collection(collectionName).findOne({
      _id: new ObjectId(id),
      businessId: user.businessId,
    });

    if (!doc) return c.json({ error: "Not found" }, 404);

    return c.json(doc);
  });

  app.post("/", requireRole("CEO", "Manager"), async (c) => {
    const user = c.get("user");
    const body = await c.req.json();
    delete body._id;
    delete body.businessId;
    const db = await getDb(c.env.MONGODB_URI);
    const doc = { ...body, businessId: user.businessId, createdAt: new Date().toISOString() };
    const result = await db.collection(collectionName).insertOne(doc);
    return c.json({ ...doc, _id: result.insertedId }, 201);
  });

  app.put("/:id", requireRole("CEO", "Manager"), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = await c.req.json();
    delete body._id;
    delete body.businessId;
    const db = await getDb(c.env.MONGODB_URI);
    const result = await db
      .collection(collectionName)
      .findOneAndUpdate(
        { _id: new ObjectId(id), businessId: user.businessId },
        { $set: { ...body, updatedAt: new Date().toISOString() } },
        { returnDocument: "after" }
      );
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  });

  app.delete("/:id", requireRole("CEO", "Manager"), async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const db = await getDb(c.env.MONGODB_URI);
    const result = await db
      .collection(collectionName)
      .deleteOne({ _id: new ObjectId(id), businessId: user.businessId });
    if (result.deletedCount === 0) return c.json({ error: "Not found" }, 404);
    return c.json({ deleted: true });
  });

  return app;
}
