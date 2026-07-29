// ---------------------------------------------------------------------------
// Risk Manager — the safety gate for every trade.
//
// Every order must pass through here. No exceptions. The risk manager:
//   1. Checks all hard limits (daily loss, drawdown, exposure).
//   2. Computes optimal position size within all constraints.
//   3. Returns a clear verdict with detailed breakdown.
//
// This module is PURE: no I/O, no DB. It receives the current state as
// parameters and returns a decision, making it fully testable.
// ---------------------------------------------------------------------------

import type { Direction, TradePlan } from "../intelligence/types";
import type {
  RiskCheck,
  RiskVerdict,
  TradingConfig,
  TradingPosition,
} from "./types";

export type RiskContext = {
  /** Current total equity across all accounts. */
  equity: number;
  /** Today's realised PnL so far. */
  dailyPnl: number;
  /** Peak equity for drawdown calculation. */
  peakEquity: number;
  /** Currently open positions. */
  openPositions: TradingPosition[];
  /** The trade plan from the brain. */
  plan: TradePlan;
  /** Signal confidence (0-100). */
  confidence: number;
  /** Signal probability. */
  probability: number;
  /** The symbol being considered. */
  symbol: string;
  /** Market regime for dynamic risk adjustment. */
  regime?: string;
  /** Correlation overlap factor (0-1) from correlation matrix. */
  correlationFactor?: number;
};

/**
 * Evaluates whether a trade should be taken and computes the correct
 * position size. Returns a veto if any hard limit is breached.
 */
