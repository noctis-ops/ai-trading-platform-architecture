"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import type { SymbolMeta } from "@/lib/market/symbols";

export function OrderForm({ symbol, meta, lastPrice }: { symbol: string; meta: SymbolMeta; lastPrice: number }) {
  const router = useRouter();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("0.1");
  const [leverage, setLeverage] = useState("5");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const notional = Number(quantity || 0) * lastPrice;
  const margin = notional / Number(leverage || 1);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    setWarnings([]);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        side,
        quantity: Number(quantity),
        leverage: Number(leverage),
        stopLoss: stopLoss ? Number(stopLoss) : null,
        takeProfit: takeProfit ? Number(takeProfit) : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Order rejected");
      return;
    }
    setSuccess(`${side === "buy" ? "Long" : "Short"} position opened at $${Number(data.position.entryPrice).toFixed(2)}`);
    setWarnings(data.warnings ?? []);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={`rounded-lg py-2 text-sm font-semibold transition ${side === "buy" ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-300"}`}
        >
          Long
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={`rounded-lg py-2 text-sm font-semibold transition ${side === "sell" ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-300"}`}
        >
          Short
        </button>
      </div>

      <div>
        <Label>Quantity ({meta.base})</Label>
        <Input type="number" step="any" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      </div>

      <div>
        <Label>Leverage (max {meta.maxLeverage}x)</Label>
        <Select value={leverage} onChange={(e) => setLeverage(e.target.value)}>
          {[1, 2, 3, 5, 10, 15, 20].filter((l) => l <= meta.maxLeverage).map((l) => (
            <option key={l} value={l}>
              {l}x
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Stop loss</Label>
          <Input type="number" step="any" min="0" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="optional" />
        </div>
        <div>
          <Label>Take profit</Label>
          <Input type="number" step="any" min="0" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="optional" />
        </div>
      </div>

      <div className="rounded-lg bg-slate-950 p-3 text-xs text-slate-400">
        <div className="flex justify-between">
          <span>Notional</span>
          <span className="text-slate-200">${notional.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between">
          <span>Est. margin</span>
          <span className="text-slate-200">${margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between">
          <span>Mark price</span>
          <span className="text-slate-200">${lastPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}
      {warnings.map((w) => (
        <p key={w} className="text-xs text-amber-400">
          ⚠ {w}
        </p>
      ))}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Placing order…" : `Place ${side === "buy" ? "long" : "short"} order`}
      </Button>
    </form>
  );
}
