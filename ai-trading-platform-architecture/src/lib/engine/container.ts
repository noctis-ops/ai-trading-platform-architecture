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
import { PostgresSignalStore } from "./postgres-store";
import { TelegramNotifier } from "./telegram-notifier";
import { SignalEngine, DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./signal-engine";

let routerInstance: MarketDataRouter | null = null;
let telegramInstance: TelegramClient | null = null;
let engineInstance: SignalEngine | null = null;

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
    engineInstance = new SignalEngine(
      getMarketRouter(),
      new PostgresSignalStore(),
      new TelegramNotifier(getTelegramClient()),
      loadEngineConfig(),
    );
  }
  return engineInstance;
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
}
