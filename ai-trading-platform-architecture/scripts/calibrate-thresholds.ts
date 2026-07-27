// ---------------------------------------------------------------------------
// Threshold calibration study.
//
//   npx tsx scripts/calibrate-thresholds.ts
//
// Measures the distribution of the aggregate multi-timeframe confluence score
// on directionless market data, and compares it against known-good setups.
// `minConfluence` must sit ABOVE the noise p99 and BELOW a textbook setup —
// otherwise the bot either signals on randomness or never speaks at all.
//
// Re-run this whenever an analyser or a weight changes; it is the evidence
// behind the numbers in DEFAULT_BRAIN_CONFIG.
// ---------------------------------------------------------------------------
import { decide } from "../src/lib/intelligence/decision";
import { DEFAULT_BRAIN_CONFIG, type Candle, type Timeframe } from "../src/lib/intelligence/types";
import { generateCandles } from "../src/lib/market/simulator";
import { breakdownSetup, breakoutSetup, chopMarket, mtf } from "../src/lib/intelligence/__tests__/fixtures";

// Gates disabled so we observe the raw score, not the filtered outcome.
const OPEN = { ...DEFAULT_BRAIN_CONFIG, minConfluence: 0, minProbability: 0, minRiskReward: 0 };

const SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "BNBUSDT",
  "MATICUSDT",
];

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor(p * (sorted.length - 1))];
}

function main() {
  const noise: number[] = [];

  for (const symbol of SYMBOLS) {
    const full: Partial<Record<Timeframe, Candle[]>> = {};
    for (const tf of OPEN.timeframes) full[tf] = generateCandles(symbol, tf, 900);

    for (let end = 300; end <= 900; end += 30) {
      const window: Partial<Record<Timeframe, Candle[]>> = {};
      for (const tf of OPEN.timeframes) window[tf] = full[tf]!.slice(end - 300, end);
      const d = decide(symbol, window, OPEN);
      if (d.confidence > 0) noise.push(d.confidence);
    }
  }

  noise.sort((a, b) => a - b);

  console.log(`\nAggregate confluence on undirected market data (n=${noise.length})`);
  console.log("─".repeat(58));
  for (const p of [0.5, 0.75, 0.9, 0.95, 0.99]) {
    console.log(`  p${String(p * 100).padStart(2)}  ${quantile(noise, p).toFixed(0)}`);
  }
  console.log(`  max  ${noise[noise.length - 1]?.toFixed(0)}`);

  console.log("\nKnown setups");
  console.log("─".repeat(58));
  const cases: [string, Candle[]][] = [
    ["breakout (A+ long)", breakoutSetup()],
    ["breakdown (A+ short)", breakdownSetup()],
    ["chop (must refuse)", chopMarket()],
  ];
  for (const [label, candles] of cases) {
    const raw = decide("TEST", mtf(candles), OPEN);
    const gated = decide("TEST", mtf(candles), DEFAULT_BRAIN_CONFIG);
    console.log(
      `  ${label.padEnd(22)} score=${String(raw.confidence).padStart(3)}  ` +
        `verdict=${gated.verdict.padEnd(6)} ${gated.blockedBy ?? ""}`,
    );
  }

  const p99 = quantile(noise, 0.99);
  console.log("\nVerdict");
  console.log("─".repeat(58));
  console.log(`  noise p99          : ${p99.toFixed(0)}`);
  console.log(`  configured minimum : ${DEFAULT_BRAIN_CONFIG.minConfluence}`);
  const ok = DEFAULT_BRAIN_CONFIG.minConfluence > p99;
  console.log(
    ok
      ? "  ✅ threshold sits above the noise floor"
      : "  ⚠️  threshold is INSIDE the noise band — random chop can produce signals",
  );
}

main();
