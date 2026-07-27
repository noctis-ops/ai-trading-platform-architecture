// ---------------------------------------------------------------------------
// Database schema — Private Subscription Trading Assistant.
//
// Product model (see /docs/PRODUCT.md):
//   - Access is via a Telegram bot, NOT a public web app.
//   - Only paying subscribers with an active entitlement receive signals.
//   - A single owner/admin console manages customers, plans, and payments.
//   - The system emits ANALYSIS AND SIGNALS ONLY — it never places orders and
//     never holds customer exchange API keys (see DECISIONS.md #12).
//
// Domains:
//   1. Identity & access      customers, admin_users, sessions, licence keys
//   2. Commerce               plans, subscriptions, payments
//   3. Intelligence output    signals, signal_events, analysis_snapshots
//   4. Learning loop          signal_outcomes, calibration
//   5. Operations             delivery_log, usage_events, audit_logs, settings
// ---------------------------------------------------------------------------
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// 1. Identity & access
// ---------------------------------------------------------------------------

/**
 * A customer IS a Telegram user. There is no password and no public signup —
 * `telegramId` is the primary identity, which removes an entire class of
 * credential-stuffing attacks from the product surface.
 */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    telegramId: bigint("telegram_id", { mode: "bigint" }).notNull().unique(),
    telegramUsername: text("telegram_username"),
    displayName: text("display_name"),
    languageCode: text("language_code").notNull().default("ar"),
    /** pending | active | suspended | banned — access gate, independent of billing. */
    status: text("status").notNull().default("pending"),
    /** Owner-only free-text notes about the customer (CRM). */
    notes: text("notes"),
    /** Per-customer notification preferences (mute windows, symbol filters). */
    preferences: jsonb("preferences").notNull().default({}),
    timezone: text("timezone").notNull().default("Asia/Riyadh"),
    // `createdAt` IS the first-seen timestamp — a separate `firstSeenAt`
    // mapped to the same column, which silently dropped a field and broke
    // every INSERT (caught by the schema integration test).
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("customers_status_idx").on(t.status)],
);

