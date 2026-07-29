// ---------------------------------------------------------------------------
// Central Signal Filter — v3.1
//
// Multi-layer position sizing adjustment. Every signal from every strategy
// passes through this filter before execution. The filter does NOT veto —
// it only ADJUSTS the position size based on cross-cutting concerns.
//
// Layers (in order):
//   1. Strategy quality → base size multiplier
//   2. Market regime → multiplier per regime
//   3. Trend strength → more size in strong trends, less in weak
//   4. Correlation → reduce if correlated positions open
//   5. Time-of-day / day-of-week → reduce during low-liquidity periods
//   6. Consecutive wins/losses → reduce after streak (anti-martingale)
//   7. Volatility regime → adjust for current vol vs historical
// ---------------------------------------------------------------------------

import type { Direction, MarketRegime } from "../intelligence/types";

export type FilterContext = {
  /** Which strategy generated this signal. */
  strategy: "trend" | "reversal" | "breakout";
  /** Current market regime. */
  regime: MarketRegime;
  /** Signal confluence score (0-100). */
  confluence: number;
  /** Signal direction. */
  direction: Direction;
  /** Current ATR as % of price. */
  atrPct: number;
  /** Historical median ATR% for this symbol. */
  historicalAtrPct: number;
  /** Correlation factor from correlation matrix (0-1). */
  correlationFactor: number;
  /** Number of consecutive wins (reset on loss). */
  consecutiveWins: number;
  /** Number of consecutive losses. */
  consecutiveLosses: number;
  /** Number of open positions. */
  openPositions: number;
  /** Whether it's a high-liquidity period. */
  isHighLiquidityPeriod: boolean;
};

export type FilterResult = {
  /** Final position size multiplier (1 = no change, 0.3 = 30% of base). */
  multiplier: number;
  /** Breakdown per layer for debugging. */
  layers: { name: string; multiplier: number; reason: string }[];
};

/**
 * Applies all filter layers and returns the final position size multiplier.
 */
