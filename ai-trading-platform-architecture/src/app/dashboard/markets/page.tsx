import Link from "next/link";
import { SYMBOLS } from "@/lib/market/symbols";
import { getLatestPrice } from "@/lib/market/simulator";
import { Card } from "@/components/ui";
import { fmtPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const rows = SYMBOLS.map((s) => ({ ...s, price: getLatestPrice(s.symbol) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Markets</h1>
        <p className="text-sm text-slate-400">Simulated leveraged perpetual markets. Prices update continuously.</p>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Market</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">Max Leverage</th>
                <th className="py-2 pr-4">Ann. Volatility</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-slate-900">
                  <td className="py-3 pr-4">
                    <p className="font-medium">{r.symbol}</p>
                    <p className="text-xs text-slate-500">{r.displayName}</p>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{fmtPrice(r.price)}</td>
                  <td className="py-3 pr-4">{r.maxLeverage}x</td>
                  <td className="py-3 pr-4 text-slate-400">{r.annualVolatilityPct}%</td>
                  <td className="py-3 pr-4">
                    <Link href={`/dashboard/markets/${r.symbol}`} className="text-xs font-semibold text-emerald-400 hover:underline">
                      Trade →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
