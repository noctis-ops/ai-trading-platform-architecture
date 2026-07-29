import { db } from "@/db";
import { count, eq, sql, sum, gte } from "drizzle-orm";
import { customers, subscriptions, signals, payments, plans } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireAdmin("support");

  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86400000);

  const [totalCust, activeSubs, totalSignalsRes, entersRes, monthRevenue, recentCust] = await Promise.all([
    db.select({ count: count() }).from(customers),
    db.select({ count: count() }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ count: count() }).from(signals),
    db.select({ count: count() }).from(signals).where(eq(signals.verdict, "enter")),
    db.select({ total: sql<string>`coalesce(sum(${payments.amount}), '0')` })
      .from(payments)
      .where(sql`${payments.status} = 'confirmed' AND ${payments.createdAt} >= ${monthAgo}`),
    db.select().from(customers).orderBy(sql`${customers.createdAt} DESC`).limit(10),
  ]);

  const totalSignals = Number(totalSignalsRes[0]?.count ?? 0);
  const enters = Number(entersRes[0]?.count ?? 0);
  const selectivity = totalSignals > 0 ? (enters / totalSignals * 100).toFixed(1) : "0";
  const revenue = Number(monthRevenue[0]?.total ?? 0);

  // Trading stats from signals
  const winsRes = await db.select({ count: count() })
    .from(signals).where(sql`${signals.status} IN ('tp1_hit','tp2_hit')`);
  const lossesRes = await db.select({ count: count() })
    .from(signals).where(eq(signals.status, "stopped"));
  const openRes = await db.select({ count: count() })
    .from(signals).where(sql`${signals.status} IN ('open','tp1_hit')`);
  const wins = Number(winsRes[0]?.count ?? 0);
  const losses = Number(lossesRes[0]?.count ?? 0);
  const open = Number(openRes[0]?.count ?? 0);
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "—";

  // Plans
  const planRows = await db.select().from(plans).orderBy(plans.sortOrder);

  // Pending payments
  const pendingPmts = await db.select().from(payments)
    .where(eq(payments.status, "pending"))
    .orderBy(sql`${payments.createdAt} DESC`).limit(10);

  return (
    <div className="space-y-8 p-4 md:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-100">📊 لوحة التحكم</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="العملاء" value={String(Number(totalCust[0]?.count ?? 0))} color="slate" />
        <KpiCard label="الاشتراكات النشطة" value={String(Number(activeSubs[0]?.count ?? 0))} color="green" />
        <KpiCard label="الإيراد (30 يوم)" value={`$${revenue.toFixed(0)}`} color="emerald" />
        <KpiCard label="الانتقائية" value={`${selectivity}%`} color="blue" />
      </div>

      {/* Trading Performance */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="الصفقات الرابحة" value={String(wins)} color="green" />
        <KpiCard label="الصفقات الخاسرة" value={String(losses)} color="red" />
        <KpiCard label="نسبة النجاح" value={`${winRate}%`} color={wins >= losses ? "emerald" : "amber"} />
        <KpiCard label="مفتوحة" value={String(open)} color="purple" />
      </div>

      {/* Plans */}
      <Section title="الخطط والأسعار">
        <table className="w-full text-sm text-slate-400">
          <thead className="text-xs uppercase bg-slate-950 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-right">الخطة</th>
              <th className="px-4 py-3 text-right">السعر الشهري</th>
              <th className="px-4 py-3 text-right">العملات</th>
              <th className="px-4 py-3 text-right">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {planRows.map(p => (
              <tr key={p.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="px-4 py-3">{p.nameAr}</td>
                <td className="px-4 py-3">${Number(p.priceMonthly).toFixed(0)}</td>
                <td className="px-4 py-3">{(p.features as any)?.maxSymbols === -1 ? "الكل" : String((p.features as any)?.maxSymbols ?? "—")}</td>
                <td className="px-4 py-3">
                  <span className={p.isActive ? "text-green-400" : "text-red-400"}>
                    {p.isActive ? "نشطة" : "متوقفة"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Recent Customers */}
      <Section title="أحدث العملاء">
        <table className="w-full text-sm text-slate-400">
          <thead className="text-xs uppercase bg-slate-950 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-right">المعرف</th>
              <th className="px-4 py-3 text-right">الاسم</th>
              <th className="px-4 py-3 text-right">تيليجرام</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">تاريخ الانضمام</th>
            </tr>
          </thead>
          <tbody>
            {recentCust.map(c => (
              <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="px-4 py-3 font-mono text-xs">{c.id.slice(0, 8)}</td>
                <td className="px-4 py-3">{c.displayName ?? "—"}</td>
                <td className="px-4 py-3">{c.telegramUsername ? `@${c.telegramUsername}` : String(c.telegramId)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3 text-xs">{new Date(c.createdAt).toLocaleDateString("ar-SA")}</td>
              </tr>
            ))}
            {recentCust.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center">لا يوجد عملاء</td></tr>}
          </tbody>
        </table>
      </Section>

      {/* Pending Payments */}
      <Section title="مدفوعات معلقة">
        <table className="w-full text-sm text-slate-400">
          <thead className="text-xs uppercase bg-slate-950 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-right">المعرف</th>
              <th className="px-4 py-3 text-right">المبلغ</th>
              <th className="px-4 py-3 text-right">المزوّد</th>
              <th className="px-4 py-3 text-right">المرجع</th>
              <th className="px-4 py-3 text-right">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {pendingPmts.map(p => (
              <tr key={p.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                <td className="px-4 py-3 font-mono text-xs">{p.id.slice(0, 8)}</td>
                <td className="px-4 py-3">${Number(p.amount).toFixed(2)} {p.currency}</td>
                <td className="px-4 py-3">{p.provider}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.providerRef ?? "—"}</td>
                <td className="px-4 py-3 text-xs">{new Date(p.createdAt).toLocaleDateString("ar-SA")}</td>
              </tr>
            ))}
            {pendingPmts.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center">لا توجد مدفوعات معلقة</td></tr>}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    slate: "text-slate-100", green: "text-green-400", emerald: "text-emerald-400",
    blue: "text-blue-400", red: "text-red-400", amber: "text-amber-400", purple: "text-purple-400",
  };
  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
      <h2 className="text-xs font-medium text-slate-500">{label}</h2>
      <p className={`text-2xl font-bold mt-2 ${colors[color] ?? "text-slate-100"}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800">
        <h2 className="font-semibold text-slate-100 text-sm">{title}</h2>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-500/10 text-green-400",
    pending: "bg-amber-500/10 text-amber-400",
    suspended: "bg-red-500/10 text-red-400",
    banned: "bg-red-500/10 text-red-400",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs ${map[status] ?? "bg-slate-500/10 text-slate-400"}`}>{status}</span>;
}
