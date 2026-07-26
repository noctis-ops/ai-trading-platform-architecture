"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { fmtPrice, fmtUsd, fmtPct } from "@/lib/format";
import type { EnrichedPosition } from "@/lib/portfolio";

export function PositionsTable({ positions }: { positions: EnrichedPosition[] }) {
  const router = useRouter();
  const [closingId, setClosingId] = useState<string | null>(null);

  async function close(id: string) {
    setClosingId(id);
    await fetch(`/api/positions/${id}/close`, { method: "POST" });
    setClosingId(null);
    router.refresh();
  }

  if (positions.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No open positions yet. Head to Markets to place a trade.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4">Symbol</th>
            <th className="py-2 pr-4">Side</th>
            <th className="py-2 pr-4">Qty</th>
            <th className="py-2 pr-4">Entry</th>
            <th className="py-2 pr-4">Mark</th>
            <th className="py-2 pr-4">Leverage</th>
            <th className="py-2 pr-4">Liq. Price</th>
            <th className="py-2 pr-4">Unrealized PnL</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="border-b border-slate-900">
              <td className="py-3 pr-4 font-medium">{p.symbol}</td>
              <td className="py-3 pr-4">
                <Badge tone={p.side === "long" ? "positive" : "negative"}>{p.side.toUpperCase()}</Badge>
              </td>
              <td className="py-3 pr-4 tabular-nums">{Number(p.quantity).toFixed(4)}</td>
              <td className="py-3 pr-4 tabular-nums">{fmtPrice(Number(p.entryPrice))}</td>
              <td className="py-3 pr-4 tabular-nums">{fmtPrice(p.markPrice)}</td>
              <td className="py-3 pr-4">{Number(p.leverage)}x</td>
              <td className="py-3 pr-4 tabular-nums text-slate-400">{fmtPrice(p.liquidationPrice)}</td>
              <td className={`py-3 pr-4 tabular-nums ${p.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {fmtUsd(p.unrealizedPnl)} ({fmtPct(p.unrealizedPnlPct)})
              </td>
              <td className="py-3 pr-4">
                <Button variant="secondary" disabled={closingId === p.id} onClick={() => close(p.id)}>
                  {closingId === p.id ? "Closing…" : "Close"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
