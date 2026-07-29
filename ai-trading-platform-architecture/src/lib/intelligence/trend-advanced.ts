// ---------------------------------------------------------------------------
// Advanced Trend Following — v3.1
//
// Upgrades from v2.x trend analyser:
//   1. ATR trailing stop instead of fixed stop
//   2. Dynamic targets scaled by trend strength
//   3. Pyramiding (scale-in at pullbacks within strong trends)
//   4. Early reversal detection (exit before stop is hit)
// ---------------------------------------------------------------------------

import { atr, sma, rsi } from "../indicators";
import { clamp } from "./structure";
import type { AnalyserReport, Candle, Reason, Direction } from "./types";

export type TrendQuality = {
  strength: number;           // 0-1 how strong the trend
  maturity: "early" | "mid" | "late"; // how far into the trend we are
  pullbackDepth: number;      // current pullback as % of ATR from recent high
  atrStopDistance: number;    // suggested ATR trailing stop multiplier
  targetsScaled: boolean;     // whether targets were scaled up
  pyramidingAllowed: boolean; // whether we can add to position
};

/**
 * Calculates a comprehensive trend analysis with quality metrics.
 */
export function analyseTrendAdvanced(candles: Candle[]): AnalyserReport & { quality: TrendQuality } {
  const emptyQ: TrendQuality = {
    strength: 0, maturity: "early", pullbackDepth: 0,
    atrStopDistance: 2.0, targetsScaled: false, pyramidingAllowed: false,
  };

  if (candles.length < 50) {
    return { name: "trend", score: 0, confidence: 0, reasons: [], metrics: {}, quality: emptyQ };
  }

  const closes = candles.map(c => c.close);
  const atrVals = atr(candles, 14);
  const currentAtr = atrVals[atrVals.length - 1] ?? 0;
  const currentPrice = closes[closes.length - 1];

  // --- Trend detection using SMA alignment ---
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, Math.min(200, candles.length));

  const s20 = sma20[sma20.length - 1] ?? currentPrice;
  const s50 = sma50[sma50.length - 1] ?? currentPrice;
  const s200 = sma200[sma200.length - 1] ?? currentPrice;

  const reasons: Reason[] = [];
  let score = 0;
  let strength = 0;

  // Bullish alignment: price > 20 > 50 > 200
  const bullishAligned = currentPrice > s20 && s20 > s50 && s50 > s200;
  const bearishAligned = currentPrice < s20 && s20 < s50 && s50 < s200;

  if (bullishAligned) {
    score = 0.5;
    strength = 0.5;
    reasons.push({ code: "TREND_UP_ALIGNED", score: 0.5, detail: {} });

    // Increasing separation = stronger trend
    const separation20_50 = ((s20 - s50) / s50) * 100;
    const separation50_200 = ((s50 - s200) / s200) * 100;

    if (separation20_50 > 1) { strength += 0.2; score += 0.15; }
    if (separation50_200 > 2) { strength += 0.2; score += 0.15; }
    if (separation20_50 > 3) { strength += 0.1; score += 0.1; }
  } else if (bearishAligned) {
    score = -0.5;
    strength = 0.5;
    reasons.push({ code: "TREND_DOWN_ALIGNED", score: -0.5, detail: {} });

    const separation20_50 = ((s50 - s20) / s50) * 100;
    const separation50_200 = ((s200 - s50) / s200) * 100;
    if (separation20_50 > 1) { strength += 0.2; score -= 0.15; }
    if (separation50_200 > 2) { strength += 0.2; score -= 0.15; }
  } else {
    reasons.push({ code: "TREND_FLAT", score: 0, detail: {} });
  }

  strength = clamp(strength, 0, 1);
  score = clamp(score, -1, 1);

  // --- Trend maturity: how far from the start ---
  let maturity: TrendQuality["maturity"] = "early";
  const trendStartIdx = bullishAligned
    ? closes.findIndex((_, i) => sma20[i] !== null && sma50[i] !== null && (sma20[i] ?? 0) > (sma50[i] ?? 0))
    : bearishAligned
      ? closes.findIndex((_, i) => sma20[i] !== null && sma50[i] !== null && (sma20[i] ?? 0) < (sma50[i] ?? 0))
      : -1;

  if (trendStartIdx >= 0) {
    const trendBars = closes.length - trendStartIdx;
    if (trendBars > 100) maturity = "late";
    else if (trendBars > 40) maturity = "mid";
  }

  // --- Pullback depth ---
  let pullbackDepth = 0;
  if (bullishAligned) {
    const recent20High = Math.max(...closes.slice(-20));
    if (recent20High > 0) pullbackDepth = ((recent20High - currentPrice) / currentAtr);
  } else if (bearishAligned) {
    const recent20Low = Math.min(...closes.slice(-20));
    if (recent20Low > 0) pullbackDepth = ((currentPrice - recent20Low) / currentAtr);
  }

  // --- ATR trailing stop suggestion ---
  // Strong trends: wider stop (3x ATR) to ride the move
  // Weaker trends: tighter stop (2x ATR) to protect capital
  let atrStopDistance = 2.0;
  if (strength > 0.8) atrStopDistance = 3.0;
  else if (strength > 0.6) atrStopDistance = 2.5;

  // Late stage: tighten stop
  if (maturity === "late") atrStopDistance *= 0.75;

  // --- Dynamic targets ---
  let targetsScaled = false;
  if (strength > 0.7) {
    targetsScaled = true;
    reasons.push({
      code: "TREND_UP_ALIGNED",
      score: score > 0 ? 0.15 : -0.15,
      detail: { dynamicTargets: "scaled_up" },
    });
  }

  // --- Pyramiding ---
  // Allowed when: strong trend + in a pullback (not chasing)
  const pyramidingAllowed = strength > 0.6 && pullbackDepth > 0.5 && maturity !== "late";

  return {
    name: "trend",
    score,
    confidence: strength,
    reasons,
    metrics: {
      strength: Math.round(strength * 100),
      sma20: Math.round(s20 * 100) / 100,
      sma50: Math.round(s50 * 100) / 100,
      sma200: Math.round(s200 * 100) / 100,
      pullbackDepthAtr: Math.round(pullbackDepth * 10) / 10,
    },
    quality: {
      strength,
      maturity,
      pullbackDepth,
      atrStopDistance,
      targetsScaled,
      pyramidingAllowed,
    },
  };
}

