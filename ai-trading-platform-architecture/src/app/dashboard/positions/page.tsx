import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount } from "@/lib/api-helpers";
import { db } from "@/db";
import { positions } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { enrichPosition } from "@/lib/portfolio";
import { Card, Badge } from "@/components/ui";
import { PositionsTable } from "@/components/trading/PositionsTable";
import { fmtPrice, fmtUsd, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const user = await requireUser();
  const account = await getOrCreatePrimaryAccount(user);

  const open = await db
    .select()
    .from(positions)
    .where(and(eq(positions.accountId, account.id), eq(positions.status, "open")));
  const closed = await db
    .select()
    .from(positions)
    .where(and(eq(positions.accountId, account.id), eq(positions.status, "closed")))
    .orderBy(desc(positions.closedAt))
    .limit(50);

  const enrichedOpen = open.map((p) => enrichPosition(p));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Positions</h1>
        <p className="text-sm text-slate-400">Open and historical positions for your paper trading account.</p>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Open</h2>
        <PositionsTable positions={enrichedOpen} />
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Closed</h2>
        {closed.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No closed positions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Side</th>
                  <th className="py-2 pr-4">Entry</th>
                  <th className="py-2 pr-4">Close</th>
                  <th className="py-2 pr-4">Realized PnL</th>
                  <th className="py-2 pr-4">Closed</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p) => (
                  <tr key={p.id} className="border-b border-slate-900">
                    <td className="py-2 pr-4 font-medium">{p.symbol}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={p.side === "long" ? "positive" : "negative"}>{p.side.toUpperCase()}</Badge>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{fmtPrice(Number(p.entryPrice))}</td>
                    <td className="py-2 pr-4 tabular-nums">{p.closePrice ? fmtPrice(Number(p.closePrice)) : "—"}</td>
                    <td className={`py-2 pr-4 tabular-nums ${Number(p.realizedPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmtUsd(Number(p.realizedPnl ?? 0))}
                    </td>
                    <td className="py-2 pr-4 text-slate-400">{p.closedAt ? fmtDate(p.closedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
