// ---------------------------------------------------------------------------
// Owner CLI — everything needed to run the business before the web console
// exists.
//
//   npx tsx scripts/admin.ts <command> [args]
//
// Why a CLI first: the owner console is a UI over these exact operations.
// Building the operations as scripts means the business is runnable on day
// one, and the future UI becomes a thin layer over already-tested logic
// rather than a place where new, untested logic accumulates.
//
// Every mutating command writes to `audit_logs`.
// ---------------------------------------------------------------------------
import "dotenv/config";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  adminUsers,
  auditLogs,
  customers,
  deliveryLog,
  licenceKeys,
  payments,
  plans,
  signals,
  subscriptions,
  usageEvents,
  watchedSymbols,
} from "../src/db/schema";
import { generateLicenceKey } from "../src/lib/access/licence-key";
import { hashPassword } from "../src/lib/auth";
import type { PlanFeatures } from "../src/lib/access/entitlements";

const [, , command, ...args] = process.argv;

// ---------------------------------------------------------------------------
// Default catalogue — a sane, sellable starting point the owner can edit.
// ---------------------------------------------------------------------------
const DEFAULT_PLANS: {
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  priceMonthly: string;
  sortOrder: number;
  features: PlanFeatures;
}[] = [
  {
    code: "basic",
    nameAr: "الأساسية",
    nameEn: "Basic",
    descriptionAr: "إشارات على أهم 3 عملات مع تقرير يومي",
    priceMonthly: "29.00",
    sortOrder: 1,
    features: {
      maxSymbols: 3,
      timeframes: ["1h", "4h"],
      onDemandAnalysisPerDay: 5,
      dailyReports: true,
      weeklyReports: false,
      monthlyReports: false,
      prioritySeconds: 0,
      customRisk: false,
      fullAnalysisBreakdown: false,
    },
  },
  {
    code: "pro",
    nameAr: "الاحترافية",
    nameEn: "Pro",
    descriptionAr: "10 عملات، تحليل مفصّل، تقارير يومية وأسبوعية",
    priceMonthly: "79.00",
    sortOrder: 2,
    features: {
      maxSymbols: 10,
      timeframes: ["15m", "1h", "4h"],
      onDemandAnalysisPerDay: 25,
      dailyReports: true,
      weeklyReports: true,
      monthlyReports: false,
      prioritySeconds: 15,
      customRisk: false,
      fullAnalysisBreakdown: true,
    },
  },
  {
    code: "vip",
    nameAr: "المميزة",
    nameEn: "VIP",
    descriptionAr: "جميع العملات، أولوية في الاستلام، كل التقارير",
    priceMonthly: "149.00",
    sortOrder: 3,
    features: {
      maxSymbols: -1,
      timeframes: ["15m", "1h", "4h", "1d"],
      onDemandAnalysisPerDay: -1,
      dailyReports: true,
      weeklyReports: true,
      monthlyReports: true,
      prioritySeconds: 60,
      customRisk: true,
      fullAnalysisBreakdown: true,
    },
  },
];

const DEFAULT_SYMBOLS = [
  { symbol: "BTCUSDT", displayName: "بيتكوين", minPlanCode: "basic", sortOrder: 1 },
  { symbol: "ETHUSDT", displayName: "إيثيريوم", minPlanCode: "basic", sortOrder: 2 },
  { symbol: "SOLUSDT", displayName: "سولانا", minPlanCode: "basic", sortOrder: 3 },
  { symbol: "BNBUSDT", displayName: "بي إن بي", minPlanCode: "pro", sortOrder: 4 },
  { symbol: "XRPUSDT", displayName: "ريبل", minPlanCode: "pro", sortOrder: 5 },
  { symbol: "ADAUSDT", displayName: "كاردانو", minPlanCode: "pro", sortOrder: 6 },
  { symbol: "AVAXUSDT", displayName: "أفالانش", minPlanCode: "pro", sortOrder: 7 },
  { symbol: "LINKUSDT", displayName: "تشين لينك", minPlanCode: "pro", sortOrder: 8 },
  { symbol: "DOGEUSDT", displayName: "دوجكوين", minPlanCode: "pro", sortOrder: 9 },
  { symbol: "TRXUSDT", displayName: "ترون", minPlanCode: "vip", sortOrder: 10 },
];

