// ---------------------------------------------------------------------------
// Dimension analysers.
//
// Each exported `analyseX(candles)` returns an AnalyserReport with a
// directional score in [-1, 1] and a self-assessed confidence in [0, 1].
// The confluence engine (decision.ts) is the only place these are combined,
// which keeps the weighting policy in exactly one auditable location.
// ---------------------------------------------------------------------------
import { atr, ema, macd, rsi, sma, stdDev } from "../indicators";
import { clamp, nearestZones, zoneProximity } from "./structure";
import type { AnalyserReport, Candle, Reason, Zone } from "./types";

const last = <T,>(arr: T[]): T => arr[arr.length - 1];

function lastDefined(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i] as number;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Trend — EMA stack + slope. Direction of the path of least resistance.
// ---------------------------------------------------------------------------
export function analyseTrend(candles: Candle[]): AnalyserReport {
  const closes = candles.map((c) => c.close);
  const fast = lastDefined(ema(closes, 21));
  const mid = lastDefined(ema(closes, 50));
  const slow = lastDefined(ema(closes, 200)) ?? lastDefined(sma(closes, Math.min(100, closes.length - 1)));
  const price = last(closes);
  const reasons: Reason[] = [];

  if (fast === null || mid === null || slow === null) {
    return {
      name: "trend",
      score: 0,
      confidence: 0.2,
      reasons: [{ code: "TREND_FLAT", score: 0 }],
      metrics: {},
    };
  }

  // Slope of the mid EMA over the last 10 bars, normalised by price.
  const emaSeries = ema(closes, 50).filter((v): v is number => v !== null);
  const slopePct =
    emaSeries.length > 10 ? ((last(emaSeries) - emaSeries[emaSeries.length - 11]) / price) * 100 : 0;

  const bullStack = price > fast && fast > mid && mid > slow;
  const bearStack = price < fast && fast < mid && mid < slow;

  let score = 0;
  if (bullStack) {
    score = 0.7 + clamp(slopePct / 2, -0.3, 0.3);
    reasons.push({ code: "TREND_UP_ALIGNED", score, detail: { slopePct: round(slopePct, 3) } });
  } else if (bearStack) {
    score = -0.7 + clamp(slopePct / 2, -0.3, 0.3);
    reasons.push({ code: "TREND_DOWN_ALIGNED", score, detail: { slopePct: round(slopePct, 3) } });
  } else {
    // Partial alignment: score from position relative to the stack only.
    const above = [price > fast, fast > mid, mid > slow].filter(Boolean).length;
    score = ((above - 1.5) / 1.5) * 0.4;
    reasons.push({ code: above === 1 || above === 2 ? "TREND_CONFLICT" : "TREND_FLAT", score });
  }

  const separation = Math.abs(fast - slow) / price;
  return {
    name: "trend",
    score: clamp(score, -1, 1),
    // A tightly compressed EMA stack is a low-information trend read.
    confidence: clamp(0.3 + separation * 40, 0.2, 0.95),
    reasons,
    metrics: { ema21: fast, ema50: mid, ema200: slow, slopePct: round(slopePct, 4), separation: round(separation, 5) },
  };
}

