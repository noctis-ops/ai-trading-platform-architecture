// ---------------------------------------------------------------------------
// Decision Engine — the "trader personality".
//
// Pipeline:
//   1. Analyse each configured timeframe independently (analyseTimeframe).
//   2. Combine timeframes with the slowest acting as a directional filter.
//   3. Score confluence (0..100) and estimate probability.
//   4. Build a concrete trade plan from ATR + structure (never round numbers).
//   5. Run ordered veto gates. The FIRST gate that fails decides the verdict.
//
// Design principle: the engine is biased towards *not* trading. Every gate can
// only downgrade a verdict, never upgrade it. "wait" and "reject" are
// first-class successful outcomes, not failures.
// ---------------------------------------------------------------------------
import {
  analyseLiquidity,
  analyseMomentum,
  analysePriceAction,
  analyseTrend,
  analyseVolatility,
  analyseVolume,
  analyseZones,
} from "./analysers";
import { analyseStructure, clamp } from "./structure";
import {
  DEFAULT_BRAIN_CONFIG,
  type AnalyserReport,
  type Bias,
  type BrainConfig,
  type Candle,
  type Decision,
  type Direction,
  type MarketRegime,
  type Reason,
  type ReasonCode,
  type TimeframeAnalysis,
  type Timeframe,
  type TradePlan,
} from "./types";

/** Minimum candles per timeframe before the brain will express any opinion. */
export const MIN_CANDLES = 210;

/** Bars considered "the current base" when locating a breakout stop. */
const RECENT_BASE_BARS = 20;

/** Stop may sit at most this many ATR from entry before the entry is "late". */
export const MAX_STOP_ATR = 4;
/** Targets are expressed as multiples of the risk taken (R), never as fixed %. */
export const TP1_R = 2;
export const TP2_R = 3.5;
/** Hard ceiling on suggested exposure as % of portfolio (spot, unleveraged). */
export const MAX_POSITION_PCT = 25;

const round2 = (v: number) => Math.round(v * 100) / 100;

export function analyseTimeframe(candles: Candle[], timeframe: Timeframe, config: BrainConfig): TimeframeAnalysis {
  const structure = analyseStructure(candles);
  const reports: Record<string, AnalyserReport> = {
    trend: analyseTrend(candles),
    structure,
    zones: analyseZones(candles, structure.zones),
    momentum: analyseMomentum(candles),
    volume: analyseVolume(candles),
    volatility: analyseVolatility(candles),
    priceAction: analysePriceAction(candles),
    liquidity: analyseLiquidity(candles),
  };

  const score = weightedScore(reports, config.weights);
  const bias: Bias = score > 0.15 ? "long" : score < -0.15 ? "short" : "neutral";

  return {
    timeframe,
    bias,
    score,
    regime: classifyRegime(reports),
    reports,
    zones: structure.zones,
    swings: structure.swings,
    lastPrice: candles[candles.length - 1].close,
    atr: reports.volatility.metrics.atr ?? 0,
    recentLows: candles.slice(-RECENT_BASE_BARS).map((c) => c.low),
    recentHighs: candles.slice(-RECENT_BASE_BARS).map((c) => c.high),
  };
}

/** Analysers that gate trades but never express a direction. */
const NON_DIRECTIONAL = new Set(["volatility"]);

/** Below this magnitude an analyser is abstaining, not voting "neutral". */
const ABSTAIN_EPSILON = 0.08;

/**
 * Confluence scoring.
 *
 * Two things must be true for a high score, and they are measured separately:
 *   1. AGREEMENT  — the analysers that DO have an opinion point the same way.
 *   2. BREADTH    — enough of them actually have an opinion.
 *
 * Naively averaging over every analyser conflates the two: a textbook trend
 * with four confirming reads and four silent ones scored ~44 because silence
 * was counted as disagreement. Abstainers are now excluded from the average
 * and instead reduce a separate coverage factor, so a single loud analyser
 * cannot reach 100 either. Volatility is excluded entirely — it is a gate.
 */
