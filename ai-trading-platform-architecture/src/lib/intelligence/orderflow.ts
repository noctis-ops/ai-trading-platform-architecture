// ---------------------------------------------------------------------------
// Order Flow Analysers — VWAP, Volume Profile, Cumulative Volume Delta
//
// These are the institutional-grade tools that v2.x was missing.
// All are PURE functions: (candles) => AnalyserReport.
//
//   VWAP — Volume-Weighted Average Price
//     - Above VWAP = bullish, below = bearish
//     - Deviation from VWAP signals exhaustion
//     - VWAP acts as dynamic support/resistance
//
//   Volume Profile — Distribution of volume across price levels
//     - POC (Point of Control) = price with most volume
//     - Value Area = 70% of volume around POC
//     - Price at VAH = potential resistance, VAL = potential support
//
//   CVD — Cumulative Volume Delta
//     - Buy pressure minus sell pressure
//     - Rising CVD with rising price = genuine uptrend
//     - Rising price, falling CVD = bearish divergence (distribution)
// ---------------------------------------------------------------------------

import { clamp } from "./structure";
import type { AnalyserReport, Candle, Reason } from "./types";

// ---------------------------------------------------------------------------
// VWAP — Volume-Weighted Average Price
// ---------------------------------------------------------------------------

export type VwapResult = {
  /** Current VWAP value. */
  vwap: number;
  /** Standard deviation of price around VWAP (for bands). */
  stdDev: number;
  /** Upper band: VWAP + 2×std. */
  upperBand: number;
  /** Lower band: VWAP - 2×std. */
  lowerBand: number;
  /** Distance of last close from VWAP, in standard deviations. */
  deviation: number;
  /** Cumulative volume. */
  cumulativeVolume: number;
};

/**
 * Computes anchored VWAP from the start of the series.
 * For daily VWAP, pass only today's candles.
 */
export function computeVwap(candles: Candle[]): VwapResult {
  if (candles.length === 0) {
    return { vwap: 0, stdDev: 0, upperBand: 0, lowerBand: 0, deviation: 0, cumulativeVolume: 0 };
  }

  let cumulativePv = 0; // price × volume
  let cumulativeVolume = 0;
  const typicalPrices: number[] = [];

  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    typicalPrices.push(typical);
    cumulativePv += typical * c.volume;
    cumulativeVolume += c.volume;
  }

  const vwap = cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : typicalPrices[typicalPrices.length - 1];

  // Standard deviation
  let sumSqDiff = 0;
  for (const tp of typicalPrices) {
    sumSqDiff += (tp - vwap) ** 2;
  }
  const stdDev = Math.sqrt(sumSqDiff / typicalPrices.length);
  const lastPrice = candles[candles.length - 1].close;
  const deviation = stdDev > 0 ? (lastPrice - vwap) / stdDev : 0;

  return {
    vwap,
    stdDev,
    upperBand: vwap + 2 * stdDev,
    lowerBand: vwap - 2 * stdDev,
    deviation,
    cumulativeVolume,
  };
}

