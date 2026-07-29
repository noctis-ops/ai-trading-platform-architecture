// ---------------------------------------------------------------------------
// PostgresSignalStore — the database adapter for the SignalEngine's port.
//
// The engine defines WHAT it needs (SignalStore); this file defines HOW it is
// satisfied with Drizzle + Postgres. Keeping the two apart is what lets the
// engine be tested with an in-memory fake and lets us swap storage later
// without touching a single line of trading logic.
//
// Every method here is a thin, auditable query. No trading decisions are made
// in this file — if you find yourself adding an `if` about market conditions,
// it belongs in the intelligence core instead.
// ---------------------------------------------------------------------------
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { analysisSnapshots, calibration, signalEvents, signals, watchedSymbols, economicEvents } from "@/db/schema";
import type { Decision } from "../intelligence/types";
import type { SignalStore, StoredSignal } from "./signal-engine";

/** Statuses that mean "this signal is still being tracked against price". */
const OPEN_STATUSES = ["open", "tp1_hit"] as const;

/**
 * Postgres `numeric` comes back as a string to preserve precision. Converting
 * at the boundary keeps the rest of the codebase in plain numbers, and
 * `null -> fallback` avoids NaN leaking into the tracking maths.
 */
const num = (v: string | null | undefined, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export class PostgresSignalStore implements SignalStore {
  async getWatchedSymbols(): Promise<string[]> {
    const rows = await db
      .select({ symbol: watchedSymbols.symbol })
      .from(watchedSymbols)
      .where(eq(watchedSymbols.isActive, true))
      .orderBy(watchedSymbols.sortOrder);
    return rows.map((r) => r.symbol);
  }

  async getOpenSignals(): Promise<StoredSignal[]> {
    const rows = await db
      .select()
      .from(signals)
      .where(inArray(signals.status, [...OPEN_STATUSES]));

    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: (r.direction ?? "long") as "long" | "short",
      entryPrice: num(r.entryPrice),
      stopLoss: num(r.stopLoss),
      takeProfit1: num(r.takeProfit1),
      takeProfit2: num(r.takeProfit2),
      status: r.status as StoredSignal["status"],
      openedAt: (r.publishedAt ?? r.createdAt).getTime(),
      // Derived, not stored twice: reaching tp1 IS the breakeven trigger.
      stopMovedToBreakeven: r.status === "tp1_hit",
      mfeR: num(r.rMultiple),
      maeR: 0,
    }));
  }

  /**
   * Counts only PUBLISHED signals — refusals are stored too, but they must not
   * consume the customer-facing daily budget.
   */
  async getSignalCountToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ n: count() })
      .from(signals)
      .where(and(eq(signals.verdict, "enter"), gte(signals.createdAt, startOfDay)));
    return Number(rows[0]?.n ?? 0);
  }

  async getMinutesSinceLastSignal(symbol: string): Promise<number | undefined> {
    const rows = await db
      .select({ createdAt: signals.createdAt })
      .from(signals)
      .where(and(eq(signals.symbol, symbol), eq(signals.verdict, "enter")))
      .orderBy(desc(signals.createdAt))
      .limit(1);
    const last = rows[0]?.createdAt;
    // undefined (not 0) means "never signalled" — 0 would read as "just now"
    // and wrongly trip the cooldown gate on a symbol's very first signal.
    if (!last) return undefined;
    return (Date.now() - last.getTime()) / 60_000;
  }

  /**
   * Combines the symbol-scoped and regime-scoped multipliers.
   *
   * Geometric mean rather than the product: multiplying two 0.8 scopes gives
   * 0.64, which double-penalises the same underperformance. Provisional rows
   * (insufficient sample) are written as 1 by the calibration job, so they are
   * naturally neutral here.
   */
  async getCalibrationMultiplier(symbol: string, regime: string): Promise<number> {
    const rows = await db
      .select({ scope: calibration.scope, scopeKey: calibration.scopeKey, multiplier: calibration.multiplier })
      .from(calibration)
      .where(
        sql`(${calibration.scope} = 'symbol' AND ${calibration.scopeKey} = ${symbol})
         OR (${calibration.scope} = 'regime' AND ${calibration.scopeKey} = ${regime})`,
      );

    const values = rows.map((r) => num(r.multiplier, 1)).filter((v) => v > 0);
    if (values.length === 0) return 1;
    const product = values.reduce((a, b) => a * b, 1);
    return product ** (1 / values.length);
  }

  /**
   * News blackout.
   *
   * Deliberately returns false until a real economic-calendar feed is wired in
   * (ROADMAP v3). Returning a hardcoded `true` would silence the bot, and
   * pretending to check would be worse than admitting we do not yet.
   */
  async isNewsBlackout(symbol: string, at: Date): Promise<boolean> {
    const base = symbol.slice(0, 3);
    const quote = symbol.slice(3, 6);
    
    const blackoutMs = 30 * 60_000;
    const windowStart = new Date(at.getTime() - blackoutMs);
    const windowEnd = new Date(at.getTime() + blackoutMs);

    const rows = await db.select({ count: count() })
      .from(economicEvents)
      .where(and(
        inArray(economicEvents.currency, [base, quote, "USD"]),
        eq(economicEvents.impact, "high"),
        gte(economicEvents.eventTime, windowStart),
        sql`${economicEvents.eventTime} <= ${windowEnd}`
      ));

    return Number(rows[0]?.count ?? 0) > 0;
  }

  /**
   * Persists EVERY decision, including refusals — see DECISIONS.md #11. The
   * analysis snapshot goes to a side table because it is large and only read
   * for forensics.
   */
  async saveDecision(decision: Decision, engineVersion: string): Promise<string> {
    const plan = decision.plan;
    const isEntry = decision.verdict === "enter";

    const [row] = await db
      .insert(signals)
      .values({
        symbol: decision.symbol,
        verdict: decision.verdict,
        direction: decision.direction,
        confidence: decision.confidence,
        probability: decision.probability.toFixed(4),
        regime: decision.regime,
        entryTimeframe: decision.timeframes[0]?.timeframe ?? "1h",
        entryPrice: plan ? String(plan.entry) : null,
        stopLoss: plan ? String(plan.stopLoss) : null,
        takeProfit1: plan ? String(plan.takeProfit1) : null,
        takeProfit2: plan ? String(plan.takeProfit2) : null,
        riskReward: plan ? String(plan.riskReward1) : null,
        riskPerTradePct: plan ? String(plan.riskPerTradePct) : null,
        atr: plan ? String(plan.atr) : null,
        supportingReasons: decision.supporting,
        objections: decision.objections,
        blockedBy: decision.blockedBy,
        // Refusals are records, not tradeable positions — never "open".
        status: isEntry ? "open" : "invalidated",
        publishedAt: isEntry ? new Date() : null,
      })
      .returning({ id: signals.id });

    await db.insert(analysisSnapshots).values({
      signalId: row.id,
      symbol: decision.symbol,
      timeframes: decision.timeframes.map((tf) => ({
        timeframe: tf.timeframe,
        bias: tf.bias,
        score: tf.score,
        regime: tf.regime,
        lastPrice: tf.lastPrice,
        atr: tf.atr,
        reports: Object.fromEntries(
          Object.entries(tf.reports).map(([k, r]) => [
            k,
            { score: r.score, confidence: r.confidence, reasons: r.reasons, metrics: r.metrics },
          ]),
        ),
      })),
      engineVersion,
    });

    return row.id;
  }

  async updateSignal(id: string, patch: Partial<StoredSignal>): Promise<void> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      update.status = patch.status;
      // A terminal status must carry its closing timestamp in the same write,
      // otherwise reporting sees a closed signal with no close time.
      if (patch.status !== "open" && patch.status !== "tp1_hit") update.closedAt = new Date();
    }
    if (patch.mfeR !== undefined) update.rMultiple = String(patch.mfeR);
    if (Object.keys(update).length === 0) return;
    await db.update(signals).set(update).where(eq(signals.id, id));
  }

  async recordEvent(
    signalId: string,
    type: string,
    price: number,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await db.insert(signalEvents).values({ signalId, type, price: String(price), payload });
  }
}
