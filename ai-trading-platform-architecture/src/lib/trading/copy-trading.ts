// ---------------------------------------------------------------------------
// Copy Trading System (v3.2)
// ---------------------------------------------------------------------------

import type { Direction, TradePlan } from "../intelligence/types";
import type { TradingConfig } from "../trading/types";
import { computeDynamicRiskPct } from "../trading/risk-manager";

export type CopyTier = "basic" | "pro" | "vip";

export type CopyTrader = {
  id: string; customerId: string; tradingAccountId: string;
  tier: CopyTier; copyRatio: number; active: boolean;
  maxNotional: number; minConfidence: number;
  strategies: ("trend" | "reversal" | "breakout")[];
};

export type CopyTradeSignal = {
  masterPositionId: string; symbol: string; direction: Direction;
  plan: TradePlan; strategy: "trend" | "reversal" | "breakout";
  confidence: number; masterEntryPrice: number; masterNotional: number;
};

export type CopyTradeResult = {
  traderId: string; customerId: string; executed: boolean;
  positionId?: string; notional?: number; ratio?: number; reason?: string;
};

export function computeCopySize(
  trader: CopyTrader, signal: CopyTradeSignal,
  traderEquity: number, traderConfig: TradingConfig,
): { notional: number; riskPct: number } {
  const tierRatio = signal.confidence >= 70 ? 1.0 : signal.confidence >= 52 ? trader.copyRatio : trader.copyRatio * 0.7;
  const ratioBased = signal.masterNotional * tierRatio;
  const stopDist = signal.plan.stopDistancePct / 100;
  const dynamicRisk = computeDynamicRiskPct(traderConfig, {
    equity: traderEquity, dailyPnl: 0, peakEquity: traderEquity,
    openPositions: [], plan: signal.plan, confidence: signal.confidence,
    probability: 0.55, symbol: signal.symbol,
  });
  const riskBased = stopDist > 0 ? (traderEquity * (dynamicRisk / 100)) / stopDist : 0;
  const notional = Math.min(ratioBased, riskBased, trader.maxNotional, signal.masterNotional * 2);
  const riskPct = traderEquity > 0 ? (notional * stopDist / traderEquity) * 100 : 0;
  return { notional, riskPct };
}

export function eligibleCopyTraders(traders: CopyTrader[], signal: CopyTradeSignal): CopyTrader[] {
  return traders.filter(t => {
    if (!t.active) return false;
    if (signal.confidence < t.minConfidence) return false;
    if (t.strategies.length > 0 && !t.strategies.includes(signal.strategy)) return false;
    return true;
  });
}

export const COPY_RATIOS: Record<CopyTier, number> = { vip: 1.0, pro: 0.7, basic: 0.5 };
export const COPY_MAX_NOTIONAL: Record<CopyTier, number> = { vip: 50000, pro: 20000, basic: 5000 };
