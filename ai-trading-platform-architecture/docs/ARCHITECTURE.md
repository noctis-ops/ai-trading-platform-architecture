# Quantum Arena — Architecture

## Overview
Quantum Arena is a modular, risk-first cryptocurrency leveraged trading platform built on Next.js (App Router), PostgreSQL, and Drizzle ORM. It is designed so each subsystem can evolve independently and, where relevant, be swapped for a production implementation (e.g. a live exchange connector) without touching the rest of the stack.

## Module Map

```
src/
  db/
    schema.ts          Drizzle schema: identity, accounts, risk, positions,
                        orders, trades, strategies, backtests, watchlist,
                        alerts, notifications, subscriptions, audit_logs
  lib/
    auth.ts             Password hashing + opaque session tokens
    api-helpers.ts       Shared account/risk-settings bootstrapping
    format.ts            Display formatting helpers
    indicators.ts        SMA/EMA/RSI/ATR/Bollinger/MACD/Donchian, stats
    portfolio.ts          Mark-to-market position/portfolio aggregation
    market/
      symbols.ts          Trading universe metadata
      simulator.ts         Deterministic synthetic OHLCV engine (GBM + vol clustering)
    strategies/
      index.ts             Strategy framework + registry (4 strategies)
    risk/
      engine.ts             Order validation, position sizing, liquidation pricing
    backtest/
      engine.ts              Bar-by-bar backtest simulator with fees/slippage
  app/
    api/                     REST API routes (auth, market, orders, positions,
                             strategies, backtest, risk-settings, watchlist,
                             alerts, admin, health)
    dashboard/                Authenticated UI: overview, markets, positions,
                             orders, strategies, backtests, risk, alerts, admin, docs
    (auth)/                  Public login/register pages
```

## Exchange Abstraction Layer
Live exchange connectivity requires API keys and stable network access that cannot be guaranteed in every deployment environment, and a platform's own health checks must never depend on a third-party venue being reachable. `src/lib/market/simulator.ts` implements a deterministic Geometric Brownian Motion + volatility-clustering price engine, seeded per symbol so backtests are reproducible. The rest of the codebase (strategies, risk engine, backtester, UI) only depends on the shape `{ time, open, high, low, close, volume }` and a `getLatestPrice(symbol)` function — swapping in a real `ExchangeAdapter` (Binance, Bybit, OKX) means implementing that same surface and registering it; no other module needs to change.

## Strategy Framework
Every strategy is a pure function `(candles, params) => Signal[]`, so the exact same implementation can run inside the backtester today and a live/paper execution loop tomorrow. Four categories are implemented, one per major style of systematic trading: trend following (SMA crossover), mean reversion (RSI), breakout (Donchian channel), and momentum (smoothed rate-of-change).

## Risk Management
The risk engine (`src/lib/risk/engine.ts`) is the single choke point every order must pass through:
1. Leverage caps — account-level and per-symbol (exchange) maximum.
2. Margin sufficiency — rejects orders the account cannot margin.
3. Position size cap — notional as % of equity.
4. Open position cap — enforces diversification.
5. Daily loss circuit breaker — halts trading once daily realized losses breach a threshold.
6. Drawdown circuit breaker — halts trading once equity drawdown from its peak breaches a threshold.
7. Soft warnings — surfaced to the UI when leverage/position size approach (but don't breach) limits.

Position sizing can additionally be computed with fixed-fractional risk (`computePositionSize`), and liquidation price is computed from leverage + maintenance margin rate (`computeLiquidationPrice`).

## Backtesting Engine
`src/lib/backtest/engine.ts` walks candles bar-by-bar, applies a strategy's signal series, opens/closes a single position at a time with realistic taker fees (4 bps) and slippage (2 bps), and reports: final equity, total return, CAGR, Sharpe ratio (annualized from per-trade returns), max drawdown, win rate, profit factor, and per-trade P&L. No strategy is assumed profitable — every claim must be backed by these numbers.

## Data Layer
PostgreSQL via Drizzle ORM (`src/db/schema.ts`). See the Dependency/Entity map in this document's companion `API.md` for the full table list. All monetary values use `numeric` columns to avoid floating point drift; all identifiers are UUIDs generated client-side via `crypto.randomUUID()` to avoid a dependency on the `pgcrypto` extension.

## Security Model
- Passwords hashed with bcrypt (cost factor 12).
- Sessions are opaque random tokens; only a SHA-256 hash is stored server-side, delivered to the browser via an `httpOnly`, `sameSite=lax` cookie. This allows instant server-side revocation, unlike a stateless JWT.
- Every mutating API route re-verifies the session and scopes all queries to `req.user.id` — there is no client-supplied user/account id trusted anywhere in the write path.
- Admin-only routes/pages additionally check `role === "admin"` server-side.

## Observability
- `orders` retains rejected orders with a `rejectReason`, giving a full audit trail of risk-engine decisions.
- `audit_logs` table exists for broader compliance-relevant events (schema-ready; wiring up is a roadmap item).
- `/api/health` provides a liveness probe that verifies DB connectivity.

## Known Simplifications (see DECISIONS.md)
- Market data is a deterministic simulator, not a live exchange feed.
- Daily realized PnL for the loss circuit breaker is currently a placeholder (0) pending a trades-by-day aggregate — documented as a roadmap item, not silently hidden.
- Notifications table exists but delivery (email/webhook) is not yet wired up.
