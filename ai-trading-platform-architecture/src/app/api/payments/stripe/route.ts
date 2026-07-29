import { db } from "@/db";
import { payments, customers, subscriptions, plans } from "@/db/schema";
import { eq } from "drizzle-orm";
import { alertOwners } from "@/lib/telegram/handler";
// Stripe would be imported here in a real project
// import Stripe from "stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // In a real project, we'd verify the signature:
  // const sig = req.headers.get("stripe-signature");
  // const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  
  try {
    const event = await req.json();

    if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
      const paymentIntentId = event.data.object.payment_intent || event.data.object.id;
      const customerId = event.data.object.metadata?.customerId;
      const planCode = event.data.object.metadata?.planCode;
      const amount = (event.data.object.amount_received ?? event.data.object.amount) / 100;
      
      if (!customerId || !planCode) {
        throw new Error("Missing metadata in Stripe payment");
      }

      // Check for duplicate payment (idempotency)
      const existing = await db.select().from(payments).where(eq(payments.providerRef, paymentIntentId));
      if (existing.length > 0) {
        return Response.json({ received: true, note: "already processed" });
      }

      const planRows = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
      const plan = planRows[0];
      if (!plan) throw new Error(`Unknown plan code: ${planCode}`);

      // Insert payment record
      const [payment] = await db.insert(payments).values({
        customerId,
        amount: String(amount),
        currency: event.data.object.currency?.toUpperCase() ?? "USD",
        provider: "stripe",
        providerRef: paymentIntentId,
        status: "confirmed",
      }).returning();

      // Extend or create subscription
      const subRows = await db.select().from(subscriptions).where(eq(subscriptions.customerId, customerId)).limit(1);
      let subId = subRows[0]?.id;
      
      const now = new Date();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      let newEnd = new Date(now.getTime() + thirtyDaysMs);

      if (subRows.length > 0) {
        const sub = subRows[0];
        if (sub.status === "active" && sub.currentPeriodEnd > now) {
          newEnd = new Date(sub.currentPeriodEnd.getTime() + thirtyDaysMs);
        }
        await db.update(subscriptions).set({
          planId: plan.id,
          status: "active",
          currentPeriodEnd: newEnd,
          featuresSnapshot: plan.features,
        }).where(eq(subscriptions.id, sub.id));
      } else {
        const [newSub] = await db.insert(subscriptions).values({
          customerId,
          planId: plan.id,
          status: "active",
          currentPeriodEnd: newEnd,
          featuresSnapshot: plan.features,
        }).returning({ id: subscriptions.id });
        subId = newSub.id;
      }

      // Link payment to subscription
      await db.update(payments).set({ subscriptionId: subId }).where(eq(payments.id, payment.id));
      
      await alertOwners(`✅ نجاح عملية دفع (Stripe):\nالعميل: ${customerId.slice(0, 8)}\nالخطة: ${planCode}\nالمبلغ: ${amount} ${event.data.object.currency?.toUpperCase() ?? "USD"}`).catch(() => {});
    }

    return Response.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] Error processing event:", err);
    await alertOwners(`❌ خطأ في معالجة دفع Stripe: ${(err as Error).message}`).catch(() => {});
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}