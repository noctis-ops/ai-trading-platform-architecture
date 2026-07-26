// ---------------------------------------------------------------------------
// Order placement endpoint.
//
// Flow: authenticate -> load account & risk settings -> load open positions
// -> run RiskEngine.validateOrder -> if allowed, open a simulated fill at the
// current mark price, persist order + position + trade rows atomically.
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { orders, positions, trades } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount, getOrCreateRiskSettings, jsonError } from "@/lib/api-helpers";
import { getLatestPrice } from "@/lib/market/simulator";
import { getSymbolMeta } from "@/lib/market/symbols";
import { computeLiquidationPrice, validateOrder } from "@/lib/risk/engine";
import { enrichPosition, summarizePortfolio } from "@/lib/portfolio";

const schema = z.object({
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  leverage: z.number().min(1).max(125),
  stopLoss: z.number().positive().nullable().optional(),
  takeProfit: z.number().positive().nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const account = await getOrCreatePrimaryAccount(user);
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.accountId, account.id))
      .orderBy(desc(orders.createdAt))
      .limit(100);
    return NextResponse.json({ orders: rows });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid order");
  const { symbol, side, quantity, leverage, stopLoss, takeProfit } = parsed.data;

  let symbolMeta;
  try {
    symbolMeta = getSymbolMeta(symbol);
  } catch {
    return jsonError("Unknown symbol");
  }

  const account = await getOrCreatePrimaryAccount(user);
  const riskCfg = await getOrCreateRiskSettings(account.id);
  const price = getLatestPrice(symbol);

  const openPositionRows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.accountId, account.id), eq(positions.status, "open")));
  const enrichedOpen = openPositionRows.map((p) => enrichPosition(p));
  const summary = summarizePortfolio(Number(account.balance), enrichedOpen);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const dailyRealizedPnl = 0; // Simplified: extend with a trades-by-day aggregate for full daily PnL tracking.

  const riskResult = validateOrder(
    { symbol, side, quantity, price, leverage },
    {
      maxLeverage: Number(riskCfg.maxLeverage),
      riskPerTradePct: Number(riskCfg.riskPerTradePct),
      maxPositionPct: Number(riskCfg.maxPositionPct),
      maxDailyLossPct: Number(riskCfg.maxDailyLossPct),
      maxDrawdownPct: Number(riskCfg.maxDrawdownPct),
      maxOpenPositions: riskCfg.maxOpenPositions,
    },
    {
      equity: summary.equity,
      balance: summary.balance,
      openPositions: enrichedOpen.map((p) => ({
        symbol: p.symbol,
        quantity: Number(p.quantity),
        entryPrice: Number(p.entryPrice),
        leverage: Number(p.leverage),
        side: p.side as "long" | "short",
      })),
      dailyRealizedPnl,
      peakEquity: Math.max(summary.equity, Number(account.balance)),
      maxSymbolLeverage: symbolMeta.maxLeverage,
    },
  );

  if (!riskResult.allowed) {
    await db.insert(orders).values({
      accountId: account.id,
      symbol,
      side,
      quantity: String(quantity),
      price: String(price),
      leverage: String(leverage),
      status: "rejected",
      rejectReason: riskResult.reason,
    });
    return jsonError(riskResult.reason ?? "Order rejected by risk engine", 422);
  }

  const [order] = await db
    .insert(orders)
    .values({
      accountId: account.id,
      symbol,
      side,
      quantity: String(quantity),
      price: String(price),
      leverage: String(leverage),
      stopLoss: stopLoss ? String(stopLoss) : null,
      takeProfit: takeProfit ? String(takeProfit) : null,
      status: "filled",
    })
    .returning();

  const positionSide = side === "buy" ? "long" : "short";
  const liquidationPrice = computeLiquidationPrice({ side: positionSide, entryPrice: price, leverage });

  const [position] = await db
    .insert(positions)
    .values({
      accountId: account.id,
      symbol,
      side: positionSide,
      quantity: String(quantity),
      entryPrice: String(price),
      leverage: String(leverage),
      stopLoss: stopLoss ? String(stopLoss) : null,
      takeProfit: takeProfit ? String(takeProfit) : null,
      liquidationPrice: String(liquidationPrice),
      status: "open",
    })
    .returning();

  await db.insert(trades).values({
    accountId: account.id,
    orderId: order.id,
    positionId: position.id,
    symbol,
    side,
    quantity: String(quantity),
    price: String(price),
    fee: String(quantity * price * 0.0004),
  });

  return NextResponse.json({ order, position, warnings: riskResult.warnings });
}
