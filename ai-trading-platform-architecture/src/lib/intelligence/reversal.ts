// ---------------------------------------------------------------------------
// Reversal / Mean-Reversion Strategy
//
// Activated when regime === "ranging" or "volatile_expansion".
//
// This is the counter-trend component. It looks for:
//   1. Price at extremes of the established range (zone proximity)
//   2. Exhaustion signals: RSI divergence, long wicks, volume climax
//   3. Liquidity sweeps: taking out the range low/high then reversing
//
// The reversal analyser has LOWER confidence than trend analysers because
// mean-reversion has a lower base rate, but it turns the bot from "silent
// 70% of the time" into "trading every regime".
// ---------------------------------------------------------------------------

import { rsi, atr } from "../indicators";
import { clamp } from "./structure";
import type { AnalyserReport, Candle, Reason, Zone } from "./types";

/**
 * Detects exhaustion candles at range boundaries.
 *
 * A reversal candle has:
 *   - A long wick in the direction of the reversal (bullish: long lower wick)
 *   - Close near the opposite end of the candle
 *   - Preferably higher volume than the average
 */
export function analyseReversal(
  candles: Candle[],
  zones: Zone[],
): AnalyserReport {
  if (candles.length < 30) {
    return {
      name: "reversal",
      score: 0,
      confidence: 0,
      reasons: [],
      metrics: {},
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(last.close - last.open);
  const totalRange = last.high - last.low;

  if (totalRange <= 0) {
    return { name: "reversal", score: 0, confidence: 0, reasons: [], metrics: {} };
  }

  const reasons: Reason[] = [];
  let score = 0;
  let confidence = 0;

  // --- 1. Wick analysis ---
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWickRatio = totalRange > 0 ? upperWick / totalRange : 0;
  const lowerWickRatio = totalRange > 0 ? lowerWick / totalRange : 0;

  // --- 2. Volume analysis ---
  const avgVolume = candles.slice(-20, -1).reduce((s, c) => s + c.volume, 0) / 19;
  const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 1;

  // --- 3. RSI extremes ---
  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);
  const currentRsi = rsiValues[rsiValues.length - 1] ?? 50;

  // --- 4. Zone proximity ---
  const price = last.close;
  const nearestSupport = zones
    .filter(z => z.kind === "support" || z.kind === "demand")
    .filter(z => z.low <= price && z.high >= price * 0.995)
    .sort((a, b) => b.strength - a.strength)[0];

  const nearestResistance = zones
    .filter(z => z.kind === "resistance" || z.kind === "supply")
    .filter(z => z.high >= price && z.low <= price * 1.005)
    .sort((a, b) => b.strength - a.strength)[0];

  // --- Bullish reversal check ---
  let bullishScore = 0;
  let bullishSignals = 0;

  // Long lower wick (hammer)
  if (lowerWickRatio > 0.6 && body / totalRange < 0.3) {
    bullishScore += 0.6;
    bullishSignals += 1;
    reasons.push({
      code: "PA_REJECTION_WICK_DOWN",
      score: 0.6,
      detail: { wickRatio: Math.round(lowerWickRatio * 100) },
    });
  }

  // Oversold RSI
  if (currentRsi < 30) {
    bullishScore += 0.4 * (1 - currentRsi / 30);
    bullishSignals += 1;
    reasons.push({
      code: "MOMENTUM_EXHAUSTED",
      score: 0.4,
      detail: { rsi: Math.round(currentRsi) },
    });
  }

  // At support zone
  if (nearestSupport) {
    bullishScore += 0.5 * nearestSupport.strength;
    bullishSignals += 1;
    reasons.push({
      code: "AT_SUPPORT",
      score: 0.5,
      detail: { touches: nearestSupport.touches },
    });
  }

  // Volume spike on reversal
  if (volumeRatio > 1.5 && last.close > last.open) {
    bullishScore += 0.3;
    bullishSignals += 1;
    reasons.push({
      code: "VOLUME_CONFIRMS",
      score: 0.3,
      detail: { ratio: Math.round(volumeRatio * 10) / 10 },
    });
  }

  // --- Bearish reversal check ---
  let bearishScore = 0;
  let bearishSignals = 0;

  // Long upper wick (shooting star)
  if (upperWickRatio > 0.6 && body / totalRange < 0.3) {
    bearishScore -= 0.6;
    bearishSignals += 1;
    reasons.push({
      code: "PA_REJECTION_WICK_UP",
      score: -0.6,
      detail: { wickRatio: Math.round(upperWickRatio * 100) },
    });
  }

  // Overbought RSI
  if (currentRsi > 70) {
    bearishScore -= 0.4 * ((currentRsi - 70) / 30);
    bearishSignals += 1;
    reasons.push({
      code: "MOMENTUM_EXHAUSTED",
      score: -0.4,
      detail: { rsi: Math.round(currentRsi) },
    });
  }

  // At resistance zone
  if (nearestResistance) {
    bearishScore -= 0.5 * nearestResistance.strength;
    bearishSignals += 1;
    reasons.push({
      code: "AT_RESISTANCE",
      score: -0.5,
      detail: { touches: nearestResistance.touches },
    });
  }

  // Volume spike on rejection
  if (volumeRatio > 1.5 && last.close < last.open) {
    bearishScore -= 0.3;
    bearishSignals += 1;
    reasons.push({
      code: "VOLUME_CONFIRMS",
      score: -0.3,
      detail: { ratio: Math.round(volumeRatio * 10) / 10 },
    });
  }

  // --- Determine dominant direction ---
  if (bullishScore > Math.abs(bearishScore)) {
    score = clamp(bullishScore, 0, 1);
    confidence = Math.min(0.8, bullishSignals / 4);
  } else if (Math.abs(bearishScore) > bullishScore) {
    score = clamp(bearishScore, -1, 0);
    confidence = Math.min(0.8, bearishSignals / 4);
  } else {
    score = 0;
    confidence = 0;
  }

  return {
    name: "reversal",
    score,
    confidence,
    reasons,
    metrics: {
      upperWickRatio: Math.round(upperWickRatio * 100),
      lowerWickRatio: Math.round(lowerWickRatio * 100),
      rsi: Math.round(currentRsi),
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      bullishScore: Math.round(bullishScore * 100) / 100,
      bearishScore: Math.round(bearishScore * 100) / 100,
    },
  };
}

/**
 * Detects momentum divergence: price making new lows but RSI making higher lows
 * (bullish divergence) or price making new highs but RSI making lower highs
 * (bearish divergence).
 */
export function detectDivergence(candles: Candle[]): {
  type: "bullish" | "bearish" | null;
  strength: number;
} {
  if (candles.length < 25) return { type: null, strength: 0 };

  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);

  // Look at last two swing lows/highs
  const lookback = 20;
  const recent = candles.slice(-lookback);
  const recentRsi = rsiValues.slice(-lookback);

  // Find two most recent swing lows (for bullish divergence)
  const lows = recent
    .map((c, i) => ({ price: c.low, rsi: recentRsi[i] ?? 50, idx: i }))
    .filter((p, i, arr) => {
      if (i < 2 || i > arr.length - 3) return false;
      return p.price < arr[i - 1].price && p.price < arr[i + 1].price;
    });

  // Bullish divergence: lower low in price, higher low in RSI
  if (lows.length >= 2) {
    const last2 = lows.slice(-2);
    const priceLower = last2[1].price < last2[0].price;
    const rsiHigher = (last2[1].rsi ?? 50) > (last2[0].rsi ?? 50);
    if (priceLower && rsiHigher) {
      return { type: "bullish", strength: 0.7 };
    }
  }

  // Find two most recent swing highs (for bearish divergence)
  const highs = recent
    .map((c, i) => ({ price: c.high, rsi: recentRsi[i] ?? 50, idx: i }))
    .filter((p, i, arr) => {
      if (i < 2 || i > arr.length - 3) return false;
      return p.price > arr[i - 1].price && p.price > arr[i + 1].price;
    });

  // Bearish divergence: higher high in price, lower high in RSI
  if (highs.length >= 2) {
    const last2 = highs.slice(-2);
    const priceHigher = last2[1].price > last2[0].price;
    const rsiLower = (last2[1].rsi ?? 50) < (last2[0].rsi ?? 50);
    if (priceHigher && rsiLower) {
      return { type: "bearish", strength: 0.7 };
    }
  }

  return { type: null, strength: 0 };
}
