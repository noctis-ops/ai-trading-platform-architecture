import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount } from "@/lib/api-helpers";
import { db } from "@/db";
import { positions, strategies, backtests } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { enrichPosition, summarizePortfolio } from "@/lib/portfolio";
import { Card, StatCard, Badge } from "@/components/ui";
import { PositionsTable } from "@/components/trading/PositionsTable";
import { fmtUsd, fmtPct } from "@/lib/format";
import { SYMBOLS } from "@/lib/market/symbols";
import { getLatestPrice } from "@/lib/market/simulator";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const user = await requireUser();
  const account = await getOrCreatePrimaryAccount(user);

  const openPositions = await db
    .select()
    .from(positions)
    .where(and(eq(positions.accountId, account.id), eq(positions.status, "open")));
  const enriched = openPositions.map((p) => enrichPosition(p));
  const summary = summarizePortfolio(Number(account.balance), enriched);

  const myStrategies = await db
    .select()
    .from(strategies)
    .where(eq(strategies.userId, user.id))
    .orderBy(desc(strategies.createdAt))
    .limit(5);

  const recentBacktests = await db
    .select()
    .from(backtests)
    .where(eq(backtests.userId, user.id))
    .orderBy(desc(backtests.createdAt))
    .limit(4);

  const movers = SYMBOLS.slice(0, 6).map((s) => ({ ...s, price: getLatestPrice(s.symbol) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-slate-400">Your paper trading portfolio at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Equity" value={fmtUsd(summary.equity)} sub={`Cash balance ${fmtUsd(summary.balance)}`} />
        <StatCard
          label="Unrealized PnL"
          value={fmtUsd(summary.unrealizedPnl)}
          tone={summary.unrealizedPnl >= 0 ? "positive" : "negative"}
        />
        <StatCard label="Used Margin" value={fmtUsd(summary.usedMargin)} sub={`Free margin ${fmtUsd(summary.freeMargin)}`} />
        <StatCard label="Open Positions" value={String(summary.openPositions)} />
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Open Positions</h2>
        <PositionsTable positions={enriched} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Market Snapshot</h2>
            <Link href="/dashboard/markets" className="text-xs font-medium text-emerald-400 hover:underline">
              View all
            </Link>
          </div>
          <ul className="space-y-2">
            {movers.map((m) => (
              <li key={m.symbol} className="flex items-center justify-between border-b border-slate-900 pb-2 text-sm last:border-0">
                <div>
                  <p className="font-medium">{m.symbol}</p>
                  <p className="text-xs text-slate-500">{m.displayName}</p>
                </div>
                <p className="tabular-nums text-slate-200">{fmtUsd(m.price, { maximumFractionDigits: m.price < 1 ? 4 : 2 })}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Strategies</h2>
            <Link href="/dashboard/strategies" className="text-xs font-medium text-emerald-400 hover:underline">
              Manage
            </Link>
          </div>
          {myStrategies.length === 0 ? (
            <p className="text-sm text-slate-500">No strategies yet. Create one to start backtesting.</p>
          ) : (
            <ul className="space-y-2">
              {myStrategies.map((s) => (
                <li key={s.id} className="flex items-center justify-between border-b border-slate-900 pb-2 text-sm last:border-0">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.symbol} · {s.timeframe}
                    </p>
                  </div>
                  <Badge tone={s.status === "active" ? "positive" : "neutral"}>{s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Backtests</h2>
          <Link href="/dashboard/backtests" className="text-xs font-medium text-emerald-400 hover:underline">
            View all
          </Link>
        </div>
        {recentBacktests.length === 0 ? (
          <p className="text-sm text-slate-500">Run your first backtest to validate a strategy objectively.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Return</th>
                  <th className="py-2 pr-4">Sharpe</th>
                  <th className="py-2 pr-4">Max DD</th>
                </tr>
              </thead>
              <tbody>
                {recentBacktests.map((b) => {
                  const m = b.metrics as { totalReturnPct: number; sharpeRatio: number; maxDrawdownPct: number } | null;
                  return (
                    <tr key={b.id} className="border-b border-slate-900">
                      <td className="py-2 pr-4">
                        <Link href={`/dashboard/backtests/${b.id}`} className="hover:text-emerald-400">
                          {b.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{b.symbol}</td>
                      <td className={`py-2 pr-4 ${(m?.totalReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {fmtPct(m?.totalReturnPct ?? 0)}
                      </td>
                      <td className="py-2 pr-4">{(m?.sharpeRatio ?? 0).toFixed(2)}</td>
                      <td className="py-2 pr-4 text-rose-400">-{(m?.maxDrawdownPct ?? 0).toFixed(1)}%</td>
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
