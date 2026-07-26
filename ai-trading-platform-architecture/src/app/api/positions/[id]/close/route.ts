import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, positions, trades } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount, jsonError } from "@/lib/api-helpers";
import { getLatestPrice } from "@/lib/market/simulator";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const account = await getOrCreatePrimaryAccount(user);
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, id), eq(positions.accountId, account.id), eq(positions.status, "open")))
    .limit(1);
  const position = rows[0];
  if (!position) return jsonError("Position not found", 404);

  const closePrice = getLatestPrice(position.symbol);
  const quantity = Number(position.quantity);
  const entryPrice = Number(position.entryPrice);
  const priceDelta = position.side === "long" ? closePrice - entryPrice : entryPrice - closePrice;
  const fee = quantity * closePrice * 0.0004;
  const realizedPnl = priceDelta * quantity - fee;

  await db
    .update(positions)
    .set({ status: "closed", closePrice: String(closePrice), realizedPnl: String(realizedPnl), closedAt: new Date() })
    .where(eq(positions.id, position.id));

  await db.insert(trades).values({
    accountId: account.id,
    positionId: position.id,
    symbol: position.symbol,
    side: position.side === "long" ? "sell" : "buy",
    quantity: String(quantity),
    price: String(closePrice),
    fee: String(fee),
    realizedPnl: String(realizedPnl),
  });

  await db
    .update(accounts)
    .set({ balance: String(Number(account.balance) + realizedPnl) })
    .where(eq(accounts.id, account.id));

  return NextResponse.json({ closePrice, realizedPnl });
}
