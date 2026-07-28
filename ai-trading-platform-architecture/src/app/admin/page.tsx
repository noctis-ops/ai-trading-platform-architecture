import { db } from "@/db";
import { count, eq, sql } from "drizzle-orm";
import { customers, subscriptions, signals } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireAdmin("support");

  // Get metrics
  const totalCustomersRes = await db.select({ count: count() }).from(customers);
  const activeSubsRes = await db
    .select({ count: count() })
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));

  const signalsRes = await db.select({ count: count() }).from(signals);

  const selectivityRes = await db
    .select({ count: count() })
    .from(signals)
    .where(eq(signals.verdict, "enter"));

  const totalSignals = Number(signalsRes[0]?.count ?? 0);
  const enters = Number(selectivityRes[0]?.count ?? 0);
  const selectivity = totalSignals > 0 ? (enters / totalSignals * 100).toFixed(1) : "0.0";

  // List recent customers
  const recentCustomers = await db
    .select()
    .from(customers)
    .orderBy(sql`${customers.createdAt} DESC`)
    .limit(10);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <h2 className="text-sm font-medium text-slate-400">العملاء</h2>
          <p className="text-3xl font-bold mt-2 text-slate-100">{totalCustomersRes[0]?.count ?? 0}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <h2 className="text-sm font-medium text-slate-400">الاشتراكات النشطة</h2>
          <p className="text-3xl font-bold mt-2 text-green-400">{activeSubsRes[0]?.count ?? 0}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <h2 className="text-sm font-medium text-slate-400">إجمالي القرارات</h2>
          <p className="text-3xl font-bold mt-2 text-slate-100">{totalSignals}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <h2 className="text-sm font-medium text-slate-400">الانتقائية (الدخول)</h2>
          <p className="text-3xl font-bold mt-2 text-blue-400">{selectivity}%</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800">
          <h2 className="font-semibold text-slate-100">أحدث العملاء</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left rtl:text-right text-slate-400">
            <thead className="text-xs uppercase bg-slate-950 text-slate-500 border-b border-slate-800">
              <tr>
                <th className="px-6 py-3">المعرف</th>
                <th className="px-6 py-3">الاسم</th>
                <th className="px-6 py-3">تيليجرام</th>
                <th className="px-6 py-3">الحالة</th>
                <th className="px-6 py-3">تاريخ الانضمام</th>
              </tr>
            </thead>
            <tbody>
              {recentCustomers.map((c) => (
                <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="px-6 py-4 font-mono">{c.id.slice(0,8)}</td>
                  <td className="px-6 py-4">{c.displayName ?? "—"}</td>
                  <td className="px-6 py-4">{c.telegramUsername ? `@${c.telegramUsername}` : c.telegramId.toString()}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs ${c.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">{new Date(c.createdAt).toLocaleDateString("ar-SA")}</td>
                </tr>
              ))}
              {recentCustomers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center">لا يوجد عملاء حتى الآن</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}