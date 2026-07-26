// ---------------------------------------------------------------------------
// Strategy Framework
//
// Every strategy implements the same pure-function interface so the
// backtesting engine, the paper-trading engine, and (eventually) a live
// execution engine can all share one code path. Strategies emit a discrete
// target position ("long" | "short" | "flat") for the *most recent* candle,
// given the full candle history up to and including that candle. This keeps
// strategies side-effect free and trivially testable.
// ---------------------------------------------------------------------------
import type { Candle } from "@/lib/indicators";
import { sma, rsi, donchianChannel, ema } from "@/lib/indicators";

export type Signal = "long" | "short" | "flat";

export type StrategyType = "sma_crossover" | "rsi_mean_reversion" | "donchian_breakout" | "momentum";

export type StrategyParams = Record<string, number>;

export type StrategyDefinition = {
  type: StrategyType;
  label: string;
  description: string;
  category: "trend_following" | "mean_reversion" | "breakout" | "momentum";
  defaultParams: StrategyParams;
  paramSchema: { key: string; label: string; min: number; max: number; step: number }[];
  /** Computes the signal series aligned index-for-index with `candles`. */
  computeSignals: (candles: Candle[], params: StrategyParams) => Signal[];
};

function smaCrossoverSignals(candles: Candle[], params: StrategyParams): Signal[] {
  const fastPeriod = Math.max(2, Math.round(params.fastPeriod ?? 10));
  const slowPeriod = Math.max(fastPeriod + 1, Math.round(params.slowPeriod ?? 30));
  const closes = candles.map((c) => c.close);
  const fast = sma(closes, fastPeriod);
  const slow = sma(closes, slowPeriod);
  return candles.map((_, i) => {
    if (fast[i] === null || slow[i] === null) return "flat";
    return (fast[i] as number) >= (slow[i] as number) ? "long" : "short";
  });
}

function rsiMeanReversionSignals(candles: Candle[], params: StrategyParams): Signal[] {
  const period = Math.max(2, Math.round(params.period ?? 14));
  const oversold = params.oversold ?? 30;
  const overbought = params.overbought ?? 70;
  const closes = candles.map((c) => c.close);
  const rsiValues = rsi(closes, period);
  const signals: Signal[] = new Array(candles.length).fill("flat");
  let state: Signal = "flat";
  for (let i = 0; i < candles.length; i++) {
    const r = rsiValues[i];
    if (r !== null) {
      if (r <= oversold) state = "long";
      else if (r >= overbought) state = "short";
      else if (r > 45 && r < 55) state = "flat";
    }
    signals[i] = state;
  }
  return signals;
}

function donchianBreakoutSignals(candles: Candle[], params: StrategyParams): Signal[] {
  const period = Math.max(2, Math.round(params.period ?? 20));
  const { upper, lower } = donchianChannel(candles, period);
  const signals: Signal[] = new Array(candles.length).fill("flat");
  let state: Signal = "flat";
  for (let i = 0; i < candles.length; i++) {
    if (upper[i] !== null && candles[i].close >= (upper[i] as number)) state = "long";
    else if (lower[i] !== null && candles[i].close <= (lower[i] as number)) state = "short";
    signals[i] = state;
  }
  return signals;
}

function momentumSignals(candles: Candle[], params: StrategyParams): Signal[] {
  const lookback = Math.max(2, Math.round(params.lookback ?? 20));
  const threshold = (params.thresholdPct ?? 2) / 100;
  const emaPeriod = Math.max(2, Math.round(params.smoothing ?? 5));
  const closes = candles.map((c) => c.close);
  const smoothed = ema(closes, emaPeriod);
  const signals: Signal[] = new Array(candles.length).fill("flat");
  let state: Signal = "flat";
  for (let i = 0; i < candles.length; i++) {
    if (i >= lookback && smoothed[i] !== null && smoothed[i - lookback] !== null) {
      const roc = ((smoothed[i] as number) - (smoothed[i - lookback] as number)) / (smoothed[i - lookback] as number);
      if (roc >= threshold) state = "long";
      else if (roc <= -threshold) state = "short";
    }
    signals[i] = state;
  }
  return signals;
}

export const STRATEGY_REGISTRY: Record<StrategyType, StrategyDefinition> = {
  sma_crossover: {
    type: "sma_crossover",
    label: "SMA Crossover (Trend Following)",
    description:
      "Goes long when the fast moving average is above the slow moving average and short when it flips below. Captures sustained directional trends; whipsaws in ranging markets.",
    category: "trend_following",
    defaultParams: { fastPeriod: 10, slowPeriod: 30 },
    paramSchema: [
      { key: "fastPeriod", label: "Fast SMA period", min: 2, max: 60, step: 1 },
      { key: "slowPeriod", label: "Slow SMA period", min: 5, max: 200, step: 1 },
    ],
    computeSignals: smaCrossoverSignals,
  },
  rsi_mean_reversion: {
    type: "rsi_mean_reversion",
    label: "RSI Mean Reversion",
    description:
      "Buys when RSI signals oversold conditions and sells when RSI signals overbought conditions, betting price reverts to the mean. Performs best in range-bound markets.",
    category: "mean_reversion",
    defaultParams: { period: 14, oversold: 30, overbought: 70 },
    paramSchema: [
      { key: "period", label: "RSI period", min: 2, max: 50, step: 1 },
      { key: "oversold", label: "Oversold threshold", min: 5, max: 45, step: 1 },
      { key: "overbought", label: "Overbought threshold", min: 55, max: 95, step: 1 },
    ],
    computeSignals: rsiMeanReversionSignals,
  },
  donchian_breakout: {
    type: "donchian_breakout",
    label: "Donchian Channel Breakout",
    description:
      "Enters long on a new N-period high and short on a new N-period low, a classic volatility breakout / turtle-trading style approach.",
    category: "breakout",
    defaultParams: { period: 20 },
    paramSchema: [{ key: "period", label: "Channel period", min: 5, max: 100, step: 1 }],
    computeSignals: donchianBreakoutSignals,
  },
  momentum: {
    type: "momentum",
    label: "Rate-of-Change Momentum",
    description:
      "Measures the smoothed rate of change over a lookback window and trades in the direction of momentum once it exceeds a threshold.",
    category: "momentum",
    defaultParams: { lookback: 20, thresholdPct: 2, smoothing: 5 },
    paramSchema: [
      { key: "lookback", label: "Lookback (bars)", min: 5, max: 100, step: 1 },
      { key: "thresholdPct", label: "Threshold %", min: 0.1, max: 10, step: 0.1 },
      { key: "smoothing", label: "EMA smoothing", min: 1, max: 30, step: 1 },
    ],
    computeSignals: momentumSignals,
  },
};

export function listStrategyDefinitions(): StrategyDefinition[] {
  return Object.values(STRATEGY_REGISTRY);
}

export function getStrategyDefinition(type: string): StrategyDefinition {
  const def = STRATEGY_REGISTRY[type as StrategyType];
  if (!def) throw new Error(`Unknown strategy type: ${type}`);
  return def;
}
