// ---------------------------------------------------------------------------
// Trading Intelligence Core — shared types.
//
// Every analyser in this folder is a PURE function: (candles, config) => report.
// No I/O, no database, no Telegram. That keeps the "brain" unit-testable and
// reusable by the live signal loop, the backtester, and the research CLI.
//
// Arabic is a PRESENTATION concern only — analysers emit stable machine codes
// (`ReasonCode`) and the Telegram layer maps them to Arabic sentences.
// ---------------------------------------------------------------------------
import type { Candle } from "../indicators";

export type { Candle };

export type Direction = "long" | "short";
export type Bias = Direction | "neutral";

export type Timeframe = "5m" | "15m" | "1h" | "4h" | "1d";

/** Ordered from fastest to slowest — used for multi-timeframe walks. */
export const TIMEFRAME_ORDER: Timeframe[] = ["5m", "15m", "1h", "4h", "1d"];

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/**
 * A normalised score in [-1, 1] where the sign is directional (positive =
 * bullish) and the magnitude is conviction. Every analyser speaks this
 * language so the confluence engine can combine them with plain weights.
 */
export type DirectionalScore = number;

/** Stable, language-independent identifiers for every reason the brain gives. */
export type ReasonCode =
  // Trend
  | "TREND_UP_ALIGNED"
  | "TREND_DOWN_ALIGNED"
  | "TREND_FLAT"
  | "TREND_CONFLICT"
  // Structure
  | "STRUCTURE_BOS_UP"
  | "STRUCTURE_BOS_DOWN"
  | "STRUCTURE_CHOCH_UP"
  | "STRUCTURE_CHOCH_DOWN"
  | "STRUCTURE_RANGE"
  // Zones
  | "AT_DEMAND_ZONE"
  | "AT_SUPPLY_ZONE"
  | "AT_SUPPORT"
  | "AT_RESISTANCE"
  | "MID_RANGE_NO_EDGE"
  // Momentum
  | "MOMENTUM_BULLISH"
  | "MOMENTUM_BEARISH"
  | "MOMENTUM_DIVERGENCE_BULL"
  | "MOMENTUM_DIVERGENCE_BEAR"
  | "MOMENTUM_EXHAUSTED"
  // Volume / liquidity
  | "VOLUME_CONFIRMS"
  | "VOLUME_WEAK"
  | "LIQUIDITY_SWEEP_LOW"
  | "LIQUIDITY_SWEEP_HIGH"
  | "LIQUIDITY_THIN"
  // Volatility
  | "VOLATILITY_NORMAL"
  | "VOLATILITY_EXPANDING"
  | "VOLATILITY_EXTREME"
  | "VOLATILITY_DEAD"
  // Price action
  | "PA_BULLISH_ENGULFING"
  | "PA_BEARISH_ENGULFING"
  | "PA_REJECTION_WICK_UP"
  | "PA_REJECTION_WICK_DOWN"
  | "PA_INDECISION"
  // Multi-timeframe
  | "MTF_ALIGNED"
  | "MTF_PARTIAL"
  | "MTF_CONFLICT"
  // v3.0 — Order Flow
  | "VWAP_BULLISH"
  | "VWAP_BEARISH"
  | "VWAP_CROSSOVER_UP"
  | "VWAP_CROSSOVER_DOWN"
  | "VP_POC_SUPPORT"
  | "VP_POC_RESISTANCE"
  | "VP_VALUE_AREA_BREAKOUT"
  | "CVD_BULLISH"
  | "CVD_BEARISH"
  | "CVD_DIVERGENCE_BEAR"
  // v3.0 — Reversal
  | "REVERSAL_HAMMER"
  | "REVERSAL_SHOOTING_STAR"
  | "REVERSAL_DIVERGENCE_BULL"
  | "REVERSAL_DIVERGENCE_BEAR"
  | "REVERSAL_OVERSOLD"
  | "REVERSAL_OVERBOUGHT"
  // v3.0 — Breakout
  | "BREAKOUT_SQUEEZE_UP"
  | "BREAKOUT_SQUEEZE_DOWN"
  | "BREAKOUT_VOLUME_SURGE"
  // v3.0 — On-Chain
  | "ONCHAIN_FUNDING_BULLISH"
  | "ONCHAIN_FUNDING_BEARISH"
  | "ONCHAIN_OI_TRENDING"
  | "ONCHAIN_LS_EXTREME"
  // Decision gates (rejections)
  | "REJECT_LOW_CONFLUENCE"
  | "REJECT_MTF_CONFLICT"
  | "REJECT_POOR_RR"
  | "REJECT_EXTREME_VOLATILITY"
  | "REJECT_DEAD_MARKET"
  | "REJECT_NO_STRUCTURE_EDGE"
  | "REJECT_NEWS_WINDOW"
  | "REJECT_LOW_PROBABILITY"
  | "REJECT_INSUFFICIENT_DATA"
  | "REJECT_COOLDOWN"
  | "REJECT_DAILY_LIMIT"
  | "REJECT_EXPOSURE_LIMIT"
  | "REJECT_CORRELATION_OVERLAP"
  | "WAIT_BETTER_PRICE";

export type Reason = {
  code: ReasonCode;
  /** -1..1 directional contribution, 0 for neutral/informational reasons. */
  score: DirectionalScore;
  /** Free-form numeric detail used to enrich the Arabic sentence. */
  detail?: Record<string, number | string>;
};

