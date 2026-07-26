import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { strategies, backtests } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { Card, Badge } from "@/components/ui";
import { getStrategyDefinition } from "@/lib/strategies";
import { StrategyActions } from "@/components/strategies/StrategyActions";
import { RunBacktestForm } from "@/components/backtests/RunBacktestForm";
import Link from "next/link";
import { fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const rows = await db
    .select()
    .from(strategies)
    .where(and(eq(strategies.id, id), eq(strategies.userId, user.id)))
    .limit(1);
  const strategy = rows[0];
  if (!strategy) notFound();

  const definition = getStrategyDefinition(strategy.type);
  const relatedBacktests = await db
    .select()
    .from(backtests)
    .where(and(eq(backtests.strategyId, strategy.id), eq(backtests.userId, user.id)))
    .orderBy(desc(backtests.createdAt))
    .limit(10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{strategy.name}</h1>
          <p className="text-sm text-slate-400">
            {definition.label} · {strategy.symbol} · {strategy.timeframe}
          </p>
        </div>
        <StrategyActions id={strategy.id} status={strategy.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-2 text-lg font-semibold">Description</h2>
          <p className="text-sm text-slate-400">{definition.description}</p>
          <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Parameters</h3>
          <pre className="rounded-lg bg-slate-950 p-3 text-xs text-slate-300">{JSON.stringify(strategy.params, null, 2)}</pre>

          <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Backtest history</h3>
          {relatedBacktests.length === 0 ? (
            <p className="text-sm text-slate-500">No backtests run for this strategy yet.</p>
          ) : (
            <ul className="divide-y divide-slate-900">
              {relatedBacktests.map((b) => {
                const m = b.metrics as { totalReturnPct: number } | null;
                return (
                  <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/dashboard/backtests/${b.id}`} className="hover:text-emerald-400">
                      {b.name}
                    </Link>
                    <Badge tone={(m?.totalReturnPct ?? 0) >= 0 ? "positive" : "negative"}>{fmtPct(m?.totalReturnPct ?? 0)}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Run a backtest</h2>
          <RunBacktestForm
            strategyId={strategy.id}
            type={strategy.type}
            symbol={strategy.symbol}
            timeframe={strategy.timeframe}
            params={strategy.params as Record<string, number>}
          />
        </Card>
      </div>
    </div>
  );
}