async function audit(action: string, targetType: string, targetId: string, after: unknown) {
  await db.insert(auditLogs).values({ actorType: "admin", actorId: "cli", action, targetType, targetId, after });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Idempotent: safe to re-run after editing the catalogue above. */
async function seed() {
  for (const p of DEFAULT_PLANS) {
    await db
      .insert(plans)
      .values(p)
      .onConflictDoUpdate({
        target: plans.code,
        set: { nameAr: p.nameAr, descriptionAr: p.descriptionAr, priceMonthly: p.priceMonthly, features: p.features },
      });
    console.log(`  plan  ${p.code.padEnd(6)} ${p.priceMonthly} USD`);
  }
  for (const s of DEFAULT_SYMBOLS) {
    await db.insert(watchedSymbols).values(s).onConflictDoNothing({ target: watchedSymbols.symbol });
    console.log(`  symbol ${s.symbol}`);
  }
  console.log("\n✅ Seeded. Edit scripts/admin.ts and re-run to change the catalogue.");
}

async function createAdmin(email?: string, password?: string, name = "Owner") {
  if (!email || !password) throw new Error("usage: create-admin <email> <password> [name]");
  if (password.length < 12) throw new Error("password must be at least 12 characters");
  const [row] = await db
    .insert(adminUsers)
    .values({ email, passwordHash: await hashPassword(password), name, role: "owner" })
    .returning({ id: adminUsers.id });
  await audit("admin.create", "admin_user", row.id, { email, role: "owner" });
  console.log(`✅ Owner created: ${email}`);
}

/**
 * Issues licence keys. The plaintext is printed ONCE and never stored — if it
 * is lost, revoke the key and issue a new one.
 */
async function issueKeys(planCode?: string, countRaw = "1", daysRaw = "30", note?: string) {
  if (!planCode) throw new Error("usage: issue-keys <planCode> [count] [days] [note]");
  const [plan] = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
  if (!plan) throw new Error(`unknown plan: ${planCode}`);

  const count = Math.max(1, Number.parseInt(countRaw, 10) || 1);
  const durationDays = Math.max(1, Number.parseInt(daysRaw, 10) || 30);

  console.log(`\n🔑 ${count} key(s) — plan ${planCode}, ${durationDays} days\n`);
  for (let i = 0; i < count; i++) {
    const { key, keyHash, keyPrefix } = generateLicenceKey();
    const [row] = await db
      .insert(licenceKeys)
      .values({ keyHash, keyPrefix, planId: plan.id, durationDays, note })
      .returning({ id: licenceKeys.id });
    await audit("licence.issue", "licence_key", row.id, { planCode, durationDays });
    console.log(`  ${key}`);
  }
  console.log("\n⚠️  Copy these now — only the hash is stored and they cannot be shown again.");
  console.log("   The customer redeems with:  /تفعيل <KEY>");
}

async function grant(telegramIdRaw?: string, planCode?: string, daysRaw = "30") {
  if (!telegramIdRaw || !planCode) throw new Error("usage: grant <telegramId> <planCode> [days]");
  const telegramId = BigInt(telegramIdRaw);
  const days = Math.max(1, Number.parseInt(daysRaw, 10) || 30);

  const [plan] = await db.select().from(plans).where(eq(plans.code, planCode)).limit(1);
  if (!plan) throw new Error(`unknown plan: ${planCode}`);

  const [customer] = await db
    .insert(customers)
    .values({ telegramId, status: "active" })
    .onConflictDoUpdate({ target: customers.telegramId, set: { status: "active" } })
    .returning({ id: customers.id });

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.customerId, customer.id))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);

  const now = new Date();
  // Extend from the existing end date when still active — never shorten a
  // subscription the customer already paid for.
  const base = existing && existing.currentPeriodEnd > now && existing.status === "active" ? existing.currentPeriodEnd : now;
  const currentPeriodEnd = new Date(base.getTime() + days * 86_400_000);
  const featuresSnapshot = (plan.features ?? {}) as Partial<PlanFeatures>;

  if (existing) {
    await db
      .update(subscriptions)
      .set({
        planId: plan.id, status: "active", currentPeriodEnd,
        pausedAt: null, canceledAt: null, source: "manual", featuresSnapshot, updatedAt: now,
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      customerId: customer.id, planId: plan.id, status: "active",
      currentPeriodEnd, source: "manual", featuresSnapshot,
    });
  }

  await audit("subscription.grant", "customer", customer.id, { planCode, days, currentPeriodEnd });
  console.log(`✅ ${telegramId} → ${planCode}, until ${currentPeriodEnd.toISOString().slice(0, 10)}`);
}

