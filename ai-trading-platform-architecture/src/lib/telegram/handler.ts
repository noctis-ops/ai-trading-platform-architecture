// ---------------------------------------------------------------------------
// Bot update handler — the composition root for a customer interaction.
//
// Flow, identical for every command:
//   parse -> identify customer -> evaluateAccess -> feature gate -> quota
//   -> execute -> log usage -> reply in Arabic
//
// The gates run BEFORE the handler, not inside it, so a new command cannot
// accidentally ship without subscription enforcement. That is the difference
// between a hobby bot and a product that protects its revenue.
// ---------------------------------------------------------------------------
import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { customers, plans, subscriptions, usageEvents } from "@/db/schema";
import {
  checkQuota,
  denialAr,
  evaluateAccess,
  isGrant,
  requireFeature,
  type AccessGrant,
  type AccessResult,
  type CustomerRecord,
  type PlanFeatures,
  type SubscriptionRecord,
} from "@/lib/access/entitlements";
import { parseCommand, type CommandSpec, type ParsedCommand } from "./commands";
import { TelegramClient, type TelegramUpdate } from "./client";
import { helpAr, notSubscribedAr, subscriptionActiveAr, subscriptionExpiringSoonAr } from "./messages.ar";

let client: TelegramClient | null = null;
function telegram(): TelegramClient {
  if (!client) client = new TelegramClient({ botToken: process.env.TELEGRAM_BOT_TOKEN ?? "" });
  return client;
}

const OWNER_TELEGRAM_IDS = (process.env.OWNER_TELEGRAM_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Identical reply for unknown and unauthorised-privileged commands, so a
 *  stranger can never discover that owner tooling exists. */
const UNKNOWN_REPLY = "لم أفهم طلبك. أرسل /مساعدة لعرض الأوامر المتاحة.";

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || !message.from || message.from.is_bot) return;

  const telegramId = BigInt(message.from.id);
  const chatId = BigInt(message.chat.id);
  const parsed = parseCommand(message.text);

  // Unknown input: nudge rather than ignore. Silence feels like a broken product.
  if (!parsed) {
    await telegram().sendMessage(chatId, UNKNOWN_REPLY);
    return;
  }

  const customer = await loadCustomer(telegramId);
  const isOwner = OWNER_TELEGRAM_IDS.includes(message.from.id.toString());

  if (parsed.spec.ownerOnly && !isOwner) {
    await telegram().sendMessage(chatId, UNKNOWN_REPLY);
    return;
  }

  // Open commands run without any subscription.
  if (!parsed.spec.requiresSubscription) {
    await runOpenCommand(parsed, chatId, telegramId, message.from);
    return;
  }

  if (!customer) {
    await telegram().sendMessage(chatId, notSubscribedAr());
    return;
  }

  const subscription = await loadActiveSubscription(customer.id);
  let access: AccessResult = evaluateAccess(customer, subscription);

  if (isGrant(access) && parsed.spec.requiresFeature) {
    access = requireFeature(access, parsed.spec.requiresFeature);
  }
  if (isGrant(access) && parsed.spec.metered) {
    access = checkQuota(access, await usageToday(customer.id, parsed.spec.id));
  }

  if (!isGrant(access)) {
    await logUsage(customer.id, parsed.spec, parsed.symbol, false, access.code);
    await telegram().sendMessage(chatId, denialAr(access));
    return;
  }

  await logUsage(customer.id, parsed.spec, parsed.symbol, true);
  await runSubscriberCommand(parsed, chatId, access);

  if (access.expiringSoon) {
    await telegram().sendMessage(chatId, subscriptionExpiringSoonAr(access.daysRemaining));
  }

  await db.update(customers).set({ lastActiveAt: new Date() }).where(eq(customers.id, customer.id));
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadCustomer(telegramId: bigint): Promise<(CustomerRecord & { chatId: bigint }) | null> {
  const rows = await db
    .select({ id: customers.id, status: customers.status, telegramId: customers.telegramId })
    .from(customers)
    .where(eq(customers.telegramId, telegramId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, status: row.status as CustomerRecord["status"], chatId: row.telegramId };
}

async function loadActiveSubscription(customerId: string): Promise<SubscriptionRecord | null> {
  const rows = await db
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      pausedAt: subscriptions.pausedAt,
      planCode: plans.code,
      featuresSnapshot: subscriptions.featuresSnapshot,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.customerId, customerId))
    .orderBy(subscriptions.currentPeriodEnd)
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as SubscriptionRecord["status"],
    currentPeriodEnd: row.currentPeriodEnd,
    pausedAt: row.pausedAt,
    planCode: row.planCode,
    featuresSnapshot: (row.featuresSnapshot ?? {}) as Partial<PlanFeatures>,
  };
}

async function usageToday(customerId: string, action: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ n: count() })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.customerId, customerId),
        eq(usageEvents.action, action),
        eq(usageEvents.allowed, true),
        gte(usageEvents.createdAt, startOfDay),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

