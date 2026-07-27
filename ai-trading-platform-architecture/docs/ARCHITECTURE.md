# Architecture — Private Subscription Trading Assistant

> Product context: `PRODUCT.md` · Rationale: `DECISIONS.md` · Plan: `ROADMAP.md`

## Overview

A **signals-only**, subscription-gated trading assistant delivered through an
Arabic Telegram bot. Three properties drive every structural choice:

1. **The brain is pure.** All analysis is `(candles, config) => report` with no
   I/O, so it is deterministic, unit-testable, and reusable by the live loop,
   a backtester, and research scripts alike.
2. **Arabic is presentation, not logic.** The engine emits stable machine
   `ReasonCode`s; one file renders them into Arabic. Adding a language is a new
   file, not a refactor.
3. **Access is one function.** Every command and every fan-out passes through
   `evaluateAccess`, so revenue-critical logic has a single audit point.

## Module map

```
src/
  lib/
    intelligence/            THE BRAIN — pure, no I/O
      types.ts                 Shared types + calibrated DEFAULT_BRAIN_CONFIG
      structure.ts             Swings, BOS/CHoCH, S/R + supply/demand zones
      analysers.ts             Trend, momentum, volume, liquidity, volatility,
                               price action, zones — each -> score/confidence
      decision.ts              Confluence scoring, MTF aggregation, trade plan,
                               ordered veto gates
      learning.ts              Calibration, self-critique, performance stats
      __tests__/               Fixtures with known-correct answers + 11 tests

    access/
      entitlements.ts          THE ACCESS GATE — plans, quotas, expiry (pure)
      __tests__/               14 tests covering grant AND denial paths

    market/
      exchange.ts              MarketDataSource port, failover router with
                               circuit breaker, candle validation
      adapters.ts              Binance / Bybit / OKX / simulator
      simulator.ts             Deterministic offline source
      symbols.ts               Trading universe metadata

    telegram/
      messages.ar.ts           THE ONLY place Arabic user copy lives
      commands.ts              Arabic command router + text normalisation
      client.ts                Bot API client, rate pacing, broadcast
      handler.ts               Composition root: parse -> access -> execute

    engine/
      signal-engine.ts         Orchestration via injected ports (hexagonal)
      backtest/                Backtesting harness — replays decide() on
                               historical candles (runBacktest, computeMetrics,
                               buildWalkForward) + 8 tests

    auth.ts                    Owner-console sessions only
  db/schema.ts                 Customers, plans, subscriptions, payments,
                               signals, outcomes, calibration, audit
  app/
    api/telegram/webhook/      The single public entry point
    api/health/                Liveness probe
    page.tsx                   Private notice — no public signup
scripts/
  calibrate-thresholds.ts      Evidence behind the entry threshold
```

## The intelligence core

### Scoring: agreement × coverage

Each analyser returns a directional score in `[-1, 1]` and a self-assessed
confidence in `[0, 1]`. Combining them naively — a plain confidence-weighted
average over all analysers — conflates two different questions and measurably
broke the engine: a textbook setup with four confirming reads and four silent
ones scored **44**, below the entry threshold, because silence was being
counted as disagreement.

The scorer now separates them:

- **Agreement** — confidence-weighted mean over analysers that actually have an
  opinion (`|score| >= 0.08`). Hesitant analysers sway it less.
- **Coverage** — how much of the evidence base spoke, weighted by base weight
  only (participation is binary). Floored at `0.55` so a genuine 3-of-6
  confluence survives, capped at `1`.

`confluence = agreement × coverage`. Volatility is excluded entirely — it is a
regime gate, never a direction.

### Calibrated thresholds

`minConfluence` is **measured, not guessed** (`npm run calibrate`):

| Input | Aggregate confluence |
|---|---|
| Directionless market, p50 / p90 / p99 | 15 / 40 / **47** |
| Pure chop | 19 |
| Textbook A+ breakout / breakdown | **55 / 54** |
| **Configured threshold** | **52** |

Sitting above the noise p99 and below a genuine setup *is* the product. Re-run
the script after touching any analyser or weight.

### Ordered veto gates

Twelve gates run in a deliberate order — cheapest and most fundamental first —
so the reported reason is the root cause, not a downstream symptom. The first
gate that fails decides the verdict. Gates can only downgrade, never upgrade.

`wait` and `reject` are **successful outcomes**: refusing to trade is the
single most valuable thing a disciplined system does.

### Trade plans that refuse to lie