async function setCustomerStatus(telegramIdRaw: string | undefined, status: string, action: string) {
  if (!telegramIdRaw) throw new Error(`usage: ${action} <telegramId>`);
  const telegramId = BigInt(telegramIdRaw);
  const [row] = await db
    .update(customers)
    .set({ status })
    .where(eq(customers.telegramId, telegramId))
    .returning({ id: customers.id });
  if (!row) throw new Error(`no customer with telegram id ${telegramId}`);
  await audit(`customer.${action}`, "customer", row.id, { status });
  console.log(`✅ ${telegramId} → ${status}`);
}

async function pauseSubscription(telegramIdRaw?: string, resume = false) {
  if (!telegramIdRaw) throw new Error("usage: pause|resume <telegramId>");
  const telegramId = BigInt(telegramIdRaw);
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.telegramId, telegramId))
    .limit(1);
  if (!customer) throw new Error(`no customer with telegram id ${telegramId}`);

  await db
    .update(subscriptions)
    .set({ pausedAt: resume ? null : new Date(), status: resume ? "active" : "paused", updatedAt: new Date() })
    .where(eq(subscriptions.customerId, customer.id));

  await audit(resume ? "subscription.resume" : "subscription.pause", "customer", customer.id, {});
  console.log(`✅ ${telegramId} subscription ${resume ? "resumed" : "paused"}`);
}

/** Business dashboard in text form — the numbers the owner checks daily. */
async function stats() {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const now = new Date();

  const [custByStatus, activeSubs, revenue, signalStats, deliveries, topCommands] = await Promise.all([
    db.select({ status: customers.status, n: sql<number>`count(*)::int` }).from(customers).groupBy(customers.status),
    db
      .select({ planCode: plans.code, n: sql<number>`count(*)::int` })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(and(eq(subscriptions.status, "active"), gte(subscriptions.currentPeriodEnd, now)))
      .groupBy(plans.code),
    db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.status, "confirmed"), gte(payments.createdAt, monthAgo))),
    db
      .select({ verdict: signals.verdict, n: sql<number>`count(*)::int` })
      .from(signals)
      .where(gte(signals.createdAt, monthAgo))
      .groupBy(signals.verdict),
    db
      .select({ status: deliveryLog.status, n: sql<number>`count(*)::int` })
      .from(deliveryLog)
      .where(gte(deliveryLog.createdAt, monthAgo))
      .groupBy(deliveryLog.status),
    db
      .select({ action: usageEvents.action, n: sql<number>`count(*)::int` })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, monthAgo))
      .groupBy(usageEvents.action)
      .orderBy(sql`count(*) desc`)
      .limit(5),
  ]);

  const line = "─".repeat(46);
  console.log(`\n📊 Business snapshot — last 30 days\n${line}`);

  console.log("Customers");
  for (const r of custByStatus) console.log(`  ${r.status.padEnd(12)} ${r.n}`);

  console.log("\nActive subscriptions");
  if (activeSubs.length === 0) console.log("  (none)");
  for (const r of activeSubs) console.log(`  ${r.planCode.padEnd(12)} ${r.n}`);

  console.log(`\nRevenue (confirmed)\n  ${Number(revenue[0]?.total ?? 0).toFixed(2)} USD`);

  console.log("\nEngine decisions");
  const total = signalStats.reduce((a, r) => a + r.n, 0);
  for (const r of signalStats) {
    const pct = total ? ((r.n / total) * 100).toFixed(0) : "0";
    console.log(`  ${r.verdict.padEnd(12)} ${String(r.n).padStart(4)}  (${pct}%)`);
  }
  // A healthy engine refuses most of the time; ~100% entries means the gates
  // are miscalibrated and the bot is selling noise.
  if (total > 0) {
    const entered = signalStats.find((r) => r.verdict === "enter")?.n ?? 0;
    console.log(`  → selectivity: ${(100 - (entered / total) * 100).toFixed(0)}% refused`);
  }

  console.log("\nDeliveries");
  for (const r of deliveries) console.log(`  ${r.status.padEnd(16)} ${r.n}`);

  console.log("\nTop commands");
  for (const r of topCommands) console.log(`  ${r.action.padEnd(16)} ${r.n}`);
  console.log(line);
}