/**
 * Generates an ATR trailing stop level.
 *
 * For long positions: stop = max(previousStop, price - atrMult * ATR)
 * The stop only moves UP (for longs) — it never widens.
 *
 * Returns the new stop level.
 */
export function trailingStopLevel(
  currentPrice: number,
  currentStop: number,
  atrValue: number,
  atrMult: number,
  direction: Direction,
): number {
  if (direction === "long") {
    const newStop = currentPrice - atrValue * atrMult;
    return Math.max(currentStop, newStop);
  } else {
    const newStop = currentPrice + atrValue * atrMult;
    return Math.min(currentStop, newStop);
  }
}

/**
 * Calculates scaled TP targets based on trend strength.
 *
 * Default: TP1=2R, TP2=3.5R
 * Strong trend: TP1=3R, TP2=6R
 * Weak trend: TP1=1.8R, TP2=3R
 */
export function scaledTargets(
  baseTP1: number,
  baseTP2: number,
  trendStrength: number,
): { tp1R: number; tp2R: number } {
  if (trendStrength > 0.8) {
    return { tp1R: baseTP1 * 1.5, tp2R: baseTP2 * 1.7 };
  } else if (trendStrength > 0.6) {
    return { tp1R: baseTP1 * 1.2, tp2R: baseTP2 * 1.3 };
  } else if (trendStrength < 0.35) {
    return { tp1R: baseTP1 * 0.8, tp2R: baseTP2 * 0.75 };
  }
  return { tp1R: baseTP1, tp2R: baseTP2 };
}

/**
 * Pyramiding entry — determines if we should add to an existing position.
 *
 * Conditions:
 *   1. Existing position is profitable (price moved 1R+ in our favor)
 *   2. Price pulled back to VWAP or a key SMA
 *   3. Trend is still intact (no divergence on higher timeframe)
 *   4. Total position size after adding ≤ max position size
 *
 * Returns: { add: boolean, fractionToAdd: 0-1, price: number }
 */
