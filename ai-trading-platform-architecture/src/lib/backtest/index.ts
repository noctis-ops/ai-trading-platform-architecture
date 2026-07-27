// Backtesting harness — public surface.
export { runBacktest } from "./backtest";
export { computeMetrics, aggregateMetrics } from "./metrics";
export { buildWalkForward, type WalkForwardConfig, type WalkForwardFold } from "./walkforward";
export type {
  BacktestConfig,
  BacktestDecision,
  BacktestResult,
  BacktestMetrics,
  BacktestTrade,
  CandlesByTimeframe,
} from "./types";