async function listCustomers() {
  const rows = await db
    .select({
      telegramId: customers.telegramId,
      username: customers.telegramUsername,
      status: customers.status,
      planCode: plans.code,
      subStatus: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
    })
    .from(customers)
    .leftJoin(subscriptions, eq(subscriptions.customerId, customers.id))
    .leftJoin(plans, eq(subscriptions.planId, plans.id))
    .orderBy(desc(customers.createdAt))
    .limit(50);

  console.log(`\n${"telegram_id".padEnd(14)} ${"username".padEnd(18)} ${"status".padEnd(10)} ${"plan".padEnd(8)} expires`);
  console.log("─".repeat(72));
  for (const r of rows) {
    console.log(
      `${String(r.telegramId).padEnd(14)} ${(r.username ?? "—").padEnd(18)} ${r.status.padEnd(10)} ` +
        `${(r.planCode ?? "—").padEnd(8)} ${r.periodEnd ? r.periodEnd.toISOString().slice(0, 10) : "—"}`,
    );
  }
  if (rows.length === 0) console.log("(no customers yet)");
}

const HELP = `
Owner CLI — npx tsx scripts/admin.ts <command>

Setup
  seed                                   Create default plans + watched symbols
  create-admin <email> <pass> [name]     Create the owner console login

Selling
  issue-keys <plan> [count] [days] [note]  Generate licence keys (printed once)
  grant <telegramId> <plan> [days]         Activate/extend a subscription directly

Customers
  list                                   Recent customers and their plans
  suspend <telegramId>                   Block access (reversible)
  activate <telegramId>                  Restore access
  ban <telegramId>                       Permanent block
  pause <telegramId>                     Pause subscription (keeps history)
  resume <telegramId>                    Resume a paused subscription

Insight
  stats                                  Business + engine snapshot
`;

async function main() {
  switch (command) {
    case "seed": return seed();
    case "create-admin": return createAdmin(args[0], args[1], args[2]);
    case "issue-keys": return issueKeys(args[0], args[1], args[2], args[3]);
    case "grant": return grant(args[0], args[1], args[2]);
    case "list": return listCustomers();
    case "suspend": return setCustomerStatus(args[0], "suspended", "suspend");
    case "activate": return setCustomerStatus(args[0], "active", "activate");
    case "ban": return setCustomerStatus(args[0], "banned", "ban");
    case "pause": return pauseSubscription(args[0], false);
    case "resume": return pauseSubscription(args[0], true);
    case "stats": return stats();
    default:
      console.log(HELP);
      if (command) process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\n❌ ${(err as Error).message}\n`);
    process.exit(1);
  });
