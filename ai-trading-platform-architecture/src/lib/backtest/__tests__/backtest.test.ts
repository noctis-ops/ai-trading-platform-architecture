// ---------------------------------------------------------------------------
// Backtesting engine tests.
//
// Lock in the behaviours that make a backtest HONEST:
//   - a bar touching both stop and target fills the STOP first (MASTER §2 م6);
//   - TP1 moves the stop to breakeven, so a later hit is a scratch, not a loss;
//   - every decision is recorded, rejections included (MASTER §2 م5 / §12);
//   - chop is refused, so selectivity stays low and the engine is not "always
//     in the market" — a bot that signals constantly is selling noise.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { test } from "node:test";

import { simulateTrade, runBacktest } from "../backtest";
import { computeMetrics, aggregateMetrics } from "../metrics";
import { buildWalkForward } from "../walkforward";
import type { Candle, TradePlan } from "@/lib/intelligence/types";
import { breakoutSetup, chopMarket, mtf } from "../../intelligence/__tests__/fixtures";

const HOUR = 3.6e6;

function plan(over: Partial<TradePlan> = {}): TradePlan {
  return {
    direction: "long",
    entry: 100,
    stopLoss: 98,
    takeProfit1: 104,
    takeProfit2: 107,
    riskReward1: 2,
    riskReward2: 3.5,
    stopDistancePct: 2,
    riskPerTradePct: 1,
    positionSizePct: 25,
    atr: 1,
    ...over,
  };
}

function bar(open: number, high: number, low: number, close: number, i: number): Candle {
  return { time: Date.now() + i * HOUR, open, high, low, close, volume: 1000 };
}

/** A breakout setup followed by a tail so the resulting trade has room to
 *  resolve. `up` lets the long trade run to TP2; `crash` stops it out. */
function breakoutWithTail(kind: "up" | "crash"): Candle[] {
  const base = breakoutSetup(400);
  const last = base[base.length - 1];
  const start = last.time;
  let p = last.close;
  const out: Candle[] = [...base];
  for (let i = 1; i <= 80; i++) {
    const drift = kind === "up" ? 1.004 : 0.985;
    const open = p;
    p = open * drift;
    out.push({
      time: start + i * HOUR,
      open,
      high: Math.max(open, p) * 1.004,
      low: Math.min(open, p) * 0.996,
      close: p,
      volume: 1500,
    });
  }
  return out;
}

test("conservative fill: a bar touching both stop and target takes the stop", () => {
  const candles = [bar(100, 100, 100, 100, 0), bar(100, 108, 97, 100, 1)];
  const t = simulateTrade(plan(), "long", candles, 1, "TEST");
  assert.equal(t.outcome, "stop");
  assert.ok(t.rMultiple < 0, "must be a losing trade");
  assert.ok(Math.abs(t.rMultiple + 1) < 1e-9, `expected -1R, got ${t.rMultiple}`);
});

test("TP2 reached without touching the stop yields +riskReward2", () => {
  const candles = [bar(100, 100, 100, 100, 0), bar(100, 108, 99, 105, 1)];
  const t = simulateTrade(plan(), "long", candles, 1, "TEST");
  assert.equal(t.outcome, "tp2");
  assert.ok(Math.abs(t.rMultiple - 3.5) < 1e-9, `expected 3.5R, got ${t.rMultiple}`);
});

test("TP1 then a hit at breakeven is a scratch (0R), not a loss", () => {
  const candles = [
    bar(100, 100, 100, 100, 0),
    bar(100, 105, 99, 104, 1), // TP1 (104) hit -> stop moves to breakeven (100)
    bar(104, 105, 99, 101, 2), // dips to 99, below breakeven 100 -> scratch
  ];
  const t = simulateTrade(plan(), "long", candles, 1, "TEST");
  assert.equal(t.outcome, "breakeven");
  assert.ok(Math.abs(t.rMultiple) < 1e-9, `expected 0R, got ${t.rMultiple}`);
});

test("short trade mirrors the long conservative fill", () => {
  const shortPlan = plan({ direction: "short", entry: 100, stopLoss: 102, takeProfit1: 96, takeProfit2: 93 });
  const candles = [bar(100, 100, 100, 100, 0), bar(100, 103, 92, 100, 1)];
  const t = simulateTrade(shortPlan, "short", candles, 1, "TEST");
  assert.ok(t.rMultiple < 0, "short should stop out");
  assert.ok(Math.abs(t.rMultiple + 1) < 1e-9, `expected -1R, got ${t.rMultiple}`);
});

test("runBacktest records every decision and yields bounded metrics on a trend", () => {
  const result = runBacktest(mtf(breakoutWithTail("up")), { symbol: "TEST" });
  assert.ok(result.totalDecisions > 0);
  assert.equal(result.decisions.length, result.totalDecisions);
  assert.ok(result.decisions.every((d) => ["enter", "wait", "reject"].includes(d.verdict)));
  const m = computeMetrics(result);
  assert.ok(m.winRate >= 0 && m.winRate <= 1, "win rate must be a fraction");
  assert.ok(m.maxDrawdownPct >= 0, "drawdown cannot be negative");
  assert.ok(Number.isFinite(m.expectancyR), "expectancy must be finite");
  assert.ok(m.trades >= 1, "a clear uptrend should produce at least one trade");
});

test("chop is mostly rejected — selectivity stays low and all decisions recorded", () => {
  const m = computeMetrics(runBacktest(mtf(chopMarket(400)), { symbol: "CHOP" }));
  assert.ok(m.selectivity < 0.2, `brain should refuse chop, got selectivity ${m.selectivity}`);
  assert.ok(m.totalDecisions > 0);
});

test("buildWalkForward yields out-of-sample folds that retain warm-up", () => {
  const candles = mtf(breakoutWithTail("up"));
  const folds = buildWalkForward(candles, "15m", { trainBars: 200, testBars: 100 });
  assert.ok(folds.length >= 1, "expected at least one fold");
  for (const f of folds) {
    const r = runBacktest(f.candles, { symbol: "WF", startIndex: f.startIndex });
    assert.ok(r.totalDecisions > 0, "fold must evaluate decisions");
  }
});

test("aggregateMetrics sums raw counts across symbols", () => {
  const a = runBacktest(mtf(breakoutWithTail("up")), { symbol: "A" });
  const b = runBacktest(mtf(chopMarket(400)), { symbol: "B" });
  const agg = aggregateMetrics([a, b]);
  assert.equal(agg.totalDecisions, a.totalDecisions + b.totalDecisions);
  assert.equal(agg.trades, a.trades.length + b.trades.length);
  assert.equal(agg.entries, a.entries + b.entries);
});
