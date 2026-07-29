// ---------------------------------------------------------------------------
// Signal Engine — orchestration between market data, the brain, and delivery.
//
// This is the only module that knows about *sequencing*; the brain stays pure
// and the Telegram layer stays dumb. Responsibilities:
//   1. Scan the watched universe on a schedule.
//   2. Feed validated multi-timeframe candles into the decision engine.
//   3. Persist EVERY decision (including refusals) via the ports below.
//   4. Track open signals against live price and emit TP/SL events.
//
// Persistence and messaging are injected as PORTS (hexagonal architecture),
// so this file has no database or Telegram imports and can be unit-tested
// with in-memory fakes.
// ---------------------------------------------------------------------------
import { decide, type DecisionContext } from "../intelligence/decision";
import { DEFAULT_BRAIN_CONFIG, type BrainConfig, type Candle, type Decision, type Timeframe } from "../intelligence/types";
import { validateCandles, type MarketDataRouter } from "../market/exchange";
import type { AutoTrader } from "../trading/auto-trader";

export const ENGINE_VERSION = process.env.ENGINE_VERSION ?? "2.2.0";

export type StoredSignal = {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  status: "open" | "tp1_hit" | "tp2_hit" | "stopped" | "breakeven" | "closed_manual" | "invalidated";
  openedAt: number;
  /** Set once TP1 is hit and the stop is moved to entry. */
  stopMovedToBreakeven: boolean;
  mfeR: number;
  maeR: number;
};

/** Everything the engine needs from the outside world. */
export interface SignalStore {
  getWatchedSymbols(): Promise<string[]>;
  getOpenSignals(): Promise<StoredSignal[]>;
  getSignalCountToday(): Promise<number>;
  getMinutesSinceLastSignal(symbol: string): Promise<number | undefined>;
  getCalibrationMultiplier(symbol: string, regime: string): Promise<number>;
  isNewsBlackout(symbol: string, at: Date): Promise<boolean>;
  saveDecision(decision: Decision, engineVersion: string): Promise<string>;
  updateSignal(id: string, patch: Partial<StoredSignal>): Promise<void>;
  recordEvent(signalId: string, type: string, price: number, payload?: Record<string, unknown>): Promise<void>;
}

export interface Notifier {
  publishSignal(signalId: string, decision: Decision): Promise<void>;
  publishClose(signal: StoredSignal, exitPrice: number, outcome: "tp1" | "tp2" | "stop" | "breakeven"): Promise<void>;
}

export type EngineConfig = {
  brain: BrainConfig;
  candleLimit: number;
  maxSignalsPerDay: number;
  cooldownMinutes: number;
  /** Publish "no trade" explanations, or stay silent unless asked. */
  publishRefusals: boolean;
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  brain: DEFAULT_BRAIN_CONFIG,
  candleLimit: 300,
  maxSignalsPerDay: 6,
  cooldownMinutes: 240,
  publishRefusals: false,
};

export type ScanResult = {
  symbol: string;
  decision: Decision | null;
  published: boolean;
  /** Whether the auto-trader executed this decision. */
  autoExecuted: boolean;
  error?: string;
};

export class SignalEngine {
  constructor(
    private readonly router: MarketDataRouter,
    private readonly store: SignalStore,
    private readonly notifier: Notifier,
    private readonly config: EngineConfig = DEFAULT_ENGINE_CONFIG,
    private readonly autoTrader?: AutoTrader,
  ) {}

  /** One full pass over the watched universe. */
  async scanAll(now: Date = new Date()): Promise<ScanResult[]> {
    const symbols = await this.store.getWatchedSymbols();
    const results: ScanResult[] = [];
    // Sequential on purpose: public market-data endpoints are rate limited,
    // and a scan that gets us banned is worse than a scan that takes longer.
    for (const symbol of symbols) {
      results.push(await this.scanSymbol(symbol, now));
    }
    return results;
  }

  async scanSymbol(symbol: string, now: Date = new Date()): Promise<ScanResult> {
    try {
      const decision = await this.analyse(symbol, now);
      const signalId = await this.store.saveDecision(decision, ENGINE_VERSION);

      const shouldPublish = decision.verdict === "enter" || this.config.publishRefusals;
      if (shouldPublish) await this.notifier.publishSignal(signalId, decision);

      // Auto-execute the trade if auto-trader is available
      let autoExecuted = false;
      if (this.autoTrader && decision.verdict === "enter" && decision.plan) {
        const result = await this.autoTrader.onDecision(decision);
        autoExecuted = result.executed;
        // Link the signal to the position
        if (result.executed && result.positionId) {
          // Store the positionId in signal metadata
          await this.store.updateSignal(signalId, {
            id: signalId,
            symbol,
            direction: decision.direction ?? "long",
            entryPrice: decision.plan.entry,
            stopLoss: decision.plan.stopLoss,
            takeProfit1: decision.plan.takeProfit1,
            takeProfit2: decision.plan.takeProfit2,
            status: "open",
            openedAt: Date.now(),
            stopMovedToBreakeven: false,
            mfeR: 0,
            maeR: 0,
          });
        }
      }

      return { symbol, decision, published: shouldPublish, autoExecuted };
    } catch (err) {
      return { symbol, decision: null, published: false, autoExecuted: false, error: (err as Error).message };
    }
  }

