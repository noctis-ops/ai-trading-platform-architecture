import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const SECTIONS = [
  {
    title: "Architecture",
    body: "Quantum Arena is organized into independent modules: the Exchange Abstraction Layer (currently backed by a deterministic market simulator), the Strategy Framework, the Risk Engine, the Backtesting Engine, and the Portfolio/Positions layer. Each is a pure, testable TypeScript module under src/lib, wired into Next.js API routes for use by the UI. This mirrors how a production system would separate a matching-engine-facing adapter from strategy/risk logic, so a real exchange connector can be dropped in later without touching the rest of the stack.",
  },
  {
    title: "Risk Management",
    body: "Every order — manual or strategy-driven — passes through validateOrder() in the risk engine before it can execute: leverage caps (account + per-symbol), max position size as % of equity, max concurrent open positions, daily loss circuit breaker, and portfolio drawdown circuit breaker. Position sizing can additionally be computed with fixed-fractional risk based on stop-loss distance.",
  },
  {
    title: "Strategy Framework",
    body: "Strategies are pure functions: given OHLCV candles and parameters, they return a signal series (long/short/flat). This lets the exact same code run inside the backtester and (eventually) a live/paper execution loop. Four categories are implemented: trend following (SMA crossover), mean reversion (RSI), breakout (Donchian channel), and momentum (rate-of-change).",
  },
  {
    title: "Continuous Validation",
    body: "No strategy is assumed profitable. The backtesting engine applies realistic taker fees and slippage, then reports Sharpe ratio, CAGR, max drawdown, win rate, and profit factor. A strategy should only be promoted to 'active' after backtests show risk-adjusted returns consistent across multiple symbols/timeframes — this platform surfaces the tooling; promotion is a deliberate decision left to the trader.",
  },
  {
    title: "Data Layer",
    body: "PostgreSQL via Drizzle ORM. Core tables: users/sessions/subscriptions (identity & billing), accounts/risk_settings (trading account + limits), positions/orders/trades (execution ledger), strategies/backtests (research), watchlist/alerts/notifications (engagement), audit_logs (compliance).",
  },
  {
    title: "Security",
    body: "Passwords are hashed with bcrypt (cost 12). Sessions are opaque random tokens hashed with SHA-256 before storage, delivered via httpOnly, sameSite=lax cookies — this allows instant server-side revocation, unlike a stateless JWT. All mutating API routes re-verify the session server-side and scope every query to the authenticated user's own records.",
  },
  {
    title: "Roadmap",
    body: "Near-term: per-day realized PnL aggregation for accurate daily-loss circuit breaking, walk-forward optimization UI, webhook/email notification delivery, and a pluggable live ExchangeAdapter (Binance/Bybit) behind a feature flag. Mid-term: multi-account support, team/RBAC, Stripe billing integration for paid tiers, and WebSocket streaming market data to replace polling.",
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform Documentation</h1>
        <p className="text-sm text-slate-400">A living summary of the architecture and engineering decisions behind Quantum Arena.</p>
      </div>
      {SECTIONS.map((s) => (
        <Card key={s.title}>
          <h2 className="mb-2 text-lg font-semibold">{s.title}</h2>
          <p className="text-sm leading-relaxed text-slate-400">{s.body}</p>
        </Card>
      ))}
    </div>
  );
}
