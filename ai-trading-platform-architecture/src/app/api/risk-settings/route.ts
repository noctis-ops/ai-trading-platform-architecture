import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { riskSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount, getOrCreateRiskSettings, jsonError } from "@/lib/api-helpers";

const schema = z.object({
  maxLeverage: z.number().min(1).max(125),
  riskPerTradePct: z.number().min(0.1).max(20),
  maxPositionPct: z.number().min(1).max(100),
  maxDailyLossPct: z.number().min(1).max(100),
  maxDrawdownPct: z.number().min(1).max(100),
  maxOpenPositions: z.number().min(1).max(50),
});

export async function GET() {
  try {
    const user = await requireUser();
    const account = await getOrCreatePrimaryAccount(user);
    const settings = await getOrCreateRiskSettings(account.id);
    return NextResponse.json({ settings });
  } catch {
    return jsonError("Not authenticated", 401);
  }
}

export async function PUT(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid risk settings");

  const account = await getOrCreatePrimaryAccount(user);
  await getOrCreateRiskSettings(account.id);

  const values = parsed.data;
  const [updated] = await db
    .update(riskSettings)
    .set({
      maxLeverage: String(values.maxLeverage),
      riskPerTradePct: String(values.riskPerTradePct),
      maxPositionPct: String(values.maxPositionPct),
      maxDailyLossPct: String(values.maxDailyLossPct),
      maxDrawdownPct: String(values.maxDrawdownPct),
      maxOpenPositions: values.maxOpenPositions,
      updatedAt: new Date(),
    })
    .where(eq(riskSettings.accountId, account.id))
    .returning();

  return NextResponse.json({ settings: updated });
}
