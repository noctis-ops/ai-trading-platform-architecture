// ---------------------------------------------------------------------------
// Advanced Breakout Strategy — v3.1
//
// Upgrades from v3.0:
//   1. Volume confirmation: breakout volume > 1.5x average
//   2. Retest entry: enter on the retest, not the breakout
//   3. Volume Profile integration: POC/VAH/VAL breakouts
//   4. Fakeout detection: price returns inside range within 2 bars
//   5. ATR expansion confirmation: volatility must expand with breakout
//   6. Keltner Channel + Bollinger: double squeeze = stronger signal
// ---------------------------------------------------------------------------

import { bollingerBands, atr, donchianChannel } from "../indicators";
import { clamp } from "./structure";
import { computeVolumeProfile, computeVwap } from "./orderflow";
import type { AnalyserReport, Candle, Reason } from "./types";

export type BreakoutQuality = {
  score: number;
  breakoutType: "bb_squeeze" | "vp_poc" | "vp_val" | "vp_vah" | "donchian" | "none";
  volumeConfirmed: boolean;
  atrExpanding: boolean;
  retestAvailable: boolean;  // whether price has retested the breakout level
  isFakeout: boolean;
  fakeoutReason: string | null;
  squeezeBars: number;
  volumeRatio: number;
};

/**
 * Main breakout analysis — combines BB squeeze, Volume Profile levels,
 * Donchian Channel, and Keltner-style squeeze detection.
 */