function weightedScore(reports: Record<string, AnalyserReport>, weights: Record<string, number>): number {
  let num = 0;
  let confidenceWeight = 0;
  let participatingWeight = 0;
  let totalWeight = 0;

  for (const [name, report] of Object.entries(reports)) {
    if (NON_DIRECTIONAL.has(name)) continue;
    const baseWeight = weights[name] ?? 1;
    totalWeight += baseWeight;

    if (Math.abs(report.score) < ABSTAIN_EPSILON) continue;

    // AGREEMENT is confidence-weighted: a hesitant analyser sways it less.
    const w = baseWeight * report.confidence;
    num += report.score * w;
    confidenceWeight += w;
    // COVERAGE is not: participation is binary — you either had an opinion or
    // you didn't. Scaling coverage by confidence too would penalise the same
    // hesitancy twice and suppress genuine confluence below the entry gate.
    participatingWeight += baseWeight;
  }

  if (confidenceWeight === 0 || totalWeight === 0) return 0;

  const agreement = clamp(num / confidenceWeight, -1, 1);

  // Floored at 0.55 so a genuine 3-of-6 confluence is not crushed, capped at
  // 1 so full participation gives the raw agreement score.
  const coverage = clamp(0.55 + 0.45 * (participatingWeight / totalWeight), 0, 1);

  return clamp(agreement * coverage, -1, 1);
}

function classifyRegime(reports: Record<string, AnalyserReport>): MarketRegime {
  const atrPct = reports.volatility.metrics.atrPct ?? 0;
  const expansion = reports.volatility.metrics.expansion ?? 1;
  const trend = reports.trend.score;

  if (atrPct < 0.2) return "quiet_compression";
  if (expansion > 1.7 || atrPct > 5) return "volatile_expansion";
  if (trend > 0.45) return "trending_up";
  if (trend < -0.45) return "trending_down";
  return "ranging";
}

// ---------------------------------------------------------------------------
// Multi-timeframe aggregation
// ---------------------------------------------------------------------------

/**
 * Slowest timeframe gets the highest weight: it decides *whether* we are
 * allowed to look for a trade at all, the faster ones decide *when*.
 */
function aggregateTimeframes(tfs: TimeframeAnalysis[]): { score: number; alignment: number; reason: Reason } {
  const weights = tfs.map((_, i) => 1 + i * 0.75);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const score = tfs.reduce((acc, tf, i) => acc + tf.score * weights[i], 0) / totalW;

  const directional = tfs.filter((tf) => tf.bias !== "neutral");
  const longs = directional.filter((tf) => tf.bias === "long").length;
  const shorts = directional.filter((tf) => tf.bias === "short").length;
  const dominant = Math.max(longs, shorts);
  const alignment = directional.length === 0 ? 0 : dominant / tfs.length;

  let reason: Reason;
  if (longs > 0 && shorts > 0) reason = { code: "MTF_CONFLICT", score: 0, detail: { longs, shorts } };
  else if (alignment >= 0.99) reason = { code: "MTF_ALIGNED", score: 0, detail: { count: tfs.length } };
  else reason = { code: "MTF_PARTIAL", score: 0, detail: { aligned: dominant, total: tfs.length } };

  return { score: clamp(score, -1, 1), alignment, reason };
}

// ---------------------------------------------------------------------------
// Trade plan construction
// ---------------------------------------------------------------------------

export type PlanResult =
  | { ok: true; plan: TradePlan }
  /**
   * Price has run too far from its structural invalidation level. The setup
   * may be valid but the ENTRY is not — the honest answer is "wait for a
   * pullback", never "widen the stop until the maths works".
   */
  | { ok: false; code: "EXTENDED_FROM_STRUCTURE"; detail: Record<string, number> }
  | { ok: false; code: "INVALID_INPUTS"; detail: Record<string, number> };

/**
 * Stops are placed beyond structure (last swing) with an ATR buffer, never at
 * a round number and never at a fixed percentage — fixed stops are where
 * liquidity sits, which is precisely where they get hunted.
 */
