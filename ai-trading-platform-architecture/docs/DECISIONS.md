# Decision Log

## 1. Next.js App Router + server components for data fetching
**Decision:** Dashboard pages fetch data directly from the database via server components/lib functions rather than calling the platform's own REST API internally.
**Why:** Avoids an unnecessary network hop and cookie-forwarding complexity for same-origin server-rendered reads. The REST API under `/api` still exists and is used by every client-side interaction (forms, buttons), and would be the integration point for a future mobile app or third-party client.

## 2. Opaque session tokens instead of JWT
**Decision:** Sessions are random tokens hashed with SHA-256 and stored server-side, not signed JWTs.
**Why:** A trading platform must be able to instantly revoke a session (e.g. suspected compromise, forced logout on password change). Stateless JWTs can't be revoked before expiry without an additional denylist, which reintroduces server-side state anyway — so we start with the simpler, safer primitive.

## 3. Deterministic synthetic market data instead of a live exchange feed
**Decision:** `src/lib/market/simulator.ts` generates OHLCV data via seeded GBM + volatility clustering instead of calling a real exchange API.
**Why:** Live venues require API keys/network access not guaranteed in every environment, and the platform's own health and demo experience must not depend on a third-party being reachable. The simulator is deterministic per symbol/timeframe (same seed → same candles), which also makes backtests reproducible. It sits behind the same interface a real adapter would use, so it is a placeholder for — not an obstacle to — live connectivity.

## 4. Single-position-per-symbol paper trading model
**Decision:** The paper trading engine (and backtester) hold at most one open position per symbol at a time; a new signal in the opposite direction closes and reverses.
**Why:** Keeps margin/liquidation math and the UI unambiguous for v1. Multi-leg/partial-fill position management is a documented roadmap item, not an oversight.

## 5. `numeric` Postgres columns for all monetary/quantity fields
**Decision:** Prices, quantities, balances, and PnL are stored as Postgres `numeric`, not `float`/`double`.
**Why:** Floating point arithmetic is unacceptable for financial ledgers; `numeric` avoids rounding drift at the cost of needing explicit `Number()` conversions in TypeScript, which is an acceptable tradeoff.

## 6. Client-generated UUID primary keys
**Decision:** `id` columns use `uuid` with `$defaultFn(() => crypto.randomUUID())` rather than Postgres `gen_random_uuid()`.
**Why:** Avoids taking a hard dependency on the `pgcrypto` extension being enabled in every Postgres instance this template might run against.

## 7. Daily-loss circuit breaker is a documented placeholder
**Decision:** `dailyRealizedPnl` in the order-validation context is currently hardcoded to `0`.
**Why:** Accurately computing "today's realized PnL" requires a trades-by-day aggregate query which is a straightforward but non-trivial addition. Rather than fake a number that looks correct, this is explicitly called out here and in ARCHITECTURE.md as a roadmap item — the drawdown circuit breaker (based on equity peak) is fully functional today and provides real protection in the meantime.