export function analyseVwap(candles: Candle[]): AnalyserReport {
  if (candles.length < 20) {
    return { name: "vwap", score: 0, confidence: 0, reasons: [], metrics: {} };
  }

  const v = computeVwap(candles);
  const reasons: Reason[] = [];
  let score = 0;
  let confidence = 0.5;

  // Price above VWAP = bullish
  if (v.deviation > 1.5) {
    // Far above VWAP — potential exhaustion / mean-reversion target
    // v3.0 fix: only express a counter-trend opinion if we're clearly over-extended
    // and NOT in a trending regime (the weights module will suppress this in trends)
    score = 0; // Neutral — let the weight system handle regime context
    confidence = 0.4;
  } else if (v.deviation > 0.3) {
    // Modestly above VWAP — healthy bullish
    score = 0.4;
    reasons.push({ code: "TREND_UP_ALIGNED", score: 0.4, detail: {} });
    confidence = 0.6;
  } else if (v.deviation < -1.5) {
    // Far below VWAP — potential snap-back (neutral, let regime decide)
    score = 0;
    confidence = 0.4;
  } else if (v.deviation < -0.3) {
    // Modestly below VWAP — bearish
    score = -0.4;
    reasons.push({ code: "TREND_DOWN_ALIGNED", score: -0.4, detail: {} });
    confidence = 0.6;
  } else {
    // Near VWAP — neutral
    score = 0;
    confidence = 0.3;
  }

  // Price crossing VWAP is significant
  const prevClose = candles[candles.length - 2]?.close ?? 0;
  const crossedAbove = prevClose < v.vwap && candles[candles.length - 1].close > v.vwap;
  const crossedBelow = prevClose > v.vwap && candles[candles.length - 1].close < v.vwap;

  if (crossedAbove) {
    score += 0.3;
    reasons.push({ code: "STRUCTURE_CHOCH_UP", score: 0.3, detail: {} });
  } else if (crossedBelow) {
    score -= 0.3;
    reasons.push({ code: "STRUCTURE_CHOCH_DOWN", score: -0.3, detail: {} });
  }

  return {
    name: "vwap",
    score: clamp(score, -1, 1),
    confidence: clamp(confidence, 0, 1),
    reasons,
    metrics: {
      vwap: Math.round(v.vwap * 100) / 100,
      deviation: Math.round(v.deviation * 100) / 100,
      upperBand: Math.round(v.upperBand * 100) / 100,
      lowerBand: Math.round(v.lowerBand * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Volume Profile — Point of Control + Value Area
// ---------------------------------------------------------------------------

export type VolumeProfileResult = {
  /** Point of Control — price level with the most volume. */
  poc: number;
  /** Value Area High — upper bound of 70% volume. */
  vah: number;
  /** Value Area Low — lower bound of 70% volume. */
  val: number;
  /** Whether current price is inside the value area. */
  priceInValueArea: boolean;
  /** Distance from POC as % of price. */
  pocDistancePct: number;
};

/**
 * Builds a simple volume profile by dividing the price range into bins.
 * Returns the POC (price with most volume) and Value Area bounds.
 */
export function computeVolumeProfile(candles: Candle[], numBins = 20): VolumeProfileResult {
  if (candles.length < 10) {
    const p = candles[candles.length - 1]?.close ?? 0;
    return { poc: p, vah: p, val: p, priceInValueArea: true, pocDistancePct: 0 };
  }

  const prices = candles.flatMap(c => [c.high, c.low, c.close]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const binSize = (maxPrice - minPrice) / numBins;

  if (binSize <= 0) {
    const p = candles[candles.length - 1].close;
    return { poc: p, vah: p, val: p, priceInValueArea: true, pocDistancePct: 0 };
  }

  // Build volume per bin
  const bins: { volume: number; high: number; low: number }[] = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({
      volume: 0,
      low: minPrice + i * binSize,
      high: minPrice + (i + 1) * binSize,
    });
  }

  // Distribute each candle's volume across the bins it spans
  for (const c of candles) {
    const range = c.high - c.low;
    if (range <= 0) continue;
    for (const bin of bins) {
      // Fraction of the candle's range that overlaps this bin
      const overlapLow = Math.max(c.low, bin.low);
      const overlapHigh = Math.min(c.high, bin.high);
      if (overlapHigh > overlapLow) {
        const fraction = (overlapHigh - overlapLow) / range;
        bin.volume += c.volume * fraction;
      }
    }
  }

  // Sort bins by volume descending
  const sorted = [...bins].sort((a, b) => b.volume - a.volume);
  const pocBin = sorted[0];
  const poc = (pocBin.high + pocBin.low) / 2;

  // Value Area = 70% of total volume
  const totalVolume = bins.reduce((s, b) => s + b.volume, 0);
  let cumVolume = 0;
  let vah = poc;
  let val = poc;

  for (const bin of sorted) {
    cumVolume += bin.volume;
    vah = Math.max(vah, bin.high);
    val = Math.min(val, bin.low);
    if (cumVolume >= totalVolume * 0.7) break;
  }

  const lastPrice = candles[candles.length - 1].close;
  const priceInValueArea = lastPrice >= val && lastPrice <= vah;
  const pocDistancePct = ((lastPrice - poc) / poc) * 100;

  return { poc, vah, val, priceInValueArea, pocDistancePct };
}

export function analyseVolumeProfile(candles: Candle[]): AnalyserReport {
  if (candles.length < 30) {
    return { name: "volumeProfile", score: 0, confidence: 0, reasons: [], metrics: {} };
  }

  const vp = computeVolumeProfile(candles);
  const reasons: Reason[] = [];
  let score = 0;
  let confidence = 0.5;

  const lastPrice = candles[candles.length - 1].close;

  // Price above POC with acceptance = bullish
  if (lastPrice > vp.poc && vp.priceInValueArea) {
    // Price above POC but still in value — building value higher
    score = 0.3;
    reasons.push({
      code: "TREND_UP_ALIGNED",
      score: 0.3,
      detail: { pocDistance: Math.round(vp.pocDistancePct * 100) / 100 },
    });
    confidence = 0.55;
  } else if (lastPrice < vp.poc && vp.priceInValueArea) {
    // Price below POC but still in value — building value lower
    score = -0.3;
    reasons.push({
      code: "TREND_DOWN_ALIGNED",
      score: -0.3,
      detail: { pocDistance: Math.round(Math.abs(vp.pocDistancePct) * 100) / 100 },
    });
    confidence = 0.55;
  } else if (lastPrice > vp.vah) {
    // Above value area high — breakout or over-extension
    const nearVah = (lastPrice - vp.vah) / lastPrice < 0.01;
    if (nearVah) {
      // Just broke out — bullish if supported
      score = 0.5;
      reasons.push({ code: "STRUCTURE_BOS_UP", score: 0.5, detail: { level: vp.vah } });
      confidence = 0.45;
    } else {
      // Far from VAH — wait for retest
      score = -0.2;
      reasons.push({ code: "WAIT_BETTER_PRICE", score: 0, detail: {} });
      confidence = 0.3;
    }
  } else if (lastPrice < vp.val) {
    // Below value area low — breakdown or over-sold
    const nearVal = (vp.val - lastPrice) / lastPrice < 0.01;
    if (nearVal) {
      score = -0.5;
      reasons.push({ code: "STRUCTURE_BOS_DOWN", score: -0.5, detail: { level: vp.val } });
      confidence = 0.45;
    } else {
      score = 0.2;
      reasons.push({ code: "WAIT_BETTER_PRICE", score: 0, detail: {} });
      confidence = 0.3;
    }
  }

  return {
    name: "volumeProfile",
    score: clamp(score, -1, 1),
    confidence: clamp(confidence, 0, 1),
    reasons,
    metrics: {
      poc: Math.round(vp.poc * 100) / 100,
      vah: Math.round(vp.vah * 100) / 100,
      val: Math.round(vp.val * 100) / 100,
      pocDistancePct: Math.round(vp.pocDistancePct * 100) / 100,
    },
  };
}

// ---------------------------------------------------------------------------
// Cumulative Volume Delta — Simplified approximation
// ---------------------------------------------------------------------------

/**
 * Approximates CVD from OHLCV data without actual tick data.
 * Uses the candle close vs open to estimate buying vs selling pressure.
 *
 *   delta = volume × (close - open) / (high - low)
 *
 * Positive delta = net buying pressure.
 * Cumulative sum over the series = CVD.
 */
export function computeCvd(candles: Candle[]): { cvd: number[]; delta: number[]; divergence: boolean } {
  const delta: number[] = [];
  const cvd: number[] = [];
  let cum = 0;

  for (const c of candles) {
    const range = c.high - c.low;
    const body = c.close - c.open;
    // Assign volume proportionally: positive body = buy, negative = sell
    const rawDelta = range > 0 ? (body / range) * c.volume : 0;
    delta.push(rawDelta);
    cum += rawDelta;
    cvd.push(cum);
  }

  // Check for bearish divergence: price making new highs but CVD making lower highs
  const recent = candles.slice(-10);
  const recentCvd = cvd.slice(-10);
  const priceRising = recent[recent.length - 1].close > recent[0].close;
  const cvdFalling = recentCvd[recentCvd.length - 1] < recentCvd[0];

  return {
    cvd,
    delta,
    divergence: priceRising && cvdFalling, // bearish divergence
  };
}

export function analyseOrderFlow(candles: Candle[]): AnalyserReport {
  if (candles.length < 20) {
    return { name: "orderFlow", score: 0, confidence: 0, reasons: [], metrics: {} };
  }

  const { cvd, delta, divergence } = computeCvd(candles);
  const reasons: Reason[] = [];
  let score = 0;
  let confidence = 0.4;

  // Recent delta trend (last 5 bars)
  const recentDelta = delta.slice(-5);
  const deltaSum = recentDelta.reduce((a, b) => a + b, 0);
  const totalRecentVolume = candles.slice(-5).reduce((a, c) => a + c.volume, 0);
  const deltaRatio = totalRecentVolume > 0 ? deltaSum / totalRecentVolume : 0;

  // Strong net buying
  if (deltaRatio > 0.15) {
    score = 0.5;
    confidence = 0.7;
    reasons.push({
      code: "VOLUME_CONFIRMS",
      score: 0.5,
      detail: { ratio: Math.round(deltaRatio * 100) / 100 },
    });
  }
  // Strong net selling
  else if (deltaRatio < -0.15) {
    score = -0.5;
    confidence = 0.7;
    reasons.push({
      code: "VOLUME_CONFIRMS",
      score: -0.5,
      detail: { ratio: Math.round(Math.abs(deltaRatio) * 100) / 100 },
    });
  }
  // Slight buying
  else if (deltaRatio > 0.03) {
    score = 0.2;
    confidence = 0.5;
    reasons.push({ code: "VOLUME_CONFIRMS", score: 0.2, detail: {} });
  }
  // Slight selling
  else if (deltaRatio < -0.03) {
    score = -0.2;
    confidence = 0.5;
    reasons.push({ code: "VOLUME_CONFIRMS", score: -0.2, detail: {} });
  }

  // Bearish divergence (price up, CVD down = distribution)
  if (divergence) {
    score -= 0.4;
    confidence = Math.max(confidence, 0.6);
    reasons.push({
      code: "MOMENTUM_DIVERGENCE_BEAR",
      score: -0.4,
      detail: {},
    });
  }

  return {
    name: "orderFlow",
    score: clamp(score, -1, 1),
    confidence: clamp(confidence, 0, 1),
    reasons,
    metrics: {
      deltaRatio: Math.round(deltaRatio * 1000) / 1000,
      divergence: divergence ? 1 : 0,
      cvdTrend: deltaSum > 0 ? 1 : deltaSum < 0 ? -1 : 0,
    },
  };
}
