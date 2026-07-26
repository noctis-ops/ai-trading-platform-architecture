// ---------------------------------------------------------------------------
// Market Structure
//
// Swing detection -> structure classification (BOS / CHoCH / range) ->
// support/resistance and supply/demand zone extraction.
//
// This module is deliberately the heaviest-weighted input in the confluence
// engine: a professional discretionary trader reads structure first and uses
// indicators only as confirmation. Everything here is derived from raw price,
// not from lagging moving averages.
// ---------------------------------------------------------------------------
import type { AnalyserReport, Candle, Reason, SwingPoint, Zone } from "./types";

/**
 * Fractal swing detection: a swing high is a candle whose high is the maximum
 * within +/- `lookback` bars. Using a symmetric window means the most recent
 * `lookback` bars can never form a confirmed swing — that is intentional, an
 * unconfirmed swing is exactly the kind of guess that produces bad entries.
 */
export function findSwings(candles: Candle[], lookback = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const c = candles[i];
    const isHigh = window.every((w) => w.high <= c.high);
    const isLow = window.every((w) => w.low >= c.low);
    // A candle can technically satisfy both in flat data; prefer the larger range.
    if (isHigh && !isLow) swings.push({ index: i, time: c.time, price: c.high, kind: "high" });
    else if (isLow && !isHigh) swings.push({ index: i, time: c.time, price: c.low, kind: "low" });
  }
  return swings;
}

export type StructureState = {
  /** Sequence of higher-highs/higher-lows etc. */
  trend: "bullish" | "bearish" | "range";
  /** Break of structure: continuation in the prevailing direction. */
  bos: "up" | "down" | null;
  /** Change of character: first break against the prevailing direction. */
  choch: "up" | "down" | null;
  lastSwingHigh: SwingPoint | null;
  lastSwingLow: SwingPoint | null;
  /** How clean the structure is, 0..1 (higher = more consistent sequence). */
  clarity: number;
};

export function classifyStructure(candles: Candle[], swings: SwingPoint[]): StructureState {
  const highs = swings.filter((s) => s.kind === "high");
  const lows = swings.filter((s) => s.kind === "low");
  const lastSwingHigh = highs.at(-1) ?? null;
  const lastSwingLow = lows.at(-1) ?? null;

  if (highs.length < 2 || lows.length < 2) {
    return { trend: "range", bos: null, choch: null, lastSwingHigh, lastSwingLow, clarity: 0 };
  }

  const recentHighs = highs.slice(-3);
  const recentLows = lows.slice(-3);
  const hh = recentHighs.at(-1)!.price > recentHighs.at(-2)!.price;
  const hl = recentLows.at(-1)!.price > recentLows.at(-2)!.price;
  const lh = recentHighs.at(-1)!.price < recentHighs.at(-2)!.price;
  const ll = recentLows.at(-1)!.price < recentLows.at(-2)!.price;

  let trend: StructureState["trend"] = "range";
  if (hh && hl) trend = "bullish";
  else if (lh && ll) trend = "bearish";

  // Clarity: fraction of the last swing legs that agree with the trend.
  const agree = trend === "bullish" ? [hh, hl] : trend === "bearish" ? [lh, ll] : [];
  const clarity = agree.length ? agree.filter(Boolean).length / agree.length : 0;

  // BOS / CHoCH: has price closed beyond the last confirmed swing?
  const close = candles.at(-1)!.close;
  let bos: StructureState["bos"] = null;
  let choch: StructureState["choch"] = null;

  if (lastSwingHigh && close > lastSwingHigh.price) {
    if (trend === "bullish") bos = "up";
    else choch = "up";
  } else if (lastSwingLow && close < lastSwingLow.price) {
    if (trend === "bearish") bos = "down";
    else choch = "down";
  }

  return { trend, bos, choch, lastSwingHigh, lastSwingLow, clarity };
}

/**
 * Extracts horizontal zones by clustering swing points that sit within
 * `tolerancePct` of each other. More touches => stronger zone. Zones above
 * current price are resistance/supply, below are support/demand.
 */
