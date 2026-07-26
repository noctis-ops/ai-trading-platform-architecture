"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

export function RunBacktestForm({
  strategyId,
  type,
  symbol,
  timeframe,
  params,
}: {
  strategyId: string;
  type: string;
  symbol: string;
  timeframe: string;
  params: Record<string, number>;
}) {
  const router = useRouter();
  const [initialBalance, setInitialBalance] = useState(10000);
  const [leverage, setLeverage] = useState(3);
  const [bars, setBars] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/backtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Backtest ${new Date().toLocaleString()}`,
        strategyId,
        type,
        symbol,
        timeframe,
        params,
        initialBalance,
        leverage,
        bars,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Backtest failed");
      return;
    }
    router.push(`/dashboard/backtests/${data.backtest.id}`);
  }

  return (
    <form onSubmit={run} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Initial balance</Label>
          <Input type="number" min={100} value={initialBalance} onChange={(e) => setInitialBalance(Number(e.target.value))} />
        </div>
        <div>
          <Label>Leverage</Label>
          <Input type="number" min={1} max={50} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} />
        </div>
        <div>
          <Label>Bars</Label>
          <Input type="number" min={100} max={2000} value={bars} onChange={(e) => setBars(Number(e.target.value))} />
        </div>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Running backtest…" : "Run backtest"}
      </Button>
    </form>
  );
}
