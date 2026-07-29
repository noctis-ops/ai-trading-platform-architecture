// ---------------------------------------------------------------------------
// Tests for orderflow analysers (VWAP, Volume Profile, CVD)
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeVwap, computeVolumeProfile, computeCvd, analyseVwap, analyseVolumeProfile, analyseOrderFlow } from "../orderflow";
import type { Candle } from "../types";

function c(o: number, h: number, l: number, cl: number, v = 1000, t = 0): Candle {
  return { time: t || Date.now(), open: o, high: h, low: l, close: cl, volume: v };
}

test("VWAP: price above VWAP gives bullish score", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    const px = 100 + i * 0.3;
    candles.push(c(px - 0.1, px + 0.5, px - 0.5, px, 1000, i * 3600000));
  }
  const result = analyseVwap(candles);
  assert.ok(result.score >= 0, "rising series should be bullish or neutral");
  assert.ok(result.confidence > 0);
  assert.ok(result.metrics.vwap !== undefined);
});

test("VWAP: price below VWAP gives bearish score", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    const px = 100 - i * 0.3;
    candles.push(c(px + 0.1, px + 0.5, px - 0.5, px, 1000, i * 3600000));
  }
  const result = analyseVwap(candles);
  assert.ok(result.score <= 0, "falling series should be bearish or neutral");
});

test("VWAP: needs enough candles", () => {
  const candles = [c(100, 101, 99, 100.5), c(100.5, 101, 100, 101)];
  const r = analyseVwap(candles);
  assert.equal(r.score, 0);
  assert.equal(r.confidence, 0);
});

test("Volume Profile: detects POC and value area", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 50; i++) {
    const px = 100 + Math.sin(i / 5) * 2;
    candles.push(c(px, px + 0.5, px - 0.5, px, 500 + Math.random() * 500, i * 3600000));
  }
  const vp = computeVolumeProfile(candles);
  assert.ok(vp.poc > 0, "POC must be positive");
  assert.ok(vp.vah >= vp.poc, "VAH must be >= POC");
  assert.ok(vp.val <= vp.poc, "VAL must be <= POC");
  assert.ok(typeof vp.priceInValueArea === "boolean");
});

test("Volume Profile analyser works", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 50; i++) {
    const px = 100 + i * 0.1;
    candles.push(c(px, px + 0.8, px - 0.8, px, 1000, i * 3600000));
  }
  const r = analyseVolumeProfile(candles);
  assert.ok(r.confidence > 0);
  assert.ok(r.metrics.poc !== undefined);
});

test("CVD: computeCvd produces arrays of correct length", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    candles.push(c(100, 101, 99, 100.5, 1000, i * 3600000));
  }
  const { cvd, delta } = computeCvd(candles);
  assert.equal(cvd.length, candles.length);
  assert.equal(delta.length, candles.length);
  assert.ok(typeof cvd[0] === "number");
});

test("CVD: rising close with bullish candles = no bearish divergence", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    const px = 100 + i * 0.5;
    candles.push(c(px - 0.3, px + 1, px - 0.5, px, 1000, i * 3600000));
  }
  const { divergence } = computeCvd(candles);
  assert.equal(divergence, false);
});

test("OrderFlow analyser gives directional score", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 30; i++) {
    const px = 100 + i * 0.3;
    candles.push(c(px - 0.2, px + 0.8, px - 0.8, px, 1000, i * 3600000));
  }
  const r = analyseOrderFlow(candles);
  assert.ok(r.confidence > 0);
  assert.ok(typeof r.score === "number");
  assert.ok(r.score >= -1 && r.score <= 1);
});

test("OrderFlow needs minimum candles", () => {
  const candles = [c(100, 101, 99, 100.5), c(100.5, 102, 100, 101)];
  const r = analyseOrderFlow(candles);
  assert.equal(r.score, 0);
  assert.equal(r.confidence, 0);
});