export function extractZones(candles: Candle[], swings: SwingPoint[], tolerancePct = 0.35): Zone[] {
  if (swings.length === 0) return [];
  const price = candles.at(-1)!.close;
  const tol = (tolerancePct / 100) * price;

  type Cluster = { prices: number[]; lastIndex: number; kind: SwingPoint["kind"] };
  const clusters: Cluster[] = [];

  for (const s of swings) {
    const hit = clusters.find(
      (c) => c.kind === s.kind && Math.abs(c.prices.reduce((a, b) => a + b, 0) / c.prices.length - s.price) <= tol,
    );
    if (hit) {
      hit.prices.push(s.price);
      hit.lastIndex = Math.max(hit.lastIndex, s.index);
    } else {
      clusters.push({ prices: [s.price], lastIndex: s.index, kind: s.kind });
    }
  }

  const maxTouches = Math.max(...clusters.map((c) => c.prices.length), 1);

  return clusters
    .map<Zone>((c) => {
      const low = Math.min(...c.prices);
      const high = Math.max(...c.prices);
      const mid = (low + high) / 2;
      const above = mid > price;
      // Recency weighting: a zone last touched long ago is less relevant.
      const recency = 1 - Math.min(1, (candles.length - c.lastIndex) / candles.length);
      const strength = Math.min(1, (c.prices.length / maxTouches) * 0.7 + recency * 0.3);
      return {
        kind: above ? (c.kind === "high" ? "resistance" : "supply") : c.kind === "low" ? "support" : "demand",
        low: low - tol * 0.5,
        high: high + tol * 0.5,
        strength,
        touches: c.prices.length,
        lastTouchIndex: c.lastIndex,
      };
    })
    .sort((a, b) => b.strength - a.strength);
}

/** Nearest zone below / above the current price. */
export function nearestZones(zones: Zone[], price: number) {
  const below = zones.filter((z) => z.high <= price).sort((a, b) => b.high - a.high)[0] ?? null;
  const above = zones.filter((z) => z.low >= price).sort((a, b) => a.low - b.low)[0] ?? null;
  return { below, above };
}

/** Is price currently inside (or within `bufferPct`) of a zone? */
export function zoneProximity(zone: Zone | null, price: number, bufferPct = 0.25): boolean {
  if (!zone) return false;
  const buffer = (bufferPct / 100) * price;
  return price >= zone.low - buffer && price <= zone.high + buffer;
}

export function analyseStructure(
  candles: Candle[],
): AnalyserReport & { state: StructureState; swings: SwingPoint[]; zones: Zone[] } {
  const swings = findSwings(candles);
  const state = classifyStructure(candles, swings);
  const zones = extractZones(candles, swings);
  const reasons: Reason[] = [];
  let score = 0;

  if (state.bos === "up") {
    score += 0.7;
    reasons.push({ code: "STRUCTURE_BOS_UP", score: 0.7, detail: { level: state.lastSwingHigh?.price ?? 0 } });
  } else if (state.bos === "down") {
    score -= 0.7;
    reasons.push({ code: "STRUCTURE_BOS_DOWN", score: -0.7, detail: { level: state.lastSwingLow?.price ?? 0 } });
  }

  if (state.choch === "up") {
    score += 0.45;
    reasons.push({ code: "STRUCTURE_CHOCH_UP", score: 0.45 });
  } else if (state.choch === "down") {
    score -= 0.45;
    reasons.push({ code: "STRUCTURE_CHOCH_DOWN", score: -0.45 });
  }

  if (state.trend === "bullish") score += 0.4 * state.clarity;
  else if (state.trend === "bearish") score -= 0.4 * state.clarity;
  else reasons.push({ code: "STRUCTURE_RANGE", score: 0 });

  score = clamp(score, -1, 1);

  return {
    name: "structure",
    score,
    confidence: swings.length >= 6 ? 0.5 + 0.5 * state.clarity : 0.35,
    reasons,
    metrics: {
      swingCount: swings.length,
      clarity: state.clarity,
      zoneCount: zones.length,
    },
    state,
    swings,
    zones,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
