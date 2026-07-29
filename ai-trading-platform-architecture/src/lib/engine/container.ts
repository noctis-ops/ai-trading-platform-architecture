// ---------------------------------------------------------------------------
// Composition root.
//
// The ONE place where concrete implementations are wired into the engine's
// ports. Everything else in the codebase depends on interfaces, which is what
// keeps the brain testable and the storage swappable.
//
// Instances are memoised per process: the market-data router holds circuit
// breaker state that must survive across requests, and rebuilding it on every
// call would silently reset the breaker and defeat the failover design.
// ---------------------------------------------------------------------------
import { buildSources } from "../market/adapters";
import { MarketDataRouter } from "../market/exchange";
import { TelegramClient } from "../telegram/client";
import { alertOwners } from "../telegram/handler";
import { AutoTrader, type AutoTraderMode } from "../trading/auto-trader";
import { BinanceFuturesAdapter, SimulatedExchange } from "../trading/exchange-executor";
import type { TradingConfig } from "../trading/types";
import { DEFAULT_TRADING_CONFIG } from "../trading/types";
import { PostgresSignalStore } from "./postgres-store";
import { TelegramNotifier } from "./telegram-notifier";
import { SignalEngine, DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./signal-engine";

let routerInstance: MarketDataRouter | null = null;
let telegramInstance: TelegramClient | null = null;
let engineInstance: SignalEngine | null = null;
let autoTraderInstance: AutoTrader | null = null;

export function getMarketRouter(): MarketDataRouter {
  if (!routerInstance) {
    routerInstance = new MarketDataRouter(
      buildSources(),
      3,
      60_000,
      (source) => alertOwners(`⚠️ تنبيه: تم إيقاف مصدر البيانات مؤقتاً لتكرار الأعطال (${source}). النظام سيستمر بالعمل عبر المصادر البديلة إن وجدت.`).catch(console.error)
    );
  }
  return routerInstance;
}

export function getTelegramClient(): TelegramClient {
  if (!telegramInstance) {
    telegramInstance = new TelegramClient({ botToken: requireEnv("TELEGRAM_BOT_TOKEN") });
  }
  return telegramInstance;
}

export function getSignalEngine(): SignalEngine {
  if (!engineInstance) {
    const trader = getAutoTrader();
    const mode = (process.env.TRADING_MODE as string) ?? "off";
    engineInstance = new SignalEngine(
      getMarketRouter(),
      new PostgresSignalStore(),
      new TelegramNotifier(getTelegramClient()),
      loadEngineConfig(),
      mode !== "off" ? trader : undefined,
    );
  }
  return engineInstance;
}

/**
 * Returns the auto-trader singleton.
 *
 * Mode is controlled by TRADING_MODE env:
 *   - "off"   = signals only, no execution
 *   - "paper" = simulated execution (PAPER_TRADING_EQUITY sets initial capital)
 *   - "live"  = real exchange execution (requires exchange API keys)
 */
export function getAutoTrader(): AutoTrader {
  if (!autoTraderInstance) {
    const mode: AutoTraderMode = (process.env.TRADING_MODE as AutoTraderMode) ?? "off";

    const tradingConfig = loadTradingConfig();

    if (mode === "paper") {
      const equity = intEnv("PAPER_TRADING_EQUITY", 10000);
      autoTraderInstance = AutoTrader.paper(equity, tradingConfig);

      // Wire paper trader to Telegram for event notifications
      autoTraderInstance.onEvent(async (event) => {
        if (event.type === "position_opened" || event.type === "position_closed") {
          try {
            await alertOwners(`📊 متداول ورقي: ${event.type === "position_opened" ? "فتح صفقة" : "إغلاق صفقة"} على ${"symbol" in event ? (event as any).symbol : ""}`);
          } catch { /* ignore */ }
        }
        if (event.type === "emergency_halt") {
          try {
            await alertOwners(`🚨 إيقاف طارئ للمتداول الآلي: ${(event as any).reason}`);
          } catch { /* ignore */ }
        }
      });
    } else if (mode === "live") {
      const apiKey = requireEnv("BINANCE_API_KEY");
      const apiSecret = requireEnv("BINANCE_API_SECRET");
      const adapter = new BinanceFuturesAdapter(apiKey, apiSecret);

      autoTraderInstance = new AutoTrader(adapter, tradingConfig, "live");

      // Wire live trader to Telegram for ALL events
      autoTraderInstance.onEvent(async (event) => {
        const msgs: string[] = [];
        switch (event.type) {
          case "position_opened":
            msgs.push(`✅ فتح صفقة حقيقية: ${(event as any).positionId}`);
            break;
          case "position_closed":
            msgs.push(`${(event as any).pnl >= 0 ? "🟢" : "🔴"} إغلاق صفقة: ${(event as any).reason} | PnL: ${(event as any).pnl?.toFixed?.(2) ?? (event as any).pnl} USDT`);
            break;
          case "emergency_halt":
            msgs.push(`🚨 إيقاف طارئ: ${(event as any).reason}`);
            break;
          case "daily_loss_limit_hit":
            msgs.push(`⚠️ تم بلوغ حد الخسارة اليومي!`);
            break;
          case "drawdown_limit_hit":
            msgs.push(`⚠️ تم بلوغ حد التراجع الأقصى!`);
            break;
        }
        for (const msg of msgs) {
          try { await alertOwners(msg); } catch { /* ignore */ }
        }
      });
    } else {
      // mode === "off"
      autoTraderInstance = new AutoTrader(new SimulatedExchange(0), { enabled: false }, "off");
    }
  }
  return autoTraderInstance;
}

function loadTradingConfig(): Partial<TradingConfig> {
  return {
    enabled: process.env.TRADING_MODE !== "off" && process.env.TRADING_MODE !== undefined,
    riskPerTradePct: floatEnv("TRADING_RISK_PER_TRADE_PCT", DEFAULT_TRADING_CONFIG.riskPerTradePct),
    maxRiskPerTradePct: floatEnv("TRADING_MAX_RISK_PER_TRADE_PCT", DEFAULT_TRADING_CONFIG.maxRiskPerTradePct),
    maxDailyLossPct: floatEnv("TRADING_MAX_DAILY_LOSS_PCT", DEFAULT_TRADING_CONFIG.maxDailyLossPct),
    maxDrawdownPct: floatEnv("TRADING_MAX_DRAWDOWN_PCT", DEFAULT_TRADING_CONFIG.maxDrawdownPct),
    maxConcurrentPositions: intEnv("TRADING_MAX_CONCURRENT_POSITIONS", DEFAULT_TRADING_CONFIG.maxConcurrentPositions),
    leverage: intEnv("TRADING_DEFAULT_LEVERAGE", DEFAULT_TRADING_CONFIG.leverage),
    maxLeverage: intEnv("TRADING_MAX_LEVERAGE", DEFAULT_TRADING_CONFIG.maxLeverage),
    sizingMethod: (process.env.TRADING_SIZING_METHOD as TradingConfig["sizingMethod"]) ?? DEFAULT_TRADING_CONFIG.sizingMethod,
    kellyFraction: floatEnv("TRADING_KELLY_FRACTION", DEFAULT_TRADING_CONFIG.kellyFraction),
    trailStop: process.env.TRADING_TRAIL_STOP !== "false",
    moveStopToBreakeven: process.env.TRADING_MOVE_STOP_TO_BREAKEVEN !== "false",
    scaleOutAtTp1: process.env.TRADING_SCALE_OUT_AT_TP1 === "true",
    scaleOutTp1Fraction: floatEnv("TRADING_SCALE_OUT_TP1_FRACTION", DEFAULT_TRADING_CONFIG.scaleOutTp1Fraction),
  };
}

/**
 * Engine tuning from env, with the calibrated defaults as the floor.
 *
 * Deliberately does NOT expose `minConfluence` here: that threshold is backed
 * by a measured study (scripts/calibrate-thresholds.ts) and lowering it via an
 * env var would let someone quietly turn market noise into billable signals
 * without re-running the evidence.
 */
function loadEngineConfig(): EngineConfig {
  return {
    ...DEFAULT_ENGINE_CONFIG,
    maxSignalsPerDay: intEnv("MAX_SIGNALS_PER_DAY", DEFAULT_ENGINE_CONFIG.maxSignalsPerDay),
    cooldownMinutes: intEnv("SIGNAL_COOLDOWN_MINUTES", DEFAULT_ENGINE_CONFIG.cooldownMinutes),
    publishRefusals: process.env.PUBLISH_REFUSALS === "true",
  };
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function floatEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}

/** Test seam: drops memoised singletons so a suite can inject fakes. */
export function resetContainer(): void {
  routerInstance = null;
  telegramInstance = null;
  engineInstance = null;
  autoTraderInstance = null;
}