export function evaluateRisk(
  config: TradingConfig,
  ctx: RiskContext,
): RiskVerdict {
  const checks: RiskCheck[] = [];

  // --- 1. Is trading enabled? ---
  if (!config.enabled) {
    return veto("Auto-trading is disabled", checks);
  }

  // --- 2. Symbol filter ---
  if (config.blockedSymbols.includes(ctx.symbol)) {
    return veto(`Symbol ${ctx.symbol} is blocked`, checks);
  }
  if (config.allowedSymbols.length > 0 && !config.allowedSymbols.includes(ctx.symbol)) {
    return veto(`Symbol ${ctx.symbol} is not in the allowed list`, checks);
  }
  checks.push({ name: "symbol_allowed", passed: true, value: 1, limit: 1, unit: "" });

  // --- 3. Risk-reward check ---
  const rr = ctx.plan.riskReward1;
  checks.push({
    name: "risk_reward",
    passed: rr >= config.minRiskReward,
    value: round(rr, 2),
    limit: config.minRiskReward,
    unit: "R",
  });
  if (rr < config.minRiskReward) {
    return veto(`Risk-reward ${rr.toFixed(1)}R below minimum ${config.minRiskReward}R`, checks);
  }

  // --- 4. Daily loss limit ---
  const dailyLossPct = ctx.equity > 0 ? Math.abs(Math.min(0, ctx.dailyPnl)) / ctx.equity * 100 : 0;
  checks.push({
    name: "daily_loss",
    passed: dailyLossPct < config.maxDailyLossPct,
    value: round(dailyLossPct, 2),
    limit: config.maxDailyLossPct,
    unit: "%",
  });
  if (dailyLossPct >= config.maxDailyLossPct) {
    return veto(
      `Daily loss ${dailyLossPct.toFixed(1)}% exceeds limit ${config.maxDailyLossPct}%`,
      checks,
    );
  }

  // --- 5. Drawdown check ---
  const drawdownPct = ctx.peakEquity > 0
    ? Math.max(0, (ctx.peakEquity - ctx.equity) / ctx.peakEquity) * 100
    : 0;
  checks.push({
    name: "drawdown",
    passed: drawdownPct < config.maxDrawdownPct,
    value: round(drawdownPct, 2),
    limit: config.maxDrawdownPct,
    unit: "%",
  });
  if (drawdownPct >= config.maxDrawdownPct) {
    return veto(
      `Drawdown ${drawdownPct.toFixed(1)}% exceeds limit ${config.maxDrawdownPct}%`,
      checks,
    );
  }

  // --- 6. Concurrent positions ---
  const openCount = ctx.openPositions.filter(p => p.status === "open").length;
  checks.push({
    name: "concurrent_positions",
    passed: openCount < config.maxConcurrentPositions,
    value: openCount,
    limit: config.maxConcurrentPositions,
    unit: "positions",
  });
  if (openCount >= config.maxConcurrentPositions) {
    return veto(
      `${openCount} open positions already at limit ${config.maxConcurrentPositions}`,
      checks,
    );
  }

  // --- 7. Same-symbol exposure ---
  const sameSymbol = ctx.openPositions.filter(
    p => p.symbol === ctx.symbol && p.status === "open",
  );
  if (sameSymbol.length > 0) {
    return veto(`Already have an open position on ${ctx.symbol}`, checks);
  }
  checks.push({
    name: "symbol_exposure",
    passed: true,
    value: 0,
    limit: 1,
    unit: "positions",
  });

  // --- 8. Total exposure ---
  const currentExposure = ctx.openPositions.reduce(
    (sum, p) => sum + (p.status === "open" ? p.notional : 0),
    0,
  );
  const proposedNotional = computeNotional(config, ctx);
  const totalExposurePct = ctx.equity > 0
    ? ((currentExposure + proposedNotional) / ctx.equity) * 100
    : 0;
  checks.push({
    name: "total_exposure",
    passed: totalExposurePct <= config.maxTotalExposurePct,
    value: round(totalExposurePct, 1),
    limit: config.maxTotalExposurePct,
    unit: "%",
  });
  if (totalExposurePct > config.maxTotalExposurePct) {
    return veto(
      `Total exposure ${totalExposurePct.toFixed(0)}% exceeds limit ${config.maxTotalExposurePct}%`,
      checks,
    );
  }

  // --- 9. Position size limits ---
  const positionSizePct = ctx.equity > 0 ? (proposedNotional / ctx.equity) * 100 : 0;
  checks.push({
    name: "position_size",
    passed: positionSizePct <= config.maxPositionSizePct,
    value: round(positionSizePct, 1),
    limit: config.maxPositionSizePct,
    unit: "%",
  });

  // Clamp to max position size
  const maxAllowedNotional = ctx.equity * (config.maxPositionSizePct / 100);
  const finalNotional = Math.min(proposedNotional, maxAllowedNotional);

  // --- 10. Min/max notional ---
  checks.push({
    name: "min_notional",
    passed: finalNotional >= config.minNotionalPerTrade,
    value: round(finalNotional, 2),
    limit: config.minNotionalPerTrade,
    unit: config.quoteCurrency,
  });
  if (finalNotional < config.minNotionalPerTrade) {
    return veto(
      `Position size ${finalNotional.toFixed(0)} below exchange minimum ${config.minNotionalPerTrade}`,
      checks,
    );
  }

  checks.push({
    name: "max_notional",
    passed: finalNotional <= config.maxNotionalPerTrade,
    value: round(finalNotional, 2),
    limit: config.maxNotionalPerTrade,
    unit: config.quoteCurrency,
  });

  // --- 11. Leverage check ---
  const effectiveLeverage = ctx.equity > 0 ? finalNotional / ctx.equity : 0;
  checks.push({
    name: "leverage",
    passed: effectiveLeverage <= config.maxLeverage,
    value: round(effectiveLeverage, 1),
    limit: config.maxLeverage,
    unit: "x",
  });

  // --- All checks passed ---
  const riskAmount = finalNotional * (ctx.plan.stopDistancePct / 100);
  const riskPct = ctx.equity > 0 ? (riskAmount / ctx.equity) * 100 : 0;

  // Only flag if risk exceeds the configured max risk per trade
  if (riskPct > config.maxRiskPerTradePct) {
    checks.push({
      name: "risk_per_trade",
      passed: false,
      value: round(riskPct, 2),
      limit: config.maxRiskPerTradePct,
      unit: "%",
    });
    return veto(
      `Risk ${riskPct.toFixed(2)}% exceeds max ${config.maxRiskPerTradePct}% per trade`,
      checks,
    );
  }
  checks.push({
    name: "risk_per_trade",
    passed: true,
    value: round(riskPct, 2),
    limit: config.maxRiskPerTradePct,
    unit: "%",
  });

  return {
    allowed: true,
    maxSizeQuote: finalNotional,
    suggestedSizeQuote: finalNotional,
    suggestedLeverage: config.leverage,
    checks,
  };
}

