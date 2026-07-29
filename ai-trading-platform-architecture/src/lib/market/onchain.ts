// ---------------------------------------------------------------------------
// On-Chain Data Analysis — Crypto-native signals.
//
// This module fetches and analyses on-chain metrics from Coinglass API.
// These metrics often LEAD price action rather than lagging it:
//
//   Funding Rate — cost of holding a perpetual futures position
//     - Very positive = market is over-leveraged long (bearish)
//     - Very negative = market is over-leveraged short (bullish)
//     - Normal range: -0.01% to +0.03%
//
//   Open Interest — total outstanding futures contracts
//     - Rising OI + rising price = genuine uptrend
//     - Rising OI + falling price = liquidations driving movement
//     - Falling OI = positions being closed (trend weakening)
//
//   Long/Short Ratio — ratio of long to short positions
//     - > 3 = excessive bullish sentiment (contrarian bearish signal)
//     - < 0.7 = excessive bearish sentiment (contrarian bullish signal)
//
//   Exchange Netflow — coins moving in/out of exchanges
//     - Large inflows = potential selling pressure
//     - Large outflows = HODLing / accumulation
//
// All functions are PURE: receive data as parameters, return analysis.
// The actual API calls happen in the market data layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FundingRate = {
  symbol: string;
  rate: number;           // Current funding rate (decimal, e.g. 0.0001 = 0.01%)
  apr: number;            // Annualised rate in %
  /** "highly_positive" | "positive" | "neutral" | "negative" | "highly_negative" */
  signal: "highly_positive" | "positive" | "neutral" | "negative" | "highly_negative";
};

export type OpenInterestData = {
  symbol: string;
  currentOI: number;      // In USDT
  oi24hChangePct: number; // 24h change in %
  oi7dChangePct: number;  // 7d change in %
  /** "rising" | "falling" | "stable" */
  trend: "rising" | "falling" | "stable";
};

export type LongShortRatio = {
  symbol: string;
  longRatio: number;      // 0..1, ratio of long positions
  shortRatio: number;     // 0..1, ratio of short positions
  accounts: number;       // Number of accounts sampled
  /** "extreme_long" | "long_biased" | "balanced" | "short_biased" | "extreme_short" */
  signal: "extreme_long" | "long_biased" | "balanced" | "short_biased" | "extreme_short";
};

export type ExchangeFlow = {
  symbol: string;
  inflow24h: number;      // USDT
  outflow24h: number;     // USDT
  netflow24h: number;     // Negative = outflow (bullish), positive = inflow (bearish)
};

export type OnChainContext = {
  funding: FundingRate | null;
  openInterest: OpenInterestData | null;
  longShort: LongShortRatio | null;
  exchangeFlow: ExchangeFlow | null;
  fetchedAt: number;
};

// ---------------------------------------------------------------------------
// Analysis — pure functions
// ---------------------------------------------------------------------------

export type OnChainScore = {
  /** -1 (strongly bearish) to +1 (strongly bullish). */
  score: number;
  /** 0..1 confidence in this score. */
  confidence: number;
  /** Reasons in machine codes. */
  reasons: string[];
};

const EMPTY_SCORE: OnChainScore = { score: 0, confidence: 0, reasons: [] };

/**
 * Scores the on-chain picture for a symbol.
 * All inputs are numbers so the function is PURE.
 */
export function scoreOnChain(ctx: OnChainContext): OnChainScore {
  if (!ctx.funding && !ctx.openInterest && !ctx.longShort) {
    return { ...EMPTY_SCORE, reasons: ["no_chain_data"] };
  }

  let score = 0;
  let totalWeight = 0;
  const reasons: string[] = [];

  // --- Funding Rate (weight: 0.35) ---
  if (ctx.funding) {
    totalWeight += 0.35;
    switch (ctx.funding.signal) {
      case "highly_positive":
        score -= 0.35; // Overheated — expect correction
        reasons.push("funding_overheated");
        break;
      case "positive":
        score += 0.1; // Normal bull market funding
        reasons.push("funding_normal_bull");
        break;
      case "neutral":
        // No signal
        break;
      case "negative":
        score -= 0.1; // Slight bearish sentiment
        reasons.push("funding_bearish");
        break;
      case "highly_negative":
        score += 0.35; // Capitulation — expect bounce
        reasons.push("funding_capitulation");
        break;
    }
  }

  // --- Open Interest (weight: 0.40) ---
  if (ctx.openInterest) {
    totalWeight += 0.40;
    switch (ctx.openInterest.trend) {
      case "rising":
        // OI rising = trend is supported by new positions
        // Directional score depends on price context (passed separately)
        reasons.push("oi_rising");
        // We don't score here — the caller combines with price context
        break;
      case "falling":
        // OI falling = positions closing = trend weakening
        reasons.push("oi_falling");
        break;
      case "stable":
        reasons.push("oi_stable");
        break;
    }
  }

  // --- Long/Short Ratio (weight: 0.25) ---
  if (ctx.longShort) {
    totalWeight += 0.25;
    switch (ctx.longShort.signal) {
      case "extreme_long":
        score -= 0.25; // Contrarian: too many longs = top signal
        reasons.push("ls_extreme_long");
        break;
      case "long_biased":
        score += 0.05; // Slight bullish bias
        reasons.push("ls_long_biased");
        break;
      case "balanced":
        reasons.push("ls_balanced");
        break;
      case "short_biased":
        score -= 0.05;
        reasons.push("ls_short_biased");
        break;
      case "extreme_short":
        score += 0.25; // Contrarian: too many shorts = bottom signal
        reasons.push("ls_extreme_short");
        break;
    }
  }

  // Normalise score: divide by total weight so each component
  // contributes proportionally regardless of data availability
  if (totalWeight > 0) {
    score = score / totalWeight;
  }

  return {
    score: Math.max(-1, Math.min(1, score)),
    confidence: totalWeight > 0.5 ? 0.6 : totalWeight > 0.25 ? 0.4 : 0.2,
    reasons,
  };
}