// ---------------------------------------------------------------------------
// Momentum — RSI + MACD histogram + divergence detection.
// ---------------------------------------------------------------------------
export function analyseMomentum(candles: Candle[]): AnalyserReport {
  const closes = candles.map((c) => c.close);
  const rsiSeries = rsi(closes, 14);
  const r = lastDefined(rsiSeries);
  const { histogram } = macd(closes);
  const h = lastDefined(histogram);
  const reasons: Reason[] = [];

  if (r === null || h === null) {
    return { name: "momentum", score: 0, confidence: 0.2, reasons: [], metrics: {} };
  }

  // RSI centred at 50 and scaled: 70 -> +0.5, 30 -> -0.5.
  let score = clamp((r - 50) / 40, -1, 1) * 0.6;
  const histNorm = clamp(h / (last(closes) * 0.004), -1, 1);
  score += histNorm * 0.4;

  if (score > 0.15) reasons.push({ code: "MOMENTUM_BULLISH", score, detail: { rsi: round(r, 1) } });
  else if (score < -0.15) reasons.push({ code: "MOMENTUM_BEARISH", score, detail: { rsi: round(r, 1) } });

  // Exhaustion: momentum so stretched that chasing it is a poor entry.
  if (r > 78 || r < 22) {
    reasons.push({ code: "MOMENTUM_EXHAUSTED", score: 0, detail: { rsi: round(r, 1) } });
    score *= 0.55;
  }

  // Divergence over the last 30 bars between price extremes and RSI extremes.
  const div = detectDivergence(candles, rsiSeries, 30);
  if (div === "bullish") {
    score += 0.35;
    reasons.push({ code: "MOMENTUM_DIVERGENCE_BULL", score: 0.35 });
  } else if (div === "bearish") {
    score -= 0.35;
    reasons.push({ code: "MOMENTUM_DIVERGENCE_BEAR", score: -0.35 });
  }

  return {
    name: "momentum",
    score: clamp(score, -1, 1),
    confidence: 0.7,
    reasons,
    metrics: { rsi: round(r, 2), macdHistogram: round(h, 6) },
  };
}

function detectDivergence(
  candles: Candle[],
  rsiSeries: (number | null)[],
  lookback: number,
): "bullish" | "bearish" | null {
  const n = candles.length;
  if (n < lookback + 5) return null;
  const startA = n - lookback;
  const mid = n - Math.floor(lookback / 2);

  const segA = candles.slice(startA, mid);
  const segB = candles.slice(mid);
  const rsiA = rsiSeries.slice(startA, mid).filter((v): v is number => v !== null);
  const rsiB = rsiSeries.slice(mid).filter((v): v is number => v !== null);
  if (rsiA.length === 0 || rsiB.length === 0) return null;

  const lowA = Math.min(...segA.map((c) => c.low));
  const lowB = Math.min(...segB.map((c) => c.low));
  const highA = Math.max(...segA.map((c) => c.high));
  const highB = Math.max(...segB.map((c) => c.high));
  const rLowA = Math.min(...rsiA);
  const rLowB = Math.min(...rsiB);
  const rHighA = Math.max(...rsiA);
  const rHighB = Math.max(...rsiB);

  if (lowB < lowA && rLowB > rLowA + 2) return "bullish"; // lower low in price, higher low in RSI
  if (highB > highA && rHighB < rHighA - 2) return "bearish";
  return null;
}

// ---------------------------------------------------------------------------
// Volume — is the move backed by participation?
// ---------------------------------------------------------------------------
export function analyseVolume(candles: Candle[]): AnalyserReport {
  if (candles.length < 25) return { name: "volume", score: 0, confidence: 0.2, reasons: [], metrics: {} };
  const vols = candles.map((c) => c.volume);
  const avg = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVol = last(vols);
  const ratio = avg > 0 ? currentVol / avg : 1;

  // Direction of the last few candles, weighted by their volume.
  const recent = candles.slice(-5);
  const signed = recent.reduce((acc, c) => acc + (c.close - c.open) * c.volume, 0);
  const totalVol = recent.reduce((acc, c) => acc + c.volume, 0) || 1;
  const avgPrice = recent.reduce((a, c) => a + c.close, 0) / recent.length;
  const pressure = clamp(signed / totalVol / (avgPrice * 0.01), -1, 1);

  const reasons: Reason[] = [];
  let score = pressure * 0.7;

  if (ratio > 1.4) {
    reasons.push({ code: "VOLUME_CONFIRMS", score: 0, detail: { ratio: round(ratio, 2) } });
    score *= 1.25;
  } else if (ratio < 0.65) {
    reasons.push({ code: "VOLUME_WEAK", score: 0, detail: { ratio: round(ratio, 2) } });
    score *= 0.6;
  }

  return {
    name: "volume",
    score: clamp(score, -1, 1),
    confidence: clamp(0.4 + Math.min(ratio, 2) * 0.25, 0.3, 0.9),
    reasons,
    metrics: { volumeRatio: round(ratio, 3), pressure: round(pressure, 3) },
  };
}

