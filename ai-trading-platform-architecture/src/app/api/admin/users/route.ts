import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, subscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  if (user.role !== "admin") return jsonError("Admin access required", 403);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      plan: subscriptions.plan,
      balance: accounts.balance,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .leftJoin(accounts, eq(accounts.userId, users.id));

  return NextResponse.json({ users: rows });
}
