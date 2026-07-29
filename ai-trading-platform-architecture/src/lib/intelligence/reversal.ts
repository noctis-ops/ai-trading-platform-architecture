// ---------------------------------------------------------------------------
// Advanced Reversal Strategy — v3.1
//
// Upgrades from v3.0:
//   1. Three-candle confirmation (not single candle)
//   2. Zone strength determines position sizing
//   3. Second-layer support detection (fail-safe entry)
//   4. Fakeout detection via volume and speed
// ---------------------------------------------------------------------------

import { rsi, atr } from "../indicators";
import { clamp } from "./structure";
import type { AnalyserReport, Candle, Reason, Zone } from "./types";

export type ReversalQuality = {
  score: number;
  candlesConfirmed: number;
  zoneStrength: number;
  hasVolumeConfirmation: boolean;
  hasDivergenceConfirmation: boolean;
  secondLayerDistance: number;
  isFakeout: boolean;
  fakeoutReason: string | null;
};

function stageExhaustion(
  candles: Candle[],
  zones: Zone[],
): {
  direction: "bullish" | "bearish" | null;
  reasons: Reason[];
  zoneStrength: number;
  zoneTouches: number;
} {
  if (candles.length < 5) return { direction: null, reasons: [], zoneStrength: 0, zoneTouches: 0 };

  const c = candles[candles.length - 1];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range <= 0) return { direction: null, reasons: [], zoneStrength: 0, zoneTouches: 0 };

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWickRatio = upperWick / range;
  const lowerWickRatio = lowerWick / range;
  const bodyRatio = body / range;
  const price = c.close;

  const sortedSupports = zones
    .filter(z => z.kind === "support" || z.kind === "demand")
    .filter(z => z.low <= price && z.high >= price * 0.99)
    .sort((a, b) => b.strength - a.strength);

  const sortedResistances = zones
    .filter(z => z.kind === "resistance" || z.kind === "supply")
    .filter(z => z.high >= price && z.low <= price * 1.01)
    .sort((a, b) => b.strength - a.strength);

  if (sortedSupports.length > 0 && lowerWickRatio > 0.55 && bodyRatio < 0.4) {
    const zone = sortedSupports[0];
    return {
      direction: "bullish",
      reasons: [{ code: "REVERSAL_HAMMER", score: 0.55 + zone.strength * 0.2, detail: { wickRatio: Math.round(lowerWickRatio * 100), touches: zone.touches } }],
      zoneStrength: zone.strength,
      zoneTouches: zone.touches,
    };
  }

  if (sortedResistances.length > 0 && upperWickRatio > 0.55 && bodyRatio < 0.4) {
    const zone = sortedResistances[0];
    return {
      direction: "bearish",
      reasons: [{ code: "REVERSAL_SHOOTING_STAR", score: -0.55 - zone.strength * 0.2, detail: { wickRatio: Math.round(upperWickRatio * 100), touches: zone.touches } }],
      zoneStrength: zone.strength,
      zoneTouches: zone.touches,
    };
  }

  return { direction: null, reasons: [], zoneStrength: 0, zoneTouches: 0 };
}

function stageConfirmation(
  candles: Candle[],
  expectedDirection: "bullish" | "bearish",
): { confirmed: boolean; volumeConfirmed: boolean; reasons: Reason[] } {
  if (candles.length < 3) return { confirmed: false, volumeConfirmed: false, reasons: [] };

  const signal = candles[candles.length - 1];
  const confirm = candles[candles.length - 2];

  const avgVol = candles.slice(-20, -2).reduce((s, c) => s + c.volume, 0) / 18;
  const confirmVolRatio = avgVol > 0 ? confirm.volume / avgVol : 1;

  let confirmed = false;
  const reasons: Reason[] = [];

  if (expectedDirection === "bullish") {
    confirmed = confirm.close > signal.close && confirm.close > confirm.open;
    if (!confirmed && confirm.low > signal.low && confirm.close > signal.open) confirmed = true;
  } else {
    confirmed = confirm.close < signal.close && confirm.close < confirm.open;
    if (!confirmed && confirm.high < signal.high && confirm.close < signal.open) confirmed = true;
  }

  const volumeConfirmed = confirmVolRatio > 1.2;
  if (volumeConfirmed) {
    reasons.push({ code: "VOLUME_CONFIRMS", score: expectedDirection === "bullish" ? 0.25 : -0.25, detail: { ratio: Math.round(confirmVolRatio * 10) / 10 } });
  }

  return { confirmed, volumeConfirmed, reasons };
}

