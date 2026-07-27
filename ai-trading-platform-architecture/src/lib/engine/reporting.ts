// ---------------------------------------------------------------------------
// Reporting service — turns stored signals into honest performance figures.
//
// INTEGRITY RULES (these are the whole point of this file):
//   1. Only CLOSED signals count toward win rate. Counting open trades at
//      their current unrealised profit is the classic way vendors inflate
//      results.
//   2. Breakeven exits are neither wins nor losses; they are reported
//      separately so the win rate denominator stays honest.
//   3. R-multiples, not percentages. "+2R" is comparable across symbols and
//      position sizes; "+3%" depends on leverage the customer chose.
// ---------------------------------------------------------------------------
import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { signals } from "@/db/schema";
import { computeStats, type OutcomeRecord, type PerformanceStats } from "../intelligence/learning";
import type { MarketRegime, ReasonCode } from "../intelligence/types";
import { performanceReportAr, type PerformanceSummary } from "../telegram/messages.ar";

export type Period = "daily" | "weekly" | "monthly" | "all";

const PERIOD_LABEL_AR: Record<Period, string> = {
  daily: "اليوم",
  weekly: "هذا الأسبوع",
  monthly: "هذا الشهر",
  all: "منذ البداية",
};

/** Terminal statuses that represent a finished, countable trade. */
const CLOSED_STATUSES = ["tp1_hit", "tp2_hit", "stopped", "breakeven", "closed_manual"] as const;

export function periodStart(period: Period, now: Date = new Date()): Date {
  const d = new Date(now);
  switch (period) {
    case "daily":
      d.setUTCHours(0, 0, 0, 0);
      return d;
    case "weekly":
      d.setUTCDate(d.getUTCDate() - 7);
      return d;
    case "monthly":
      d.setUTCDate(d.getUTCDate() - 30);
      return d;
    case "all":
      return new Date(0);
  }
}

const num = (v: string | null, fallback = 0): number => {
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Loads closed signals in a window as `OutcomeRecord`s — the same shape the
 * learning loop consumes, so reporting and calibration can never disagree
 * about what "a win" means.
 */
export async function loadOutcomes(period: Period, now: Date = new Date()): Promise<OutcomeRecord[]> {
  const rows = await db
    .select()
    .from(signals)
    .where(
      and(
        inArray(signals.status, [...CLOSED_STATUSES]),
        gte(signals.createdAt, periodStart(period, now)),
        lte(signals.createdAt, now),
      ),
    );

  return rows.map((r) => {
    const rMultiple = num(r.rMultiple);
    return {
      signalId: r.id,
      symbol: r.symbol,
      regime: r.regime as MarketRegime,
      predictedProbability: num(r.probability),
      confidence: r.confidence,
      // Breakeven is explicitly NOT a win.
      won: r.status === "tp1_hit" || r.status === "tp2_hit",
      rMultiple,
      reasonCodes: extractCodes(r.supportingReasons),
      durationMinutes: r.closedAt ? (r.closedAt.getTime() - r.createdAt.getTime()) / 60_000 : 0,
    };
  });
}

function extractCodes(raw: unknown): ReasonCode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (typeof r === "object" && r !== null ? (r as { code?: string }).code : undefined))
    .filter((c): c is ReasonCode => typeof c === "string");
}

async function countOpen(): Promise<number> {
  const rows = await db
    .select({ id: signals.id })
    .from(signals)
    .where(inArray(signals.status, ["open", "tp1_hit"]));
  return rows.length;
}

export type Report = { stats: PerformanceStats; summary: PerformanceSummary; textAr: string };

export async function buildReport(period: Period, now: Date = new Date()): Promise<Report> {
  const outcomes = await loadOutcomes(period, now);
  const stats = computeStats(outcomes);
  const open = await countOpen();

  const summary: PerformanceSummary = {
    periodLabel: PERIOD_LABEL_AR[period],
    totalSignals: stats.totalSignals,
    wins: stats.wins,
    losses: stats.losses,
    open,
    winRatePct: stats.winRatePct,
    avgRMultiple: stats.avgRMultiple,
    totalR: stats.totalR,
    bestSymbol: stats.bestSymbol,
    worstSymbol: stats.worstSymbol,
  };

  // An empty period is a legitimate result for a selective engine, and must
  // read as discipline rather than as a broken report.
  const textAr =
    stats.totalSignals === 0
      ? [
          `📊 تقرير الأداء — ${PERIOD_LABEL_AR[period]}`,
          "━━━━━━━━━━━━━━━",
          "لم تُغلق أي صفقة خلال هذه الفترة.",
          open > 0 ? `الصفقات المفتوحة حالياً: ${open}` : "لا توجد صفقات مفتوحة.",
          "",
          "عدم وجود صفقات ليس تقصيراً — النظام لا يدخل إلا عند توفر شروط واضحة.",
        ].join("\n")
      : performanceReportAr(summary);

  return { stats, summary, textAr };
}
