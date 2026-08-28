import { Hono } from "hono";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "../db";
import { signToken, requireAuth, requireRole } from "../auth";
import type { Env, AuthUser } from "../types";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };
export const authRoutes = new Hono<AppEnv>();

function genBusinessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeBusinessCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

// Create a new business + its CEO account. Returns the business code
// the CEO shares with staff so they can find the right login list.
authRoutes.post("/register-business", async (c) => {
  const { businessName, ownerName, pin } = await c.req.json();

  const cleanBusinessName = String(businessName || "").trim();
  const cleanOwnerName = String(ownerName || "").trim();

  if (!cleanBusinessName || !cleanOwnerName || !/^\d{4}$/.test(String(pin || ""))) {
    return c.json(
      { error: "businessName, ownerName and a 4-digit pin are required" },
      400
    );
  }
  const db = await getDb(c.env.MONGODB_URI);
  let code = genBusinessCode();
  while (await db.collection("businesses").findOne({ code })) code = genBusinessCode();

  const biz = await db.collection("businesses").insertOne({
    name: cleanBusinessName,
    code,
    createdAt: new Date().toISOString(),
  });
  const pinHash = await bcrypt.hash(pin, 10);
  const user = await db.collection("users").insertOne({
    businessId: biz.insertedId.toString(),
    name: cleanOwnerName,
    role: "CEO",
    pinHash,
    createdAt: new Date().toISOString(),
  });

  const token = await signToken(
    {
      id: user.insertedId.toString(),
      businessId: biz.insertedId.toString(),
      role: "CEO",
      name: cleanOwnerName,
    },
    c.env.JWT_SECRET
  );

  return c.json(
    {
      token,
      businessCode: code,
      user: {
        id: user.insertedId.toString(),
        name: cleanOwnerName,
        role: "CEO",
      },
    },
    201
  );
});

// List the login "cards" (name/role only, no pin) for a business code.
authRoutes.get("/users", async (c) => {
  const code = normalizeBusinessCode(c.req.query("businessCode"));
  if (!code) {
    return c.json({ error: "businessCode query param required" }, 400);
  }

  const db = await getDb(c.env.MONGODB_URI);
  const biz = await db.collection("businesses").findOne({ code });
  if (!biz) return c.json({ error: "Business not found" }, 404);
  const users = await db
    .collection("users")
    .find({ businessId: biz._id.toString() }, { projection: { pinHash: 0 } })
    .toArray();
  return c.json({ business: { name: biz.name, code: biz.code }, users });
});

authRoutes.post("/login", async (c) => {
  const { businessCode, userId, pin } = await c.req.json();
  const code = normalizeBusinessCode(businessCode);
  const id = String(userId || "").trim();

  if (!code || !id || !pin) {
    return c.json(
      { error: "businessCode, userId and pin required" },
      400
    );
  }

  if (!ObjectId.isValid(id)) {
    return c.json({ error: "Invalid userId" }, 400);
  }

  const db = await getDb(c.env.MONGODB_URI);
  const biz = await db.collection("businesses").findOne({ code });

  if (!biz) return c.json({ error: "Business not found" }, 404);

  const user = await db.collection("users").findOne({
    _id: new ObjectId(id),
    businessId: biz._id.toString(),
  });
  if (!user) return c.json({ error: "User not found" }, 404);
  const ok = await bcrypt.compare(pin, user.pinHash);
  if (!ok) return c.json({ error: "Incorrect PIN" }, 401);

  const token = await signToken(
    { id: user._id.toString(), businessId: biz._id.toString(), role: user.role, name: user.name },
    c.env.JWT_SECRET
  );
  return c.json({
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      role: user.role,
    },
  });
});

// Add a new user (Manager/Staff) to the business. CEO or Manager only.
authRoutes.post("/users", requireAuth, requireRole("CEO", "Manager"), async (c) => {
  const actor = c.get("user");
  const { name, role, pin } = await c.req.json();
  if (!name || !["Manager", "Staff"].includes(role) || !/^\d{4}$/.test(pin || "")) {
    return c.json({ error: "name, role (Manager|Staff) and a 4-digit pin are required" }, 400);
  }

  // Managers can create Staff only. CEO can create Manager or Staff.
  if (actor.role === "Manager" && role !== "Staff") {
    return c.json({ error: "Managers can create Staff accounts only" }, 403);
  }
  const db = await getDb(c.env.MONGODB_URI);
  const pinHash = await bcrypt.hash(pin, 10);
  const result = await db.collection("users").insertOne({
    businessId: actor.businessId,
    name,
    role,
    pinHash,
    createdAt: new Date().toISOString(),
  });
  return c.json({ id: result.insertedId, name, role }, 201);
});

// Update own profile (name/pin), or CEO editing anyone in the business.
authRoutes.delete("/users/:id", requireAuth, requireRole("CEO", "Manager"), async (c) => {
  const actor = c.get("user");
  const id = String(c.req.param("id") || "").trim();

  if (!ObjectId.isValid(id)) {
    return c.json({ error: "Invalid userId" }, 400);
  }

  if (actor.id === id) {
    return c.json({ error: "You cannot delete your own account" }, 400);
  }

  const db = await getDb(c.env.MONGODB_URI);
  const result = await db.collection("users").deleteOne({
    _id: new ObjectId(id),
    businessId: actor.businessId,
  });

  if (!result.deletedCount) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ ok: true, deletedUserId: id });
});

authRoutes.put("/users/:id", requireAuth, async (c) => {
  const actor = c.get("user");
  const id = c.req.param("id");
  if (actor.id !== id && actor.role !== "CEO") return c.json({ error: "Forbidden" }, 403);
  const { name, pin } = await c.req.json();
  const update: Record<string, unknown> = {};
  if (name) update.name = name;
  if (pin) {
    if (!/^\d{4}$/.test(pin)) return c.json({ error: "PIN must be 4 digits" }, 400);
    update.pinHash = await bcrypt.hash(pin, 10);
  }
  const db = await getDb(c.env.MONGODB_URI);
  const result = await db
    .collection("users")
    .findOneAndUpdate(
      { _id: new ObjectId(id), businessId: actor.businessId },
      { $set: update },
      { returnDocument: "after", projection: { pinHash: 0 } }
    );
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});
