import { NextResponse } from "next/server";
import { SYMBOLS } from "@/lib/market/symbols";
import { getLatestPrice } from "@/lib/market/simulator";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = SYMBOLS.map((s) => ({ ...s, lastPrice: getLatestPrice(s.symbol) }));
  return NextResponse.json({ symbols: data });
}
