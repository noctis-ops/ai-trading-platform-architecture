// ---------------------------------------------------------------------------
// Arabic command router.
//
// Commands are Arabic-facing but resolve to stable internal `CommandId`s, so
// handlers, entitlement checks, rate limits, and analytics never depend on
// display strings. Latin aliases are accepted because Telegram clients and
// keyboards sometimes mangle Arabic slash-commands, and a customer who types
// /help must never hit a dead end.
// ---------------------------------------------------------------------------
import type { PlanFeatures } from "../access/entitlements";

export type CommandId =
  | "start"
  | "help"
  | "status"
  | "analyse"
  | "openTrades"
  | "performance"
  | "reportDaily"
  | "reportWeekly"
  | "reportMonthly"
  | "subscription"
  | "plans"
  | "renew"
  | "redeem"
  | "settings"
  | "support"
  // Owner-only
  | "adminStats"
  | "adminGrant"
  | "adminRevoke"
  | "adminBroadcast";

export type CommandSpec = {
  id: CommandId;
  /** Primary Arabic command as shown in the Telegram menu. */
  ar: string;
  aliases: string[];
  descriptionAr: string;
  /** Does this command require an active subscription? */
  requiresSubscription: boolean;
  /** Plan feature that must be enabled, if any. */
  requiresFeature?: keyof PlanFeatures;
  /** Counts against the customer's daily metered quota. */
  metered?: boolean;
  ownerOnly?: boolean;
};

export const COMMANDS: CommandSpec[] = [
  { id: "start", ar: "/بدء", aliases: ["/start"], descriptionAr: "بدء استخدام البوت", requiresSubscription: false },
  {
    id: "help",
    ar: "/مساعدة",
    aliases: ["/help", "/الأوامر"],
    descriptionAr: "عرض قائمة الأوامر",
    requiresSubscription: false,
  },
  {
    id: "plans",
    ar: "/الخطط",
    aliases: ["/plans", "/الاسعار", "/الأسعار"],
    descriptionAr: "الخطط والأسعار",
    requiresSubscription: false,
  },
  {
    id: "subscription",
    ar: "/اشتراكي",
    aliases: ["/subscription", "/حسابي"],
    descriptionAr: "حالة اشتراكك",
    requiresSubscription: false,
  },
  { id: "renew", ar: "/تجديد", aliases: ["/renew"], descriptionAr: "تجديد الاشتراك", requiresSubscription: false },
  {
    id: "redeem",
    ar: "/تفعيل",
    aliases: ["/redeem", "/كود"],
    descriptionAr: "تفعيل كود اشتراك",
    requiresSubscription: false,
  },
  { id: "support", ar: "/الدعم", aliases: ["/support"], descriptionAr: "التواصل مع الدعم", requiresSubscription: false },

  {
    id: "status",
    ar: "/الحالة",
    aliases: ["/status", "/السوق"],
    descriptionAr: "حالة السوق الحالية",
    requiresSubscription: true,
  },
  {
    id: "analyse",
    ar: "/تحليل",
    aliases: ["/analyse", "/analyze"],
    descriptionAr: "تحليل مفصل لعملة محددة",
    requiresSubscription: true,
    metered: true,
  },
  {
    id: "openTrades",
    ar: "/الصفقات",
    aliases: ["/trades", "/المفتوحة"],
    descriptionAr: "الصفقات المفتوحة",
    requiresSubscription: true,
  },
  {
    id: "performance",
    ar: "/الأداء",
    aliases: ["/performance", "/الاداء"],
    descriptionAr: "ملخص الأداء",
    requiresSubscription: true,
  },
  {
    id: "reportDaily",
    ar: "/تقرير_يومي",
    aliases: ["/daily"],
    descriptionAr: "تقرير اليوم",
    requiresSubscription: true,
    requiresFeature: "dailyReports",
  },
  {
    id: "reportWeekly",
    ar: "/تقرير_أسبوعي",
    aliases: ["/weekly", "/تقرير_اسبوعي"],
    descriptionAr: "تقرير الأسبوع",
    requiresSubscription: true,
    requiresFeature: "weeklyReports",
  },
  {
    id: "reportMonthly",
    ar: "/تقرير_شهري",
    aliases: ["/monthly"],
    descriptionAr: "تقرير الشهر",
    requiresSubscription: true,
    requiresFeature: "monthlyReports",
  },
  {
    id: "settings",
    ar: "/الإعدادات",
    aliases: ["/settings", "/الاعدادات"],
    descriptionAr: "تفضيلات التنبيهات",
    requiresSubscription: true,
  },

  {
    id: "adminStats",
    ar: "/إحصائيات",
    aliases: ["/stats"],
    descriptionAr: "إحصائيات النظام",
    requiresSubscription: false,
    ownerOnly: true,
  },
  {
    id: "adminGrant",
    ar: "/منح",
    aliases: ["/grant"],
    descriptionAr: "منح اشتراك لعميل",
    requiresSubscription: false,
    ownerOnly: true,
  },
  {
    id: "adminRevoke",
    ar: "/إيقاف",
    aliases: ["/revoke"],
    descriptionAr: "إيقاف اشتراك عميل",
    requiresSubscription: false,
    ownerOnly: true,
  },
  {
    id: "adminBroadcast",
    ar: "/إذاعة",
    aliases: ["/broadcast"],
    descriptionAr: "رسالة جماعية",
    requiresSubscription: false,
    ownerOnly: true,
  },
];

