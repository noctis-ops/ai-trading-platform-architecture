import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { strategies } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import { getStrategyDefinition, listStrategyDefinitions } from "@/lib/strategies";

const schema = z.object({
  name: z.string().min(2).max(80),
  type: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  params: z.record(z.string(), z.number()),
});

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(strategies)
      .where(eq(strategies.userId, user.id))
      .orderBy(desc(strategies.createdAt));
    return NextResponse.json({ strategies: rows, definitions: listStrategyDefinitions() });
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
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid strategy");

  try {
    getStrategyDefinition(parsed.data.type);
  } catch {
    return jsonError("Unknown strategy type");
  }

  const [created] = await db
    .insert(strategies)
    .values({ userId: user.id, ...parsed.data })
    .returning();

  return NextResponse.json({ strategy: created });
}