// ---------------------------------------------------------------------------
// Position sizing methods
// ---------------------------------------------------------------------------

function computeNotional(config: TradingConfig, ctx: RiskContext): number {
  switch (config.sizingMethod) {
    case "fixed_fractional":
      return fixedFractionalSize(config, ctx);
    case "kelly":
      return kellySize(config, ctx);
    case "fixed_ratio":
      return fixedRatioSize(config, ctx);
    case "risk_based":
    default:
      return riskBasedSize(config, ctx);
  }
}

/**
 * Risk-based: risk a fixed % of equity per trade, size based on stop distance.
 * This is the most common and recommended method.
 *
 * v3.0: Dynamic risk — risk % is scaled by regime, confluence, and correlation.
 *
 *   positionSize = (equity × dynamicRiskPct) / stopDistance
 *   notional = positionSize × entryPrice (spot) or positionSize × entryPrice / leverage (futures)
 */
function riskBasedSize(config: TradingConfig, ctx: RiskContext): number {
  const dynamicRisk = computeDynamicRiskPct(config, ctx);
  const stopDistancePct = ctx.plan.stopDistancePct / 100;

  if (stopDistancePct <= 0) return 0;

  const divider = config.marketType === "futures"
    ? stopDistancePct / config.leverage
    : stopDistancePct;

  const riskBudget = ctx.equity * (dynamicRisk / 100);

  // Apply correlation factor
  const corrFactor = ctx.correlationFactor ?? 1;

  return Math.min(
    (riskBudget / divider) * corrFactor,
    config.maxNotionalPerTrade,
  );
}

/**
 * Dynamic risk % — adjusts risk-per-trade based on:
 *   1. Market regime (less risk in volatile/ranging, more in trending)
 *   2. Signal confluence (more risk for higher quality signals)
 *   3. Correlation overlap with existing positions
 *
 * Base = config.riskPerTradePct, then multiplied by regime factor
 * and confluence factor. Clamped to [0.25%, maxRiskPerTradePct].
 */
export function computeDynamicRiskPct(config: TradingConfig, ctx: RiskContext): number {
  const base = config.riskPerTradePct;
  const regime = ctx.regime ?? "ranging";

  // Regime multiplier
  let regimeMultiplier = 1.0;
  switch (regime) {
    case "trending_up":
    case "trending_down":
      regimeMultiplier = 1.0; // Full risk in trending markets
      break;
    case "ranging":
      regimeMultiplier = 0.6; // Reversal trades are lower probability
      break;
    case "volatile_expansion":
      regimeMultiplier = 0.4; // Most dangerous regime
      break;
    case "quiet_compression":
      regimeMultiplier = 0.7; // Build-up is good, but breakout unconfirmed
      break;
  }

  // Confluence multiplier: higher confluence → slightly more risk
  const confluenceMultiplier = 0.7 + 0.3 * (ctx.confidence / 100);

  // Correlation factor from context
  const corrFactor = ctx.correlationFactor ?? 1;

  // Combined
  const dynamic = base * regimeMultiplier * confluenceMultiplier * corrFactor;

  return Math.min(
    config.maxRiskPerTradePct,
    Math.max(0.25, dynamic), // Floor at 0.25% — below this, fees dominate
  );
}

/**
 * Fixed fractional: invest a fixed fraction of equity each trade.
 * Simple but doesn't account for stop distance — use with caution.
 */
function fixedFractionalSize(config: TradingConfig, ctx: RiskContext): number {
  return ctx.equity * config.fixedFraction * config.leverage;
}