// ---------------------------------------------------------------------------
// Liquidity — stop hunts / sweeps of obvious highs and lows.
// ---------------------------------------------------------------------------
export function analyseLiquidity(candles: Candle[]): AnalyserReport {
  if (candles.length < 30) return { name: "liquidity", score: 0, confidence: 0.2, reasons: [], metrics: {} };
  const window = candles.slice(-25, -1);
  const priorHigh = Math.max(...window.map((c) => c.high));
  const priorLow = Math.min(...window.map((c) => c.low));
  const c = last(candles);
  const reasons: Reason[] = [];
  let score = 0;

  // Swept the low then closed back above it => buy-side liquidity grab.
  if (c.low < priorLow && c.close > priorLow) {
    score += 0.65;
    reasons.push({ code: "LIQUIDITY_SWEEP_LOW", score: 0.65, detail: { level: round(priorLow, 6) } });
  }
  if (c.high > priorHigh && c.close < priorHigh) {
    score -= 0.65;
    reasons.push({ code: "LIQUIDITY_SWEEP_HIGH", score: -0.65, detail: { level: round(priorHigh, 6) } });
  }

  // Thin liquidity proxy: the range is wide relative to the volume behind it.
  const avgVol = candles.slice(-20).reduce((a, x) => a + x.volume, 0) / 20;
  const rangePct = ((c.high - c.low) / c.close) * 100;
  const thin = avgVol > 0 && c.volume < avgVol * 0.5 && rangePct > 1;
  if (thin) reasons.push({ code: "LIQUIDITY_THIN", score: 0, detail: { rangePct: round(rangePct, 2) } });

  return {
    name: "liquidity",
    score: clamp(score, -1, 1),
    confidence: score === 0 ? 0.35 : 0.8,
    reasons,
    metrics: { priorHigh, priorLow, rangePct: round(rangePct, 3) },
  };
}

// ---------------------------------------------------------------------------
// Volatility — regime gate, not a directional signal.
// ---------------------------------------------------------------------------
export function analyseVolatility(candles: Candle[]): AnalyserReport {
  const atrSeries = atr(candles, 14);
  const a = lastDefined(atrSeries) ?? 0;
  const price = last(candles).close;
  const atrPct = price > 0 ? (a / price) * 100 : 0;

  const defined = atrSeries.filter((v): v is number => v !== null);
  const baseline =
    defined.length > 30 ? defined.slice(-60).reduce((x, y) => x + y, 0) / Math.min(60, defined.length) : a;
  const expansion = baseline > 0 ? a / baseline : 1;

  const closes = candles.map((c) => c.close);
  const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
  const realised = stdDev(returns.slice(-50)) * 100;

  const reasons: Reason[] = [];
  if (expansion > 1.6) reasons.push({ code: "VOLATILITY_EXPANDING", score: 0, detail: { expansion: round(expansion, 2) } });
  else if (atrPct > 6) reasons.push({ code: "VOLATILITY_EXTREME", score: 0, detail: { atrPct: round(atrPct, 2) } });
  else if (atrPct < 0.15) reasons.push({ code: "VOLATILITY_DEAD", score: 0, detail: { atrPct: round(atrPct, 3) } });
  else reasons.push({ code: "VOLATILITY_NORMAL", score: 0, detail: { atrPct: round(atrPct, 2) } });

  return {
    name: "volatility",
    score: 0, // never directional by itself
    confidence: 0.8,
    reasons,
    metrics: { atr: a, atrPct: round(atrPct, 4), expansion: round(expansion, 3), realisedPct: round(realised, 4) },
  };
}

