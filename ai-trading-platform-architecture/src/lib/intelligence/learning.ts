// ---------------------------------------------------------------------------
// Learning Loop
//
// Turns closed signals into (a) a calibration multiplier that makes the brain
// more conservative where it has been over-confident, and (b) human-readable
// lessons surfaced in the owner console and monthly report.
//
// Discipline enforced here:
//   - Nothing adapts until there is a minimum sample size. Reacting to 5
//     trades is not learning, it is noise-chasing.
//   - Adjustments are bounded and shrunk toward neutral, so one bad week can
//     never collapse the engine's behaviour.
//   - We calibrate PROBABILITY, never the risk rules. Risk limits are policy,
//     not something the model gets to optimise away.
// ---------------------------------------------------------------------------
import type { MarketRegime, ReasonCode } from "./types";

export type OutcomeRecord = {
  signalId: string;
  symbol: string;
  regime: MarketRegime;
  predictedProbability: number;
  confidence: number;
  won: boolean;
  rMultiple: number;
  reasonCodes: ReasonCode[];
  durationMinutes: number;
  mfeR?: number;
  maeR?: number;
};

export const MIN_SAMPLE = 25;
export const MULTIPLIER_FLOOR = 0.7;
export const MULTIPLIER_CEILING = 1.15;

export type CalibrationResult = {
  scope: "global" | "symbol" | "regime" | "reason_code";
  scopeKey: string;
  sampleSize: number;
  observedWinRate: number;
  predictedWinRate: number;
  expectancyR: number;
  multiplier: number;
  /** True when sampleSize < MIN_SAMPLE — multiplier is forced to 1. */
  provisional: boolean;
};

function summarise(records: OutcomeRecord[]): { observed: number; predicted: number; expectancy: number } {
  const n = records.length;
  if (n === 0) return { observed: 0, predicted: 0, expectancy: 0 };
  const observed = records.filter((r) => r.won).length / n;
  const predicted = records.reduce((a, r) => a + r.predictedProbability, 0) / n;
  const expectancy = records.reduce((a, r) => a + r.rMultiple, 0) / n;
  return { observed, predicted, expectancy };
}

/**
 * Shrinkage: with few samples the multiplier stays near 1 and only approaches
 * the raw observed/predicted ratio as evidence accumulates. This is a simple
 * empirical-Bayes style guard against over-fitting a short streak.
 */
function shrink(rawRatio: number, sampleSize: number): number {
  const weight = sampleSize / (sampleSize + MIN_SAMPLE);
  const blended = 1 + (rawRatio - 1) * weight;
  return Math.min(MULTIPLIER_CEILING, Math.max(MULTIPLIER_FLOOR, blended));
}

export function calibrate(
  scope: CalibrationResult["scope"],
  scopeKey: string,
  records: OutcomeRecord[],
): CalibrationResult {
  const { observed, predicted, expectancy } = summarise(records);
  const provisional = records.length < MIN_SAMPLE;
  const rawRatio = predicted > 0 ? observed / predicted : 1;
  return {
    scope,
    scopeKey,
    sampleSize: records.length,
    observedWinRate: observed,
    predictedWinRate: predicted,
    expectancyR: expectancy,
    multiplier: provisional ? 1 : shrink(rawRatio, records.length),
    provisional,
  };
}

/** Recomputes every calibration scope from the full outcome history. */
export function calibrateAll(records: OutcomeRecord[]): CalibrationResult[] {
  const out: CalibrationResult[] = [calibrate("global", "global", records)];

  for (const key of unique(records.map((r) => r.symbol))) {
    out.push(calibrate("symbol", key, records.filter((r) => r.symbol === key)));
  }
  for (const key of unique(records.map((r) => r.regime))) {
    out.push(calibrate("regime", key, records.filter((r) => r.regime === key)));
  }
  for (const code of unique(records.flatMap((r) => r.reasonCodes))) {
    out.push(calibrate("reason_code", code, records.filter((r) => r.reasonCodes.includes(code))));
  }
  return out;
}

/**
 * Combines the applicable scopes into the single multiplier the decision
 * engine consumes. Geometric mean keeps a single extreme scope from
 * dominating, and the result is re-clamped.
 */
export function effectiveMultiplier(scopes: CalibrationResult[]): number {
  const usable = scopes.filter((s) => !s.provisional);
  if (usable.length === 0) return 1;
  const product = usable.reduce((a, s) => a * s.multiplier, 1);
  const geo = product ** (1 / usable.length);
  return Math.min(MULTIPLIER_CEILING, Math.max(MULTIPLIER_FLOOR, geo));
}

// ---------------------------------------------------------------------------
// Self-critique — "يحلل أخطاءه"
// ---------------------------------------------------------------------------
export type Lesson = { code: string; severity: "info" | "warn" | "critical"; ar: string; metric: number };

/**
 * Pattern-matches the outcome history for recognisable, ACTIONABLE mistakes.
 * Each lesson maps to a concrete config lever, so the owner can act on it
 * rather than just read a diagnosis.
 */
