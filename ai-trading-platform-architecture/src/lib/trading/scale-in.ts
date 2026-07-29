// ---------------------------------------------------------------------------
// Scale-In Strategy — incremental position building (v3.1)
// ---------------------------------------------------------------------------
import type { Direction, TradePlan } from "../intelligence/types";

export type ScaleInPhase = "phase1" | "phase2" | "phase3";

export type ScaleInEntry = {
  phase: ScaleInPhase;
  allocation: number;
  status: "pending" | "active" | "filled" | "skipped";
  entryPrice: number | null;
  stopLoss: number;
  fillPrice: number | null;
  filledAt: number | null;
};

export type ScaleInPlan = {
  totalRiskPct: number;
  phases: ScaleInEntry[];
  currentPhase: ScaleInPhase;
  basePlan: TradePlan;
};

export function buildScaleInPlan(plan: TradePlan, direction: Direction): ScaleInPlan {
  const entry = plan.entry;
  const atr = plan.atr;

  return {
    totalRiskPct: plan.riskPerTradePct,
    phases: [
      { phase: "phase1", allocation: 0.50, status: "pending", entryPrice: entry, stopLoss: plan.stopLoss, fillPrice: null, filledAt: null },
      { phase: "phase2", allocation: 0.30, status: "pending", entryPrice: direction === "long" ? entry - atr * 0.8 : entry + atr * 0.8, stopLoss: plan.stopLoss, fillPrice: null, filledAt: null },
      { phase: "phase3", allocation: 0.20, status: "pending",
        entryPrice: direction === "long" ? entry + (plan.takeProfit1 - entry) * 0.3 : entry - (entry - plan.takeProfit1) * 0.3,
        stopLoss: direction === "long" ? entry + atr * 0.5 : entry - atr * 0.5, fillPrice: null, filledAt: null },
    ],
    currentPhase: "phase1",
    basePlan: plan,
  };
}

export function isPhase2Ready(currentPrice: number, direction: Direction, plan: ScaleInPlan): boolean {
  const p2 = plan.phases[1];
  if (!p2 || p2.status !== "pending" || p2.entryPrice === null) return false;
  const entry = plan.basePlan.entry;
  const atr = plan.basePlan.atr;
  if (direction === "long") {
    const pb = entry - currentPrice;
    return currentPrice < entry && pb >= atr * 0.3 && pb <= atr * 2;
  }
  const pb = currentPrice - entry;
  return currentPrice > entry && pb >= atr * 0.3 && pb <= atr * 2;
}

export function isPhase3Ready(currentPrice: number, direction: Direction, plan: ScaleInPlan): boolean {
  const p3 = plan.phases[2];
  if (!p3 || p3.status !== "pending") return false;
  const entry = plan.basePlan.entry;
  const tp1 = plan.basePlan.takeProfit1;
  if (direction === "long") return currentPrice > entry && currentPrice < tp1 * 0.95;
  return currentPrice < entry && currentPrice > tp1 * 1.05;
}

export function totalSizeFilled(plan: ScaleInPlan): number {
  return plan.phases.filter(p => p.status === "filled").reduce((s, p) => s + p.allocation, 0);
}

export function averageEntryPrice(plan: ScaleInPlan): number | null {
  const filled = plan.phases.filter(p => p.status === "filled" && p.fillPrice !== null);
  if (filled.length === 0) return null;
  const total = filled.reduce((s, p) => s + p.allocation, 0);
  if (total === 0) return null;
  return filled.reduce((sum, p) => sum + (p.fillPrice ?? 0) * p.allocation, 0) / total;
}
