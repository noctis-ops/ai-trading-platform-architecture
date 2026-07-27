// ---------------------------------------------------------------------------
// Backtesting — shared types.
//
// The backtester replays the EXACT `decide()` path the live bot uses, so any
// number it prints is a genuine property of the shipped brain, not a parallel
// research implementation that can silently drift. Everything here is pure:
// (candles + config) => result, with no I/O, no database, no Telegram, and no
// Arabic — matching the intelligence core it wraps.
//
// Honesty constraints baked into the design (see MASTER.md §2 م5/م6 and §12):
//   - EVERY decision is recorded, including rejections ("all decisions").
//   - A bar that touches both stop and target fills the STOP first.
//   - Rejections count toward selectivity; they are never dropped.
// ---------------------------------------------------------------------------
import type { Candle } from "@/lib/indicators";
import type { BrainConfig, DecisionVerdict, Direction, ReasonCode, Timeframe } from "@/lib/intelligence/types";

export type CandlesByTimeframe = Partial<Record<Timeframe, Candle[]>>;

/** Lightweight, decision-only record. We do NOT keep the full `Decision` (it
 *  embeds every timeframe analysis) — thousands of bars would bloat memory and
 *  the metrics only need the verdict, the blocking gate, and the confidence. */
export type BacktestDecision = {
  /** Fast-timeframe bar index at which the decision was made. */
  index: number;
  time: number;
  verdict: DecisionVerdict;
  blockedBy: ReasonCode | null;
  confidence: number;
};

export type BacktestTrade = {
  symbol: string;
  direction: Direction;
  /** Fast-timeframe bar index of the signal that opened the trade. */
  entryIndex: number;
  entryTime: number;
  /** Actual fill price — the OPEN of the bar AFTER the signal (no look-ahead). */
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  /** Fast-timeframe bar index where the trade was closed. */
  exitIndex: number;
  exitTime: number;
  exitPrice: number;
  /**
   * Final R-multiple on the FULL position, mirroring the live
   * `SignalEngine.evaluateSignal` management exactly:
   *   - stop before TP1            => -1
   *   - TP1 then stop at breakeven =>  0 (scratch, not a loss)
   *   - TP2 reached                => +riskReward2 (≈ 3.5)
   *   - closed at last bar         => realised R at that close
   */
  rMultiple: number;
  outcome: "tp2" | "stop" | "breakeven";
  status: "tp2_hit" | "stopped" | "breakeven";
  /** From the plan — used to size the equity impact honestly. */
  positionSizePct: number;
  stopDistancePct: number;
};

export type BacktestConfig = {
  /** Symbol under test (labels only; does not change the brain). */
  symbol: string;
  /** Brain config to replay. Defaults to the calibrated DEFAULT_BRAIN_CONFIG. */
  brain?: BrainConfig;
  /** Decision cadence in fast-timeframe bars (1 = every bar). Default 1. */
  step?: number;
  /**
   * First fast index to evaluate. Warm-up history is supplied by the candle
   * arrays themselves (they extend back to the beginning), so this only
   * selects WHERE trading may begin — used by walk-forward to restrict each
   * fold to its out-of-sample window.
   */
  startIndex?: number;
  /**
   * Allow a new trade to open while one is already open (research only). The
   * default `false` matches production, where `REJECT_EXPOSURE_LIMIT` blocks
   * a second entry on the same symbol.
   */
  allowOverlap?: boolean;
};

export type BacktestResult = {
  symbol: string;
  decisions: BacktestDecision[];
  trades: BacktestTrade[];
  /** Count of `enter` verdicts (== trades.length in non-overlap mode). */
  entries: number;
  /** Total decisions evaluated, including every rejection. */
  totalDecisions: number;
};

export type BacktestMetrics = {
  totalDecisions: number;
  entries: number;
  trades: number;
  /** entries / totalDecisions — how selective the brain is (low is healthy). */
  selectivity: number;
  /** Fraction of closed trades with rMultiple > 0. */
  winRate: number;
  /** Fraction of closed trades that scratched at breakeven (rMultiple == 0). */
  scratchRate: number;
  /** Fraction of closed trades that lost (rMultiple < 0). */
  lossRate: number;
  /** Mean R per closed trade. */
  expectancyR: number;
  /** Mean equity impact per closed trade, in percent. */
  expectancyPct: number;
  /** Gross profit R / gross loss R (Infinity if no losses). */
  profitFactor: number;
  /** Worst peak-to-trough equity decline, in percent. */
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  /** Average holding period in fast-timeframe bars. */
  avgHoldBars: number;
  /** Equity after all trades, starting from 100. */
  finalEquity: number;
};