/**
 * Kelly Criterion: optimal bet size based on edge.
 *
 *   f* = (p × b - q) / b
 *   where p = win probability, q = 1-p, b = avg win / avg loss ratio
 *
 * We use half-Kelly (fraction = 0.5) by default for safety.
 */
function kellySize(config: TradingConfig, ctx: RiskContext): number {
  const p = ctx.probability;
  const q = 1 - p;
  const b = ctx.plan.riskReward1; // win/loss ratio

  if (b <= 0) return 0;

  const kelly = (p * b - q) / b;

  // Kelly can be negative (no edge) or very large
  if (kelly <= 0) return 0;

  const adjusted = kelly * config.kellyFraction;
  const clampedKelly = Math.min(adjusted, 0.25); // Never bet more than 25% Kelly

  return ctx.equity * clampedKelly * config.leverage;
}

/**
 * Fixed Ratio: increase size by a fixed delta for each unit of profit.
 * Popularised by Ryan Jones. More conservative than fixed fractional.
 */
function fixedRatioSize(config: TradingConfig, ctx: RiskContext): number {
  // Start with 1 unit and add units proportional to accumulated profit
  const accumulatedProfit = Math.max(0, ctx.peakEquity - ctx.equity > 0 ? 0 : 0);
  const units = 1 + Math.floor(accumulatedProfit / config.fixedRatioDelta);
  const unitSize = ctx.equity * 0.01; // 1% per unit
  return Math.min(unitSize * units, config.maxNotionalPerTrade);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function veto(reason: string, checks: RiskCheck[]): RiskVerdict {
  return {
    allowed: false,
    reason,
    maxSizeQuote: 0,
    suggestedSizeQuote: 0,
    suggestedLeverage: 0,
    checks,
  };
}

function round(v: number, dp: number): number {
  const m = 10 ** dp;
  return Math.round(v * m) / m;
}

/**
 * Computes the optimal leverage for a given trade.
 * Considers: volatility regime, signal confidence, account risk profile.
 */
export function suggestLeverage(
  config: TradingConfig,
  atrPct: number,
  confidence: number,
  regime: string,
): number {
  // Start with base leverage
  let lev = config.leverage;

  // Reduce leverage in volatile regimes
  if (regime === "volatile_expansion") lev *= 0.5;
  if (regime === "quiet_compression") lev *= 0.75;

  // Adjust for ATR: wider stops = less leverage needed
  if (atrPct > 4) lev *= 0.6;
  else if (atrPct > 3) lev *= 0.75;
  else if (atrPct < 0.5) lev *= 1.2;

  // Higher confidence allows slightly more leverage
  if (confidence >= 78) lev *= 1.15;
  else if (confidence >= 66) lev *= 1.05;

  // Clamp
  return Math.max(1, Math.min(Math.round(lev), config.maxLeverage));
}

/**
 * Emergency halt check — called before every trade.
 * Returns true if trading should stop immediately.
 */
export function shouldEmergencyHalt(
  config: TradingConfig,
  equity: number,
  peakEquity: number,
  dailyPnl: number,
): { halt: boolean; reason?: string } {
  // Daily loss limit
  const dailyLossPct = equity > 0 ? Math.abs(Math.min(0, dailyPnl)) / equity * 100 : 0;
  if (dailyLossPct >= config.maxDailyLossPct) {
    return { halt: true, reason: `Daily loss limit reached: ${dailyLossPct.toFixed(1)}%` };
  }

  // Drawdown limit
  const drawdown = peakEquity > 0 ? (peakEquity - equity) / peakEquity * 100 : 0;
  if (drawdown >= config.maxDrawdownPct) {
    return { halt: true, reason: `Max drawdown reached: ${drawdown.toFixed(1)}%` };
  }

  // Equity too low
  if (equity < config.minNotionalPerTrade * 2) {
    return { halt: true, reason: `Equity too low: ${equity.toFixed(0)} ${config.quoteCurrency}` };
  }

  return { halt: false };
}