export function deriveLessons(records: OutcomeRecord[]): Lesson[] {
  const lessons: Lesson[] = [];
  if (records.length < 10) return lessons;

  // 1. Stops too tight: many losses that later ran deep in our favour.
  const losses = records.filter((r) => !r.won);
  const nearMisses = losses.filter((r) => (r.mfeR ?? 0) >= 1.2);
  if (losses.length >= 8 && nearMisses.length / losses.length > 0.35) {
    lessons.push({
      code: "STOPS_TOO_TIGHT",
      severity: "warn",
      metric: nearMisses.length / losses.length,
      ar: `${Math.round((nearMisses.length / losses.length) * 100)}% من الصفقات الخاسرة تحركت لصالحنا قبل ضرب الوقف — وقف الخسارة ضيق جداً ويحتاج مسافة أكبر.`,
    });
  }

  // 2. Over-confidence: high-confidence bucket underperforming its prediction.
  const highConf = records.filter((r) => r.confidence >= 75);
  if (highConf.length >= 12) {
    const { observed, predicted } = summarise(highConf);
    if (observed < predicted - 0.12) {
      lessons.push({
        code: "OVERCONFIDENT_HIGH_BUCKET",
        severity: "critical",
        metric: predicted - observed,
        ar: `الإشارات عالية الثقة حققت ${Math.round(observed * 100)}% مقابل توقّع ${Math.round(predicted * 100)}% — النظام مبالغ في ثقته ويجب رفع حد الدخول.`,
      });
    }
  }

  // 3. Regime blind spot: a regime with negative expectancy.
  for (const regime of unique(records.map((r) => r.regime))) {
    const subset = records.filter((r) => r.regime === regime);
    if (subset.length >= MIN_SAMPLE) {
      const { expectancy } = summarise(subset);
      if (expectancy < -0.1) {
        lessons.push({
          code: `NEGATIVE_REGIME_${regime.toUpperCase()}`,
          severity: "critical",
          metric: expectancy,
          ar: `الأداء سلبي في سوق من نوع "${regime}" (${expectancy.toFixed(2)}R لكل صفقة) — يُنصح بإيقاف التداول في هذه الحالة.`,
        });
      }
    }
  }

  // 4. Reason codes that consistently lose money.
  for (const code of unique(records.flatMap((r) => r.reasonCodes))) {
    const subset = records.filter((r) => r.reasonCodes.includes(code));
    if (subset.length >= MIN_SAMPLE) {
      const { expectancy } = summarise(subset);
      if (expectancy < -0.15) {
        lessons.push({
          code: `WEAK_CONFLUENCE_${code}`,
          severity: "warn",
          metric: expectancy,
          ar: `العامل "${code}" مرتبط بأداء سلبي (${expectancy.toFixed(2)}R) — يجب تقليل وزنه في محرك القرار.`,
        });
      }
    }
  }

  // 5. Holding too long / cutting winners early.
  const wins = records.filter((r) => r.won);
  if (wins.length >= 10) {
    const avgWinR = wins.reduce((a, r) => a + r.rMultiple, 0) / wins.length;
    const avgLossR = losses.length ? Math.abs(losses.reduce((a, r) => a + r.rMultiple, 0) / losses.length) : 1;
    if (avgWinR < avgLossR * 1.2) {
      lessons.push({
        code: "PAYOFF_RATIO_LOW",
        severity: "warn",
        metric: avgWinR / (avgLossR || 1),
        ar: `متوسط الربح (${avgWinR.toFixed(2)}R) قريب جداً من متوسط الخسارة (${avgLossR.toFixed(2)}R) — الأهداف تُغلق مبكراً مقارنة بالمخاطرة.`,
      });
    }
  }

  return lessons.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

const severityRank = (s: Lesson["severity"]) => (s === "critical" ? 2 : s === "warn" ? 1 : 0);

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// Performance statistics (shared by reports and the owner console)
// ---------------------------------------------------------------------------
export type PerformanceStats = {
  totalSignals: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalR: number;
  avgRMultiple: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  expectancyR: number;
  bestSymbol?: string;
  worstSymbol?: string;
};

export function computeStats(records: OutcomeRecord[]): PerformanceStats {
  const n = records.length;
  if (n === 0) {
    return {
      totalSignals: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      totalR: 0,
      avgRMultiple: 0,
      profitFactor: 0,
      maxConsecutiveLosses: 0,
      expectancyR: 0,
    };
  }
  const wins = records.filter((r) => r.won);
  const losses = records.filter((r) => !r.won);
  const grossWin = wins.reduce((a, r) => a + r.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.rMultiple, 0));
  const totalR = records.reduce((a, r) => a + r.rMultiple, 0);

  let streak = 0;
  let maxStreak = 0;
  for (const r of records) {
    streak = r.won ? 0 : streak + 1;
    maxStreak = Math.max(maxStreak, streak);
  }

  const bySymbol = new Map<string, number>();
  for (const r of records) bySymbol.set(r.symbol, (bySymbol.get(r.symbol) ?? 0) + r.rMultiple);
  const ranked = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]);

  return {
    totalSignals: n,
    wins: wins.length,
    losses: losses.length,
    winRatePct: (wins.length / n) * 100,
    totalR,
    avgRMultiple: totalR / n,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    maxConsecutiveLosses: maxStreak,
    expectancyR: totalR / n,
    bestSymbol: ranked[0]?.[0],
    worstSymbol: ranked.length > 1 ? ranked[ranked.length - 1][0] : undefined,
  };
}
