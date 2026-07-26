// ---------------------------------------------------------------------------
// Regression tests for the decision engine.
//
// These lock in the behaviours that define the product's character:
// it enters only on genuine confluence, it refuses chop, and it never
// publishes an unsafe trade plan.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";

import { decide, MAX_POSITION_PCT, MAX_STOP_ATR } from "../decision";
import { DEFAULT_BRAIN_CONFIG } from "../types";
import { breakdownSetup, breakoutSetup, chopMarket, deadMarket, extendedRun, mtf } from "./fixtures";

const cfg = DEFAULT_BRAIN_CONFIG;

test("enters long on an aligned multi-timeframe break of structure", () => {
  const d = decide("BTCUSDT", mtf(breakoutSetup()), cfg);
  assert.equal(d.verdict, "enter");
  assert.equal(d.direction, "long");
  assert.ok(d.plan, "a trade plan must be attached to an enter verdict");
  assert.ok(d.confidence >= cfg.minConfluence);
  assert.ok(d.supporting.length > 0, "an entry must be explainable");
});

test("enters short on the mirrored breakdown", () => {
  const d = decide("BTCUSDT", mtf(breakdownSetup()), cfg);
  assert.equal(d.direction, "short");
});

test("refuses to trade directionless chop", () => {
  const d = decide("BTCUSDT", mtf(chopMarket()), cfg);
  assert.notEqual(d.verdict, "enter");
  assert.equal(d.plan, null);
  assert.ok(d.blockedBy, "a refusal must name the gate that blocked it");
});

test("refuses a dead, untradeable market", () => {
  const d = decide("BTCUSDT", mtf(deadMarket()), cfg);
  assert.notEqual(d.verdict, "enter");
});

test("waits for a pullback instead of chasing an extended run", () => {
  const d = decide("BTCUSDT", mtf(extendedRun()), cfg);
  assert.equal(d.verdict, "wait");
  assert.equal(d.blockedBy, "WAIT_BETTER_PRICE");
});

test("refuses when timeframes disagree", () => {
  const d = decide("BTCUSDT", { "15m": breakoutSetup(), "1h": breakdownSetup(), "4h": breakoutSetup() }, cfg);
  assert.notEqual(d.verdict, "enter");
});

test("refuses when history is too short to be trusted", () => {
  const short = breakoutSetup().slice(-50);
  const d = decide("BTCUSDT", mtf(short), cfg);
  assert.equal(d.blockedBy, "REJECT_INSUFFICIENT_DATA");
});

test("trade plans are internally consistent and safely sized", () => {
  const d = decide("BTCUSDT", mtf(breakoutSetup()), cfg);
  const plan = d.plan!;
  assert.ok(plan.stopLoss < plan.entry, "long stop must sit below entry");
  assert.ok(plan.takeProfit1 > plan.entry && plan.takeProfit2 > plan.takeProfit1);

  const risk = plan.entry - plan.stopLoss;
  assert.ok(risk <= plan.atr * MAX_STOP_ATR, "stop must respect the ATR ceiling");
  // TP1 must actually pay the advertised multiple.
  assert.ok(Math.abs((plan.takeProfit1 - plan.entry) / risk - plan.riskReward1) < 1e-6);

  assert.ok(plan.positionSizePct <= MAX_POSITION_PCT, "exposure must be capped");
  assert.ok(plan.riskPerTradePct <= cfg.maxRiskPct, "risk budget must be capped");
  assert.ok(plan.positionSizePct > 0);
});

test("external context can veto an otherwise valid setup", () => {
  const candles = mtf(breakoutSetup());
  assert.equal(decide("BTCUSDT", candles, cfg).verdict, "enter");

  assert.equal(decide("BTCUSDT", candles, cfg, { newsBlackout: true }).blockedBy, "REJECT_NEWS_WINDOW");
  assert.equal(decide("BTCUSDT", candles, cfg, { hasOpenSignal: true }).blockedBy, "REJECT_EXPOSURE_LIMIT");
  assert.equal(
    decide("BTCUSDT", candles, cfg, { signalsToday: 6, maxSignalsPerDay: 6 }).blockedBy,
    "REJECT_DAILY_LIMIT",
  );
  assert.equal(
    decide("BTCUSDT", candles, cfg, { minutesSinceLastSignal: 10, cooldownMinutes: 240 }).blockedBy,
    "REJECT_COOLDOWN",
  );
});

test("calibration multiplier can suppress a marginal signal", () => {
  const candles = mtf(breakoutSetup());
  const harsh = decide("BTCUSDT", candles, cfg, { calibration: 0.7 });
  const normal = decide("BTCUSDT", candles, cfg);
  assert.ok(harsh.probability < normal.probability, "a losing streak must lower confidence");
});

test("reasons are deduplicated across timeframes", () => {
  const d = decide("BTCUSDT", mtf(breakoutSetup()), cfg);
  const codes = d.supporting.map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length, "the same reason must not repeat");
});
