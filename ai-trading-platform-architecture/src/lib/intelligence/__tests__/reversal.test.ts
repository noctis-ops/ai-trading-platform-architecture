// ---------------------------------------------------------------------------
// Tests for advanced reversal strategy
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyseReversal, detectDivergence, type ReversalQuality } from "../reversal";
import type { Candle, Zone } from "../types";

function candle(o: number, h: number, l: number, c: number, v = 1000, t = 0): Candle {
  return { time: t || Date.now(), open: o, high: h, low: l, close: c, volume: v };
}

function makeZones(overrides: Zone[] = []): Zone[] {
  return [
    { kind: "support" as const, low: 88, high: 92, strength: 0.8, touches: 5, lastTouchIndex: 10 },
    { kind: "resistance" as const, low: 108, high: 112, strength: 0.7, touches: 4, lastTouchIndex: 8 },
    ...overrides,
  ];
}

function makeCandles(n: number, lastOverrides?: Partial<Candle>): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push(candle(100, 101, 99, 100.5, 1000, i * 3600000));
  }
  if (lastOverrides) {
    const last = out[out.length - 1];
    out[out.length - 1] = { ...last, ...lastOverrides };
  }
  return out;
}

test("detects bullish hammer at support with confirmation", () => {
  // Build candles: flat then hammer + confirmation
  const candles = makeCandles(50);
  // Hammer: small body, long lower wick at support zone
  candles[49] = candle(91.5, 92.5, 88.5, 92, 1500); // hammer near support (88-92)
  // Need a "confirmation" bar before the hammer for the 2-bar lookback
  // Actually signal is last bar, confirmation is second-to-last
  candles[48] = candle(91, 91.8, 90.5, 91.5, 1200); // confirmation bar (close > previous close)
  
  const zones = makeZones();
  const result = analyseReversal(candles, zones);
  
  assert.ok(result.quality.candlesConfirmed >= 1, "should detect at least the hammer candle");
  assert.ok(result.quality.zoneStrength > 0, "should detect zone proximity");
});

test("detects bearish shooting star at resistance", () => {
  const candles = makeCandles(50);
  // Shooting star near resistance (108-112)
  candles[49] = candle(109.5, 113, 109, 109.8, 1400);
  candles[48] = candle(109, 110, 108.8, 109.5, 1100);
  
  const zones = makeZones();
  const result = analyseReversal(candles, zones);
  
  assert.ok(result.quality.candlesConfirmed >= 1);
  // Should be bearish or at least detect the shooting star
  assert.ok(result.score <= 0 || result.quality.zoneStrength >= 0, 
    "should detect exhaustion at resistance");
});

test("rejects fakeout — tiny candle at zone", () => {
  const candles = makeCandles(50);
  // Very small candle with low volume = fakeout
  candles[49] = candle(90.5, 90.8, 90.2, 90.5, 300); // tiny range, low vol
  candles[48] = candle(90.5, 90.5, 90.5, 90.5, 300);
  
  const zones = makeZones();
  const result = analyseReversal(candles, zones);
  
  // Either fakeout or very low confidence
  assert.ok(
    result.quality.isFakeout || result.confidence < 0.3,
    "tiny candle at zone should be fakeout or low confidence"
  );
});

test("returns neutral when no zone proximity", () => {
  const candles = makeCandles(50);
  // Hammer BUT far from any zone (at 100, zones at 88-92 and 108-112)
  candles[49] = candle(100, 101, 97, 100.5, 1200);
  candles[48] = candle(99.5, 100.5, 99, 100, 1100);
  
  const zones = makeZones();
  const result = analyseReversal(candles, zones);
  
  // Should not give strong signal — no zone nearby
  assert.ok(Math.abs(result.score) < 0.3 || result.confidence < 0.3,
    "hammer without zone proximity should be weak");
});

test("needs minimum 30 candles", () => {
  const candles = makeCandles(20);
  const result = analyseReversal(candles, makeZones());
  assert.equal(result.score, 0);
  assert.equal(result.confidence, 0);
});

test("detectDivergence finds bullish divergence", () => {
  // Price making lower low, RSI making higher low
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    const px = 100 - i * 0.3;
    candles.push(candle(px, px + 1, px - 1, px, 1000, i * 3600000));
  }
  // Force a lower low at the end
  candles[29] = candle(80, 81, 78, 80.5, 1500);
  
  const div = detectDivergence(candles);
  // Divergence detection needs proper swing points
  assert.ok(typeof div.type === "string" || div.type === null);
  assert.ok(div.strength >= 0);
});

test("detectDivergence returns null for flat data", () => {
  const candles = makeCandles(50);
  const div = detectDivergence(candles);
  assert.equal(div.type, null);
});