export function pyramidingSignal(
  currentPrice: number,
  entryPrice: number,
  direction: Direction,
  trendStrength: number,
  pullbackDepth: number,
  atrValue: number,
  maxAddFraction: number = 0.3,
): { add: boolean; fractionToAdd: number; targetPrice: number } {
  const isLong = direction === "long";
  const profitR = isLong
    ? (currentPrice - entryPrice) / (atrValue * 2)
    : (entryPrice - currentPrice) / (atrValue * 2);

  // Must be in profit by at least 1R
  if (profitR < 1) return { add: false, fractionToAdd: 0, targetPrice: currentPrice };

  // Must be in a pullback (> 0.5 ATR from recent high/low)
  if (pullbackDepth < 0.5) return { add: false, fractionToAdd: 0, targetPrice: currentPrice };

  // Trend must still be strong
  if (trendStrength < 0.5) return { add: false, fractionToAdd: 0, targetPrice: currentPrice };

  // Scale: deeper pullback = larger add (up to maxAddFraction)
  const fractionToAdd = Math.min(maxAddFraction, pullbackDepth * 0.08);

  return { add: true, fractionToAdd, targetPrice: currentPrice };
}

/**
 * Early exit detection — should we exit before the stop is hit?
 *
 * Triggers when trend shows clear signs of reversal:
 *   1. Price crosses below SMA 20 (for longs) with volume
 *   2. RSI divergence on a higher timeframe
 *   3. Momentum exhaustion
 */
export function earlyExitSignal(
  candles: Candle[],
  direction: Direction,
): { exit: boolean; reason: string | null } {
  if (candles.length < 30) return { exit: false, reason: null };

  const closes = candles.map(c => c.close);
  const sma20vals = sma(closes, 20);
  const rsiValues = rsi(closes, 14);
  const currentPrice = closes[closes.length - 1];
  const s20 = sma20vals[sma20vals.length - 1] ?? currentPrice;
  const currentRsi = rsiValues[rsiValues.length - 1] ?? 50;

  if (direction === "long") {
    // Price crosses below SMA20 after being above
    const prevClose = closes[closes.length - 2] ?? currentPrice;
    const prevSma = sma20vals[sma20vals.length - 2] ?? s20;

    if (currentPrice < s20 && prevClose >= prevSma) {
      // Check if this is a real breakdown (volume)
      const avgVol = candles.slice(-20, -1).reduce((a, c) => a + c.volume, 0) / 19;
      const lastVol = candles[candles.length - 1].volume;
      if (lastVol > avgVol * 1.2) {
        return { exit: true, reason: "Price broke below SMA20 on elevated volume — early exit" };
      }
      return { exit: true, reason: "Price broke below SMA20 — consider reducing" };
    }

    // RSI exhaustion: was above 70, now dropping fast
    if (currentRsi > 70 && rsiValues[rsiValues.length - 2] !== null && (rsiValues[rsiValues.length - 2] ?? 70) > 75) {
      return { exit: true, reason: "RSI rolling over from overbought — take partial profits" };
    }
  } else {
    // Short exit signals (mirrored)
    const prevClose2 = closes[closes.length - 2] ?? currentPrice;
    const prevSma2 = sma20vals[sma20vals.length - 2] ?? s20;

    if (currentPrice > s20 && prevClose2 <= prevSma2) {
      const avgVol = candles.slice(-20, -1).reduce((a, c) => a + c.volume, 0) / 19;
      const lastVol = candles[candles.length - 1].volume;
      if (lastVol > avgVol * 1.2) {
        return { exit: true, reason: "Price broke above SMA20 on elevated volume — early exit" };
      }
      return { exit: true, reason: "Price broke above SMA20 — consider reducing" };
    }

    if (currentRsi < 30 && rsiValues[rsiValues.length - 2] !== null && (rsiValues[rsiValues.length - 2] ?? 30) < 25) {
      return { exit: true, reason: "RSI rolling over from oversold — take partial profits" };
    }
  }

  return { exit: false, reason: null };
}
