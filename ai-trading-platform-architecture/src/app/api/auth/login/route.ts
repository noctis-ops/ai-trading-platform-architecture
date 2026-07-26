import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, verifyPassword } from "@/lib/auth";
import { jsonError } from "@/lib/api-helpers";
import { eq } from "drizzle-orm";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid email or password.");
  }
  const { email, password } = parsed.data;

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) return jsonError("Invalid email or password.", 401);

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return jsonError("Invalid email or password.", 401);

  await createSession(user.id);

  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