export type MarketRegime =
  | "trending_up"
  | "trending_down"
  | "ranging"
  | "volatile_expansion"
  | "quiet_compression";

export type SwingPoint = {
  index: number;
  time: number;
  price: number;
  kind: "high" | "low";
};

export type Zone = {
  kind: "support" | "resistance" | "demand" | "supply";
  low: number;
  high: number;
  /** 0..1 — how many touches / how much reaction the zone has produced. */
  strength: number;
  touches: number;
  lastTouchIndex: number;
};

export type AnalyserReport = {
  name: string;
  /** -1..1 directional read of this dimension. */
  score: DirectionalScore;
  /** 0..1 how much this analyser trusts its own read on this data. */
  confidence: number;
  reasons: Reason[];
  metrics: Record<string, number>;
};

export type TimeframeAnalysis = {
  timeframe: Timeframe;
  bias: Bias;
  score: DirectionalScore;
  regime: MarketRegime;
  reports: Record<string, AnalyserReport>;
  zones: Zone[];
  swings: SwingPoint[];
  lastPrice: number;
  atr: number;
  /** Lows/highs of the most recent bars — the consolidation base used for
   *  stop placement when price breaks out away from the last major swing. */
  recentLows: number[];
  recentHighs: number[];
};

export type TradePlan = {
  direction: Direction;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  /** Reward-to-risk measured against takeProfit1 (the conservative target). */
  riskReward1: number;
  riskReward2: number;
  /** Distance from entry to stop, in percent of entry price. */
  stopDistancePct: number;
  /** Suggested % of account equity to risk, after brain-side adjustments. */
  riskPerTradePct: number;
  /** Position notional as % of equity, derived from risk + stop distance. */
  positionSizePct: number;
  atr: number;
};

export type DecisionVerdict = "enter" | "wait" | "reject";

export type Decision = {
  verdict: DecisionVerdict;
  direction: Direction | null;
  /** 0..100 — the number shown to the customer as "نسبة الثقة". */
  confidence: number;
  /** 0..1 — modelled historical hit-rate for setups of this quality. */
  probability: number;
  regime: MarketRegime;
  plan: TradePlan | null;
  /** Ordered: strongest supporting evidence first. */
  supporting: Reason[];
  /** Everything that argued against, including the blocking gate. */
  objections: Reason[];
  /** The single gate that produced a non-`enter` verdict. */
  blockedBy: ReasonCode | null;
  /** Per-timeframe detail, kept for the "شرح التحليل" Telegram view. */
  timeframes: TimeframeAnalysis[];
  symbol: string;
  generatedAt: number;
  /** v3.1: which strategy produced this decision. */
  strategy?: "trend" | "reversal" | "breakout";
  /** v3.1: position size multiplier from central filter. */
  filterMultiplier?: number;
};

export type BrainConfig = {
  /** Timeframes analysed, slowest is treated as the higher-timeframe filter. */
  timeframes: Timeframe[];
  /** Minimum confluence score (0..100) required to even consider entering. */
  minConfluence: number;
  /** Minimum modelled probability required to enter. */
  minProbability: number;
  /** Minimum reward-to-risk on TP1 required to enter. */
  minRiskReward: number;
  /** Max ATR% of price before the market is considered untradeable (long). */
  maxAtrPct: number;
  /** Max ATR% for shorts — higher because crypto crashes are faster. */
  maxAtrPctShort: number;
  /** Min ATR% of price before the market is considered dead. */
  minAtrPct: number;
  /** Weight of each analyser inside the confluence score. */
  weights: Record<string, number>;
  /** Base risk per trade (% of equity) before quality scaling. */
  baseRiskPct: number;
  /** Hard cap on risk per trade regardless of conviction. */
  maxRiskPct: number;
};

/**
 * Thresholds are CALIBRATED, not guessed. Measured on the aggregate
 * multi-timeframe confluence score across 10 symbols x 3 timeframes x rolling
 * windows — reproduce with `npx tsx scripts/calibrate-thresholds.ts`:
 *
 *   directionless market ("noise"):  p50=15  p90=40  p95=44  p99=47
 *   textbook A+ breakout / breakdown:            54-55
 *   pure chop:                                   19
 *
 * minConfluence=52 sits above the 99th percentile of noise and below a
 * genuine A+ read. That gap is the entire product: the engine stays silent in
 * chop and only speaks when several independent dimensions agree. Raising it
 * past ~56 makes the bot near-silent; dropping below ~47 starts admitting
 * random market noise as "signals". Re-run the script after any change to an
 * analyser or a weight.
 */
export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  timeframes: ["15m", "1h", "4h"],
  minConfluence: 52,
  minProbability: 0.55,
  minRiskReward: 1.8,
  maxAtrPct: 6,
  maxAtrPctShort: 8,   // Shorts tolerate 33% more volatility (crypto crashes are faster)
  minAtrPct: 0.15,
  weights: {
    trend: 1.6,
    structure: 1.8,
    zones: 1.5,
    momentum: 1.2,
    volume: 0.9,
    volatility: 0.6,
    priceAction: 1.1,
    liquidity: 1.0,
    vwap: 0.8,
    volumeProfile: 0.7,
    orderFlow: 0.6,
    reversal: 0.0,
    breakout: 0.0,
  },
  baseRiskPct: 1,
  maxRiskPct: 2,
};
