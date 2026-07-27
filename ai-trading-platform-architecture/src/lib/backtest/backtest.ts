// ---------------------------------------------------------------------------
// Backtesting engine — replays the exact `decide()` path over historical
// candles and simulates fills using the SAME conservative rules the live
// `SignalEngine` uses to track open signals.
//
// Why this file exists (ROADMAP.md v2.2.1): the brain is pure, so proving it
// works historically requires NO engine changes — only a harness that feeds it
// windows of past candles and books the resulting trades honestly. The harness
// therefore shares the brain's verdict logic verbatim and re-implements the
// fill/stop-management rules from `signal-engine.ts` (stop-fills-first, TP1
// moves the stop to breakeven, TP2 closes the full position).
//
// This module is pure: no I/O, no DB, no Telegram, no Arabic. It is unit
// tested in `__tests__/backtest.test.ts`.
// ---------------------------------------------------------------------------
import { maxDrawdown } from "@/lib/indicators";
import { decide, MIN_CANDLES } from "@/lib/intelligence/decision";
import {
  DEFAULT_BRAIN_CONFIG,
  type BrainConfig,
  type Candle,
  type Decision,
  type Direction,
  type Timeframe,
  type TradePlan,
} from "@/lib/intelligence/types";
import type { BacktestConfig, BacktestDecision, BacktestResult, BacktestTrade, CandlesByTimeframe } from "./types";

/** Number of candles in `series` whose `time` is <= T (series sorted ascending). */
function countUpToTime(series: Candle[], T: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].time <= T) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Build, for fast index `i`, the temporal window of candles up to that bar's
 *  close time. Alignment is by TIME, not index, so it is correct regardless of
 *  how each timeframe's series was generated. */
function buildWindow(candles: CandlesByTimeframe, fastCandles: Candle[], i: number): CandlesByTimeframe {
  const T = fastCandles[i].time;
  const window: CandlesByTimeframe = {};
  for (const tf of Object.keys(candles) as Timeframe[]) {
    const series = candles[tf]!;
    window[tf] = series.slice(0, countUpToTime(series, T));
  }
  return window;
}

/** Smallest fast index where EVERY timeframe has at least MIN_CANDLES bars up
 *  to that bar's time. The slowest timeframe is the binding constraint. */
function firstValidStep(candles: CandlesByTimeframe, fastCandles: Candle[]): number {
  const timeframes = Object.keys(candles) as Timeframe[];
  for (let i = MIN_CANDLES - 1; i < fastCandles.length; i++) {
    const T = fastCandles[i].time;
    const ok = timeframes.every((tf) => countUpToTime(candles[tf]!, T) >= MIN_CANDLES);
    if (ok) return i;
  }
  return -1;
}

function makeTrade(
  params: Omit<BacktestTrade, "status"> & { status: BacktestTrade["status"] },
): BacktestTrade {
  return params;
}

/**
 * Walk forward from `entryIndex` (the bar AFTER the signal) filling the trade
 * with the live engine's conservative rules:
 *   - stop is checked BEFORE any target on every bar, so a bar that wicks both
 *     fills the stop first (worst-case — vendors that assume the target fills
 *     first publish win rates customers never achieve);
 *   - TP1 hit moves the stop to breakeven and leaves the full position running;
 *   - TP2 hit closes the full position at +riskReward2;
 *   - if still open at the last available bar, closes at that bar's close.
 */
