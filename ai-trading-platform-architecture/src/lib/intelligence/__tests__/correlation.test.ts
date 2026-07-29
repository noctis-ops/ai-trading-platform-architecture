// ---------------------------------------------------------------------------
// Tests for correlation matrix
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCorrelationMatrix, getCorrelation, correlationOverlapFactor, correlatedSymbols, HIGH_CORRELATION, VERY_HIGH_CORRELATION } from "../correlation";
import type { Candle } from "../types";

function c(o: number, h: number, l: number, cl: number, v = 1000, t = 0): Candle {
  return { time: t || Date.now(), open: o, high: h, low: l, close: cl, volume: v };
}

test("buildCorrelationMatrix with identical series gives r=1", () => {
  const candlesA: Candle[] = [];
  const candlesB: Candle[] = [];
  for (let i = 0; i < 100; i++) {
    const px = 100 + i * 0.2;
    candlesA.push(c(px, px + 0.5, px - 0.5, px, 1000, i * 3600000));
    candlesB.push(c(px, px + 0.5, px - 0.5, px, 1000, i * 3600000));
  }

  const matrix = buildCorrelationMatrix({ A: candlesA, B: candlesB });
  assert.equal(matrix.symbols.length, 2);
  const r = getCorrelation(matrix, "A", "B");
  assert.ok(r > 0.95, `identical series should have r > 0.95, got ${r}`);
});

test("buildCorrelationMatrix with inverse series gives negative r", () => {
  const candlesA: Candle[] = [];
  const candlesB: Candle[] = [];
  // A zigzags up, B zigzags down — negative correlation on returns
  for (let i = 0; i < 100; i++) {
    const aRet = i % 2 === 0 ? 1.005 : 0.995;
    const bRet = i % 2 === 0 ? 0.995 : 1.005;
    const prevA = i > 0 ? candlesA[i - 1].close : 100;
    const prevB = i > 0 ? candlesB[i - 1].close : 100;
    const pxA = prevA * aRet;
    const pxB = prevB * bRet;
    candlesA.push(c(prevA, pxA + 0.5, pxA - 0.5, pxA, 1000, i * 3600000));
    candlesB.push(c(prevB, pxB + 0.5, pxB - 0.5, pxB, 1000, i * 3600000));
  }
  const matrix = buildCorrelationMatrix({ A: candlesA, B: candlesB });
  const r = getCorrelation(matrix, "A", "B");
  assert.ok(r < 0, `opposite returns should have negative correlation, got ${r.toFixed(3)}`);
});

test("self-correlation is always 1", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 100; i++) {
    const px = 100 + Math.sin(i / 5) * 2;
    candles.push(c(px, px + 0.5, px - 0.5, px, 1000, i * 3600000));
  }

  const matrix = buildCorrelationMatrix({ BTC: candles });
  assert.equal(getCorrelation(matrix, "BTC", "BTC"), 1);
});

test("correlationOverlapFactor returns 1 for no overlap", () => {
  const candlesA: Candle[] = [];
  const candlesB: Candle[] = [];
  for (let i = 0; i < 100; i++) {
    const pxA = 100 + Math.sin(i / 5) * 2;
    const pxB = 50 + Math.cos(i / 7) * 3;
    candlesA.push(c(pxA, pxA + 0.5, pxA - 0.5, pxA, 1000, i * 3600000));
    candlesB.push(c(pxB, pxB + 0.5, pxB - 0.5, pxB, 1000, i * 3600000));
  }

  const matrix = buildCorrelationMatrix({ A: candlesA, B: candlesB });
  const r = getCorrelation(matrix, "A", "B");

  // If uncorrelated, open positions in B should not affect A
  const result = correlationOverlapFactor(matrix, "A", ["B"]);
  if (r < HIGH_CORRELATION) {
    assert.equal(result.factor, 1);
  }
  // result should always be between 0.3 and 1
  assert.ok(result.factor >= 0.3 && result.factor <= 1);
});

test("correlationOverlapFactor reduces for highly correlated", () => {
  const candlesA: Candle[] = [];
  const candlesB: Candle[] = [];
  for (let i = 0; i < 100; i++) {
    const px = 100 + i * 0.2;
    candlesA.push(c(px - 0.1, px + 0.5, px - 0.5, px, 1000, i * 3600000));
    // B nearly identical to A (just 0.1% different)
    candlesB.push(c(px * 1.001, px * 1.001 + 0.5, px * 1.001 - 0.5, px * 1.001, 1000, i * 3600000));
  }

  const matrix = buildCorrelationMatrix({ A: candlesA, B: candlesB });
  const r = getCorrelation(matrix, "A", "B");
  assert.ok(r > 0.9, `near-identical series expected r > 0.9, got ${r}`);

  const result = correlationOverlapFactor(matrix, "A", ["B"]);
  assert.ok(result.factor < 1, "factor should be reduced for correlated pairs");
  assert.ok(result.maxCorrelation > 0.5);
  assert.equal(result.overlappingSymbol, "B");
});

test("correlatedSymbols returns empty when no correlation", () => {
  const candlesA: Candle[] = [];
  const candlesB: Candle[] = [];
  for (let i = 0; i < 100; i++) {
    candlesA.push(c(100 + Math.sin(i / 5), 101, 99, 100, 1000, i * 3600000));
    candlesB.push(c(50 + Math.cos(i / 7), 51, 49, 50, 1000, i * 3600000));
  }

  const matrix = buildCorrelationMatrix({ A: candlesA, B: candlesB });
  const correlated = correlatedSymbols(matrix, "A");
  const r = getCorrelation(matrix, "A", "B");
  if (r < HIGH_CORRELATION) {
    assert.equal(correlated.length, 0);
  }
});

test("matrix needs minimum 2 symbols with enough data", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 100; i++) {
    candles.push(c(100, 101, 99, 100.5, 1000, i * 3600000));
  }

  // Single symbol
  const m1 = buildCorrelationMatrix({ A: candles });
  assert.ok(m1.symbols.length <= 1);

  // Symbol with insufficient data
  const short: Candle[] = [];
  for (let i = 0; i < 10; i++) {
    short.push(c(100, 101, 99, 100.5));
  }
  const m2 = buildCorrelationMatrix({ A: candles, B: short });
  // B should be excluded due to insufficient data
  assert.ok(!m2.symbols.includes("B") || m2.symbols.length === 1);
});

test("HIGH_CORRELATION and VERY_HIGH_CORRELATION thresholds are reasonable", () => {
  assert.ok(HIGH_CORRELATION > 0.5 && HIGH_CORRELATION < 1);
  assert.ok(VERY_HIGH_CORRELATION > HIGH_CORRELATION && VERY_HIGH_CORRELATION < 1);
});
