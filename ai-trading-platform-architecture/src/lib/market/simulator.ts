// ---------------------------------------------------------------------------
// Synthetic Market Data Engine
//
// Rationale (see /docs/DECISIONS.md #3): live exchange connectivity requires
// API keys/network access that are not guaranteed inside this sandbox, and a
// production trading platform must never depend on a flaky upstream for its
// own health checks. We therefore ship a deterministic Geometric Brownian
// Motion + volatility-regime price engine seeded per-symbol, wrapped behind
// the same `ExchangeAdapter` interface that a real Binance/Bybit adapter
// would implement. Swapping in a live venue later means implementing
// `ExchangeAdapter` and registering it — no other code changes.
// ---------------------------------------------------------------------------
import { getSymbolMeta, SYMBOLS, TIMEFRAME_MINUTES, type Timeframe } from "./symbols";
import type { Candle } from "@/lib/indicators";

// Deterministic PRNG (mulberry32) so backtests are reproducible.
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
  // Box-Muller transform
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const EPOCH = Date.UTC(2023, 0, 1);
const candleCache = new Map<string, Candle[]>();

/**
 * Generates deterministic OHLCV history for a symbol/timeframe up to "now",
 * using GBM with mild mean-reverting volatility clustering (GARCH-lite).
 */
export function generateCandles(symbol: string, timeframe: Timeframe, count: number): Candle[] {
  const cacheKey = `${symbol}:${timeframe}:${count}`;
  const cached = candleCache.get(cacheKey);
  if (cached) return cached;

  const meta = getSymbolMeta(symbol);
  const minutes = TIMEFRAME_MINUTES[timeframe];
  const barMs = minutes * 60 * 1000;
  const now = Date.now();
  const startTime = now - count * barMs;

  const rng = mulberry32(hashSeed(`${symbol}:${timeframe}`));
  const barsPerYear = (365 * 24 * 60) / minutes;
  const drift = meta.annualDriftPct / 100 / barsPerYear;
  const baseVol = meta.annualVolatilityPct / 100 / Math.sqrt(barsPerYear);

  let price = meta.startPrice * 0.55; // start lower so the series trends toward realistic present-day levels
  let vol = baseVol;
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    // volatility clustering: vol slowly mean-reverts with random shocks
    vol = vol + (baseVol - vol) * 0.02 + Math.abs(gaussian(rng)) * baseVol * 0.05;
    vol = Math.min(Math.max(vol, baseVol * 0.3), baseVol * 3);

    const shock = gaussian(rng) * vol;
    const periodDrift = drift - 0.5 * vol * vol;
    const open = price;
    const close = open * Math.exp(periodDrift + shock);
    const high = Math.max(open, close) * (1 + Math.abs(gaussian(rng)) * vol * 0.4);
    const low = Math.min(open, close) * (1 - Math.abs(gaussian(rng)) * vol * 0.4);
    const volume = Math.abs(gaussian(rng)) * 1000 * (1 + vol * 20);

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

/** Returns the latest simulated mark price for a symbol (uses 5m series). */
export function getLatestPrice(symbol: string): number {
  const candles = generateCandles(symbol, "5m", 500);
  return candles[candles.length - 1].close;
}

/** Returns latest prices for every tracked symbol in one call. */
export function getAllLatestPrices(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SYMBOLS) {
    out[s.symbol] = getLatestPrice(s.symbol);
  }
  return out;
}

export function clearCandleCache() {
  candleCache.clear();
}
