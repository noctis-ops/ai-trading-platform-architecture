import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { backtests } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { Card, Badge } from "@/components/ui";
import { fmtPct, fmtDate } from "@/lib/format";
import type { BacktestMetrics } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";

export default async function BacktestsPage() {
  const user = await requireUser();
  const rows = await db.select().from(backtests).where(eq(backtests.userId, user.id)).orderBy(desc(backtests.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Backtests</h1>
        <p className="text-sm text-slate-400">Objective, out-of-sample-style validation before any strategy goes live.</p>
      </div>
      <Card>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No backtests yet. Head to Strategies to create one and run your first backtest.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Timeframe</th>
                  <th className="py-2 pr-4">Return</th>
                  <th className="py-2 pr-4">Sharpe</th>
                  <th className="py-2 pr-4">Max DD</th>
                  <th className="py-2 pr-4">Win Rate</th>
                  <th className="py-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const m = b.metrics as BacktestMetrics | null;
                  return (
                    <tr key={b.id} className="border-b border-slate-900">
                      <td className="py-2 pr-4">
                        <Link href={`/dashboard/backtests/${b.id}`} className="font-medium hover:text-emerald-400">
                          {b.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{b.symbol}</td>
                      <td className="py-2 pr-4">{b.timeframe}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={(m?.totalReturnPct ?? 0) >= 0 ? "positive" : "negative"}>{fmtPct(m?.totalReturnPct ?? 0)}</Badge>
                      </td>
                      <td className="py-2 pr-4">{(m?.sharpeRatio ?? 0).toFixed(2)}</td>
                      <td className="py-2 pr-4 text-rose-400">-{(m?.maxDrawdownPct ?? 0).toFixed(1)}%</td>
                      <td className="py-2 pr-4">{(m?.winRate ?? 0).toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-slate-500">{fmtDate(b.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
