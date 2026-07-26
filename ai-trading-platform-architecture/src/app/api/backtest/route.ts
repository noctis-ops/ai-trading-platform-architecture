import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { backtests } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import { generateCandles } from "@/lib/market/simulator";
import { getSymbolMeta, TIMEFRAMES, type Timeframe } from "@/lib/market/symbols";
import { getStrategyDefinition } from "@/lib/strategies";
import { runBacktest } from "@/lib/backtest/engine";

const schema = z.object({
  name: z.string().min(1).max(100),
  strategyId: z.string().uuid().nullable().optional(),
  type: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  params: z.record(z.string(), z.number()),
  initialBalance: z.number().positive().default(10000),
  leverage: z.number().min(1).max(50).default(3),
  bars: z.number().min(100).max(2000).default(1000),
});

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(backtests)
      .where(eq(backtests.userId, user.id))
      .orderBy(desc(backtests.createdAt))
      .limit(50);
    return NextResponse.json({ backtests: rows });
  } catch {
    return jsonError("Not authenticated", 401);
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
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid backtest request");
  const { name, strategyId, type, symbol, timeframe, params, initialBalance, leverage, bars } = parsed.data;

  if (!TIMEFRAMES.includes(timeframe as Timeframe)) return jsonError("Invalid timeframe");
  try {
    getSymbolMeta(symbol);
    getStrategyDefinition(type);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Invalid request");
  }

  const candles = generateCandles(symbol, timeframe as Timeframe, bars);
  const result = runBacktest({
    candles,
    strategyType: type,
    params,
    initialBalance,
    leverage,
    timeframe: timeframe as Timeframe,
  });

  const [saved] = await db
    .insert(backtests)
    .values({
      userId: user.id,
      strategyId: strategyId ?? null,
      name,
      symbol,
      timeframe,
      initialBalance: String(initialBalance),
      params,
      metrics: result.metrics,
      equityCurve: result.equityCurve,
      tradesLog: result.trades.slice(-200),
      status: "completed",
    })
    .returning();

  return NextResponse.json({ backtest: saved });
}