export type ParsedCommand = {
  spec: CommandSpec;
  /** Raw arguments after the command token. */
  args: string[];
  /** First argument normalised as a trading symbol, if valid. */
  symbol?: string;
};

/**
 * Arabic normalisation before matching: users type أ/إ/آ interchangeably and
 * copy text containing diacritics or tatweel. Without this, /الاعدادات and
 * /الإعدادات would be two different commands to a naive matcher.
 */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u064B-\u0652\u0640]/g, "") // diacritics + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\u200f|\u200e/g, "") // bidi marks
    .trim();
}

const INDEX: Map<string, CommandSpec> = (() => {
  const m = new Map<string, CommandSpec>();
  for (const spec of COMMANDS) {
    for (const token of [spec.ar, ...spec.aliases]) {
      m.set(normalizeArabic(token).toLowerCase(), spec);
    }
  }
  return m;
})();

/** Common symbol shorthands Arabic-speaking traders actually type. */
const SYMBOL_ALIASES: Record<string, string> = {
  BTC: "BTCUSDT",
  BITCOIN: "BTCUSDT",
  بيتكوين: "BTCUSDT",
  ETH: "ETHUSDT",
  ETHEREUM: "ETHUSDT",
  ايثيريوم: "ETHUSDT",
  ايثر: "ETHUSDT",
  SOL: "SOLUSDT",
  سولانا: "SOLUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  ريبل: "XRPUSDT",
  ADA: "ADAUSDT",
  DOGE: "DOGEUSDT",
  AVAX: "AVAXUSDT",
  LINK: "LINKUSDT",
};

export function resolveSymbol(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = normalizeArabic(raw)
    .toUpperCase()
    .replace(/[/\-_]/g, "");
  if (SYMBOL_ALIASES[cleaned]) return SYMBOL_ALIASES[cleaned];
  const arabicKey = normalizeArabic(raw);
  if (SYMBOL_ALIASES[arabicKey]) return SYMBOL_ALIASES[arabicKey];
  if (/^[A-Z]{2,10}USDT?$/.test(cleaned)) return cleaned.endsWith("USDT") ? cleaned : `${cleaned}T`;
  return undefined;
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawCmd, ...args] = trimmed.split(/\s+/);
  // Strip the @BotName suffix Telegram appends in group chats.
  const token = normalizeArabic(rawCmd.split("@")[0]).toLowerCase();
  const spec = INDEX.get(token);
  if (!spec) return null;

  return { spec, args, symbol: resolveSymbol(args[0]) };
}

/** Command list for Telegram's setMyCommands (customer-visible only). */
export function telegramCommandMenu() {
  return COMMANDS.filter((c) => !c.ownerOnly).map((c) => ({
    // Telegram requires lowercase a-z, digits and underscores only, so the
    // Arabic label lives in the description and the aliases carry the token.
    command: c.aliases.find((a) => /^\/[a-z_]+$/.test(a))?.slice(1) ?? c.id.toLowerCase(),
    description: `${c.ar} — ${c.descriptionAr}`,
  }));
}
