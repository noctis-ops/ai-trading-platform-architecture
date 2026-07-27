// ---------------------------------------------------------------------------
// Backtest runner.
//
//   npx tsx scripts/run-backtest.ts [--symbols BTCUSDT,ETHUSDT] [--bars 4000]
//                                    [--walk-forward] [--train-bars 2000]
//                                    [--test-bars 1000] [--step 1]
//
// Replays the EXACT `decide()` path the live bot uses over historical candles
// and reports honest performance: win rate, expectancy, max drawdown, max
// consecutive losses — computed over ALL decisions, rejections included.
//
// ⚠️  DATA HONESTY: by default this runs on the DETERMINISTIC SIMULATOR
// (src/lib/market/simulator.ts). Simulated prices are NOT a performance claim
// and must never be shown to a customer. They exist to prove the harness is
// wired correctly (the brain takes real trades, rejections are recorded, fills
// are conservative). Before publishing ANY number, feed REAL historical candles
// and paper-run the bot in production for 4–8 weeks (MASTER.md §10 / v2.2.3).
// ---------------------------------------------------------------------------
import { generateCandles } from "../src/lib/market/simulator";
import {
  DEFAULT_BRAIN_CONFIG,
  TIMEFRAME_MINUTES,
  type Candle,
  type Timeframe,
} from "../src/lib/intelligence/types";
import {
  aggregateMetrics,
  buildWalkForward,
  computeMetrics,
  runBacktest,
  type BacktestMetrics,
  type CandlesByTimeframe,
} from "../src/lib/backtest";

const FINE_TF: Timeframe = "15m";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
        out[a.slice(2)] = argv[++i];
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}

/** Build consistent multi-timeframe candles by aggregating the finest series,
 *  so higher timeframes are the SAME underlying path, not an independent GBM. */
function buildConsistentCandles(symbol: string, bars: number, timeframes: Timeframe[]): CandlesByTimeframe {
  const fine = generateCandles(symbol, FINE_TF, bars);
  const out: CandlesByTimeframe = { [FINE_TF]: fine };
  for (const tf of timeframes) {
    if (tf === FINE_TF) continue;
    const ratio = TIMEFRAME_MINUTES[tf] / TIMEFRAME_MINUTES[FINE_TF];
    out[tf] = aggregate(fine, ratio);
  }
  return out;
}

function aggregate(base: Candle[], ratio: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + ratio <= base.length; i += ratio) {
    const group = base.slice(i, i + ratio);
    out.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((s, c) => s + c.volume, 0),
    });
  }
  const rem = base.length % ratio;
  if (rem > 0) {
    const group = base.slice(base.length - rem);
    out.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((s, c) => s + c.volume, 0),
    });
  }
  return out;
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtNum(x: number, d = 2): string {
  if (!Number.isFinite(x)) return "∞";
  return x.toFixed(d);
}