/**
 * Combines on-chain score with price direction to give a directional signal.
 *
 * Example: OI rising + price rising = bullish continuation signal.
 *          OI rising + price falling = bearish (liquidations).
 */
export function directionalChainScore(
  chainScore: OnChainScore,
  priceDirection: number, // -1..1 (negative = bearish, positive = bullish)
  oiTrend: "rising" | "falling" | "stable",
): number {
  let score = chainScore.score;

  // OI + price alignment
  if (oiTrend === "rising" && Math.abs(priceDirection) > 0.3) {
    // OI confirms the price direction
    score += priceDirection * 0.15;
  } else if (oiTrend === "falling" && Math.abs(priceDirection) > 0.3) {
    // OI contraditcts — trend is weakening
    score -= priceDirection * 0.15;
  }

  return Math.max(-1, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Data fetching utilities (called by the market data layer)
// ---------------------------------------------------------------------------

export const COINGLASS_BASE = "https://open-api-v3.coinglass.com/api";

/**
 * Fetches funding rate from Coinglass public API.
 * Requires API key in COINGLASS_API_KEY env.
 */
export async function fetchFundingRate(symbol: string): Promise<FundingRate | null> {
  try {
    const key = process.env.COINGLASS_API_KEY;
    if (!key) return null;

    const res = await fetch(
      `${COINGLASS_BASE}/futures/funding-rate/v3?symbol=${symbol}&limit=1`,
      { headers: { apiKey: key }, signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.[0]) return null;

    const rate = Number(data.data[0].fundingRate ?? 0);
    const apr = rate * 3 * 365 * 100; // 3 settlements/day × 365 days × 100%

    let signal: FundingRate["signal"] = "neutral";
    if (rate > 0.001) signal = "highly_positive";
    else if (rate > 0.0003) signal = "positive";
    else if (rate < -0.001) signal = "highly_negative";
    else if (rate < -0.0001) signal = "negative";

    return { symbol, rate, apr, signal };
  } catch {
    return null;
  }
}

/**
 * Fetches open interest data from Coinglass.
 */
export async function fetchOpenInterest(symbol: string): Promise<OpenInterestData | null> {
  try {
    const key = process.env.COINGLASS_API_KEY;
    if (!key) return null;

    const res = await fetch(
      `${COINGLASS_BASE}/futures/openInterest/v3?symbol=${symbol}&limit=2`,
      { headers: { apiKey: key }, signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.[0]) return null;

    const current = Number(data.data[0].openInterest ?? 0);
    const prev = data.data[1] ? Number(data.data[1].openInterest ?? 0) : current;
    const changePct = prev > 0 ? ((current - prev) / prev) * 100 : 0;

    let trend: OpenInterestData["trend"] = "stable";
    if (changePct > 3) trend = "rising";
    else if (changePct < -3) trend = "falling";

    return {
      symbol,
      currentOI: current,
      oi24hChangePct: changePct,
      oi7dChangePct: 0, // Would need more data
      trend,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches long/short ratio from Coinglass.
 */
export async function fetchLongShortRatio(symbol: string): Promise<LongShortRatio | null> {
  try {
    const key = process.env.COINGLASS_API_KEY;
    if (!key) return null;

    const res = await fetch(
      `${COINGLASS_BASE}/futures/longShort/v3?symbol=${symbol}&limit=1`,
      { headers: { apiKey: key }, signal: AbortSignal.timeout(5000) },
    );

    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.[0]) return null;

    const long = Number(data.data[0].longVolUsd ?? 0);
    const short = Number(data.data[0].shortVolUsd ?? 0);
    const total = long + short;
    if (total <= 0) return null;

    const longRatio = long / total;
    let signal: LongShortRatio["signal"] = "balanced";
    if (longRatio > 0.75) signal = "extreme_long";
    else if (longRatio > 0.6) signal = "long_biased";
    else if (longRatio < 0.25) signal = "extreme_short";
    else if (longRatio < 0.4) signal = "short_biased";

    return {
      symbol,
      longRatio,
      shortRatio: 1 - longRatio,
      accounts: Number(data.data[0].accounts ?? 0),
      signal,
    };
  } catch {
    return null;
  }
}

export async function fetchAllOnChain(symbol: string): Promise<OnChainContext> {
  const [funding, openInterest, longShort] = await Promise.all([
    fetchFundingRate(symbol),
    fetchOpenInterest(symbol),
    fetchLongShortRatio(symbol),
  ]);

  return {
    funding,
    openInterest,
    longShort,
    exchangeFlow: null, // Exchange flow requires separate API
    fetchedAt: Date.now(),
  };
}
