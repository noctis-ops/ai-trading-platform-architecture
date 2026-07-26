import { notFound } from "next/navigation";
import { SYMBOL_MAP } from "@/lib/market/symbols";
import { generateCandles, getLatestPrice } from "@/lib/market/simulator";
import { Card } from "@/components/ui";
import { PriceChart } from "@/components/charts/PriceChart";
import { OrderForm } from "@/components/trading/OrderForm";
import { fmtPrice } from "@/lib/format";
import { WatchlistToggle } from "@/components/watchlist/WatchlistToggle";

export const dynamic = "force-dynamic";

export default async function MarketDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const meta = SYMBOL_MAP.get(symbol.toUpperCase());
  if (!meta) notFound();

  const candles = generateCandles(meta.symbol, "1h", 400);
  const lastPrice = getLatestPrice(meta.symbol);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {meta.symbol} <span className="text-base font-normal text-slate-500">{meta.displayName}</span>
          </h1>
          <p className="mt-1 text-3xl font-bold tabular-nums">{fmtPrice(lastPrice)}</p>
        </div>
        <WatchlistToggle symbol={meta.symbol} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <PriceChart candles={candles} />
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Place Order</h2>
          <OrderForm symbol={meta.symbol} meta={meta} lastPrice={lastPrice} />
        </Card>
      </div>
    </div>
  );
}
