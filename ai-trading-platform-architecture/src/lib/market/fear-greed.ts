// ---------------------------------------------------------------------------
// Fear & Greed Index — crypto market sentiment
//
// The index ranges 0-100:
//   0-25  = Extreme Fear (historically a buy signal)
//   26-45 = Fear
//   46-55 = Neutral
//   56-75 = Greed
//   76-100 = Extreme Greed (historically a sell signal)
//
// Data sources:
//   - Alternative.me API (free, no key required): Bitcoin Fear & Greed
//   - Coinglass (needs API key): multi-asset
//
// This module is PURE: the score is passed as input, analysis is functional.
// ---------------------------------------------------------------------------

export type FearGreedLevel = "extreme_fear" | "fear" | "neutral" | "greed" | "extreme_greed";

export type FearGreedData = {
  value: number;         // 0-100
  level: FearGreedLevel;
  timestamp: number;     // unix ms when fetched
};

/**
 * Categorises a fear & greed value.
 */
export function classifyFearGreed(value: number): FearGreedLevel {
  if (value <= 25) return "extreme_fear";
  if (value <= 45) return "fear";
  if (value <= 55) return "neutral";
  if (value <= 75) return "greed";
  return "extreme_greed";
}

/**
 * Returns a position size multiplier based on fear & greed.
 *
 * Contrarian logic:
 *   - Extreme fear → buy opportunity → increase size (1.2x)
 *   - Extreme greed → sell signal → decrease size (0.5x)
 *
 * Weight: 0.15 of the total signal filter.
 */
export function fearGreedMultiplier(level: FearGreedLevel): number {
  switch (level) {
    case "extreme_fear": return 1.2;   // Best buying opportunity
    case "fear": return 1.1;
    case "neutral": return 1.0;
    case "greed": return 0.8;
    case "extreme_greed": return 0.5;  // Market overheated
  }
}

/**
 * Returns a directional bias from extreme readings.
 *
 * Extreme fear = bullish bias (buy)
 * Extreme greed = bearish bias (sell/fade)
 */
export function fearGreedBias(level: FearGreedLevel): "bullish" | "bearish" | "neutral" {
  switch (level) {
    case "extreme_fear": return "bullish";
    case "fear": return "bullish";
    case "neutral": return "neutral";
    case "greed": return "bearish";
    case "extreme_greed": return "bearish";
  }
}

/**
 * Fetches the current Bitcoin Fear & Greed Index from Alternative.me.
 * Free, no API key required. Rate limit: ~1 req/sec.
 */
export async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const item = data?.data?.[0];
    if (!item) return null;

    const value = Number(item.value ?? 50);
    return {
      value,
      level: classifyFearGreed(value),
      timestamp: Number(item.timestamp ?? 0) * 1000,
    };
  } catch {
    return null;
  }
}
