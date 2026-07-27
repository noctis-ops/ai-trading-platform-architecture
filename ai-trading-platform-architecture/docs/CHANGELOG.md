# Changelog

## v2.2.0 — Backtesting engine + honest performance metrics

The "prove it works" stage. The brain is pure, so validating it historically
required no engine changes — only a harness that feeds it windows of past
candles and books trades with the SAME conservative rules the live
`SignalEngine` uses.

### Added — Backtest harness (`src/lib/backtest/`)
- `runBacktest()` — replays the exact `decide()` path over historical candles;
  alignment is by **time** (not index) so any timeframe source works, and the
  exposure gate (`REJECT_EXPOSURE_LIMIT`) prevents stacking on one symbol,
  exactly like production.
- `computeMetrics()` — win rate, expectancy (R and %), profit factor, max
  drawdown, max consecutive losses, computed over **all** decisions (rejections
  included) so selectivity stays honest. Equity impact uses the plan's own
  position sizing + stop distance.
- `buildWalkForward()` — out-of-sample folds that retain warm-up history; the
  brain config is NOT re-fit per fold (no curve-fitting).
- Conservative fill rules copied verbatim from `signal-engine.ts`: a bar that
  touches both stop and target fills the **stop first**; TP1 moves the stop to
  breakeven (scratch, not a loss); TP2 closes the full position at +3.5R.
- `scripts/run-backtest.ts` — CLI (`npm run backtest`) with `--symbols`,
  `--bars`, `--walk-forward`, `--train-bars`, `--test-bars`, `--step`. Defaults
  to the **deterministic simulator** with a loud "NOT a performance claim"
  banner; feed real candles before publishing any number.
- `docs/SETUP.md` — install/run guide plus a backtest section documenting the
  honesty guarantees and the real-data requirement.

### Tests
- `src/lib/backtest/__tests__/backtest.test.ts` — 8 tests covering conservative
  same-bar fills, TP1→breakeven scratch, long/short symmetry, full-decision
  recording, chop selectivity, walk-forward warm-up, and metric aggregation.
- Total suite now **52 tests** (was 44).

### Docs
- `MASTER.md` §9/§10 — v2.2 marked complete (except operational paper-run);
  test count 44 → 52.
- `ARCHITECTURE.md` — backtest module added to the map; test count updated.
- `ROADMAP.md` — v2.2 items checked; paper-run left as the remaining gate.

## v2.0.0 — Pivot to a private subscription trading assistant

**Breaking:** the public trading platform is replaced by a signals-only,
subscription-gated product delivered through an Arabic Telegram bot.

### Added — Trading intelligence core
- Eight pure analysers: trend, market structure, zones, momentum, volume,
  liquidity, volatility, price action.
- Market structure: fractal swing detection, BOS/CHoCH classification, and
  supply/demand + support/resistance zone clustering with recency weighting.
- Confluence engine separating **agreement** (do analysers concur) from
  **coverage** (how many spoke), with multi-timeframe aggregation.
- Twelve ordered veto gates; `wait` and `reject` are first-class outcomes with
  named causes.
- Trade plans with structural stops, R-multiple targets (2R/3.5R), a 25%
  exposure cap, and a `WAIT_BETTER_PRICE` verdict instead of chasing price.
- Learning loop: bounded calibration with shrinkage (min 25 samples, clamped to
  `[0.7, 1.15]`), Arabic self-critique lessons, performance statistics.
- `scripts/calibrate-thresholds.ts` — empirical evidence for `minConfluence=52`
  (noise p99 = 47, A+ setups = 54–55).

### Added — Commercial layer
- Access control: one `evaluateAccess` gate covering plans, quotas, expiry,
  pause/suspend/ban; bans are checked before billing; cancellation honours the
  paid period; `featuresSnapshot` prevents retroactive downgrades.
- Schema: customers, plans, subscriptions, immutable payment ledger, hashed
  licence keys, signals + outcomes + calibration, delivery log, usage events,
  audit log.
- Telegram: Arabic command router with text normalisation (همزات/تشكيل/تطويل),
  rate-paced Bot API client, webhook with constant-time secret verification.
- Multi-exchange market data (Binance/Bybit/OKX) with circuit-breaker failover
  and strict candle validation.
- Signal engine orchestrating data → brain → delivery through injected ports.

### Changed
- Identity is now `telegram_id`; customers have no passwords. `auth.ts` guards
  the owner console only (8h sessions, `owner`/`support` roles).
- Root page is a private notice; no public signup.
- Arabic user-facing copy is confined to `messages.ar.ts`.

### Removed
- Public dashboard, customer web auth, and the orders/positions/portfolio/
  strategies/backtest/watchlist/alerts APIs.
- Order placement and the account-level risk engine — the product no longer
  executes trades or holds customer exchange keys (`DECISIONS.md #12`).

### Fixed (found while building the test suite)
- Confluence scoring counted abstaining analysers as disagreement, capping a
  textbook setup at 44 and making the engine permanently silent.
- A silent ATR stop fallback re-enabled price-chasing when structure was far.
- Position size could exceed 100% of portfolio on tight stops.
- Signals cleared the entry gate yet were labelled "منخفضة" (low confidence).
- Reasons repeated once per timeframe, faking extra confluence.

### Added — Infrastructure
- `.gitignore` (the repository previously had none) and `.env.example`.
- `npm test` (25 tests) and `npm run calibrate`.

## v1.0.0 — Initial platform
- Database schema for identity, trading accounts, risk settings, positions, orders, trades, strategies, backtests, watchlist, alerts, notifications, subscriptions, and audit logs.
- Authentication system with bcrypt password hashing and revocable server-side sessions.
- Deterministic synthetic market data engine covering 10 crypto perpetual-style markets.
- Technical indicator library (SMA, EMA, RSI, ATR, Bollinger Bands, MACD, Donchian Channel, drawdown, Sharpe ratio).
- Strategy framework with SMA Crossover, RSI Mean Reversion, Donchian Breakout, and Momentum strategies.
- Backtesting engine with realistic fees/slippage and full performance metrics.
- Risk engine enforcing leverage, position size, open-position count, daily loss, and drawdown limits on every order.
- REST API covering auth, market data, orders, positions, strategies, backtests, risk settings, watchlist, alerts, and admin user directory.
- Full dashboard UI: overview, markets + trading, positions, order history, strategy management, backtest results with equity curve charting, risk settings, price alerts, and an admin console.
- Architecture, decision log, roadmap, and in-app documentation page.