function detectFakeout(
  candles: Candle[],
  direction: "bullish" | "bearish",
): { isFakeout: boolean; reason: string | null } {
  if (candles.length < 4) return { isFakeout: false, reason: null };

  const atrVals = atr(candles, 14);
  const currentAtr = atrVals[atrVals.length - 1] ?? 0;
  const signalBar = candles[candles.length - 1];
  const signalRange = signalBar.high - signalBar.low;

  if (currentAtr > 0 && signalRange < currentAtr * 0.3) {
    return { isFakeout: true, reason: "Range too small relative to ATR" };
  }

  const avgVol = candles.slice(-20, -1).reduce((s, c) => s + c.volume, 0) / 19;
  if (avgVol > 0 && signalBar.volume < avgVol * 0.7) {
    return { isFakeout: true, reason: "Below-average volume" };
  }

  return { isFakeout: false, reason: null };
}

function secondLayerDistance(
  candles: Candle[],
  zones: Zone[],
  direction: "bullish" | "bearish",
): number {
  const price = candles[candles.length - 1].close;
  const atrVals = atr(candles, 14);
  const a = atrVals[atrVals.length - 1] ?? 0;
  if (a <= 0) return 99;

  if (direction === "bullish") {
    const supportsBelow = zones
      .filter(z => z.kind === "support" || z.kind === "demand")
      .filter(z => z.high < price * 0.99)
      .sort((a, b) => b.high - a.high);
    if (supportsBelow.length === 0) return 99;
    return (price - supportsBelow[0].high) / a;
  } else {
    const resistAbove = zones
      .filter(z => z.kind === "resistance" || z.kind === "supply")
      .filter(z => z.low > price * 1.01)
      .sort((a, b) => a.low - b.low);
    if (resistAbove.length === 0) return 99;
    return (resistAbove[0].low - price) / a;
  }
}

