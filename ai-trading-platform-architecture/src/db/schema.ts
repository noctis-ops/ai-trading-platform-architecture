// ---------------------------------------------------------------------------
// Database schema for the Autonomous AI Trading Platform.
//
// Domains covered:
//  - Identity & access (users, sessions, subscriptions)
//  - Trading accounts, risk configuration, positions, orders, trade ledger
//  - Strategy framework + backtesting results
//  - Watchlists, price alerts, notifications
//  - Audit log for compliance / forensics
// ---------------------------------------------------------------------------
import {
  boolean,
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

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("trader"), // trader | admin
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"), // free | pro | institutional
  status: text("status").notNull().default("active"), // active | canceled | trialing
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Trading accounts + risk configuration
// ---------------------------------------------------------------------------
export const accounts = pgTable("accounts", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Main Portfolio"),
  baseCurrency: text("base_currency").notNull().default("USDT"),
  balance: numeric("balance", { precision: 20, scale: 2 }).notNull().default("100000"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const strategies = pgTable("strategies", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // sma_crossover | rsi_mean_reversion | donchian_breakout | momentum
  symbol: text("symbol").notNull().default("BTCUSDT"),
  timeframe: text("timeframe").notNull().default("1h"),
  params: jsonb("params").notNull().default({}),
  status: text("status").notNull().default("draft"), // draft | active | paused
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskSettings = pgTable("risk_settings", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .unique()
    .references(() => accounts.id, { onDelete: "cascade" }),
  maxLeverage: numeric("max_leverage", { precision: 6, scale: 2 }).notNull().default("10"),
  riskPerTradePct: numeric("risk_per_trade_pct", { precision: 6, scale: 3 }).notNull().default("1"),
  maxPositionPct: numeric("max_position_pct", { precision: 6, scale: 2 }).notNull().default("20"),
  maxDailyLossPct: numeric("max_daily_loss_pct", { precision: 6, scale: 2 }).notNull().default("5"),
  maxDrawdownPct: numeric("max_drawdown_pct", { precision: 6, scale: 2 }).notNull().default("20"),
  maxOpenPositions: integer("max_open_positions").notNull().default(8),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable("positions", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // long | short
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
  leverage: numeric("leverage", { precision: 6, scale: 2 }).notNull().default("1"),
  stopLoss: numeric("stop_loss", { precision: 20, scale: 8 }),
  takeProfit: numeric("take_profit", { precision: 20, scale: 8 }),
  liquidationPrice: numeric("liquidation_price", { precision: 20, scale: 8 }),
  status: text("status").notNull().default("open"), // open | closed | liquidated
  closePrice: numeric("close_price", { precision: 20, scale: 8 }),
  realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const orders = pgTable("orders", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // buy | sell
  type: text("type").notNull().default("market"),
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  price: numeric("price", { precision: 20, scale: 8 }),
  leverage: numeric("leverage", { precision: 6, scale: 2 }).notNull().default("1"),
  stopLoss: numeric("stop_loss", { precision: 20, scale: 8 }),
  takeProfit: numeric("take_profit", { precision: 20, scale: 8 }),
  status: text("status").notNull().default("filled"), // pending | filled | cancelled | rejected
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trades = pgTable("trades", {
  id: id(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
  positionId: uuid("position_id").references(() => positions.id, { onDelete: "set null" }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  price: numeric("price", { precision: 20, scale: 8 }).notNull(),
  fee: numeric("fee", { precision: 20, scale: 8 }).notNull().default("0"),
  realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Research: strategies & backtests
// ---------------------------------------------------------------------------
export const backtests = pgTable("backtests", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  strategyId: uuid("strategy_id").references(() => strategies.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  initialBalance: numeric("initial_balance", { precision: 20, scale: 2 }).notNull().default("10000"),
  params: jsonb("params").notNull().default({}),
  metrics: jsonb("metrics"),
  equityCurve: jsonb("equity_curve"),
  tradesLog: jsonb("trades_log"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Watchlists, alerts, notifications
// ---------------------------------------------------------------------------
export const watchlist = pgTable(
  "watchlist",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("watchlist_user_symbol_idx").on(table.userId, table.symbol)],
);

export const alerts = pgTable("alerts", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  condition: text("condition").notNull(), // above | below
  targetPrice: numeric("target_price", { precision: 20, scale: 8 }).notNull(),
  status: text("status").notNull().default("active"), // active | triggered | cancelled
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
