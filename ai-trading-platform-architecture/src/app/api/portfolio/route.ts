import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount } from "@/lib/api-helpers";
import { db } from "@/db";
import { positions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { enrichPosition, summarizePortfolio } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const account = await getOrCreatePrimaryAccount(user);
    const openPositions = await db
      .select()
      .from(positions)
      .where(and(eq(positions.accountId, account.id), eq(positions.status, "open")));

    const enriched = openPositions.map((p) => enrichPosition(p));
    const summary = summarizePortfolio(Number(account.balance), enriched);

    return NextResponse.json({ account, positions: enriched, summary });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
