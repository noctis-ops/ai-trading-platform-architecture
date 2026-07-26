import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backtests } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const rows = await db
    .select()
    .from(backtests)
    .where(and(eq(backtests.id, id), eq(backtests.userId, user.id)))
    .limit(1);
  if (!rows[0]) return jsonError("Backtest not found", 404);
  return NextResponse.json({ backtest: rows[0] });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  await db.delete(backtests).where(and(eq(backtests.id, id), eq(backtests.userId, user.id)));
  return NextResponse.json({ ok: true });
}
