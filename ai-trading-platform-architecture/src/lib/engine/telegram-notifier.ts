// ---------------------------------------------------------------------------
// TelegramNotifier — fans published signals out to entitled subscribers.
//
// The engine decides WHAT to say; this decides WHO hears it. Two rules that
// protect the business are enforced here and nowhere else:
//
//   1. Entitlement is re-checked at DELIVERY time, not at signal time. A
//      subscription can expire between the scan and the fan-out, and an
//      expired customer receiving a signal is revenue leaking.
//   2. Every attempt is written to `delivery_log`. When a customer says "I
//      never got that signal", the answer must be a record, not a guess.
// ---------------------------------------------------------------------------
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, deliveryLog, plans, signals, subscriptions, watchedSymbols } from "@/db/schema";
import {
  evaluateAccess,
  isGrant,
  type CustomerRecord,
  type PlanFeatures,
  type SubscriptionRecord,
} from "@/lib/access/entitlements";
import { signalClosedAr, signalOpenedAr } from "@/lib/telegram/messages.ar";
import { TelegramClient } from "@/lib/telegram/client";
import type { Decision } from "../intelligence/types";
import type { Notifier, StoredSignal } from "./signal-engine";

type Recipient = {
  customerId: string;
  chatId: bigint;
  planCode: string;
  features: PlanFeatures;
  prioritySeconds: number;
};

export class TelegramNotifier implements Notifier {
  constructor(private readonly telegram: TelegramClient) {}

  async publishSignal(signalId: string, decision: Decision): Promise<void> {
    if (!decision.plan) return; // refusals are stored, not broadcast

    const text = signalOpenedAr({ symbol: decision.symbol, plan: decision.plan, decision });
    const recipients = await this.entitledRecipients(decision.symbol);

    await this.fanOut(recipients, text, "signal", signalId);

    await db
      .update(signals)
      .set({ deliveredToPlans: [...new Set(recipients.map((r) => r.planCode))] })
      .where(eq(signals.id, signalId));
  }

  async publishClose(
    signal: StoredSignal,
    exitPrice: number,
    outcome: "tp1" | "tp2" | "stop" | "breakeven",
  ): Promise<void> {
    const isLong = signal.direction === "long";
    const risk = Math.abs(signal.entryPrice - signal.stopLoss);
    const move = isLong ? exitPrice - signal.entryPrice : signal.entryPrice - exitPrice;

    const text = signalClosedAr({
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entryPrice,
      exit: exitPrice,
      pnlPct: (move / signal.entryPrice) * 100,
      rMultiple: risk > 0 ? move / risk : 0,
      outcome,
      durationMinutes: (Date.now() - signal.openedAt) / 60_000,
    });

    // Close notices go to everyone entitled to the symbol. A customer who
    // received the entry must receive the exit even if their plan changed —
    // leaving someone in a trade they were told to open is unacceptable.
    const recipients = await this.entitledRecipients(signal.symbol);
    await this.fanOut(recipients, text, "close", signal.id);
  }

  /**
   * Resolves the current, entitled audience for a symbol.
   *
   * Symbol gating uses the owner-curated `watched_symbols.sortOrder` as the
   * canonical tier ordering, so "basic gets 3 symbols" always means the same
   * three for everyone — not an arbitrary per-query slice.
   */
  private async entitledRecipients(symbol: string): Promise<Recipient[]> {
    const rows = await db
      .select({
        customerId: customers.id,
        chatId: customers.telegramId,
        customerStatus: customers.status,
        subId: subscriptions.id,
        subStatus: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        pausedAt: subscriptions.pausedAt,
        planCode: plans.code,
        featuresSnapshot: subscriptions.featuresSnapshot,
      })
      .from(subscriptions)
      .innerJoin(customers, eq(subscriptions.customerId, customers.id))
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(inArray(subscriptions.status, ["active", "trialing"]));

    const tierSymbols = (
      await db
        .select({ symbol: watchedSymbols.symbol })
        .from(watchedSymbols)
        .where(eq(watchedSymbols.isActive, true))
        .orderBy(watchedSymbols.sortOrder)
    ).map((r) => r.symbol);

    const now = new Date();
    const out: Recipient[] = [];

    for (const row of rows) {
      const customer: CustomerRecord = {
        id: row.customerId,
        status: row.customerStatus as CustomerRecord["status"],
      };
      const subscription: SubscriptionRecord = {
        id: row.subId,
        status: row.subStatus as SubscriptionRecord["status"],
        currentPeriodEnd: row.currentPeriodEnd,
        pausedAt: row.pausedAt,
        planCode: row.planCode,
        featuresSnapshot: (row.featuresSnapshot ?? {}) as Partial<PlanFeatures>,
      };

      const access = evaluateAccess(customer, subscription, now);
      if (!isGrant(access)) continue;

      const limit = access.features.maxSymbols;
      const allowed = limit === -1 ? tierSymbols : tierSymbols.slice(0, limit);
      if (!allowed.includes(symbol)) continue;

      out.push({
        customerId: access.customerId,
        chatId: row.chatId,
        planCode: access.planCode,
        features: access.features,
        prioritySeconds: access.features.prioritySeconds ?? 0,
      });
    }

    // Higher tiers first — that head start is a paid-for feature.
    return out.sort((a, b) => b.prioritySeconds - a.prioritySeconds);
  }

  private async fanOut(
    recipients: Recipient[],
    text: string,
    kind: "signal" | "close",
    signalId: string,
  ): Promise<void> {
    for (const r of recipients) {
      const result = await this.telegram.sendMessage(r.chatId, text);

      await db.insert(deliveryLog).values({
        customerId: r.customerId,
        signalId,
        kind,
        status: result.ok ? "sent" : result.blockedByUser ? "blocked_by_user" : "failed",
        telegramMessageId: result.ok ? BigInt(result.messageId) : null,
        error: result.ok ? null : result.error,
        attempts: 1,
        sentAt: result.ok ? new Date() : null,
      });

      // A user who blocked the bot is a permanent state change, not a
      // transient error: suspend them so the queue stops retrying forever.
      if (!result.ok && result.blockedByUser) {
        await db.update(customers).set({ status: "suspended" }).where(eq(customers.id, r.customerId));
      }
    }
  }
}
