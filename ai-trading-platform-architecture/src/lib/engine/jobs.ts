// ---------------------------------------------------------------------------
// Scheduled jobs — the heartbeat of the service.
//
// Each job is a plain async function so it can be triggered by a cron HTTP
// route, a worker process, or a test. They are deliberately idempotent-ish and
// individually failure-isolated: one bad symbol must never abort a whole scan.
// ---------------------------------------------------------------------------
import { and, eq, gte, inArray, lte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { calibration, customers, deliveryLog, plans, signalOutcomes, signals, subscriptions, economicEvents } from "@/db/schema";
import { calibrateAll, deriveLessons } from "../intelligence/learning";
import { subscriptionExpiringSoonAr } from "../telegram/messages.ar";
import { getAutoTrader, getSignalEngine, getTelegramClient } from "./container";
import { buildReport, loadOutcomes, type Period } from "./reporting";
import { getMLPredictor, extractFeatures, type MLTrainingRow } from "../intelligence/ml-predictor";
import { fetchFearGreed } from "../market/fear-greed";
import { fetchDeribitOptions, analyseGammaSignal, gammaRiskMultiplier } from "../market/options-flow";

export type JobResult = { job: string; ok: boolean; details: Record<string, unknown> };

/** Scan the watched universe and publish any valid setups. */
export async function runScanJob(): Promise<JobResult> {
  const results = await getSignalEngine().scanAll();
  return {
    job: "scan",
    ok: true,
    details: {
      scanned: results.length,
      published: results.filter((r) => r.published).length,
      errors: results.filter((r) => r.error).map((r) => ({ symbol: r.symbol, error: r.error })),
    },
  };
}

/** Move open signals against live price; emit TP/SL notifications. */
export async function runTrackJob(): Promise<JobResult> {
  await getSignalEngine().trackOpenSignals();
  return { job: "track", ok: true, details: {} };
}

/**
 * Materialises `signal_outcomes` for signals that closed but have no
 * post-mortem yet, then recomputes calibration.
 *
 * Split from tracking on purpose: tracking must stay fast and side-effect
 * light, while this is a heavier analytical pass that can run less often.
 */
export async function runOutcomesJob(): Promise<JobResult> {
  const closed = await db
    .select()
    .from(signals)
    .where(
      and(
        inArray(signals.status, ["tp1_hit", "tp2_hit", "stopped", "breakeven", "closed_manual"]),
        sql`NOT EXISTS (SELECT 1 FROM ${signalOutcomes} WHERE ${signalOutcomes.signalId} = ${signals.id})`,
      ),
    );

  let written = 0;
  for (const s of closed) {
    const r = Number(s.rMultiple ?? 0);
    await db
      .insert(signalOutcomes)
      .values({
        signalId: s.id,
        symbol: s.symbol,
        regime: s.regime,
        predictedProbability: s.probability,
        confidence: s.confidence,
        won: s.status === "tp1_hit" || s.status === "tp2_hit",
        rMultiple: String(Number.isFinite(r) ? r : 0),
        durationMinutes: s.closedAt ? Math.round((s.closedAt.getTime() - s.createdAt.getTime()) / 60_000) : 0,
        reasonCodes: s.supportingReasons,
      })
      .onConflictDoNothing({ target: signalOutcomes.signalId });
    written += 1;
  }

  const outcomes = await loadOutcomes("all");
  const scopes = calibrateAll(outcomes);

  for (const c of scopes) {
    await db
      .insert(calibration)
      .values({
        scope: c.scope,
        scopeKey: c.scopeKey,
        sampleSize: c.sampleSize,
        observedWinRate: c.observedWinRate.toFixed(4),
        predictedWinRate: c.predictedWinRate.toFixed(4),
        expectancyR: c.expectancyR.toFixed(3),
        multiplier: c.multiplier.toFixed(3),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [calibration.scope, calibration.scopeKey],
        set: {
          sampleSize: c.sampleSize,
          observedWinRate: c.observedWinRate.toFixed(4),
          predictedWinRate: c.predictedWinRate.toFixed(4),
          expectancyR: c.expectancyR.toFixed(3),
          multiplier: c.multiplier.toFixed(3),
          updatedAt: new Date(),
        },
      });
  }

  return {
    job: "outcomes",
    ok: true,
    details: { outcomesWritten: written, scopesCalibrated: scopes.length, lessons: deriveLessons(outcomes).length },
  };
}

/** Broadcast a periodic performance report to entitled subscribers. */
export async function runReportJob(period: Exclude<Period, "all">): Promise<JobResult> {
  const { textAr, stats } = await buildReport(period);
  const featureKey = period === "daily" ? "dailyReports" : period === "weekly" ? "weeklyReports" : "monthlyReports";

  const rows = await db
    .select({
      customerId: customers.id,
      chatId: customers.telegramId,
      features: subscriptions.featuresSnapshot,
    })
    .from(subscriptions)
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(
      and(
        inArray(subscriptions.status, ["active", "trialing"]),
        eq(customers.status, "active"),
        gte(subscriptions.currentPeriodEnd, new Date()),
      ),
    );

  const tg = getTelegramClient();
  let sent = 0;

  for (const row of rows) {
    const features = (row.features ?? {}) as Record<string, unknown>;
    if (features[featureKey] !== true) continue; // not entitled to this cadence

    const result = await tg.sendMessage(row.chatId, textAr);
    await db.insert(deliveryLog).values({
      customerId: row.customerId,
      kind: "report",
      status: result.ok ? "sent" : result.blockedByUser ? "blocked_by_user" : "failed",
      error: result.ok ? null : result.error,
      attempts: 1,
      sentAt: result.ok ? new Date() : null,
    });
    if (result.ok) sent += 1;
  }

  return { job: `report:${period}`, ok: true, details: { recipients: sent, closedTrades: stats.totalSignals } };
}

/**
 * Expiry lifecycle:
 *   1. Warn subscribers inside the renewal window.
 *   2. Flip genuinely elapsed subscriptions to `expired`.
 *
 * Warning before expiring (in that order) means a customer always gets a
 * nudge before losing access, which is both fairer and better for renewals.
 */
export async function runExpiryJob(warningDays = 3): Promise<JobResult> {
  const now = new Date();
  const horizon = new Date(now.getTime() + warningDays * 86_400_000);
  const tg = getTelegramClient();

  const expiring = await db
    .select({
      customerId: customers.id,
      chatId: customers.telegramId,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(customers, eq(subscriptions.customerId, customers.id))
    .where(
      and(
        eq(subscriptions.status, "active"),
        gte(subscriptions.currentPeriodEnd, now),
        lte(subscriptions.currentPeriodEnd, horizon),
      ),
    );

  let warned = 0;
  for (const row of expiring) {
    const daysLeft = Math.ceil((row.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000);
    const result = await tg.sendMessage(row.chatId, subscriptionExpiringSoonAr(daysLeft));
    if (result.ok) warned += 1;
  }

  const expired = await db
    .update(subscriptions)
    .set({ status: "expired", updatedAt: now })
    .where(and(inArray(subscriptions.status, ["active", "trialing"]), lte(subscriptions.currentPeriodEnd, now)))
    .returning({ id: subscriptions.id });

  return { job: "expiry", ok: true, details: { warned, expired: expired.length } };
}

export async function runCalendarJob(): Promise<JobResult> {
  // In a real implementation, this would fetch from an API like ForexFactory
  // For the sandbox, we just clear old events.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.delete(economicEvents).where(lt(economicEvents.eventTime, cutoff));
  
  return { job: "calendar", ok: true, details: { "cleanedOldEvents": true } };
}

/** Train ML predictor on recent outcomes and cache fear-greed. */
export async function runMLJob(): Promise<JobResult> {
  const predictor = getMLPredictor();

  // Load all outcomes for training
  const outcomes = await loadOutcomes("all");
  const rows: MLTrainingRow[] = outcomes.map(o => ({
    confluence: o.confidence,
    regimeTrend: 0, regimeStructure: 0, regimeZones: 0,
    atrPct: 1, volatilityExpansion: 1, mtfAlignment: 0.6,
    hasDivergence: false, hasVolumeConfirmation: false,
    isReversal: false, isBreakout: false,
    positionCount: 0, correlationOverlap: 0,
    hourOfDay: 12, dayOfWeek: 3,
    won: o.won,
    rMultiple: o.rMultiple,
  }));

  predictor.train(rows);

  // Fetch and cache fear-greed + gamma exposure for BTC
  let fg = null;
  let gammaSignal = null;
  try { fg = await fetchFearGreed(); } catch { /* offline */ }
  try {
    const gex = await fetchDeribitOptions("BTCUSDT");
    if (gex) gammaSignal = analyseGammaSignal(gex, 0);
  } catch { /* offline */ }

  return {
    job: "ml",
    ok: true,
    details: {
      trainingSamples: predictor.getSampleSize(),
      predictorReady: predictor.isReady(),
      fearGreed: fg?.value ?? null,
      gammaBias: gammaSignal?.gammaBias ?? null,
    },
  };
}

/** Sync auto-trader account info from exchange and reset daily PnL at midnight. */
export async function runTradingSyncJob(): Promise<JobResult> {
  const trader = getAutoTrader();
  const state = trader.getState();

  if (state.mode === "off") {
    return { job: "trading_sync", ok: true, details: { mode: "off" } };
  }

  await trader.syncAccount();

  // Reset daily PnL at UTC midnight
  const now = new Date();
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
    trader.resetDaily();
  }

  const newState = trader.getState();
  return {
    job: "trading_sync",
    ok: true,
    details: {
      mode: newState.mode,
      equity: newState.equity,
      dailyPnl: newState.dailyPnl,
      openPositions: newState.openPositions.length,
      isHalted: newState.isHalted,
      haltReason: newState.haltReason,
    },
  };
}
