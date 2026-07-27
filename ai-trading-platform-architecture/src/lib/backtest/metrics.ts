// ---------------------------------------------------------------------------
// Backtest performance metrics.
//
// Computed over EVERYTHING: rejections are counted in `totalDecisions` (so
// selectivity is honest) but, by definition, never become trades. Trade
// metrics are computed only over closed trades. Equity is impacted using the
// plan's own position sizing and stop distance, so the drawdown figure is a
// realistic fraction of capital, not an abstract R sum.
// ---------------------------------------------------------------------------
import { maxDrawdown } from "@/lib/indicators";
import type { BacktestMetrics, BacktestResult } from "./types";

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeMetrics(result: BacktestResult): BacktestMetrics {
  const trades = result.trades;
  const n = trades.length;

  let wins = 0;
  let scratches = 0;
  let losses = 0;
  let grossProfitR = 0;
  let grossLossR = 0;

  let equity = 100;
  const equityCurve = [100];

  for (const t of trades) {
    if (t.rMultiple > 0) {
      wins++;
      grossProfitR += t.rMultiple;
    } else if (t.rMultiple < 0) {
      losses++;
      grossLossR += -t.rMultiple;
    } else {
      scratches++;
    }

    // Honest equity impact: notional (% of equity) × stop distance (% of price)
    // × realised R. A 25% position with a 2% stop risks 0.5% of equity per R.
    const riskFraction = (t.positionSizePct / 100) * (t.stopDistancePct / 100);
    equity *= 1 + riskFraction * t.rMultiple;
    equityCurve.push(equity);
  }

  const expectancyR = mean(trades.map((t) => t.rMultiple));

  let expectancyPct = 0;
  if (n > 0) {
    let sumPct = 0;
    for (let k = 1; k < equityCurve.length; k++) {
      sumPct += (equityCurve[k] / equityCurve[k - 1] - 1) * 100;
    }
    expectancyPct = sumPct / n;
  }

  const profitFactor = grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR > 0 ? Infinity : 0;

  const maxDrawdownPct = maxDrawdown(equityCurve) * 100;

  let maxStreak = 0;
  let streak = 0;
  for (const t of trades) {
    if (t.rMultiple < 0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      // a win OR a scratch breaks a losing streak
      streak = 0;
    }
  }

  const avgHoldBars = n ? mean(trades.map((t) => t.exitIndex - t.entryIndex)) : 0;

  return {
    totalDecisions: result.totalDecisions,
    entries: result.entries,
    trades: n,
    selectivity: result.totalDecisions ? result.entries / result.totalDecisions : 0,
    winRate: n ? wins / n : 0,
    scratchRate: n ? scratches / n : 0,
    lossRate: n ? losses / n : 0,
    expectancyR,
    expectancyPct,
    profitFactor,
    maxDrawdownPct,
    maxConsecutiveLosses: maxStreak,
    avgHoldBars,
    finalEquity: equity,
  };
}

/** Aggregate metrics across several symbols / folds (trade-weighted where it
 *  matters, decision-weighted for selectivity). Keeps the "all decisions"
 *  denominator honest by summing raw counts before dividing. */
export function aggregateMetrics(results: BacktestResult[]): BacktestMetrics {
  const allTrades = results.flatMap((r) => r.trades);
  const combined: BacktestResult = {
    symbol: results.map((r) => r.symbol).join("+"),
    decisions: results.flatMap((r) => r.decisions),
    trades: allTrades,
    entries: results.reduce((s, r) => s + r.entries, 0),
    totalDecisions: results.reduce((s, r) => s + r.totalDecisions, 0),
  };
  return computeMetrics(combined);
}
