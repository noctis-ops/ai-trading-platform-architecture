import { NextRequest, NextResponse } from "next/server";
import { generateCandles } from "@/lib/market/simulator";
import { getSymbolMeta, TIMEFRAMES, type Timeframe } from "@/lib/market/symbols";
import { jsonError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? "BTCUSDT";
  const timeframe = (searchParams.get("timeframe") ?? "1h") as Timeframe;
  const limit = Math.min(Number(searchParams.get("limit") ?? 300), 2000);

  if (!TIMEFRAMES.includes(timeframe)) return jsonError("Invalid timeframe");
  try {
    getSymbolMeta(symbol);
  } catch {
    return jsonError("Unknown symbol");
  }

  const candles = generateCandles(symbol, timeframe, limit);
  return NextResponse.json({ symbol, timeframe, candles });
}
