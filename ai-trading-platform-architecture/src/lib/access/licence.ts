// ---------------------------------------------------------------------------
// Licence key redemption — how a payment becomes access.
//
// The owner generates keys out-of-band (bank transfer, USDT, reseller) and the
// customer redeems one inside Telegram. This keeps revenue flowing before any
// payment gateway exists.
//
// Key primitives (generation/hashing) live in `licence-key.ts` so they stay
// pure and testable; this module owns the database transaction. Redemption is
// atomic and single-use — a key cannot be shared between two customers even
// if they race.
// ---------------------------------------------------------------------------
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, customers, licenceKeys, plans, subscriptions } from "@/db/schema";
import type { PlanFeatures } from "./entitlements";
import { hashKey } from "./licence-key";

export { generateLicenceKey, hashKey, normaliseKey } from "./licence-key";

export type RedeemResult =
  | { ok: true; planCode: string; daysAdded: number; newPeriodEnd: Date }
  | { ok: false; code: "INVALID" | "ALREADY_USED" | "REVOKED" | "EXPIRED" | "NO_PLAN" };

export const REDEEM_AR: Record<Exclude<RedeemResult, { ok: true }>["code"], string> = {
  INVALID: "الكود غير صحيح. تأكد من كتابته بشكل صحيح أو تواصل عبر /الدعم.",
  ALREADY_USED: "هذا الكود مستخدم مسبقاً.",
  REVOKED: "تم إلغاء هذا الكود. تواصل مع الدعم عبر /الدعم.",
  EXPIRED: "انتهت صلاحية هذا الكود.",
  NO_PLAN: "الكود غير مرتبط بخطة صالحة. تواصل مع الدعم عبر /الدعم.",
};

/**
 * Redeems a key and extends the customer's subscription.
 *
 * Runs in a transaction with a conditional UPDATE that only matches a key
 * still in `issued` state. If two requests race, exactly one UPDATE affects a
 * row and the other is rejected — the check and the claim are the same
 * operation, so there is no read-then-write window to exploit.
 *
 * Extension semantics: an ACTIVE subscription is extended from its existing
 * end date (the customer keeps what they paid for); an expired one restarts
 * from now.
 */
export async function redeemLicenceKey(customerId: string, rawKey: string): Promise<RedeemResult> {
  const keyHash = hashKey(rawKey);

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(licenceKeys)
      .set({ status: "redeemed", redeemedByCustomerId: customerId, redeemedAt: new Date() })
      .where(and(eq(licenceKeys.keyHash, keyHash), eq(licenceKeys.status, "issued")))
      .returning();

    if (!claimed) {
      // Nothing claimed: distinguish "wrong key" from "already used" so the
      // customer gets an actionable message instead of a generic failure.
      const [existing] = await tx.select().from(licenceKeys).where(eq(licenceKeys.keyHash, keyHash)).limit(1);
      if (!existing) return { ok: false as const, code: "INVALID" as const };
      if (existing.status === "revoked") return { ok: false as const, code: "REVOKED" as const };
      if (existing.status === "expired") return { ok: false as const, code: "EXPIRED" as const };
      return { ok: false as const, code: "ALREADY_USED" as const };
    }

    if (claimed.expiresAt && claimed.expiresAt.getTime() < Date.now()) {
      await tx.update(licenceKeys).set({ status: "expired" }).where(eq(licenceKeys.id, claimed.id));
      return { ok: false as const, code: "EXPIRED" as const };
    }
    if (!claimed.planId) return { ok: false as const, code: "NO_PLAN" as const };

    const [plan] = await tx.select().from(plans).where(eq(plans.id, claimed.planId)).limit(1);
    if (!plan) return { ok: false as const, code: "NO_PLAN" as const };

    const now = new Date();
    const [existingSub] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.customerId, customerId))
      .orderBy(sql`${subscriptions.currentPeriodEnd} DESC`)
      .limit(1);

    const base =
      existingSub && existingSub.currentPeriodEnd > now && existingSub.status === "active"
        ? existingSub.currentPeriodEnd
        : now;
    const newPeriodEnd = new Date(base.getTime() + claimed.durationDays * 86_400_000);
    const features = (plan.features ?? {}) as Partial<PlanFeatures>;

    if (existingSub) {
      await tx
        .update(subscriptions)
        .set({
          planId: plan.id,
          status: "active",
          currentPeriodEnd: newPeriodEnd,
          pausedAt: null,
          canceledAt: null,
          source: "licence_key",
          featuresSnapshot: features,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existingSub.id));
    } else {
      await tx.insert(subscriptions).values({
        customerId,
        planId: plan.id,
        status: "active",
        currentPeriodEnd: newPeriodEnd,
        source: "licence_key",
        featuresSnapshot: features,
      });
    }

    // Redeeming is what promotes a `pending` lead into a paying customer.
    await tx.update(customers).set({ status: "active" }).where(eq(customers.id, customerId));

    await tx.insert(auditLogs).values({
      actorType: "customer",
      actorId: customerId,
      action: "licence.redeem",
      targetType: "licence_key",
      targetId: claimed.id,
      after: { planCode: plan.code, durationDays: claimed.durationDays, newPeriodEnd: newPeriodEnd.toISOString() },
    });

    return {
      ok: true as const,
      planCode: plan.code,
      daysAdded: claimed.durationDays,
      newPeriodEnd,
    };
  });
}

export function redeemSuccessAr(planCode: string, daysAdded: number, newPeriodEnd: Date): string {
  return [
    "✅ تم تفعيل اشتراكك بنجاح",
    "━━━━━━━━━━━━━━━",
    `الخطة: ${planCode}`,
    `المدة المضافة: ${daysAdded} يوم`,
    `ينتهي في: ${newPeriodEnd.toISOString().slice(0, 10)}`,
    "",
    "ستصلك الإشارات فور توفر فرص مطابقة للمعايير.",
    "أرسل /مساعدة لعرض الأوامر.",
  ].join("\n");
}
