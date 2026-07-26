import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import { getSymbolMeta } from "@/lib/market/symbols";
import { getLatestPrice } from "@/lib/market/simulator";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db.select().from(alerts).where(eq(alerts.userId, user.id)).orderBy(desc(alerts.createdAt));

    // Lazily evaluate active alerts against the latest simulated price.
    for (const alert of rows) {
      if (alert.status !== "active") continue;
      const price = getLatestPrice(alert.symbol);
      const hit =
        (alert.condition === "above" && price >= Number(alert.targetPrice)) ||
        (alert.condition === "below" && price <= Number(alert.targetPrice));
      if (hit) {
        await db.update(alerts).set({ status: "triggered", triggeredAt: new Date() }).where(eq(alerts.id, alert.id));
        alert.status = "triggered";
        alert.triggeredAt = new Date();
      }
    }

    return NextResponse.json({ alerts: rows });
  } catch {
    return jsonError("Not authenticated", 401);
  }
}

const schema = z.object({
  symbol: z.string(),
  condition: z.enum(["above", "below"]),
  targetPrice: z.number().positive(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid alert");
  try {
    getSymbolMeta(parsed.data.symbol);
  } catch {
    return jsonError("Unknown symbol");
  }

  const [created] = await db
    .insert(alerts)
    .values({ userId: user.id, symbol: parsed.data.symbol, condition: parsed.data.condition, targetPrice: String(parsed.data.targetPrice) })
    .returning();

  return NextResponse.json({ alert: created });
}

export async function DELETE(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return jsonError("id query param required");
  await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, user.id)));
  return NextResponse.json({ ok: true });
}
