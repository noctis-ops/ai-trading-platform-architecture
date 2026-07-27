// ---------------------------------------------------------------------------
// Synthetic market fixtures for deterministic brain tests.
//
// These are hand-built price paths with a KNOWN correct answer, which is what
// makes them useful: if the engine stops recognising a textbook break of
// structure, or starts signalling inside pure chop, a test fails.
// ---------------------------------------------------------------------------
import type { Candle } from "../types";

const HOUR = 3.6e6;

/**
 * Deterministic pseudo-noise so fixtures stay reproducible across runs while
 * still producing realistic intrabar ranges.
 */
function noise(i: number, salt = 1): number {
  return Math.abs(Math.sin(i * 12.9898 * salt) * 43758.5453) % 1;
}

/**
 * Wick size matters more than it looks: ATR is derived from true range, so
 * candles with near-zero wicks produce an artificially tiny ATR. That in turn
 * makes every structural level appear to be 7+ ATR away and the engine
 * (correctly) refuses to trade. Real 1h crypto candles carry wicks worth
 * roughly 0.3-1% of price, which is what this models.
 */
function toCandles(closes: number[], volumes: number[]): Candle[] {
  return closes.map((close, i) => {
    const open = i > 0 ? closes[i - 1] : close;
    const body = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    const upper = 1 + 0.002 + noise(i, 1.7) * 0.004;
    const lower = 1 - 0.002 - noise(i, 2.3) * 0.004;
    return {
      time: Date.now() - (closes.length - i) * HOUR,
      open,
      high: body * upper,
      low: bodyLow * lower,
      close,
      volume: volumes[i],
    };
  });
}

/**
 * Trend that consolidates under resistance then breaks out on volume (BOS).
 *
 * Built from EXPLICIT legs rather than emergent sine cycles so the geometry
 * the test depends on is guaranteed: a staircase of higher highs and higher
 * lows, a tight range whose high is the highest point of the series, and a
 * final bar closing just above that range on expanding volume. Everything the
 * engine needs (trend, structure, breakout, volume confirmation) is present
 * by construction, and the invalidation level sits ~1.5 ATR below entry.
 */
export function breakoutSetup(n = 300): Candle[] {
  const closes: number[] = [];
  const volumes: number[] = [];
  let p = 100;

  // --- Staircase uptrend: impulse up, shallow pullback, repeat -------------
  const consolidationBars = 24;
  const trendBars = n - consolidationBars - 1;
  const legUp = 12;
  const legDown = 6;

  for (let i = 0; i < trendBars; i++) {
    const phase = i % (legUp + legDown);
    if (phase < legUp) {
      p *= 1 + 0.0042;
      volumes.push(1500 + noise(i) * 300);
    } else {
      p *= 1 - 0.0035;
      volumes.push(700 + noise(i) * 150);
    }
    closes.push(p);
  }

  // --- Tight range under the highs (the breakout base) --------------------
  // Width is intentionally small vs ATR so the stop below it is a valid,
  // close-by invalidation level rather than a distant one.
  const rangeMid = p;
  for (let i = 0; i < consolidationBars; i++) {
    p = rangeMid * (1 + (noise(i, 3.1) - 0.5) * 0.006);
    closes.push(p);
    volumes.push(600 + noise(i, 4.2) * 120);
  }

  const candles = toCandles(closes, volumes);

  // --- Breakout bar: closes just above the range high on high volume ------
  const rangeHigh = Math.max(...candles.slice(-consolidationBars).map((c) => c.high));
  const prevClose = candles[candles.length - 1].close;
  candles.push({
    time: candles[candles.length - 1].time + HOUR,
    open: prevClose,
    low: prevClose * 0.9988,
    high: rangeHigh * 1.005,
    close: rangeHigh * 1.003,
    volume: 3500,
  });

  return candles;
}

/**
 * Mirror image of `breakoutSetup` — a downside break of structure.
 *
 * Built by inverting RETURNS, not by subtracting prices from a pivot. A naive
 * reflection (pivot - price) collapses the series toward zero, which inflates
 * ATR-as-%-of-price into fake "extreme volatility" and makes the fixture test
 * the wrong thing. Inverting returns preserves both the price scale and the
 * structural geometry.
 */
export function breakdownSetup(n = 300): Candle[] {
  const up = breakoutSetup(n);
  const start = up[0].close;
  const closes: number[] = [];
  let p = start;

  for (let i = 0; i < up.length; i++) {
    if (i > 0) {
      const ret = (up[i].close - up[i - 1].close) / up[i - 1].close;
      p = p * (1 - ret);
    }
    closes.push(p);
  }

  return up.map((c, i) => {
    const close = closes[i];
    const open = i > 0 ? closes[i - 1] : close;
    // Preserve the original bar's wick geometry, inverted.
    const upperWickPct = (c.high - Math.max(c.open, c.close)) / c.close;
    const lowerWickPct = (Math.min(c.open, c.close) - c.low) / c.close;
    return {
      time: c.time,
      open,
      high: Math.max(open, close) * (1 + lowerWickPct),
      low: Math.min(open, close) * (1 - upperWickPct),
      close,
      volume: c.volume,
    };
  });
}

/** Directionless chop — the engine must refuse to trade this. */
export function chopMarket(n = 300): Candle[] {
  const closes: number[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < n; i++) {
    closes.push(100 + Math.sin(i / 3) * 0.6 + Math.cos(i / 7) * 0.4);
    volumes.push(900 + Math.sin(i) * 80);
  }
  return toCandles(closes, volumes);
}

/** A parabolic run far above any structural stop — "late entry". */
export function extendedRun(n = 300): Candle[] {
  const closes: number[] = [];
  const volumes: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const phase = i % 40;
    p = p * (1 + (phase < 25 ? 0.006 : -0.0045));
    closes.push(p);
    volumes.push(phase < 25 ? 1600 : 700);
  }
  const candles = toCandles(closes, volumes);
  const j = candles.length - 1;
  const priorLow = Math.min(...candles.slice(-25, -1).map((c) => c.low));
  candles[j] = {
    time: candles[j].time,
    open: candles[j - 1].close * 0.999,
    low: priorLow * 0.994,
    high: candles[j - 1].close * 1.012,
    close: candles[j - 1].close * 1.011,
    volume: 3000,
  };
  return candles;
}

/** Flat, near-zero-volatility market — below the tradeable ATR floor. */
export function deadMarket(n = 300): Candle[] {
  const closes = Array.from({ length: n }, (_, i) => 100 + i * 1e-5);
  return toCandles(closes, Array(n).fill(500));
}

export const mtf = (candles: Candle[]) => ({ "15m": candles, "1h": candles, "4h": candles });