/** Owner + support staff. Separate table so staff auth never touches customers. */
export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  /** owner | support — owner can manage billing and staff, support cannot. */
  role: text("role").notNull().default("support"),
  totpSecret: text("totp_secret"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: id(),
  adminUserId: uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Plans are DATA, not code — adding a new tier is an INSERT, never a deploy.
 * `features` holds the entitlement flags the bot checks at runtime.
 */
export const plans = pgTable("plans", {
  id: id(),
  code: text("code").notNull().unique(), // basic | pro | vip
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  descriptionAr: text("description_ar"),
  priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  /** Discounted price when billed quarterly/yearly; null = not offered. */
  priceQuarterly: numeric("price_quarterly", { precision: 12, scale: 2 }),
  priceYearly: numeric("price_yearly", { precision: 12, scale: 2 }),
  /**
   * Entitlements, e.g.:
   * { maxSymbols: 5, timeframes: ["1h","4h"], dailyReports: true,
   *   weeklyReports: true, monthlyReports: true, onDemandAnalysisPerDay: 20,
   *   prioritySeconds: 0, customRisk: false }
   */
  features: jsonb("features").notNull().default({}),
  /** Sort order in the Arabic /الخطط menu. */
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Licence keys let the owner sell access out-of-band (resellers, promo codes,
 * manual bank transfers) and have the customer redeem it inside Telegram.
 * Only a hash is stored so a database leak cannot be turned into free access.
 */
export const licenceKeys = pgTable(
  "licence_keys",
  {
    id: id(),
    keyHash: text("key_hash").notNull().unique(),
    /** Human-readable prefix for support lookups, e.g. "QA-7F3K". */
    keyPrefix: text("key_prefix").notNull(),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    durationDays: integer("duration_days").notNull().default(30),
    /** issued | redeemed | revoked | expired */
    status: text("status").notNull().default("issued"),
    redeemedByCustomerId: uuid("redeemed_by_customer_id").references(() => customers.id, { onDelete: "set null" }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    issuedByAdminId: uuid("issued_by_admin_id").references(() => adminUsers.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("licence_keys_status_idx").on(t.status)],
);

// ---------------------------------------------------------------------------
// 2. Commerce
// ---------------------------------------------------------------------------

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    /** trialing | active | past_due | paused | canceled | expired */
    status: text("status").notNull().default("active"),
    billingPeriod: text("billing_period").notNull().default("monthly"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** The authoritative access deadline checked on every bot interaction. */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    /** Owner-set pause — access blocked without destroying subscription history. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    autoRenew: boolean("auto_renew").notNull().default(false),
    /** manual | licence_key | crypto | stripe — how this period was paid for. */
    source: text("source").notNull().default("manual"),
    /** Snapshot of plan features at purchase time, so a plan edit can't retroactively downgrade a paying customer. */
    featuresSnapshot: jsonb("features_snapshot").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscriptions_customer_idx").on(t.customerId),
    index("subscriptions_status_period_idx").on(t.status, t.currentPeriodEnd),
  ],
);

/**
 * Immutable payment ledger. Rows are never updated in place except to attach
 * a provider reference — a financial record that can be edited is not a record.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    /** manual | crypto | stripe | licence_key */
    provider: text("provider").notNull().default("manual"),
    /** Provider-side id (tx hash, Stripe payment intent) — unique per provider. */
    providerRef: text("provider_ref"),
    /** pending | confirmed | failed | refunded */
    status: text("status").notNull().default("pending"),
    periodDays: integer("period_days").notNull().default(30),
    confirmedByAdminId: uuid("confirmed_by_admin_id").references(() => adminUsers.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_ref_idx").on(t.provider, t.providerRef),
    index("payments_customer_idx").on(t.customerId),
  ],
);

// ---------------------------------------------------------------------------
// 3. Intelligence output
// ---------------------------------------------------------------------------

/**
 * A signal is the brain's published decision. Rejected/waiting decisions are
 * ALSO stored (verdict != 'enter') because "why didn't it trade" is a core
 * product feature and the honest denominator for any performance claim.
 */
export const signals = pgTable(
  "signals",
  {
    id: id(),
    symbol: text("symbol").notNull(),
    exchange: text("exchange").notNull().default("binance"),
    /** enter | wait | reject */
    verdict: text("verdict").notNull(),
    direction: text("direction"), // long | short | null
    /** 0..100 confluence score shown as "نسبة الثقة". */
    confidence: integer("confidence").notNull().default(0),
    /** 0..1 modelled probability at publication time. */
    probability: numeric("probability", { precision: 5, scale: 4 }).notNull().default("0"),
    regime: text("regime").notNull(),
    entryTimeframe: text("entry_timeframe").notNull(),

    entryPrice: numeric("entry_price", { precision: 24, scale: 10 }),
    stopLoss: numeric("stop_loss", { precision: 24, scale: 10 }),
    takeProfit1: numeric("take_profit_1", { precision: 24, scale: 10 }),
    takeProfit2: numeric("take_profit_2", { precision: 24, scale: 10 }),
    riskReward: numeric("risk_reward", { precision: 8, scale: 3 }),
    riskPerTradePct: numeric("risk_per_trade_pct", { precision: 6, scale: 3 }),
    atr: numeric("atr", { precision: 24, scale: 10 }),

    /** Machine-readable reason codes — Arabic rendering happens at delivery. */
    supportingReasons: jsonb("supporting_reasons").notNull().default([]),
    objections: jsonb("objections").notNull().default([]),
    blockedBy: text("blocked_by"),

    /** open | tp1_hit | tp2_hit | stopped | breakeven | closed_manual | invalidated */
    status: text("status").notNull().default("open"),
    exitPrice: numeric("exit_price", { precision: 24, scale: 10 }),
    pnlPct: numeric("pnl_pct", { precision: 10, scale: 4 }),
    rMultiple: numeric("r_multiple", { precision: 8, scale: 3 }),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    /** Which plan tiers this signal was delivered to. */
    deliveredToPlans: jsonb("delivered_to_plans").notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("signals_symbol_created_idx").on(t.symbol, t.createdAt),
    index("signals_status_idx").on(t.status),
    index("signals_verdict_idx").on(t.verdict),
  ],
);

/** Timeline of everything that happened to a signal (TP1, SL moved, closed). */
export const signalEvents = pgTable(
  "signal_events",
  {
    id: id(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    /** published | tp1_hit | tp2_hit | stop_hit | stop_moved_be | invalidated | commentary */
    type: text("type").notNull(),
    price: numeric("price", { precision: 24, scale: 10 }),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("signal_events_signal_idx").on(t.signalId)],
);

/**
 * Full per-timeframe analyser output at decision time. Kept separate from
 * `signals` because it is large and only read for forensics/"شرح التحليل",
 * so it never bloats hot queries.
 */
export const analysisSnapshots = pgTable(
  "analysis_snapshots",
  {
    id: id(),
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    /** { "15m": { score, regime, reports: {...} }, ... } */
    timeframes: jsonb("timeframes").notNull(),
    brainConfig: jsonb("brain_config").notNull().default({}),
    /** Version of the decision engine that produced this — vital for A/B. */
    engineVersion: text("engine_version").notNull().default("1.0.0"),
    createdAt: createdAt(),
  },
  (t) => [index("analysis_snapshots_symbol_idx").on(t.symbol, t.createdAt)],
);

// ---------------------------------------------------------------------------
// 4. Learning loop
// ---------------------------------------------------------------------------

/**
 * Post-mortem per closed signal: what the brain expected vs what happened.
 * This is the input to calibration and to the "يحلل أخطاءه" product promise.
 */
export const signalOutcomes = pgTable(
  "signal_outcomes",
  {
    id: id(),
    signalId: uuid("signal_id")
      .notNull()
      .unique()
      .references(() => signals.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    regime: text("regime").notNull(),
    predictedProbability: numeric("predicted_probability", { precision: 5, scale: 4 }).notNull(),
    confidence: integer("confidence").notNull(),
    won: boolean("won").notNull(),
    rMultiple: numeric("r_multiple", { precision: 8, scale: 3 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    /** Max favourable/adverse excursion — did we stop out at the exact low? */
    mfeR: numeric("mfe_r", { precision: 8, scale: 3 }),
    maeR: numeric("mae_r", { precision: 8, scale: 3 }),
    /** Which reason codes were present — enables "which confluence actually pays". */
    reasonCodes: jsonb("reason_codes").notNull().default([]),
    /** Engine-generated lesson, e.g. "stops too tight in volatile_expansion". */
    lesson: text("lesson"),
    createdAt: createdAt(),
  },
  (t) => [index("signal_outcomes_regime_idx").on(t.regime)],
);

/**
 * Rolling calibration per (symbol|regime|bucket). The decision engine reads
 * `multiplier` to temper its probability estimate. Recomputed by a scheduled
 * job, never mutated inline by the signal loop.
 */
export const calibration = pgTable(
  "calibration",
  {
    id: id(),
    scope: text("scope").notNull(), // global | symbol | regime | reason_code
    scopeKey: text("scope_key").notNull(), // "BTCUSDT" | "trending_up" | "STRUCTURE_BOS_UP"
    sampleSize: integer("sample_size").notNull().default(0),
    observedWinRate: numeric("observed_win_rate", { precision: 5, scale: 4 }),
    predictedWinRate: numeric("predicted_win_rate", { precision: 5, scale: 4 }),
    expectancyR: numeric("expectancy_r", { precision: 8, scale: 3 }),
    /** Applied to probability estimates; clamped to [0.7, 1.15] by the engine. */
    multiplier: numeric("multiplier", { precision: 5, scale: 3 }).notNull().default("1"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calibration_scope_idx").on(t.scope, t.scopeKey)],
);

// ---------------------------------------------------------------------------
// 5. Operations
// ---------------------------------------------------------------------------

/** Per-customer delivery receipt — proves what each subscriber actually got. */
export const deliveryLog = pgTable(
  "delivery_log",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id").references(() => signals.id, { onDelete: "set null" }),
    /** signal | close | report | system | broadcast */
    kind: text("kind").notNull(),
    /** queued | sent | failed | blocked_by_user */
    status: text("status").notNull().default("queued"),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("delivery_log_customer_idx").on(t.customerId, t.createdAt),
    index("delivery_log_status_idx").on(t.status),
  ],
);

/** Command/feature usage — powers per-plan rate limits and owner analytics. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** Command name or feature key, e.g. "analyse" or "on_demand_analysis". */
    action: text("action").notNull(),
    symbol: text("symbol"),
    /** Denied requests are logged too — that is the upsell signal. */
    allowed: boolean("allowed").notNull().default(true),
    denyReason: text("deny_reason"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_customer_action_idx").on(t.customerId, t.action, t.createdAt)],
);

/** Append-only audit trail for every privileged action. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorType: text("actor_type").notNull(), // admin | system | customer
    actorId: text("actor_id"),
    action: text("action").notNull(), // subscription.extend, customer.suspend, plan.update...
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Before/after diff for reversible forensics. */
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_action_idx").on(t.action, t.createdAt)],
);

/** Runtime configuration the owner can change without a deploy. */
export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedByAdminId: uuid("updated_by_admin_id").references(() => adminUsers.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Symbols the engine scans, owner-controlled per plan tier. */
export const watchedSymbols = pgTable("watched_symbols", {
  id: id(),
  symbol: text("symbol").notNull().unique(),
  exchange: text("exchange").notNull().default("binance"),
  displayName: text("display_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  /** Minimum plan tier that receives signals on this symbol. */
  minPlanCode: text("min_plan_code").notNull().default("basic"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});