export function buildTradePlan(
  direction: Direction,
  entryTf: TimeframeAnalysis,
  config: BrainConfig,
  qualityScore: number,
): PlanResult {
  const entry = entryTf.lastPrice;
  const atrValue = entryTf.atr;
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(atrValue) || atrValue <= 0) {
    return { ok: false, code: "INVALID_INPUTS", detail: { entry, atr: atrValue } };
  }

  const buffer = atrValue * 0.35;

  /**
   * Stop placement uses the NEAREST valid structural level, not simply the
   * most recent swing. On a breakout the last major swing low can sit many
   * ATR away while the consolidation base that actually invalidates the idea
   * is much closer; anchoring to the far swing would either reject a good
   * trade or force an oversized risk. Candidates are evaluated closest-first
   * and the first one that survives the ATR ceiling wins.
   */
  const swings = entryTf.swings;
  const candidates: number[] = [];

  if (direction === "long") {
    for (const s of swings) if (s.kind === "low" && s.price < entry) candidates.push(s.price - buffer);
    const recentLow = Math.min(...entryTf.recentLows);
    if (Number.isFinite(recentLow) && recentLow < entry) candidates.push(recentLow - buffer);
  } else {
    for (const s of swings) if (s.kind === "high" && s.price > entry) candidates.push(s.price + buffer);
    const recentHigh = Math.max(...entryTf.recentHighs);
    if (Number.isFinite(recentHigh) && recentHigh > entry) candidates.push(recentHigh + buffer);
  }

  candidates.sort((a, b) => Math.abs(entry - a) - Math.abs(entry - b));

  const withinBand = (c: number) => {
    const r = Math.abs(entry - c);
    // Too tight = inside the noise band and guaranteed to be wicked out.
    return r >= atrValue * 0.5 && r <= atrValue * MAX_STOP_ATR;
  };

  let stopLoss = candidates.find(withinBand);

  if (stopLoss === undefined) {
    /**
     * No structural level sits at a sane distance. Two very different cases:
     *
     *  - Structure EXISTS but is far away  => price has run; entering here
     *    means an invalidation level we cannot justify. Refuse and wait.
     *  - No structure at all (fresh range) => a pure volatility stop is the
     *    honest choice.
     *
     * Falling back to an ATR stop in the first case would quietly re-enable
     * exactly the chasing behaviour this engine is supposed to prevent.
     */
    if (candidates.length > 0) {
      const nearest = candidates[0];
      return {
        ok: false,
        code: "EXTENDED_FROM_STRUCTURE",
        detail: { stopAtrMultiple: round2(Math.abs(entry - nearest) / atrValue), max: MAX_STOP_ATR },
      };
    }
    stopLoss = direction === "long" ? entry - atrValue * 1.6 : entry + atrValue * 1.6;
  }

  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return { ok: false, code: "INVALID_INPUTS", detail: { risk } };

  const tp1 = direction === "long" ? entry + risk * TP1_R : entry - risk * TP1_R;
  const tp2 = direction === "long" ? entry + risk * TP2_R : entry - risk * TP2_R;

  const stopDistancePct = (risk / entry) * 100;
  // Risk scales with conviction but is hard-capped.
  const riskPerTradePct = Math.min(config.maxRiskPct, config.baseRiskPct * (0.6 + qualityScore * 0.8));

  /**
   * Position size = risk budget / stop distance. With a tight 1% stop this
   * formula alone returns >100% of equity, which silently assumes leverage
   * the customer may not have and is irresponsible to print in a signal.
   * We cap exposure at MAX_POSITION_PCT of the portfolio; when the cap binds,
   * the effective risk taken is LOWER than the budget, never higher.
   */
  const uncappedPositionPct = stopDistancePct > 0 ? (riskPerTradePct / stopDistancePct) * 100 : 0;
  const positionSizePct = Math.min(uncappedPositionPct, MAX_POSITION_PCT);

  return {
    ok: true,
    plan: {
      direction,
      entry,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      riskReward1: TP1_R,
      riskReward2: TP2_R,
      stopDistancePct,
      riskPerTradePct,
      positionSizePct,
      atr: atrValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Probability model
// ---------------------------------------------------------------------------

/**
 * Maps confluence + alignment onto a modelled hit-rate via a logistic curve.
 *
 * IMPORTANT: these coefficients are priors, not measured edge. The learning
 * loop (learning.ts) recalibrates them from realised outcomes; until enough
 * closed trades exist the system reports this as an estimate, and the Telegram
 * layer labels it as such. We never present a prior as a backtested statistic.
 */
export function estimateProbability(confluence: number, alignment: number, regime: MarketRegime): number {
  const x = (confluence - 60) / 12 + (alignment - 0.6) * 1.5;
  let p = 1 / (1 + Math.exp(-x));
  // Regime adjustment: trends are kinder to trend-following entries.
  if (regime === "volatile_expansion") p -= 0.06;
  if (regime === "quiet_compression") p -= 0.08;
  if (regime === "trending_up" || regime === "trending_down") p += 0.03;
  return clamp(p, 0.05, 0.92);
}

// ---------------------------------------------------------------------------
// External context (news / exposure / cooldown) supplied by the caller.
// ---------------------------------------------------------------------------
export type DecisionContext = {
  /** True when a high-impact event is within the blackout window. */
  newsBlackout?: boolean;
  /** Symbol already has an open signal — avoid stacking correlated risk. */
  hasOpenSignal?: boolean;
  /** Signals already published today across the whole service. */
  signalsToday?: number;
  maxSignalsPerDay?: number;
  /** Minutes since the last signal on this symbol. */
  minutesSinceLastSignal?: number;
  cooldownMinutes?: number;
  /**
   * Calibration multiplier from the learning loop (1 = neutral). Applied to
   * the probability estimate so the brain becomes more conservative after a
   * losing streak in a given regime.
   */
  calibration?: number;
};

/**
 * The main entry point. `candlesByTimeframe` must contain every timeframe in
 * `config.timeframes`, ordered fastest-first by the caller's data layer.
 */
export function decide(
  symbol: string,
  candlesByTimeframe: Partial<Record<Timeframe, Candle[]>>,
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
  ctx: DecisionContext = {},
): Decision {
  const generatedAt = Date.now();

  // --- Gate 0: data sufficiency ------------------------------------------
  const usable = config.timeframes.filter((tf) => (candlesByTimeframe[tf]?.length ?? 0) >= MIN_CANDLES);
  if (usable.length < config.timeframes.length) {
    return emptyDecision(symbol, generatedAt, "REJECT_INSUFFICIENT_DATA", {
      required: MIN_CANDLES,
      available: usable.length,
    });
  }

  const timeframes = usable.map((tf) => analyseTimeframe(candlesByTimeframe[tf]!, tf, config));
  const entryTf = timeframes[0]; // fastest = execution timeframe
  const { score: mtfScore, alignment, reason: mtfReason } = aggregateTimeframes(timeframes);

  const direction: Direction = mtfScore >= 0 ? "long" : "short";
  const confluence = Math.round(Math.abs(mtfScore) * 100);
  const regime = timeframes[timeframes.length - 1].regime;

  // Collect reasons across all timeframes, tagged by direction agreement.
  const allReasons: Reason[] = timeframes.flatMap((tf) => Object.values(tf.reports).flatMap((r) => r.reasons));
  allReasons.push(mtfReason);

  // Deduplicate by reason code, keeping the strongest instance. The same
  // condition detected on 15m, 1h and 4h is ONE piece of evidence to a human
  // reader — repeating it three times in the Arabic message reads like a bug
  // and fakes the appearance of extra confluence.
  const supporting = dedupeByCode(allReasons.filter((r) => (direction === "long" ? r.score > 0 : r.score < 0)));
  const objections = dedupeByCode(allReasons.filter((r) => (direction === "long" ? r.score < 0 : r.score > 0)));

  const qualityScore = clamp(confluence / 100, 0, 1);
  const planResult = buildTradePlan(direction, entryTf, config, qualityScore);
  const plan = planResult.ok ? planResult.plan : null;
  const rawProbability = estimateProbability(confluence, alignment, regime);
  const probability = clamp(rawProbability * (ctx.calibration ?? 1), 0.05, 0.92);

  // --- Ordered veto gates -------------------------------------------------
  // Order matters: cheapest/hardest constraints first so the reported reason
  // is the most fundamental one, not an incidental downstream symptom.
  const vol = entryTf.reports.volatility.metrics;
  const gates: {
    code: ReasonCode;
    failed: boolean;
    detail?: Record<string, number | string>;
    verdict: "reject" | "wait";
  }[] = [
    {
      code: "REJECT_NEWS_WINDOW",
      failed: Boolean(ctx.newsBlackout),
      verdict: "wait",
    },
    {
      code: "REJECT_DAILY_LIMIT",
      failed: ctx.maxSignalsPerDay !== undefined && (ctx.signalsToday ?? 0) >= ctx.maxSignalsPerDay,
      detail: { signalsToday: ctx.signalsToday ?? 0, max: ctx.maxSignalsPerDay ?? 0 },
      verdict: "wait",
    },
    {
      code: "REJECT_COOLDOWN",
      failed:
        ctx.cooldownMinutes !== undefined &&
        ctx.minutesSinceLastSignal !== undefined &&
        ctx.minutesSinceLastSignal < ctx.cooldownMinutes,
      detail: { since: ctx.minutesSinceLastSignal ?? 0, required: ctx.cooldownMinutes ?? 0 },
      verdict: "wait",
    },
    {
      code: "REJECT_EXPOSURE_LIMIT",
      failed: Boolean(ctx.hasOpenSignal),
      verdict: "wait",
    },
    {
      code: "REJECT_EXTREME_VOLATILITY",
      failed: (vol.atrPct ?? 0) > config.maxAtrPct,
      detail: { atrPct: vol.atrPct ?? 0, max: config.maxAtrPct },
      verdict: "reject",
    },
    {
      code: "REJECT_DEAD_MARKET",
      failed: (vol.atrPct ?? 0) < config.minAtrPct,
      detail: { atrPct: vol.atrPct ?? 0, min: config.minAtrPct },
      verdict: "reject",
    },
    {
      code: "REJECT_MTF_CONFLICT",
      failed: mtfReason.code === "MTF_CONFLICT",
      detail: mtfReason.detail,
      verdict: "wait",
    },
    {
      code: "REJECT_LOW_CONFLUENCE",
      failed: confluence < config.minConfluence,
      detail: { confluence, required: config.minConfluence },
      verdict: "reject",
    },
    {
      code: "REJECT_NO_STRUCTURE_EDGE",
      failed: Math.abs(entryTf.reports.structure.score) < 0.15 && Math.abs(entryTf.reports.zones.score) < 0.15,
      verdict: "wait",
    },
    {
      // Price extended far beyond its invalidation level: the setup is real
      // but this ENTRY is late. Reported as "wait" so the customer knows to
      // watch for a pullback rather than believing the idea was rejected.
      code: "WAIT_BETTER_PRICE",
      failed: !planResult.ok && planResult.code === "EXTENDED_FROM_STRUCTURE",
      detail: !planResult.ok && planResult.code === "EXTENDED_FROM_STRUCTURE" ? planResult.detail : undefined,
      verdict: "wait",
    },
    {
      code: "REJECT_POOR_RR",
      failed: plan === null || plan.riskReward1 < config.minRiskReward,
      detail: { rr: plan?.riskReward1 ?? 0, required: config.minRiskReward },
      verdict: "reject",
    },
    {
      code: "REJECT_LOW_PROBABILITY",
      failed: probability < config.minProbability,
      detail: { probability: Math.round(probability * 100), required: Math.round(config.minProbability * 100) },
      verdict: "reject",
    },
  ];

  const blocking = gates.find((g) => g.failed);

  if (blocking) {
    objections.unshift({ code: blocking.code, score: 0, detail: blocking.detail });
    return {
      verdict: blocking.verdict,
      direction: null,
      confidence: confluence,
      probability,
      regime,
      plan: null,
      supporting,
      objections,
      blockedBy: blocking.code,
      timeframes,
      symbol,
      generatedAt,
    };
  }

  return {
    verdict: "enter",
    direction,
    confidence: confluence,
    probability,
    regime,
    plan,
    supporting,
    objections,
    blockedBy: null,
    timeframes,
    symbol,
    generatedAt,
  };
}

/** Keeps the highest-magnitude instance of each reason code, strongest first. */
function dedupeByCode(reasons: Reason[]): Reason[] {
  const best = new Map<ReasonCode, Reason>();
  for (const r of reasons) {
    const existing = best.get(r.code);
    if (!existing || Math.abs(r.score) > Math.abs(existing.score)) best.set(r.code, r);
  }
  return [...best.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

function emptyDecision(
  symbol: string,
  generatedAt: number,
  code: ReasonCode,
  detail?: Record<string, number | string>,
): Decision {
  return {
    verdict: "reject",
    direction: null,
    confidence: 0,
    probability: 0,
    regime: "ranging",
    plan: null,
    supporting: [],
    objections: [{ code, score: 0, detail }],
    blockedBy: code,
    timeframes: [],
    symbol,
    generatedAt,
  };
}