function printMetrics(label: string, m: BacktestMetrics): void {
  console.log(`\n${label}`);
  console.log("─".repeat(64));
  console.log(`  decisions (all)      : ${m.totalDecisions}  (enter=${m.entries}, reject/wait=${m.totalDecisions - m.entries})`);
  console.log(`  selectivity           : ${fmtPct(m.selectivity)}  (low is disciplined)`);
  console.log(`  closed trades         : ${m.trades}`);
  console.log(`  win rate              : ${fmtPct(m.winRate)}`);
  console.log(`  scratch rate (BE)     : ${fmtPct(m.scratchRate)}`);
  console.log(`  loss rate             : ${fmtPct(m.lossRate)}`);
  console.log(`  expectancy (R/trade)  : ${fmtNum(m.expectancyR)}`);
  console.log(`  expectancy (%/trade)  : ${fmtNum(m.expectancyPct)}%`);
  console.log(`  profit factor         : ${fmtNum(m.profitFactor, 2)}`);
  console.log(`  max drawdown          : ${fmtPct(m.maxDrawdownPct / 100)}`);
  console.log(`  max consec. losses    : ${m.maxConsecutiveLosses}`);
  console.log(`  avg hold (bars)       : ${fmtNum(m.avgHoldBars, 1)}`);
  console.log(`  final equity (start100): ${fmtNum(m.finalEquity, 2)}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const timeframes = DEFAULT_BRAIN_CONFIG.timeframes as Timeframe[];
  // 4000 × 15m ≈ 10 days — fast default that still exercises the harness.
  // Pass --bars 8000+ for a deeper synthetic history (or feed real candles).
  let bars = Number(args["bars"] ?? 4000);
  // Walk-forward needs enough slow-timeframe history to clear the 210-bar
  // warm-up on every fold, so we raise the default automatically when asked.
  if (args["walk-forward"] && bars < 8000) {
    console.log(`  (walk-forward: auto-raised --bars to 8000 for slow-timeframe warm-up)`);
    bars = 8000;
  }
  const symbols = args["symbols"]
    ? String(args["symbols"]).split(",").map((s) => s.trim().toUpperCase())
    : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "MATICUSDT"];
  const step = Number(args["step"] ?? 1);

  console.log("╔════════════════════════════════════════════════════════════════════╗");
  console.log("║  BACKTEST HARNESS — replays the live decide() path               ║");
  console.log("╠════════════════════════════════════════════════════════════════════╣");
  console.log("║  ⚠️  DEFAULT DATA = DETERMINISTIC SIMULATOR (synthetic GBM).      ║");
  console.log("║  These numbers PROVE THE HARNESS WORKS — they are NOT a          ║");
  console.log("║  performance claim and must never be shown to a customer.        ║");
  console.log("║  Feed REAL historical candles + paper-run live before selling.  ║");
  console.log("╚════════════════════════════════════════════════════════════════════╝");
  console.log(`\nConfig: timeframes=${timeframes.join("/")}  bars=${bars}  decisionStep=${step}`);
  console.log(`Brain : minConfluence=${DEFAULT_BRAIN_CONFIG.minConfluence}  minProb=${DEFAULT_BRAIN_CONFIG.minProbability}  minRR=${DEFAULT_BRAIN_CONFIG.minRiskReward}`);

  const results = symbols.map((symbol) => {
    const candles = buildConsistentCandles(symbol, bars, timeframes);
    const result = runBacktest(candles, { symbol, step });
    const m = computeMetrics(result);
    printMetrics(`◆ ${symbol}`, m);
    return result;
  });

  printMetrics("◆ AGGREGATE (all symbols)", aggregateMetrics(results));

  if (args["walk-forward"]) {
    const trainBars = Number(args["train-bars"] ?? 3000);
    const testBars = Number(args["test-bars"] ?? 1500);
    console.log(`\n\n╔════════════════════════════════════════════════════════════════════╗`);
    console.log(`║  WALK-FORWARD — out-of-sample folds (config NOT re-fit)        ║`);
    console.log(`╚════════════════════════════════════════════════════════════════════╝`);

    const foldResults = symbols.flatMap((symbol) => {
      const candles = buildConsistentCandles(symbol, bars, timeframes);
      const folds = buildWalkForward(candles, FINE_TF, { trainBars, testBars });
      const out = [];
      for (const fold of folds) {
        const result = runBacktest(fold.candles, { symbol: `${symbol}:${fold.label}`, step, startIndex: fold.startIndex });
        if (result.totalDecisions === 0) {
          console.log(`  (skipped ${symbol}:${fold.label}: not enough slow-timeframe warm-up — pass --bars 8000)`);
          continue;
        }
        out.push(result);
      }
      return out;
    });

    if (foldResults.length === 0) {
      console.log("\n  No walk-forward fold had enough history at --bars " + bars + ". Re-run with a larger --bars.");
    } else {
      foldResults.forEach((r) => printMetrics(`◆ ${r.symbol}`, computeMetrics(r)));
      printMetrics("◆ WALK-FORWARD OUT-OF-SAMPLE (all folds)", aggregateMetrics(foldResults));
    }
  }

  console.log("\nDone.");
}

main();
