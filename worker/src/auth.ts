import { SignJWT, jwtVerify } from "jose";
import type { Context, Next } from "hono";
import type { Env, AuthUser } from "./types";

export async function signToken(user: AuthUser, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key);
}

export async function verifyToken(token: string, secret: string): Promise<AuthUser> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return payload as unknown as AuthUser;
}

// Hono middleware: requires a valid Bearer token, attaches user to context
export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: AuthUser } }>, next: Next) {
  const header = c.req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "Missing token" }, 401);
  try {
    const user = await verifyToken(token, c.env.JWT_SECRET);
    c.set("user", user);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}

// Restrict a route to specific roles
export function requireRole(...roles: Array<AuthUser["role"]>) {
  return async (c: Context<{ Bindings: Env; Variables: { user: AuthUser } }>, next: Next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
}