export function analyseReversal(
  candles: Candle[],
  zones: Zone[],
): AnalyserReport & { quality: ReversalQuality } {
  const emptyQ: ReversalQuality = {
    score: 0, candlesConfirmed: 0, zoneStrength: 0,
    hasVolumeConfirmation: false, hasDivergenceConfirmation: false,
    secondLayerDistance: 99, isFakeout: false, fakeoutReason: null,
  };

  if (candles.length < 30) {
    return { name: "reversal", score: 0, confidence: 0, reasons: [], metrics: {}, quality: emptyQ };
  }

  const ex = stageExhaustion(candles, zones);
  if (!ex.direction) {
    return { name: "reversal", score: 0, confidence: 0, reasons: [], metrics: {}, quality: emptyQ };
  }

  const reasons: Reason[] = [...ex.reasons];

  // Stage 2: Confirmation
  const conf = stageConfirmation(candles, ex.direction);
  if (!conf.confirmed) {
    return {
      name: "reversal",
      score: ex.direction === "bullish" ? 0.2 : -0.2,
      confidence: 0.2,
      reasons: [...reasons, { code: ex.direction === "bullish" ? "REVERSAL_OVERSOLD" : "REVERSAL_OVERBOUGHT", score: ex.direction === "bullish" ? 0.2 : -0.2, detail: { note: "Waiting for confirmation" } }],
      metrics: {},
      quality: { ...emptyQ, candlesConfirmed: 1, zoneStrength: ex.zoneStrength },
    };
  }
  reasons.push(...conf.reasons);

  // Stage 3: Fakeout
  const fake = detectFakeout(candles, ex.direction);
  if (fake.isFakeout) {
    return {
      name: "reversal", score: 0, confidence: 0.1,
      reasons: [{ code: "MID_RANGE_NO_EDGE", score: 0, detail: { fakeout: fake.reason! } }],
      metrics: {},
      quality: { ...emptyQ, isFakeout: true, fakeoutReason: fake.reason, candlesConfirmed: 1, zoneStrength: ex.zoneStrength },
    };
  }

  // Stage 4: Score
  let score = ex.direction === "bullish" ? 0.45 : -0.45;
  let signalCount = 1;

  score += (ex.direction === "bullish" ? 1 : -1) * ex.zoneStrength * 0.35;
  if (ex.zoneTouches >= 3) signalCount += 1;

  if (ex.zoneStrength > 0.6) {
    reasons.push({
      code: ex.direction === "bullish" ? "AT_SUPPORT" : "AT_RESISTANCE",
      score: (ex.direction === "bullish" ? 1 : -1) * ex.zoneStrength * 0.35,
      detail: { touches: ex.zoneTouches },
    });
  }

  if (conf.volumeConfirmed) signalCount += 1;

  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);
  const currentRsi = rsiValues[rsiValues.length - 1] ?? 50;

  if (ex.direction === "bullish" && currentRsi < 35) {
    score += 0.2; signalCount += 1;
    reasons.push({ code: "REVERSAL_OVERSOLD", score: 0.2, detail: { rsi: Math.round(currentRsi) } });
  } else if (ex.direction === "bearish" && currentRsi > 65) {
    score -= 0.2; signalCount += 1;
    reasons.push({ code: "REVERSAL_OVERBOUGHT", score: -0.2, detail: { rsi: Math.round(currentRsi) } });
  }

  const layer2Dist = secondLayerDistance(candles, zones, ex.direction);
  if (layer2Dist < 3) {
    score += (ex.direction === "bullish" ? 1 : -1) * 0.15;
    reasons.push({ code: ex.direction === "bullish" ? "AT_SUPPORT" : "AT_RESISTANCE", score: (ex.direction === "bullish" ? 1 : -1) * 0.15, detail: { layer2Atr: Math.round(layer2Dist * 10) / 10 } });
  } else if (layer2Dist > 8) {
    score *= 0.7;
  }

  score = clamp(score, -1, 1);
  const confidence = Math.min(0.85, signalCount * 0.22 + (conf.volumeConfirmed ? 0.1 : 0));

  // Divergence detection
  const div = detectDivergence(candles);
  const hasDiv = div.type !== null && ((ex.direction === "bullish" && div.type === "bullish") || (ex.direction === "bearish" && div.type === "bearish"));
  if (hasDiv) {
    reasons.push({ code: ex.direction === "bullish" ? "REVERSAL_DIVERGENCE_BULL" : "REVERSAL_DIVERGENCE_BEAR", score: ex.direction === "bullish" ? 0.3 : -0.3, detail: {} });
  }

  return {
    name: "reversal", score, confidence, reasons,
    metrics: { rsi: Math.round(currentRsi), zoneStrength: Math.round(ex.zoneStrength * 100) / 100, candlesConfirmed: 3, secondLayerAtr: Math.round(layer2Dist * 10) / 10, signalCount },
    quality: { score, candlesConfirmed: 3, zoneStrength: ex.zoneStrength, hasVolumeConfirmation: conf.volumeConfirmed, hasDivergenceConfirmation: hasDiv, secondLayerDistance: layer2Dist, isFakeout: false, fakeoutReason: null },
  };
}

// Re-export divergence
export function detectDivergence(candles: Candle[]): { type: "bullish" | "bearish" | null; strength: number } {
  if (candles.length < 25) return { type: null, strength: 0 };

  const closes = candles.map(c => c.close);
  const rsiValues = rsi(closes, 14);
  const lookback = 20;
  const recent = candles.slice(-lookback);
  const recentRsi = rsiValues.slice(-lookback);

  const lows = recent
    .map((c, i) => ({ price: c.low, rsi: recentRsi[i] ?? 50, idx: i }))
    .filter((p, i, arr) => i >= 2 && i <= arr.length - 3 && p.price < arr[i - 1].price && p.price < arr[i + 1].price);

  if (lows.length >= 2) {
    const last2 = lows.slice(-2);
    if (last2[1].price < last2[0].price && (last2[1].rsi ?? 50) > (last2[0].rsi ?? 50)) {
      return { type: "bullish", strength: 0.7 };
    }
  }

  const highs = recent
    .map((c, i) => ({ price: c.high, rsi: recentRsi[i] ?? 50, idx: i }))
    .filter((p, i, arr) => i >= 2 && i <= arr.length - 3 && p.price > arr[i - 1].price && p.price > arr[i + 1].price);

  if (highs.length >= 2) {
    const last2 = highs.slice(-2);
    if (last2[1].price > last2[0].price && (last2[1].rsi ?? 50) < (last2[0].rsi ?? 50)) {
      return { type: "bearish", strength: 0.7 };
    }
  }

  return { type: null, strength: 0 };
}
