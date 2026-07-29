-- Migration: auto-trading tables
-- Adds full trading infrastructure: accounts, configs, orders, positions, risk events.

CREATE TABLE IF NOT EXISTS "trading_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "venue" text NOT NULL,
  "market_type" text NOT NULL DEFAULT 'futures',
  "api_key_encrypted" text NOT NULL,
  "api_key_iv" text NOT NULL,
  "secret_hash" text NOT NULL,
  "passphrase_hash" text,
  "equity" numeric(24, 4) NOT NULL DEFAULT 0,
  "available_balance" numeric(24, 4) NOT NULL DEFAULT 0,
  "margin_balance" numeric(24, 4) NOT NULL DEFAULT 0,
  "unrealised_pnl" numeric(24, 4) NOT NULL DEFAULT 0,
  "daily_pnl" numeric(24, 4) NOT NULL DEFAULT 0,
  "daily_loss" numeric(24, 4) NOT NULL DEFAULT 0,
  "peak_equity" numeric(24, 4) NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_sync_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "trading_accounts_customer_idx" ON "trading_accounts"("customer_id");
CREATE INDEX IF NOT EXISTS "trading_accounts_active_idx" ON "trading_accounts"("is_active");

CREATE TABLE IF NOT EXISTS "trading_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trading_account_id" uuid NOT NULL UNIQUE REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "config" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "trading_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trading_account_id" uuid NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "signal_id" uuid REFERENCES "signals"("id") ON DELETE SET NULL,
  "exchange_order_id" text,
  "client_order_id" text NOT NULL,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "price" numeric(24, 10),
  "quantity" numeric(24, 10) NOT NULL,
  "filled_quantity" numeric(24, 10) NOT NULL DEFAULT 0,
  "avg_fill_price" numeric(24, 10),
  "filled_quote_value" numeric(24, 4) NOT NULL DEFAULT 0,
  "fee" numeric(24, 10) NOT NULL DEFAULT 0,
  "fee_currency" text NOT NULL DEFAULT 'USDT',
  "reduce_only" boolean NOT NULL DEFAULT false,
  "time_in_force" text NOT NULL DEFAULT 'GTC',
  "error" text,
  "raw_response" jsonb,
  "filled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "trading_orders_account_idx" ON "trading_orders"("trading_account_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "trading_orders_client_idx" ON "trading_orders"("client_order_id");

CREATE TABLE IF NOT EXISTS "trading_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trading_account_id" uuid NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "signal_id" uuid REFERENCES "signals"("id") ON DELETE SET NULL,
  "symbol" text NOT NULL,
  "direction" text NOT NULL,
  "market_type" text NOT NULL DEFAULT 'futures',
  "status" text NOT NULL DEFAULT 'open',
  "entry_price" numeric(24, 10) NOT NULL,
  "mark_price" numeric(24, 10),
  "quantity" numeric(24, 10) NOT NULL,
  "notional" numeric(24, 4) NOT NULL,
  "leverage" numeric(8, 2) NOT NULL DEFAULT 1,
  "margin_used" numeric(24, 4) NOT NULL DEFAULT 0,
  "unrealised_pnl" numeric(24, 4) NOT NULL DEFAULT 0,
  "unrealised_pnl_pct" numeric(10, 4) NOT NULL DEFAULT 0,
  "risk_amount" numeric(24, 4) NOT NULL DEFAULT 0,
  "risk_pct" numeric(8, 4) NOT NULL DEFAULT 0,
  "stop_loss_price" numeric(24, 10),
  "take_profit_1_price" numeric(24, 10),
  "take_profit_2_price" numeric(24, 10),
  "stop_moved_to_breakeven" boolean NOT NULL DEFAULT false,
  "trailing_stop_active" boolean NOT NULL DEFAULT false,
  "trailing_stop_price" numeric(24, 10),
  "mfe_r" numeric(8, 3) NOT NULL DEFAULT 0,
  "mae_r" numeric(8, 3) NOT NULL DEFAULT 0,
  "close_reason" text,
  "realised_pnl" numeric(24, 4) NOT NULL DEFAULT 0,
  "r_multiple" numeric(8, 3) NOT NULL DEFAULT 0,
  "opened_at" timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "trading_positions_account_idx" ON "trading_positions"("trading_account_id", "status");
CREATE INDEX IF NOT EXISTS "trading_positions_symbol_idx" ON "trading_positions"("symbol", "status");

CREATE TABLE IF NOT EXISTS "risk_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trading_account_id" uuid NOT NULL REFERENCES "trading_accounts"("id") ON DELETE CASCADE,
  "signal_id" uuid REFERENCES "signals"("id") ON DELETE SET NULL,
  "event_type" text NOT NULL,
  "reason" text,
  "checks" jsonb NOT NULL DEFAULT '[]',
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "risk_events_account_idx" ON "risk_events"("trading_account_id", "created_at");
