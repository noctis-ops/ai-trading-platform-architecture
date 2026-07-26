// ---------------------------------------------------------------------------
// Backtesting Engine
//
// Simulates a strategy over historical (synthetic) candles with realistic
// frictions (taker fees + slippage) and produces the metrics required for
// objective validation before any strategy is allowed into paper/live
// trading (see /docs/ARCHITECTURE.md "Continuous Validation").
// ---------------------------------------------------------------------------
import type { Candle } from "@/lib/indicators";
import { maxDrawdown, sharpeRatio } from "@/lib/indicators";
import { getStrategyDefinition, type StrategyParams } from "@/lib/strategies";
import { TIMEFRAME_MINUTES, type Timeframe } from "@/lib/market/symbols";

const TAKER_FEE_RATE = 0.0004; // 4 bps, typical perpetual futures taker fee
const SLIPPAGE_RATE = 0.0002; // 2 bps modeled slippage

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  fees: number;
};

export type BacktestMetrics = {
  finalEquity: number;
  totalReturnPct: number;
  cagr: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTradePnlPct: number;
  bestTradePct: number;
  worstTradePct: number;
};

export type BacktestResult = {
  equityCurve: { time: number; equity: number }[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
};

export function runBacktest(opts: {
  candles: Candle[];
  strategyType: string;
  params: StrategyParams;
  initialBalance: number;
  leverage: number;
  timeframe: Timeframe;
}): BacktestResult {
  const { candles, strategyType, params, initialBalance, leverage, timeframe } = opts;
  const definition = getStrategyDefinition(strategyType);
  const signals = definition.computeSignals(candles, params);

  let equity = initialBalance;
  const equityCurve: { time: number; equity: number }[] = [];
  const trades: BacktestTrade[] = [];
  const periodicReturns: number[] = [];

  type PositionState = { side: "long" | "short"; entryPrice: number; entryTime: number; quantity: number };
  // Using a holder object (instead of a reassigned `let`) sidesteps a
  // TypeScript control-flow-analysis limitation: CFA does not track
  // reassignments performed inside nested closures, which would otherwise
  // cause the narrowed type to collapse to `never`.
  const holder: { current: PositionState | null } = { current: null };

  const openPosition = (side: "long" | "short", price: number, time: number) => {
    const execPrice = side === "long" ? price * (1 + SLIPPAGE_RATE) : price * (1 - SLIPPAGE_RATE);
    const notional = equity * leverage;
    const quantity = notional / execPrice;
    equity -= notional * TAKER_FEE_RATE;
    holder.current = { side, entryPrice: execPrice, entryTime: time, quantity };
  };

  const closePosition = (price: number, time: number) => {
    const pos = holder.current;
    if (!pos) return;
    const execPrice = pos.side === "long" ? price * (1 - SLIPPAGE_RATE) : price * (1 + SLIPPAGE_RATE);
    const priceDelta = pos.side === "long" ? execPrice - pos.entryPrice : pos.entryPrice - execPrice;
    const grossPnl = priceDelta * pos.quantity;
    const fee = pos.quantity * execPrice * TAKER_FEE_RATE;
    const netPnl = grossPnl - fee;
    const equityBefore = equity;
    equity += netPnl;

    trades.push({
      entryTime: pos.entryTime,
      exitTime: time,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice: execPrice,
      quantity: pos.quantity,
      pnl: netPnl,
      pnlPct: equityBefore > 0 ? (netPnl / equityBefore) * 100 : 0,
      fees: fee,
    });
    periodicReturns.push(equityBefore > 0 ? netPnl / equityBefore : 0);
    holder.current = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const signal = signals[i];
    const price = candles[i].close;

    const active = holder.current;
    if (active && active.side === "long" && signal !== "long") closePosition(price, candles[i].time);
    else if (active && active.side === "short" && signal !== "short") closePosition(price, candles[i].time);

    if (!holder.current && signal === "long") openPosition("long", price, candles[i].time);
    else if (!holder.current && signal === "short") openPosition("short", price, candles[i].time);

    // Mark-to-market equity for the curve (unrealized pnl included).
    let markEquity = equity;
    const openPos = holder.current;
    if (openPos) {
      const unrealized =
        openPos.side === "long" ? (price - openPos.entryPrice) * openPos.quantity : (openPos.entryPrice - price) * openPos.quantity;
      markEquity = equity + unrealized;
    }
    equityCurve.push({ time: candles[i].time, equity: markEquity });
  }

  if (holder.current) {
    closePosition(candles[candles.length - 1].close, candles[candles.length - 1].time);
    equityCurve[equityCurve.length - 1] = { time: candles[candles.length - 1].time, equity };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

  const minutes = TIMEFRAME_MINUTES[timeframe];
  const barsPerYear = (365 * 24 * 60) / minutes;
  const totalDays = (candles[candles.length - 1].time - candles[0].time) / (1000 * 60 * 60 * 24);
  const totalReturnPct = ((equity - initialBalance) / initialBalance) * 100;
  const cagr = totalDays > 0 ? (Math.pow(equity / initialBalance, 365 / totalDays) - 1) * 100 : 0;

  const metrics: BacktestMetrics = {
    finalEquity: equity,
    totalReturnPct,
    cagr,
    maxDrawdownPct: maxDrawdown(equityCurve.map((p) => p.equity)) * 100,
    sharpeRatio: sharpeRatio(periodicReturns, barsPerYear),
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    totalTrades: trades.length,
    avgTradePnlPct: trades.length > 0 ? trades.reduce((a, t) => a + t.pnlPct, 0) / trades.length : 0,
    bestTradePct: trades.length > 0 ? Math.max(...trades.map((t) => t.pnlPct)) : 0,
    worstTradePct: trades.length > 0 ? Math.min(...trades.map((t) => t.pnlPct)) : 0,
  };

  return { equityCurve, trades, metrics };
}