export function applySignalFilter(ctx: FilterContext): FilterResult {
  const layers: { name: string; multiplier: number; reason: string }[] = [];
  let m = 1.0;

  // --- Layer 1: Strategy quality ---
  let strategyM = 1.0;
  let strategyReason = "";
  switch (ctx.strategy) {
    case "trend":
      if (ctx.confluence >= 70) { strategyM = 1.0; strategyReason = "Strong trend confluence"; }
      else if (ctx.confluence >= 60) { strategyM = 0.85; strategyReason = "Moderate trend confluence"; }
      else { strategyM = 0.6; strategyReason = "Weak trend confluence — reduced size"; }
      break;
    case "reversal":
      strategyM = 0.7; strategyReason = "Reversal trades are lower probability";
      if (ctx.confluence >= 65) { strategyM = 0.85; strategyReason = "Strong reversal confluence"; }
      break;
    case "breakout":
      strategyM = 0.65; strategyReason = "Breakouts have high false rate";
      if (ctx.confluence >= 70) { strategyM = 0.85; strategyReason = "High-conviction breakout"; }
      break;
  }
  m *= strategyM;
  layers.push({ name: "strategy_quality", multiplier: strategyM, reason: strategyReason });

  // --- Layer 2: Market regime ---
  let regimeM = 1.0;
  let regimeReason = "";
  switch (ctx.regime) {
    case "trending_up":
    case "trending_down":
      regimeM = 1.0;
      regimeReason = "Trending — full size";
      break;
    case "ranging":
      regimeM = ctx.strategy === "reversal" ? 1.0 : 0.6;
      regimeReason = ctx.strategy === "reversal" ? "Ranging — reversal is primary" : "Ranging — trend trades reduced";
      break;
    case "volatile_expansion":
      regimeM = 0.4;
      regimeReason = "Volatile — reduced across all strategies";
      break;
    case "quiet_compression":
      regimeM = ctx.strategy === "breakout" ? 1.0 : 0.7;
      regimeReason = ctx.strategy === "breakout" ? "Compression — breakout is primary" : "Compression — awaiting breakout";
      break;
  }
  m *= regimeM;
  layers.push({ name: "market_regime", multiplier: regimeM, reason: regimeReason });

  // --- Layer 3: Correlation overlap ---
  if (ctx.correlationFactor < 1) {
    m *= ctx.correlationFactor;
    layers.push({ name: "correlation", multiplier: ctx.correlationFactor, reason: "Reduced for correlated open positions" });
  } else {
    layers.push({ name: "correlation", multiplier: 1.0, reason: "No correlation overlap" });
  }

  // --- Layer 4: Streak management (anti-martingale) ---
  let streakM = 1.0;
  let streakReason = "";
  if (ctx.consecutiveLosses >= 3) {
    streakM = 0.5;
    streakReason = `${ctx.consecutiveLosses} consecutive losses — halving size`;
  } else if (ctx.consecutiveLosses >= 2) {
    streakM = 0.7;
    streakReason = `${ctx.consecutiveLosses} consecutive losses — reducing size`;
  } else if (ctx.consecutiveWins >= 5) {
    streakM = 0.8;
    streakReason = `${ctx.consecutiveWins} consecutive wins — mean reversion guard`;
  }
  m *= streakM;
  layers.push({ name: "streak_mgmt", multiplier: streakM, reason: streakReason || "Normal" });

  // --- Layer 5: Position count scaling ---
  let posM = 1.0;
  if (ctx.openPositions >= 4) { posM = 0.3; }
  else if (ctx.openPositions >= 3) { posM = 0.5; }
  else if (ctx.openPositions >= 2) { posM = 0.75; }
  m *= posM;
  layers.push({ name: "position_count", multiplier: posM, reason: posM < 1 ? `${ctx.openPositions} positions open — scaling down` : "Room for more" });

  // --- Layer 6: Volatility adjustment ---
  let volM = 1.0;
  const volRatio = ctx.historicalAtrPct > 0 ? ctx.atrPct / ctx.historicalAtrPct : 1;
  if (volRatio > 2.0) { volM = 0.4; layers.push({ name: "volatility", multiplier: volM, reason: "Vol 2x+ above normal — heavy reduction" }); }
  else if (volRatio > 1.5) { volM = 0.6; layers.push({ name: "volatility", multiplier: volM, reason: "Vol 1.5x above normal — moderate reduction" }); }
  else if (volRatio < 0.5) { volM = 0.7; layers.push({ name: "volatility", multiplier: volM, reason: "Vol below normal — reduced (less opportunity)" }); }
  else { layers.push({ name: "volatility", multiplier: 1.0, reason: "Vol normal" }); }
  m *= volM;

  // --- Layer 7: Liquidity period ---
  if (!ctx.isHighLiquidityPeriod) {
    m *= 0.7;
    layers.push({ name: "liquidity_period", multiplier: 0.7, reason: "Low liquidity period — reduced" });
  } else {
    layers.push({ name: "liquidity_period", multiplier: 1.0, reason: "High liquidity period" });
  }

  // Floor: never go below 20% of base
  m = Math.max(0.2, Math.round(m * 100) / 100);

  return { multiplier: m, layers };
}

/**
 * Determines if the current time is a high-liquidity period.
 * Crypto markets have clear liquidity patterns:
 *   - London open (08:00 UTC): high
 *   - NY open (13:30 UTC): high
 *   - Asian session (00:00-08:00 UTC): moderate
 *   - Weekend: low
 *   - NY close to Asian open (21:00-00:00 UTC): lowest
 */
export function isHighLiquidityPeriod(now: Date = new Date()): boolean {
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  // Weekend = low liquidity
  if (day === 0 || day === 6) return false;

  // NY/Europe overlap (13:00-17:00 UTC) = highest
  if (hour >= 13 && hour <= 17) return true;

  // London open (08:00-12:00 UTC) = high
  if (hour >= 8 && hour <= 12) return true;

  // Asian session (00:00-07:00 UTC) = moderate → treat as high for filter
  if (hour >= 0 && hour <= 7) return true;

  // NY close transition (21:00-23:59 UTC) = low
  return false;
}