- **Stops go to the nearest valid structural level**, not blindly to the last
  swing. On a breakout the last major swing can sit 7 ATR away while the
  consolidation base that truly invalidates the idea is 1.5 ATR away.
- **No silent ATR fallback when structure exists but is far.** That would
  quietly re-enable the price-chasing this engine exists to prevent; instead it
  returns `WAIT_BETTER_PRICE`.
- **Targets are R-multiples** (2R / 3.5R), never fixed percentages.
- **Exposure is capped at 25%** of portfolio. The textbook formula
  `risk / stopDistance` returns >100% on a tight stop — printing that in a
  signal silently assumes leverage the customer may not have.

## Data layer

`MarketDataRouter` fans reads across Binance → Bybit → OKX with a circuit
breaker: after 3 consecutive failures a venue is skipped for 60s (half-open
probe after). Blind retries during an outage turn one slow call into N slow
calls and stall the entire scan.

`validateCandles` rejects non-positive prices, inconsistent OHLC, and
non-monotonic timestamps before they reach the brain. A single zero-price
candle can invent a crash and fire a signal — invalid feeds are dropped, not
patched, and the brain then refuses on `REJECT_INSUFFICIENT_DATA`.

The simulator remains as a last-priority, never-failing source, but is only
included in production when `ALLOW_SIMULATED_DATA=true` — customers must never
be served synthetic prices by accident.

## Access control

`evaluateAccess(customer, subscription, now)` is the only authority. Ordering
is deliberate: **bans are checked before billing**, so a banned user is never
invited to pay. Cancellation honours the period already purchased.
`featuresSnapshot` is frozen at purchase so a plan edit cannot retroactively
downgrade a paying customer.

Gates run in `handler.ts` *before* the command body, so a new command cannot
ship without subscription enforcement.

## Security

| Surface | Control |
|---|---|
| Webhook | Constant-time `secret_token` compare **before** body parsing |
| Webhook errors | Always 200 to authenticated updates; a poison update must not trigger a Telegram retry storm |
| Owner sessions | Opaque tokens, SHA-256 hashed at rest, 8h TTL, instant revocation |
| Licence keys | Hashed at rest — a DB leak cannot be turned into free access |
| Customer credentials | None exist: `telegramId` is the identity, no exchange keys stored |
| Privileged commands | Non-owners get the generic "unknown command" reply |
| Payments | Immutable ledger, unique `(provider, providerRef)` |

## Learning loop

Closed signals become `OutcomeRecord`s. Calibration is deliberately
conservative: nothing adapts below 25 samples, adjustments are shrunk toward
neutral (empirical-Bayes style), and the multiplier is clamped to
`[0.7, 1.15]`. Only **probability** is calibrated — risk limits are policy, not
something a model may optimise away.

`deriveLessons()` pattern-matches actionable mistakes (stops too tight,
over-confident buckets, negative-expectancy regimes) and renders them in
Arabic for the owner.

## Testing

52 tests, all passing (`npm test`): 11 intelligence, 21 access, 12 schema
(real Postgres via PGlite), 8 backtest. The fixtures encode *known-correct*
answers, and building them surfaced two real engine bugs (the coverage
double-count and the ATR fallback bypass). Fixture realism matters: an early
version used near-zero wicks, which understated ATR and made every structural
level look 7+ ATR away — the tests were failing because the *fixture* was
wrong, verified against the real distribution (p90 = 2.65 ATR).

## Backtesting (v2.2)

`src/lib/backtest/` replays the **exact** `decide()` path the live bot uses, so
any number it prints is a property of the shipped brain — not a parallel
research implementation that can drift. It is pure (no I/O, no DB, no
Telegram, no Arabic) and reuses the live fill rules from `signal-engine.ts`:

- **Stop-fills-first** when a bar touches both stop and target (worst-case).
- **TP1 → breakeven**: the stop moves to entry; a later hit is a scratch (0R),
  not a loss. **TP2** closes the full position at +riskReward2.
- **Every decision is recorded**, rejections included — selectivity
  (enter / all-decisions) is an honest health signal.
- **Walk-forward** (`buildWalkForward`) yields out-of-sample folds that retain
  warm-up history; the brain config is deliberately **not** re-fit per fold.
- `computeMetrics` reports win rate, expectancy (R and %), profit factor, max
  drawdown, and max consecutive losses over **all** decisions.

`scripts/run-backtest.ts` (`npm run backtest`) drives it. By default it runs on
the **deterministic simulator** and prints a loud *not a performance claim*
banner — for real statistics, feed real historical candles and paper-run live
(MASTER.md §10 / SETUP.md §7).