export function simulateTrade(
  plan: TradePlan,
  direction: Direction,
  fastCandles: Candle[],
  entryIndex: number,
  symbol: string,
): BacktestTrade {
  const isLong = direction === "long";
  const entryPrice = fastCandles[entryIndex].open;
  let stopLoss = plan.stopLoss;
  const tp1 = plan.takeProfit1;
  const tp2 = plan.takeProfit2;
  const risk = Math.abs(entryPrice - stopLoss);
  let stopMovedToBreakeven = false;

  const close = (exitIndex: number, exitPrice: number): BacktestTrade => {
    const signed = isLong ? exitPrice - entryPrice : entryPrice - exitPrice;
    const r = risk > 0 ? signed / risk : 0;
    let outcome: BacktestTrade["outcome"];
    let status: BacktestTrade["status"];
    if (stopMovedToBreakeven && r <= 0) {
      outcome = "breakeven";
      status = "breakeven";
    } else if (r > 0) {
      outcome = "tp2";
      status = "tp2_hit";
    } else {
      outcome = "stop";
      status = "stopped";
    }
    return makeTrade({
      symbol,
      direction,
      entryIndex: entryIndex - 1, // the signal bar, for reporting
      entryTime: fastCandles[entryIndex - 1].time,
      entryPrice,
      stopLoss: plan.stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      exitIndex,
      exitTime: fastCandles[exitIndex].time,
      exitPrice,
      rMultiple: r,
      outcome,
      status,
      positionSizePct: plan.positionSizePct,
      stopDistancePct: plan.stopDistancePct,
    });
  };

  for (let j = entryIndex; j < fastCandles.length; j++) {
    const c = fastCandles[j];
    const stopHit = isLong ? c.low <= stopLoss : c.high >= stopLoss;
    const tp1Hit = isLong ? c.high >= tp1 : c.low <= tp1;
    const tp2Hit = isLong ? c.high >= tp2 : c.low <= tp2;

    if (stopHit) return close(j, stopLoss);
    if (tp2Hit) return close(j, tp2);
    if (tp1Hit && !stopMovedToBreakeven) {
      stopMovedToBreakeven = true;
      stopLoss = entryPrice; // risk-free management: stop -> entry
    }
    if (j === fastCandles.length - 1) return close(j, c.close);
  }

  // Defensive: should be unreachable (loop always closes at the last bar).
  const last = fastCandles.length - 1;
  return close(last, fastCandles[last].close);
}

/** Run a single backtest over the supplied candles. */
export function runBacktest(candles: CandlesByTimeframe, config: BacktestConfig): BacktestResult {
  const brain: BrainConfig = config.brain ?? DEFAULT_BRAIN_CONFIG;
  const fastTf = brain.timeframes[0];
  const fastCandles = candles[fastTf];

  const empty = (): BacktestResult => ({
    symbol: config.symbol,
    decisions: [],
    trades: [],
    entries: 0,
    totalDecisions: 0,
  });

  if (!fastCandles || fastCandles.length < MIN_CANDLES) return empty();

  const warmup = firstValidStep(candles, fastCandles);
  if (warmup < 0) return empty();

  const step = config.step ?? 1;
  const startIndex = Math.max(warmup, config.startIndex ?? 0);

  const decisions: BacktestDecision[] = [];
  const trades: BacktestTrade[] = [];
  let openSignalIndex = -1; // fast index of the signal that opened the live trade

  for (let i = startIndex; i < fastCandles.length; i += step) {
    const window = buildWindow(candles, fastCandles, i);
    const hasOpenSignal = openSignalIndex >= 0;

    const decision: Decision = decide(config.symbol, window, brain, {
      hasOpenSignal,
      calibration: 1, // no learning loop in backtest; single-pass like live
    });

    decisions.push({
      index: i,
      time: fastCandles[i].time,
      verdict: decision.verdict,
      blockedBy: decision.blockedBy,
      confidence: decision.confidence,
    });

    if (decision.verdict === "enter" && decision.plan && decision.direction) {
      if (!hasOpenSignal || config.allowOverlap) {
        const entryIndex = i + 1; // fill at next bar open — no look-ahead
        if (entryIndex < fastCandles.length) {
          trades.push(simulateTrade(decision.plan, decision.direction, fastCandles, entryIndex, config.symbol));
          if (!config.allowOverlap) openSignalIndex = i;
        }
      }
    }

    // Release the exposure lock once the open trade has closed.
    if (openSignalIndex >= 0 && trades.length > 0) {
      const last = trades[trades.length - 1];
      if (i > last.exitIndex) openSignalIndex = -1;
    }
  }

  const entries = decisions.filter((d) => d.verdict === "enter").length;

  return {
    symbol: config.symbol,
    decisions,
    trades,
    entries,
    totalDecisions: decisions.length,
  };
}