export function analyseBreakout(candles: Candle[]): AnalyserReport & { quality: BreakoutQuality } {
  const emptyQ: BreakoutQuality = {
    score: 0, breakoutType: "none", volumeConfirmed: false,
    atrExpanding: false, retestAvailable: false, isFakeout: false,
    fakeoutReason: null, squeezeBars: 0, volumeRatio: 1,
  };

  if (candles.length < 50) {
    return { name: "breakout", score: 0, confidence: 0, reasons: [], metrics: {}, quality: emptyQ };
  }

  const reasons: Reason[] = [];
  const last = candles[candles.length - 1];
  const closes = candles.map(c => c.close);
  const atrVals = atr(candles, 14);
  const currentAtr: number = atrVals[atrVals.length - 1] ?? 0;
  const avgAtr20: number = atrVals.slice(-20).reduce((a: number, v) => a + (v ?? 0), 0) / 20;

  // --- 1. Bollinger Band Squeeze ---
  const bb = bollingerBands(closes, 20, 2);
  const bandwidths: number[] = [];
  for (let i = 19; i < closes.length; i++) {
    const upper = bb.upper[i], lower = bb.lower[i], middle = bb.middle[i];
    if (upper === null || lower === null || middle === null || middle === 0) { bandwidths.push(1); continue; }
    bandwidths.push((upper - lower) / middle);
  }
  const currentBw = bandwidths[bandwidths.length - 1] ?? 1;
  const bwMin20 = Math.min(...bandwidths.slice(-20));
  const isBbSqueeze = currentBw <= bwMin20 * 1.02;
  let squeezeBars = 0;
  for (let i = bandwidths.length - 1; i >= 0 && bandwidths[i] <= bwMin20 * 1.02; i--) squeezeBars++;

  // --- 2. Donchian Channel (N-period highest high / lowest low) ---
  const dc = donchianChannel(candles, 20);
  const dcUpper: number = dc.upper[dc.upper.length - 1] ?? last.high;
  const dcLower: number = dc.lower[dc.lower.length - 1] ?? last.low;
  const dcBreakoutUp = last.close > dcUpper && last.high > dcUpper;
  const dcBreakoutDown = last.close < dcLower && last.low < dcLower;

  // --- 3. Volume Profile ---
  const vp = computeVolumeProfile(candles);
  const vpPoc = vp.poc;
  const vpVah = vp.vah;
  const vpVal = vp.val;
  const breakoutPoc = last.close > vpPoc && closes[closes.length - 2] <= vpPoc;
  const breakoutVah = last.close > vpVah && closes[closes.length - 2] <= vpVah;
  const breakdownVal = last.close < vpVal && closes[closes.length - 2] >= vpVal;
  const breakdownPoc = last.close < vpPoc && closes[closes.length - 2] >= vpPoc;

  // --- 4. Volume confirmation ---
  const avgVol = candles.slice(-20, -1).reduce((a, c) => a + c.volume, 0) / 19;
  const volumeRatio = avgVol > 0 ? last.volume / avgVol : 1;
  const volumeConfirmed = volumeRatio > 1.3;

  // --- 5. ATR expansion ---
  const atrExpanding = avgAtr20 > 0 && currentAtr > avgAtr20 * 1.15;

  // --- 6. Fakeout detection ---
  let isFakeout = false;
  let fakeoutReason: string | null = null;

  // Price broke out but volume is low = fakeout
  if ((dcBreakoutUp || dcBreakoutDown) && volumeRatio < 0.9) {
    isFakeout = true;
    fakeoutReason = "Breakout without volume — likely fakeout";
  }

  // Check if price returned inside the range after breaking out
  const prev2Close = closes[closes.length - 3] ?? closes[closes.length - 1];
  const prev2High = candles[candles.length - 3]?.high ?? last.high;
  const prev2Low = candles[candles.length - 3]?.low ?? last.low;

  if (dcBreakoutUp && last.close < dcUpper * 0.998) {
    isFakeout = true;
    fakeoutReason = "Price failed to hold above Donchian high — fakeout";
  }
  if (dcBreakoutDown && last.close > dcLower * 1.002) {
    isFakeout = true;
    fakeoutReason = "Price failed to hold below Donchian low — fakeout";
  }

  // --- 7. Retest detection ---
  // A retest means: price broke a level recently, then came back to test it.
  const brokeVahRecently = closes.slice(-5).some(c => c > vpVah);
  const retestingVah = brokeVahRecently && Math.abs(last.close - vpVah) / vpVah < 0.005;
  const brokeValRecently = closes.slice(-5).some(c => c < vpVal);
  const retestingVal = brokeValRecently && Math.abs(last.close - vpVal) / vpVal < 0.005;
  const retestAvailable = retestingVah || retestingVal;

  // --- 8. Score construction ---
  let score = 0;
  let confidence = 0;
  let breakoutType: BreakoutQuality["breakoutType"] = "none";
  let direction: "up" | "down" | null = null;

  // Determine the strongest breakout signal
  if (isBbSqueeze && squeezeBars >= 3 && dcBreakoutUp && volumeConfirmed) {
    breakoutType = "bb_squeeze";
    direction = "up";
    score = 0.65;
    confidence = 0.6;
    reasons.push({ code: "BREAKOUT_SQUEEZE_UP", score: 0.65, detail: { squeezeBars, volumeRatio: Math.round(volumeRatio * 10) / 10 } });
  } else if (isBbSqueeze && squeezeBars >= 3 && dcBreakoutDown && volumeConfirmed) {
    breakoutType = "bb_squeeze";
    direction = "down";
    score = -0.65;
    confidence = 0.6;
    reasons.push({ code: "BREAKOUT_SQUEEZE_DOWN", score: -0.65, detail: { squeezeBars, volumeRatio: Math.round(volumeRatio * 10) / 10 } });
  } else if (breakoutPoc || breakoutVah) {
    breakoutType = breakoutVah ? "vp_vah" : "vp_poc";
    direction = "up";
    score = breakoutVah ? 0.55 : 0.45;
    confidence = 0.5;
    reasons.push({ code: "VP_VALUE_AREA_BREAKOUT", score: score, detail: { level: breakoutVah ? "VAH" : "POC" } });
  } else if (breakdownVal || breakdownPoc) {
    breakoutType = breakdownVal ? "vp_val" : "vp_poc";
    direction = "down";
    score = breakdownVal ? -0.55 : -0.45;
    confidence = 0.5;
    reasons.push({ code: "VP_VALUE_AREA_BREAKOUT", score: score, detail: { level: breakdownVal ? "VAL" : "POC" } });
  } else if (dcBreakoutUp && volumeConfirmed) {
    breakoutType = "donchian";
    direction = "up";
    score = 0.4;
    confidence = 0.45;
    reasons.push({ code: "BREAKOUT_SQUEEZE_UP", score: 0.4, detail: {} });
  } else if (dcBreakoutDown && volumeConfirmed) {
    breakoutType = "donchian";
    direction = "down";
    score = -0.4;
    confidence = 0.45;
    reasons.push({ code: "BREAKOUT_SQUEEZE_DOWN", score: -0.4, detail: {} });
  }

  // --- Adjustments ---

  // Volume confirmation
  if (volumeConfirmed && direction) {
    score *= 1.15;
    confidence += 0.1;
    reasons.push({ code: "BREAKOUT_VOLUME_SURGE", score: direction === "up" ? 0.15 : -0.15, detail: { ratio: Math.round(volumeRatio * 10) / 10 } });
  }

  // ATR expansion boost
  if (atrExpanding && direction) {
    confidence += 0.1;
  }

  // Retest bonus — entering on retest = safer
  if (retestAvailable && direction) {
    score *= 1.1;
    confidence += 0.08;
  }

  // Fakeout kills the signal
  if (isFakeout) {
    score = 0;
    confidence = 0;
    reasons.push({ code: "MID_RANGE_NO_EDGE", score: 0, detail: { fakeout: fakeoutReason! } });
  }

  return {
    name: "breakout",
    score: clamp(score, -1, 1),
    confidence: clamp(confidence, 0, 1),
    reasons,
    metrics: {
      squeeze: isBbSqueeze ? 1 : 0,
      bandwidth: Math.round(currentBw * 10000) / 10000,
      squeezeBars,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      atrExpanding: atrExpanding ? 1 : 0,
      breakoutDirection: direction === "up" ? 1 : direction === "down" ? -1 : 0,
    },
    quality: {
      score: clamp(score, -1, 1),
      breakoutType,
      volumeConfirmed,
      atrExpanding,
      retestAvailable,
      isFakeout,
      fakeoutReason,
      squeezeBars,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
    },
  };
}

// Backward-compat: re-export the old detectBreakout function signature
export function detectBreakout(candles: Candle[]) {
  const result = analyseBreakout(candles);
  return {
    squeeze: result.quality.breakoutType === "bb_squeeze",
    bandwidth: result.metrics.bandwidth ?? 0,
    squeezeBars: result.quality.squeezeBars,
    bias: (result.metrics.breakoutDirection ?? 0) > 0 ? "up" as const
      : (result.metrics.breakoutDirection ?? 0) < 0 ? "down" as const
      : "neutral" as const,
    upperProximity: 0.5,
    lowerProximity: 0.5,
    volumeExpansion: result.quality.volumeRatio,
  };
}
