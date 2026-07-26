// ---------------------------------------------------------------------------
// Small shared helpers for API route handlers.
// ---------------------------------------------------------------------------
import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, riskSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Fetches the user's primary trading account, creating one (with default
 * risk settings) on first use. Keeps onboarding to zero steps. */
export async function getOrCreatePrimaryAccount(user: CurrentUser) {
  const existing = await db.select().from(accounts).where(eq(accounts.userId, user.id)).limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(accounts)
    .values({ userId: user.id, name: "Main Portfolio" })
    .returning();

  await db.insert(riskSettings).values({ accountId: created.id });

  return created;
}

export async function getOrCreateRiskSettings(accountId: string) {
  const existing = await db.select().from(riskSettings).where(eq(riskSettings.accountId, accountId)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db.insert(riskSettings).values({ accountId }).returning();
  return created;
}
