# Roadmap

## Shipped — v2.0 (this phase)

The complete decision core and commercial foundation, verified by 25 passing
tests and a reproducible calibration study.

- [x] **Trading intelligence core** — 8 pure analysers (trend, structure,
      zones, momentum, volume, liquidity, volatility, price action)
- [x] **Market structure** — fractal swings, BOS/CHoCH, supply/demand and
      support/resistance zone clustering
- [x] **Confluence engine** — agreement × coverage scoring, multi-timeframe
      aggregation, 12 ordered veto gates
- [x] **Empirically calibrated thresholds** — `npm run calibrate` reproduces
      the evidence behind `minConfluence = 52`
- [x] **Trade plan builder** — structural stops, R-multiple targets, capped
      exposure, "wait for pullback" instead of chasing
- [x] **Learning loop** — bounded calibration with shrinkage, Arabic
      self-critique lessons, performance statistics
- [x] **Arabic presentation layer** — all copy in one file, reason-code driven
- [x] **Access & entitlements** — plans, quotas, expiry, pause/suspend/ban
      (14 tests covering both grant and denial paths)
- [x] **Commercial schema** — customers, plans, subscriptions, immutable
      payment ledger, licence keys, audit log, usage tracking
- [x] **Multi-exchange data layer** — Binance/Bybit/OKX with circuit-breaker
      failover and candle validation
- [x] **Telegram layer** — Arabic command router with text normalisation,
      rate-paced client, secure webhook
- [x] **Signal engine** — orchestration through injected ports
- [x] Removed the public platform surface; owner-only web console auth

## Next — v2.1 (make it live)

The critical path to a working paid service.

- [ ] **Wire subscriber commands to the engine** — `runSubscriberCommand` is
      the single connection point; `/تحليل`, `/الحالة`, `/الصفقات` become real
- [ ] **`SignalStore` Postgres implementation** — the port is defined and the
      schema exists; this is the adapter
- [ ] **Scheduled jobs** — periodic scan, open-signal tracking, daily/weekly/
      monthly reports, expiry reminders
- [ ] **Licence key redemption** — generate, hash, redeem, extend subscription
- [ ] **Owner console UI** — customers, subscriptions, revenue, engine health
- [ ] **Database migrations** — generate and commit the initial Drizzle
      migration
- [ ] **Integration test** — fake Telegram + in-memory store, asserting the
      full path from update to delivered Arabic message

## Then — v2.2 (prove it works)

> Nothing in this section is optional before making performance claims.

- [x] **Backtest harness** — `src/lib/backtest/` replays the exact `decide()`
      path over historical candles; the engine is already pure, so this needs
      no engine changes. Conservative fills (stop first), every decision
      recorded. Drive it with `npm run backtest`.
- [x] **Walk-forward validation** — `buildWalkForward` produces out-of-sample
      windows; the config is **not** re-fit per fold (no curve-fitting).
- [x] **Publish honest statistics** — `computeMetrics` reports win rate,
      expectancy (R and %), profit factor, max drawdown, max consecutive
      losses, computed over **all** decisions (rejections included).
- [ ] Paper-run in production for a meaningful period (4–8 weeks) before
      selling — operational, not code.

## Later — v3 (scale the business)

- [ ] Automated payments (USDT confirmation and/or Stripe) via the existing
      `provider` abstraction
- [ ] Per-customer preferences: symbol filters, quiet hours, risk profile
- [ ] Economic calendar feed to make `REJECT_NEWS_WINDOW` real rather than
      a supplied flag
- [ ] Referral / affiliate tracking
- [ ] A/B testing of engine versions via `analysis_snapshots.engineVersion`
- [ ] Additional languages (one new `messages.*.ts` file)
- [ ] Order-flow and open-interest analysers

## Explicitly out of scope

- **Trade execution and custody of customer API keys** — see `DECISIONS.md #12`.
  This is a deliberate product boundary, not a missing feature.
- **A public self-service web app** — contradicts the private access model.
