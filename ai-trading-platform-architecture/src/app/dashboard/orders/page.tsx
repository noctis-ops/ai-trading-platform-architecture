import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount } from "@/lib/api-helpers";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { Card, Badge } from "@/components/ui";
import { fmtPrice, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await requireUser();
  const account = await getOrCreatePrimaryAccount(user);
  const rows = await db.select().from(orders).where(eq(orders.accountId, account.id)).orderBy(desc(orders.createdAt)).limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Order History</h1>
        <p className="text-sm text-slate-400">Every order placed, including risk-engine rejections.</p>
      </div>
      <Card>
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No orders placed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Side</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Price</th>
                  <th className="py-2 pr-4">Leverage</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-slate-900">
                    <td className="py-2 pr-4 text-slate-400">{fmtDate(o.createdAt)}</td>
                    <td className="py-2 pr-4 font-medium">{o.symbol}</td>
                    <td className="py-2 pr-4 uppercase">{o.side}</td>
                    <td className="py-2 pr-4 tabular-nums">{Number(o.quantity).toFixed(4)}</td>
                    <td className="py-2 pr-4 tabular-nums">{o.price ? fmtPrice(Number(o.price)) : "—"}</td>
                    <td className="py-2 pr-4">{Number(o.leverage)}x</td>
                    <td className="py-2 pr-4">
                      <Badge tone={o.status === "filled" ? "positive" : o.status === "rejected" ? "negative" : "neutral"}>
                        {o.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500">{o.rejectReason ?? "—"}</td>
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
