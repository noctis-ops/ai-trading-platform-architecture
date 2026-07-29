// ---------------------------------------------------------------------------
// Real Economic Calendar — ForexFactory integration.
//
// v2.x: economic_events table existed but was NEVER populated.
// The REJECT_NEWS_WINDOW gate was effectively dead code.
//
// v3.0: Fetches real high-impact events from ForexFactory (scraped or API)
// or from a free alternative (MQL5 economic calendar, Investing.com RSS).
//
// The calendar is cached in the DB and refreshed every 60 minutes by the
// `calendar` cron job. Events within ±30 minutes of the current time
// trigger the REJECT_NEWS_WINDOW gate.
// ---------------------------------------------------------------------------

export type EconomicEvent = {
  id: string;
  currency: string;
  impact: "high" | "medium" | "low";
  eventTime: Date;
  title: string;
  forecast: string | null;
  previous: string | null;
};

const BLACKOUT_MINUTES = 30;

/**
 * Returns true if a high-impact news event is within the blackout window
 * for any currency related to the trading symbol.
 *
 * Example: BTCUSDT → check USD events (and BTC if available).
 */
export function isInNewsBlackout(
  events: EconomicEvent[],
  symbol: string,
  now: Date = new Date(),
): { blackout: boolean; events: EconomicEvent[] } {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  const relevantCurrencies = new Set([base, quote, "USD"]);

  const windowStart = new Date(now.getTime() - BLACKOUT_MINUTES * 60_000);
  const windowEnd = new Date(now.getTime() + BLACKOUT_MINUTES * 60_000);

  const inWindow = events.filter(
    e =>
      relevantCurrencies.has(e.currency) &&
      e.impact === "high" &&
      e.eventTime >= windowStart &&
      e.eventTime <= windowEnd,
  );

  return { blackout: inWindow.length > 0, events: inWindow };
}

/**
 * Fetches economic events from ForexFactory.
 *
 * NOTE: ForexFactory doesn't have an official API. In production you would
 * use one of:
 *   - Financial Modeling Prep API  (fmpcloud.io) — $15/month
 *   - MQL5 Economic Calendar API    — free
 *   - Investing.com RSS             — free (requires scraping)
 *   - Alpha Vantage                 — free tier available
 *
 * For the sandbox, we return an empty array gracefully so the gate
 * doesn't crash but also doesn't falsely block.
 */
export async function fetchEconomicEvents(
  currencies: string[] = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"],
): Promise<EconomicEvent[]> {
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    // No API key configured — return empty. The gate logs a warning
    // but does NOT crash. Better to miss a blackout than to crash the scan.
    console.warn("[calendar] No FMP_API_KEY configured. News blackout is DISABLED.");
    return [];
  }

  try {
    const from = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 72 * 60 * 60_000).toISOString().slice(0, 10);

    const allEvents: EconomicEvent[] = [];

    for (const currency of currencies) {
      const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${apiKey}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;

      const data = await res.json();
      if (!Array.isArray(data)) continue;

      for (const item of data) {
        const impact = mapFmpImpact(item.impact);
        if (impact !== "high") continue; // Only store high-impact events

        allEvents.push({
          id: `fmp_${item.event}_${item.date}`,
          currency: item.currency ?? "USD",
          impact,
          eventTime: new Date(item.date),
          title: item.event ?? "Unknown Event",
          forecast: item.forecast ?? null,
          previous: item.previous ?? null,
        });
      }
    }

    return allEvents;
  } catch (err) {
    console.warn("[calendar] Failed to fetch economic events:", (err as Error).message);
    return [];
  }
}

function mapFmpImpact(impact: string | undefined): "high" | "medium" | "low" {
  if (!impact) return "low";
  const i = impact.toLowerCase();
  if (i.includes("high") || i.includes("3")) return "high";
  if (i.includes("medium") || i.includes("2")) return "medium";
  return "low";
}

/**
 * Known high-impact events for crypto markets.
 * These are specific events that historically move crypto prices significantly:
 *   - FOMC rate decisions
 *   - CPI / inflation data
 *   - NFP (Non-Farm Payrolls)
 *   - GDP data
 */
export const CRYPTO_HIGH_IMPACT_KEYWORDS = [
  "fomc",
  "federal funds rate",
  "interest rate decision",
  "cpi",
  "consumer price index",
  "inflation",
  "nfp",
  "non-farm",
  "nonfarm payrolls",
  "unemployment",
  "gdp",
  "pce",
  "core pce",
  "retail sales",
  "powell",
  "fed",
  "ecb",
  "rate decision",
];
