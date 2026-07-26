import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { strategies } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";

const schema = z.object({
  name: z.string().min(2).max(80).optional(),
  status: z.enum(["draft", "active", "paused"]).optional(),
  params: z.record(z.string(), z.number()).optional(),
  symbol: z.string().optional(),
  timeframe: z.string().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid update");

  const [updated] = await db
    .update(strategies)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(strategies.id, id), eq(strategies.userId, user.id)))
    .returning();

  if (!updated) return jsonError("Strategy not found", 404);
  return NextResponse.json({ strategy: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  await db.delete(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, user.id)));
  return NextResponse.json({ ok: true });
}
