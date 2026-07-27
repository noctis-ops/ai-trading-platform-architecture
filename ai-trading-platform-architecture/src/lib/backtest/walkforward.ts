// ---------------------------------------------------------------------------
// Walk-forward validation.
//
// Splits the history into sequential train/test folds. Crucially, the TEST
// candles retain the full pre-fold history as warm-up, so every indicator has
// enough bars — only the DECISIONS opened inside the test window count toward
// that fold's out-of-sample metrics. The brain config is NOT re-fit on the
// train fold: re-optimising per fold is exactly the curve-fitting this
// exercise exists to avoid (ROADMAP.md v2.2.2). The train fold is exposed for
// reference / in-sample sanity checks only.
// ---------------------------------------------------------------------------
import { TIMEFRAME_MINUTES, type Timeframe } from "@/lib/intelligence/types";
import type { CandlesByTimeframe } from "./types";

export type WalkForwardConfig = {
  /** Train (warm-up) length in fast-timeframe bars. */
  trainBars: number;
  /** Test (out-of-sample) length in fast-timeframe bars. */
  testBars: number;
  /** Advance between folds in fast bars (default = testBars, non-overlapping). */
  step?: number;
};

export type WalkForwardFold = {
  label: string;
  /** Full history up to the end of the test window (warm-up included). */
  candles: CandlesByTimeframe;
  /** First fast index where trading is allowed (start of the test window). */
  startIndex: number;
  trainBars: number;
  testBars: number;
};

/** First index with `time >= T` (series sorted ascending). */
function lowerBound(series: { time: number }[], T: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].time >= T) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index with `time > T` (series sorted ascending). */
function upperBound(series: { time: number }[], T: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].time > T) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Slice every timeframe to the inclusive time range [tStart, tEnd]. */
function sliceByTime(candles: CandlesByTimeframe, tStart: number, tEnd: number): CandlesByTimeframe {
  const out: CandlesByTimeframe = {};
  for (const tf of Object.keys(candles) as Timeframe[]) {
    const series = candles[tf]!;
    const s = lowerBound(series, tStart);
    const e = upperBound(series, tEnd);
    out[tf] = series.slice(s, e);
  }
  return out;
}

export function buildWalkForward(
  candles: CandlesByTimeframe,
  fastTimeframe: Timeframe,
  config: WalkForwardConfig,
): WalkForwardFold[] {
  const fastCandles = candles[fastTimeframe];
  if (!fastCandles) return [];
  const N = fastCandles.length;
  const step = config.step ?? config.testBars;

  const folds: WalkForwardFold[] = [];
  let start = 0;
  let idx = 0;

  while (start + config.trainBars + config.testBars <= N) {
    const trainEnd = start + config.trainBars; // exclusive
    const testStart = trainEnd;
    const testEnd = testStart + config.testBars; // exclusive

    const tEnd = fastCandles[testEnd - 1].time;

    folds.push({
      label: `fold-${String(idx + 1).padStart(2, "0")}`,
      candles: sliceByTime(candles, fastCandles[0].time, tEnd),
      startIndex: testStart,
      trainBars: config.trainBars,
      testBars: config.testBars,
    });

    start += step;
    idx++;
  }

  return folds;
}
