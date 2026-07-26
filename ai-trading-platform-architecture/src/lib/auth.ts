// ---------------------------------------------------------------------------
// Owner-console authentication.
//
// Scope change from v1: there is no customer-facing web login any more.
// Customers authenticate implicitly through Telegram (their `telegramId` is
// their identity). This module now protects ONLY the owner/support console,
// which is the highest-privilege surface in the product — it can extend
// subscriptions, ban customers, and read revenue data.
//
// Design:
//  - bcrypt cost 12 for staff passwords.
//  - Opaque random session tokens; only the SHA-256 hash is persisted, so a
//    database leak does not yield usable sessions, and revocation is instant.
//  - Sessions are bound to a role so authorisation is a pure function of the
//    session row, never of client input.
// ---------------------------------------------------------------------------
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";

export const SESSION_COOKIE = "qa_console";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8h — short, this is an admin surface

export type AdminRole = "owner" | "support";

export type AdminIdentity = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare for any secret we check ourselves (e.g. webhook tokens). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function createAdminSession(adminUserId: string, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(adminSessions).values({
    adminUserId,
    tokenHash: hashToken(token),
    expiresAt,
    ipAddress: ip,
    userAgent,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getCurrentAdmin(): Promise<AdminIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      role: adminUsers.role,
      isActive: adminUsers.isActive,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
    .where(
      and(
        eq(adminSessions.tokenHash, hashToken(token)),
        gt(adminSessions.expiresAt, new Date()),
        isNull(adminSessions.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role as AdminRole };
}

/** Throws unless a session exists — use at the top of every console route. */
export async function requireAdmin(minRole: AdminRole = "support"): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin();
  if (!admin) throw new UnauthorizedError();
  if (minRole === "owner" && admin.role !== "owner") throw new ForbiddenError();
  return admin;
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}