// ---------------------------------------------------------------------------
// Price action — candle anatomy on the most recent bars.
// ---------------------------------------------------------------------------
export function analysePriceAction(candles: Candle[]): AnalyserReport {
  if (candles.length < 3) return { name: "priceAction", score: 0, confidence: 0.2, reasons: [], metrics: {} };
  const c = last(candles);
  const p = candles[candles.length - 2];
  const body = Math.abs(c.close - c.open);
  const range = Math.max(c.high - c.low, 1e-12);
  const upperWick = c.high - Math.max(c.close, c.open);
  const lowerWick = Math.min(c.close, c.open) - c.low;
  const bodyRatio = body / range;
  const reasons: Reason[] = [];
  let score = 0;

  const prevBody = Math.abs(p.close - p.open);
  const bullEngulf = c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close && body > prevBody;
  const bearEngulf = c.close < c.open && p.close > p.open && c.close <= p.open && c.open >= p.close && body > prevBody;

  if (bullEngulf) {
    score += 0.6;
    reasons.push({ code: "PA_BULLISH_ENGULFING", score: 0.6 });
  } else if (bearEngulf) {
    score -= 0.6;
    reasons.push({ code: "PA_BEARISH_ENGULFING", score: -0.6 });
  }

  if (lowerWick > body * 1.8 && lowerWick / range > 0.5) {
    score += 0.45;
    reasons.push({ code: "PA_REJECTION_WICK_DOWN", score: 0.45, detail: { wickRatio: round(lowerWick / range, 2) } });
  }
  if (upperWick > body * 1.8 && upperWick / range > 0.5) {
    score -= 0.45;
    reasons.push({ code: "PA_REJECTION_WICK_UP", score: -0.45, detail: { wickRatio: round(upperWick / range, 2) } });
  }

  if (bodyRatio < 0.2 && reasons.length === 0) {
    reasons.push({ code: "PA_INDECISION", score: 0, detail: { bodyRatio: round(bodyRatio, 2) } });
  }

  return {
    name: "priceAction",
    score: clamp(score, -1, 1),
    confidence: reasons.length > 0 && score !== 0 ? 0.75 : 0.4,
    reasons,
    metrics: { bodyRatio: round(bodyRatio, 3), upperWick: round(upperWick, 8), lowerWick: round(lowerWick, 8) },
  };
}

// ---------------------------------------------------------------------------
// Zones — where is price relative to the nearest meaningful levels?
//
// Buying into resistance or selling into support is the single most common
// retail mistake; this analyser exists to veto exactly that.
// ---------------------------------------------------------------------------
export function analyseZones(candles: Candle[], zones: Zone[]): AnalyserReport {
  const price = last(candles).close;
  const { below, above } = nearestZones(zones, price);
  const reasons: Reason[] = [];
  let score = 0;

  const atSupport = zoneProximity(below, price) && (below?.kind === "support" || below?.kind === "demand");
  const atResistance = zoneProximity(above, price) && (above?.kind === "resistance" || above?.kind === "supply");

  if (atSupport && below) {
    score += 0.55 * below.strength;
    reasons.push({
      code: below.kind === "demand" ? "AT_DEMAND_ZONE" : "AT_SUPPORT",
      score: 0.55 * below.strength,
      detail: { low: round(below.low, 6), high: round(below.high, 6), touches: below.touches },
    });
  }
  if (atResistance && above) {
    score -= 0.55 * above.strength;
    reasons.push({
      code: above.kind === "supply" ? "AT_SUPPLY_ZONE" : "AT_RESISTANCE",
      score: -0.55 * above.strength,
      detail: { low: round(above.low, 6), high: round(above.high, 6), touches: above.touches },
    });
  }

  // Headroom: distance to the next obstacle in each direction.
  const roomUp = above ? ((above.low - price) / price) * 100 : Infinity;
  const roomDown = below ? ((price - below.high) / price) * 100 : Infinity;

  if (!atSupport && !atResistance) {
    // Mid-range: no edge. Penalise conviction rather than adding direction.
    if (Number.isFinite(roomUp) && Number.isFinite(roomDown) && Math.abs(roomUp - roomDown) < 0.5) {
      reasons.push({ code: "MID_RANGE_NO_EDGE", score: 0 });
    }
  }

  return {
    name: "zones",
    score: clamp(score, -1, 1),
    confidence: zones.length >= 3 ? 0.75 : 0.4,
    reasons,
    metrics: {
      roomUpPct: Number.isFinite(roomUp) ? round(roomUp, 3) : 99,
      roomDownPct: Number.isFinite(roomDown) ? round(roomDown, 3) : 99,
      nearestSupport: below?.high ?? 0,
      nearestResistance: above?.low ?? 0,
    },
  };
}

export function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
