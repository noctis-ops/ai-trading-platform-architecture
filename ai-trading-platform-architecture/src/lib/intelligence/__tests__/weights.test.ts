// ---------------------------------------------------------------------------
// Tests for adaptive weights
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";
import { getRegimeWeights, BASE_WEIGHTS, isAnalyserActive, normaliseWeights } from "../weights";

test("base weights have all expected analysers", () => {
  const keys = Object.keys(BASE_WEIGHTS);
  assert.ok(keys.includes("trend"));
  assert.ok(keys.includes("structure"));
  assert.ok(keys.includes("zones"));
  assert.ok(keys.includes("momentum"));
  assert.ok(keys.includes("volume"));
  assert.ok(keys.includes("volatility"));
  assert.ok(keys.includes("priceAction"));
  assert.ok(keys.includes("liquidity"));
  assert.ok(keys.includes("vwap"));
  assert.ok(keys.includes("volumeProfile"));
  assert.ok(keys.includes("orderFlow"));
  assert.ok(keys.includes("reversal"));
  assert.ok(keys.includes("breakout"));
  assert.equal(keys.length, 13);
});

test("trending_up increases trend and structure weights", () => {
  const w = getRegimeWeights("trending_up");
  assert.ok(w.trend > BASE_WEIGHTS.trend, "trend weight should increase in uptrend");
  assert.ok(w.structure > BASE_WEIGHTS.structure, "structure weight should increase in uptrend");
  assert.ok(w.reversal === 0, "reversal should be suppressed in trending");
  assert.ok(w.breakout === 0, "breakout should be suppressed in trending");
  assert.ok(w.vwap > 0, "vwap should be active in trending");
});

test("trending_down mirrors trending_up structure", () => {
  const w = getRegimeWeights("trending_down");
  assert.ok(w.trend > BASE_WEIGHTS.trend, "trend weight should increase in downtrend");
  assert.ok(w.structure > BASE_WEIGHTS.structure, "structure weight should increase");
  assert.ok(w.reversal === 0);
  assert.ok(w.breakout === 0);
  // volatility slightly higher in downtrends
  assert.ok(w.volatility >= BASE_WEIGHTS.volatility);
});

test("ranging activates reversal and boosts zones", () => {
  const w = getRegimeWeights("ranging");
  assert.ok(w.reversal > 0, "reversal must be active in ranging");
  assert.ok(w.zones > BASE_WEIGHTS.zones, "zones weight must increase in ranging");
  assert.ok(w.liquidity > BASE_WEIGHTS.liquidity, "liquidity must increase in ranging");
  assert.ok(w.trend < BASE_WEIGHTS.trend, "trend weight must decrease in ranging");
  assert.ok(w.structure < BASE_WEIGHTS.structure, "structure weight must decrease");
  assert.ok(w.breakout === 0, "breakout suppressed in confirmed range");
});

test("volatile_expansion activates reversal and boosts volatility gate", () => {
  const w = getRegimeWeights("volatile_expansion");
  assert.ok(w.volatility > BASE_WEIGHTS.volatility, "volatility gate weight must increase");
  assert.ok(w.reversal > 0, "reversal should be active for snap-back");
  assert.ok(w.vwap > BASE_WEIGHTS.vwap, "VWAP matters more in expansion");
  assert.ok(w.breakout === 0, "breakout suppressed in expansion");
  // Momentum is reduced — whipsaw risk
  assert.ok(w.momentum < BASE_WEIGHTS.momentum);
});

test("quiet_compression activates breakout and boosts volume", () => {
  const w = getRegimeWeights("quiet_compression");
  assert.ok(w.breakout > 0, "breakout must be active in compression");
  assert.ok(w.volume > BASE_WEIGHTS.volume, "volume weight must increase");
  assert.ok(w.volatility > BASE_WEIGHTS.volatility, "volatility = coil detection");
  assert.ok(w.reversal === 0, "reversal suppressed in compression");
  assert.ok(w.trend < BASE_WEIGHTS.trend);
});

test("isAnalyserActive reflects regime weights", () => {
  assert.equal(isAnalyserActive("reversal", "ranging"), true);
  assert.equal(isAnalyserActive("reversal", "trending_up"), false);
  assert.equal(isAnalyserActive("breakout", "quiet_compression"), true);
  assert.equal(isAnalyserActive("breakout", "trending_down"), false);
  assert.equal(isAnalyserActive("trend", "trending_up"), true);
});

test("normaliseWeights preserves relative proportions", () => {
  const custom = { a: 1, b: 2, c: 3 };
  const normalised = normaliseWeights(custom);
  // Should maintain the 1:2:3 ratio
  assert.ok(normalised.a > 0 && normalised.b > 0 && normalised.c > 0);
  assert.ok(Math.abs(normalised.b / normalised.a - 2) < 0.5);
});

test("every regime returns valid, non-empty weights", () => {
  const regimes = ["trending_up", "trending_down", "ranging", "volatile_expansion", "quiet_compression"] as const;
  for (const r of regimes) {
    const w = getRegimeWeights(r);
    assert.ok(typeof w === "object");
    assert.ok(Object.keys(w).length >= 13);
    // All weights should be non-negative
    for (const v of Object.values(w)) {
      assert.ok(v >= 0, `${r}: all weights must be >= 0, got ${v}`);
    }
    // At least one weight > 0
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(total > 0, `${r}: total weight must be > 0`);
  }
});
