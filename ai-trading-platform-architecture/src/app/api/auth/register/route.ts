import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { accounts, riskSettings, subscriptions, users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { name, email, password } = parsed.data;

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    return jsonError("An account with that email already exists.", 409);
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ name, email, passwordHash }).returning();

  const [account] = await db
    .insert(accounts)
    .values({ userId: user.id, name: "Main Portfolio", balance: "100000" })
    .returning();
  await db.insert(riskSettings).values({ accountId: account.id });
  await db.insert(subscriptions).values({ userId: user.id, plan: "free" });

  await createSession(user.id);

  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
