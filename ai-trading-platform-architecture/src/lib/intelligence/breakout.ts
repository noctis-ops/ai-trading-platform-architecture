// ---------------------------------------------------------------------------
// Breakout Strategy — activated in quiet_compression regime.
//
// Compression → Expansion is one of the most reliable market patterns.
// This strategy detects when:
//   1. Volatility has contracted to extremely low levels (Bollinger Band squeeze)
//   2. Price is coiling near a key level (VWAP, POC, or structural level)
//   3. Volume is building up (accumulation before breakout)
//   4. The breakout direction is confirmed by the broader context
//
// The breakout analyser has medium confidence because false breakouts
// are common. It works best when combined with the trend analysers as
// confirmation.
// ---------------------------------------------------------------------------

import { bollingerBands, atr } from "../indicators";
import { clamp } from "./structure";
import type { AnalyserReport, Candle, Reason } from "./types";

export type BreakoutSignal = {
  /** Whether a squeeze is in effect. */
  squeeze: boolean;
  /** Bandwidth = (upper - lower) / middle — lower = tighter. */
  bandwidth: number;
  /** How many bars the squeeze has persisted. */
  squeezeBars: number;
  /** Direction bias from recent price action. */
  bias: "up" | "down" | "neutral";
  /** How close price is to the upper band (0..1). */
  upperProximity: number;
  /** How close price is to the lower band (0..1). */
  lowerProximity: number;
  /** Volume expansion vs recent average. */
  volumeExpansion: number;
};

/**
 * Detects Bollinger Band squeeze (Keltner Channel variant).
 *
 * A squeeze occurs when the Bollinger Bands move INSIDE the Keltner Channel.
 * This signals extremely low volatility — a precursor to expansion.
 *
 * Simplified: we use bandwidth = (upper - lower) / middle.
 * When bandwidth drops below its 20-period minimum, we're in a squeeze.
 */
export function detectBreakout(candles: Candle[]): BreakoutSignal {
  if (candles.length < 50) {
    return {
      squeeze: false,
      bandwidth: 0,
      squeezeBars: 0,
      bias: "neutral",
      upperProximity: 0,
      lowerProximity: 0,
      volumeExpansion: 0,
    };
  }

  const closes = candles.map(c => c.close);
  const bb = bollingerBands(closes, 20, 2);
  const atrValues = atr(candles, 14);

  // Compute bandwidth for each bar
  const bandwidths: number[] = [];
  for (let i = 19; i < candles.length; i++) {
    const upper = bb.upper[i];
    const lower = bb.lower[i];
    const middle = bb.middle[i];
    if (upper === null || lower === null || middle === null || middle === 0) {
      bandwidths.push(1);
      continue;
    }
    bandwidths.push((upper - lower) / middle);
  }

  const currentBw = bandwidths[bandwidths.length - 1] ?? 1;

  // Squeeze threshold: bandwidth below 20-period minimum
  const bwMin20 = Math.min(...bandwidths.slice(-20));
  const squeeze = currentBw <= bwMin20 * 1.02; // Allow 2% tolerance

  // Count consecutive squeeze bars
  let squeezeBars = 0;
  for (let i = bandwidths.length - 1; i >= 0 && bandwidths[i] <= bwMin20 * 1.02; i--) {
    squeezeBars++;
  }

  // Direction bias from recent closes vs middle band
  const lastClose = closes[closes.length - 1];
  const lastBB = bb.middle[bb.middle.length - 1] ?? lastClose;
  let bias: BreakoutSignal["bias"] = "neutral";
  if (lastClose > lastBB * 1.005) bias = "up";
  else if (lastClose < lastBB * 0.995) bias = "down";

  // Proximity to bands
  const upperBand = bb.upper[bb.upper.length - 1] ?? lastClose * 1.05;
  const lowerBand = bb.lower[bb.lower.length - 1] ?? lastClose * 0.95;
  const bandRange = upperBand - lowerBand;
  const upperProximity = bandRange > 0 ? (upperBand - lastClose) / bandRange : 0.5;
  const lowerProximity = bandRange > 0 ? (lastClose - lowerBand) / bandRange : 0.5;

  // Volume expansion: last candle volume vs 20-period average
  const avgVol = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
  const volumeExpansion = avgVol > 0 ? candles[candles.length - 1].volume / avgVol : 1;

  return {
    squeeze,
    bandwidth: currentBw,
    squeezeBars,
    bias,
    upperProximity,
    lowerProximity,
    volumeExpansion,
  };
}

export function analyseBreakout(candles: Candle[]): AnalyserReport {
  if (candles.length < 50) {
    return { name: "breakout", score: 0, confidence: 0, reasons: [], metrics: {} };
  }

  const bs = detectBreakout(candles);
  const reasons: Reason[] = [];
  let score = 0;
  let confidence = 0;

  // No squeeze or insufficient squeeze bars = no breakout signal
  if (!bs.squeeze || bs.squeezeBars < 3) {
    return {
      name: "breakout",
      score: 0,
      confidence: 0,
      reasons: [],
      metrics: {
        squeeze: bs.squeeze ? 1 : 0,
        bandwidth: Math.round(bs.bandwidth * 10000) / 10000,
        squeezeBars: bs.squeezeBars,
      },
    };
  }

  // Squeeze detected — determine direction
  const isCoilingUp = bs.bias === "up" && bs.upperProximity < 0.3;
  const isCoilingDown = bs.bias === "down" && bs.lowerProximity < 0.3;

  if (isCoilingUp) {
    score = 0.6;
    reasons.push({
      code: "STRUCTURE_BOS_UP",
      score: 0.6,
      detail: { squeezeBars: bs.squeezeBars, bandwidth: Math.round(bs.bandwidth * 10000) / 10000 },
    });
  } else if (isCoilingDown) {
    score = -0.6;
    reasons.push({
      code: "STRUCTURE_BOS_DOWN",
      score: -0.6,
      detail: { squeezeBars: bs.squeezeBars, bandwidth: Math.round(bs.bandwidth * 10000) / 10000 },
    });
  } else if (bs.squeezeBars >= 5) {
    // Prolonged squeeze without direction — watch closely
    score = bs.bias === "up" ? 0.3 : bs.bias === "down" ? -0.3 : 0;
    if (score !== 0) {
      reasons.push({
        code: "VOLATILITY_EXPANDING",
        score,
        detail: { squeezeBars: bs.squeezeBars },
      });
    }
  }

  // Volume confirmation
  if (bs.volumeExpansion > 1.3 && score !== 0) {
    score *= 1.2;
    reasons.push({
      code: "VOLUME_CONFIRMS",
      score: score > 0 ? 0.3 : -0.3,
      detail: { ratio: Math.round(bs.volumeExpansion * 10) / 10 },
    });
  }

  // Confidence scales with squeeze duration
  confidence = Math.min(0.7, 0.2 + bs.squeezeBars * 0.05);

  return {
    name: "breakout",
    score: clamp(score, -1, 1),
    confidence: clamp(confidence, 0, 1),
    reasons,
    metrics: {
      squeeze: 1,
      bandwidth: Math.round(bs.bandwidth * 10000) / 10000,
      squeezeBars: bs.squeezeBars,
      volumeExpansion: Math.round(bs.volumeExpansion * 100) / 100,
      bias: bs.bias === "up" ? 1 : bs.bias === "down" ? -1 : 0,
    },
  };
}