  /** Analysis without persistence — used by the on-demand /تحليل command. */
  async analyse(symbol: string, now: Date = new Date()): Promise<Decision> {
    const timeframes = this.config.brain.timeframes as Timeframe[];
    const raw = await this.router.fetchMultiTimeframe(symbol, timeframes, this.config.candleLimit);

    const candles: Partial<Record<Timeframe, Candle[]>> = {};
    for (const tf of timeframes) {
      const series = raw[tf];
      if (!series) continue;
      const { valid, cleaned } = validateCandles(series, tf);
      // Invalid feeds are dropped, not patched. The brain then refuses on
      // REJECT_INSUFFICIENT_DATA rather than trading on bad prices.
      if (valid) candles[tf] = cleaned;
    }

    const openSignals = await this.store.getOpenSignals();
    const ctx: DecisionContext = {
      newsBlackout: await this.store.isNewsBlackout(symbol, now),
      hasOpenSignal: openSignals.some((s) => s.symbol === symbol),
      signalsToday: await this.store.getSignalCountToday(),
      maxSignalsPerDay: this.config.maxSignalsPerDay,
      minutesSinceLastSignal: await this.store.getMinutesSinceLastSignal(symbol),
      cooldownMinutes: this.config.cooldownMinutes,
    };

    const provisional = decide(symbol, candles, this.config.brain, ctx);
    // Second pass with the regime-specific calibration applied.
    const multiplier = await this.store.getCalibrationMultiplier(symbol, provisional.regime);
    if (multiplier === 1) return provisional;
    return decide(symbol, candles, this.config.brain, { ...ctx, calibration: multiplier });
  }

  /**
   * Tracks open signals against the latest price.
   *
   * Conservative fill assumption: if a bar touched both the stop and the
   * target, we assume the STOP filled first. Optimistic assumptions here are
   * how vendors publish win rates their customers never actually achieve.
   */
  async trackOpenSignals(): Promise<void> {
    const open = await this.store.getOpenSignals();
    for (const signal of open) {
      let ticker;
      try {
        ticker = await this.router.fetchTicker(signal.symbol);
      } catch {
        continue; // A price we cannot verify must not close a customer's trade.
      }
      await this.evaluateSignal(signal, ticker.price);
    }

    // Also sync auto-trader positions
    if (this.autoTrader) {
      await this.autoTrader.trackPositions();
    }
  }

  private async evaluateSignal(signal: StoredSignal, price: number): Promise<void> {
    const isLong = signal.direction === "long";
    const risk = Math.abs(signal.entryPrice - signal.stopLoss);
    if (risk <= 0) return;

    const moveR = (isLong ? price - signal.entryPrice : signal.entryPrice - price) / risk;
    const mfeR = Math.max(signal.mfeR, moveR);
    const maeR = Math.min(signal.maeR, moveR);

    const effectiveStop = signal.stopMovedToBreakeven ? signal.entryPrice : signal.stopLoss;
    const stopHit = isLong ? price <= effectiveStop : price >= effectiveStop;
    const tp1Hit = isLong ? price >= signal.takeProfit1 : price <= signal.takeProfit1;
    const tp2Hit = isLong ? price >= signal.takeProfit2 : price <= signal.takeProfit2;

    if (stopHit) {
      const outcome = signal.stopMovedToBreakeven ? "breakeven" : "stop";
      await this.store.updateSignal(signal.id, {
        status: outcome === "breakeven" ? "breakeven" : "stopped",
        mfeR,
        maeR,
      });
      await this.store.recordEvent(signal.id, outcome === "breakeven" ? "stop_moved_be" : "stop_hit", price);
      await this.notifier.publishClose(signal, price, outcome);

      // Notify auto-trader of the close
      if (this.autoTrader) {
        await this.autoTrader.onSignalClose(signal.symbol, signal.direction, price, outcome, signal.id);
      }
      return;
    }

    if (tp2Hit) {
      await this.store.updateSignal(signal.id, { status: "tp2_hit", mfeR, maeR });
      await this.store.recordEvent(signal.id, "tp2_hit", price);
      await this.notifier.publishClose(signal, price, "tp2");

      if (this.autoTrader) {
        await this.autoTrader.onSignalClose(signal.symbol, signal.direction, price, "tp2", signal.id);
      }
      return;
    }

    if (tp1Hit && signal.status === "open") {
      // Risk-free management: after TP1, the stop moves to entry.
      await this.store.updateSignal(signal.id, { status: "tp1_hit", stopMovedToBreakeven: true, mfeR, maeR });
      await this.store.recordEvent(signal.id, "tp1_hit", price, { stopMovedTo: signal.entryPrice });
      await this.notifier.publishClose(signal, price, "tp1");

      if (this.autoTrader) {
        await this.autoTrader.onSignalClose(signal.symbol, signal.direction, price, "tp1", signal.id);
      }
      return;
    }

    if (mfeR !== signal.mfeR || maeR !== signal.maeR) {
      await this.store.updateSignal(signal.id, { mfeR, maeR });
    }
  }
}