async function logUsage(
  customerId: string,
  spec: CommandSpec,
  symbol: string | undefined,
  allowed: boolean,
  denyReason?: string,
) {
  await db.insert(usageEvents).values({
    customerId,
    action: spec.id,
    symbol,
    allowed,
    denyReason,
  });
}

// ---------------------------------------------------------------------------
// Command execution
//
// Handlers are intentionally thin here: they format and reply. The heavy
// lifting (analysis, reporting) lives in the engine/intelligence modules so
// the same logic serves the bot, the console, and scheduled jobs.
// ---------------------------------------------------------------------------
async function runOpenCommand(
  parsed: ParsedCommand,
  chatId: bigint,
  telegramId: bigint,
  from: NonNullable<NonNullable<TelegramUpdate["message"]>["from"]>,
): Promise<void> {
  const tg = telegram();

  switch (parsed.spec.id) {
    case "start": {
      // Registering a pending customer on /بدء is what lets the owner see and
      // convert interested users — the top of the sales funnel.
      await db
        .insert(customers)
        .values({
          telegramId,
          telegramUsername: from.username,
          displayName: from.first_name,
          languageCode: from.language_code ?? "ar",
          status: "pending",
        })
        .onConflictDoNothing({ target: customers.telegramId });
      await tg.sendMessage(chatId, notSubscribedAr());
      return;
    }
    case "help":
      await tg.sendMessage(chatId, helpAr());
      return;
    case "plans":
      await tg.sendMessage(chatId, await renderPlansAr());
      return;
    case "subscription": {
      const customer = await loadCustomer(telegramId);
      if (!customer) {
        await tg.sendMessage(chatId, notSubscribedAr());
        return;
      }
      const sub = await loadActiveSubscription(customer.id);
      const access = evaluateAccess(customer, sub);
      await tg.sendMessage(
        chatId,
        isGrant(access)
          ? subscriptionActiveAr(access.planCode, access.daysRemaining, sub!.currentPeriodEnd)
          : denialAr(access),
      );
      return;
    }
    case "renew":
    case "redeem":
      await tg.sendMessage(
        chatId,
        [
          "🔑 تفعيل الاشتراك",
          "━━━━━━━━━━━━━━━",
          "أرسل كود التفعيل الخاص بك بالصيغة:",
          "/تفعيل XXXX-XXXX-XXXX",
          "",
          "إذا لم يكن لديك كود، أرسل /الخطط للاطلاع على الخطط، أو /الدعم للتواصل معنا.",
        ].join("\n"),
      );
      return;
    case "support":
      await tg.sendMessage(
        chatId,
        `📞 الدعم الفني\n━━━━━━━━━━━━━━━\nللتواصل: ${process.env.SUPPORT_CONTACT ?? "@support"}\nأوقات الرد: خلال 24 ساعة.`,
      );
      return;
    default:
      await tg.sendMessage(chatId, helpAr());
  }
}

async function runSubscriberCommand(parsed: ParsedCommand, chatId: bigint, grant: AccessGrant): Promise<void> {
  const tg = telegram();
  // Wired to the SignalEngine + reporting services in the implementation
  // phase; the access pipeline above is complete and enforced today.
  await tg.sendMessage(
    chatId,
    `⏳ جارٍ تنفيذ الأمر ${parsed.spec.ar}${parsed.symbol ? ` على ${parsed.symbol}` : ""}...\n(خطتك: ${grant.planCode})`,
  );
}

async function renderPlansAr(): Promise<string> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder);

  if (rows.length === 0) return "لا توجد خطط متاحة حالياً. تواصل مع الدعم عبر /الدعم.";

  const blocks = rows.map((p) => {
    const f = (p.features ?? {}) as Partial<PlanFeatures>;
    const lines = [
      `📦 ${p.nameAr}`,
      `💵 ${Number(p.priceMonthly).toFixed(0)} ${p.currency} / شهرياً`,
      p.descriptionAr ? `📝 ${p.descriptionAr}` : "",
      `• العملات المشمولة: ${f.maxSymbols === -1 ? "الكل" : (f.maxSymbols ?? 0)}`,
      `• تحليل عند الطلب: ${f.onDemandAnalysisPerDay === -1 ? "غير محدود" : `${f.onDemandAnalysisPerDay ?? 0} يومياً`}`,
      `• التقارير: ${[f.dailyReports && "يومي", f.weeklyReports && "أسبوعي", f.monthlyReports && "شهري"].filter(Boolean).join("، ") || "—"}`,
    ];
    return lines.filter(Boolean).join("\n");
  });

  return ["💎 الخطط المتاحة", "━━━━━━━━━━━━━━━", blocks.join("\n\n"), "━━━━━━━━━━━━━━━", "للاشتراك أرسل /الدعم"].join(
    "\n",
  );
}
