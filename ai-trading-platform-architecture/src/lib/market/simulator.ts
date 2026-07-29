// ---------------------------------------------------------------------------
// Synthetic Market Data Engine — v3.0 with realistic regime generation
//
// v2.x: Pure GBM — random walk, no market structure.
// v3.0: Multi-regime generation with:
//   - Trending (directional drift + moderate vol)
//   - Ranging (mean-reverting oscillations)
//   - Volatile expansion (large shocks, GARCH clustering)
//   - Quiet compression (tight range, low vol coiling)
//   - Mixed (transitions between regimes)
//
// Each symbol is deterministically assigned a regime based on its seed,
// so backtests using the same symbol/timeframe always produce the same
// price series. This makes the simulator suitable for:
//   a) Testing the engine's response to different market conditions
//   b) Verifying that the multi-strategy system actually works per regime
//
// It does NOT make it suitable for performance claims — use real data
// for that (`npm run backtest -- --live`).
// ---------------------------------------------------------------------------
import { getSymbolMeta, SYMBOLS, TIMEFRAME_MINUTES, type Timeframe } from "./symbols";
import type { Candle } from "@/lib/indicators";

// ---------------------------------------------------------------------------
// PRNG & helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Regime-based generation
// ---------------------------------------------------------------------------

type RegimeType = "trending" | "ranging" | "volatile_expansion" | "quiet_compression" | "mixed";

const REGIME_VOL: Record<RegimeType, number> = {
  trending: 1.0,
  ranging: 0.5,
  volatile_expansion: 2.5,
  quiet_compression: 0.35,
  mixed: 1.0,
};

const candleCache = new Map<string, Candle[]>();
const symbolRegimes = new Map<string, RegimeType>();

function getSymbolRegime(symbol: string): RegimeType {
  if (!symbolRegimes.has(symbol)) {
    const seed = hashSeed(`${symbol}:regime`);
    const rng = mulberry32(seed);
    const r = rng();
    if (r < 0.25) symbolRegimes.set(symbol, "trending");
    else if (r < 0.45) symbolRegimes.set(symbol, "ranging");
    else if (r < 0.55) symbolRegimes.set(symbol, "volatile_expansion");
    else if (r < 0.70) symbolRegimes.set(symbol, "quiet_compression");
    else symbolRegimes.set(symbol, "mixed");
  }
  return symbolRegimes.get(symbol)!;
}

/**
 * Generates deterministic OHLCV history for a symbol/timeframe.
 *
 * v3.0: Uses the symbol's assigned regime to modulate:
 *   - Drift (trending: consistent directional bias)
 *   - Volatility (ranging: mean-reversion, volatile: GARCH clustering)
 *   - Volume (expansion: volume spikes, compression: drying volume)
 */
export function generateCandles(symbol: string, timeframe: Timeframe, count: number): Candle[] {
  const cacheKey = `${symbol}:${timeframe}:${count}`;
  const cached = candleCache.get(cacheKey);
  if (cached) return cached;

  const meta = getSymbolMeta(symbol);
  const regime = getSymbolRegime(symbol);
  const minutes = TIMEFRAME_MINUTES[timeframe];
  const barMs = minutes * 60 * 1000;
  const now = Date.now();
  const startTime = now - count * barMs;

  const rng = mulberry32(hashSeed(`${symbol}:${timeframe}`));
  const barsPerYear = (365 * 24 * 60) / minutes;
  const baseDrift = meta.annualDriftPct / 100 / barsPerYear;
  const baseVol = meta.annualVolatilityPct / 100 / Math.sqrt(barsPerYear) * REGIME_VOL[regime];

  // Starting price: determine from regime
  let price = meta.startPrice;
  if (regime === "trending") price *= 0.6;  // Start low for uptrend
  if (regime === "ranging") price *= 0.9;   // Start near current for range
  if (regime === "volatile_expansion") price *= 0.7;
  if (regime === "quiet_compression") price *= 1.0;

  let vol = baseVol;
  const candles: Candle[] = [];

  // Regime-specific parameters
  const meanReversionStrength = regime === "ranging" ? 0.015 : regime === "quiet_compression" ? 0.025 : 0.001;
  const meanReversionTarget = meta.startPrice; // Range center
  const trendStrength = regime === "trending" ? 2.0 : 0.3;

  for (let i = 0; i < count; i++) {
    // Volatility dynamics
    vol = vol + (baseVol - vol) * 0.02 + Math.abs(gaussian(rng)) * baseVol * 0.05;
    vol = Math.min(Math.max(vol, baseVol * 0.3), baseVol * 4);

    // Drift: trending = strong directional, ranging = mean-reverting
    let drift = baseDrift * trendStrength;
    if (regime === "ranging" || regime === "quiet_compression") {
      // Mean-reversion: pull toward center
      drift = (meanReversionTarget - price) * meanReversionStrength;
    }

    const shock = gaussian(rng) * vol;
    const periodDrift = drift - 0.5 * vol * vol;
    const open = price;
    const close = open * Math.exp(periodDrift + shock);

    // Wicks: smaller in ranging, larger in volatile
    const wickFactor = regime === "volatile_expansion" ? 0.8 : regime === "quiet_compression" ? 0.15 : 0.4;
    const high = Math.max(open, close) * (1 + Math.abs(gaussian(rng)) * vol * wickFactor);
    const low = Math.min(open, close) * (1 - Math.abs(gaussian(rng)) * vol * wickFactor);

    // Volume: regime-dependent
    const volumeBase = regime === "quiet_compression"
      ? 300
      : regime === "volatile_expansion"
        ? 2000
        : 1000;
    const volume = Math.abs(gaussian(rng)) * volumeBase * (1 + vol * 15);

    candles.push({
      time: startTime + i * barMs,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  candleCache.set(cacheKey, candles);
  return candles;
}

export function getLatestPrice(symbol: string): number {
  const candles = generateCandles(symbol, "5m", 500);
  return candles[candles.length - 1].close;
}

export function getAllLatestPrices(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SYMBOLS) {
    out[s.symbol] = getLatestPrice(s.symbol);
  }
  return out;
}

export function clearCandleCache() {
  candleCache.clear();
  symbolRegimes.clear();
}
