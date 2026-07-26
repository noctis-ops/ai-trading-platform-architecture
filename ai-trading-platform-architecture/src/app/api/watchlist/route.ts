import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import { getSymbolMeta } from "@/lib/market/symbols";
import { getLatestPrice } from "@/lib/market/simulator";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db.select().from(watchlist).where(eq(watchlist.userId, user.id));
    const withPrices = rows.map((r) => ({ ...r, lastPrice: getLatestPrice(r.symbol) }));
    return NextResponse.json({ watchlist: withPrices });
  } catch {
    return jsonError("Not authenticated", 401);
  }
}

const schema = z.object({ symbol: z.string() });

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid symbol");
  try {
    getSymbolMeta(parsed.data.symbol);
  } catch {
    return jsonError("Unknown symbol");
  }

  const [created] = await db
    .insert(watchlist)
    .values({ userId: user.id, symbol: parsed.data.symbol })
    .onConflictDoNothing()
    .returning();

  return NextResponse.json({ item: created ?? null });
}

export async function DELETE(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  if (!symbol) return jsonError("symbol query param required");
  await db.delete(watchlist).where(and(eq(watchlist.userId, user.id), eq(watchlist.symbol, symbol)));
  return NextResponse.json({ ok: true });
}
