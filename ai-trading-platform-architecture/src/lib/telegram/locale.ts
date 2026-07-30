// ---------------------------------------------------------------------------
// Multi-Language Locale System (v3.2)
// Supported: ar (default), en, tr, ru, zh, fa
// ---------------------------------------------------------------------------

import type { Decision, Reason, TradePlan } from "../intelligence/types";

export type MessageFunctions = {
  reasonAr(reason: Reason): string;
  signalOpenedAr(params: { symbol: string; plan: TradePlan; decision: Decision; maxReasons?: number }): string;
  signalClosedAr(params: { symbol: string; direction: "long" | "short"; entry: number; exit: number; pnlPct: number; rMultiple: number; outcome: string; durationMinutes: number }): string;
  noTradeAr(symbol: string, decision: Decision): string;
  marketStatusAr(symbol: string, decision: Decision): string;
  performanceReportAr(s: { periodLabel: string; totalSignals: number; wins: number; losses: number; open: number; winRatePct: number; avgRMultiple: number; totalR: number; bestSymbol?: string; worstSymbol?: string }): string;
  helpText(): string;
  notSubscribedText(): string;
  subscriptionActiveText(plan: string, daysLeft: number, expiresAt: Date): string;
  subscriptionExpiredText(): string;
  subscriptionExpiringText(daysLeft: number): string;
};

export type SupportedLocale = "ar" | "en" | "tr" | "ru" | "zh" | "fa";

const localeNames: Record<SupportedLocale, string> = {
  ar: "العربية", en: "English", tr: "Türkçe", ru: "Русский", zh: "中文", fa: "فارسی",
};

export function getLocaleName(locale: SupportedLocale): string {
  return localeNames[locale] ?? "العربية";
}

const localeCache = new Map<SupportedLocale, MessageFunctions>();

async function loadLocale(locale: SupportedLocale): Promise<MessageFunctions> {
  switch (locale) {
    case "ar": return import("../telegram/messages.ar") as any;
    case "en": return import("../telegram/messages.en") as any;
    case "tr": return import("../telegram/messages.tr") as any;
    case "ru": return import("../telegram/messages.ru") as any;
    case "zh": return import("../telegram/messages.zh") as any;
    case "fa": return import("../telegram/messages.fa") as any;
    default: return import("../telegram/messages.ar") as any;
  }
}

export async function getMessages(locale: SupportedLocale = "ar"): Promise<MessageFunctions> {
  if (localeCache.has(locale)) return localeCache.get(locale)!;
  const msgs = await loadLocale(locale);
  localeCache.set(locale, msgs);
  return msgs;
}

export function detectLocale(telegramLangCode: string | null | undefined): SupportedLocale {
  if (!telegramLangCode) return "ar";
  const code = telegramLangCode.split("-")[0].toLowerCase();
  const supported: SupportedLocale[] = ["ar", "en", "tr", "ru", "zh", "fa"];
  return supported.includes(code as SupportedLocale) ? (code as SupportedLocale) : "ar";
}
