import { NextResponse } from "next/server";
import { getAllLatestPrices } from "@/lib/market/simulator";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ prices: getAllLatestPrices(), ts: Date.now() });
}
