"use client";

import { useEffect, useState, useCallback } from "react";
import { Button, Card, Input, Label, Select, Badge } from "@/components/ui";
import { SYMBOLS } from "@/lib/market/symbols";
import { fmtPrice, fmtDate } from "@/lib/format";

type Alert = {
  id: string;
  symbol: string;
  condition: string;
  targetPrice: string;
  status: string;
  createdAt: string;
  triggeredAt: string | null;
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/alerts");
    const data = await res.json();
    setAlerts(data.alerts ?? []);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!targetPrice) return;
    setLoading(true);
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, condition, targetPrice: Number(targetPrice) }),
    });
    setTargetPrice("");
    setLoading(false);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/alerts?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Price Alerts</h1>
        <p className="text-sm text-slate-400">Get notified when a market crosses a target price you set.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Your alerts</h2>
          {alerts.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No alerts configured yet.</p>
          ) : (
            <ul className="divide-y divide-slate-900">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {a.symbol} {a.condition} {fmtPrice(Number(a.targetPrice))}
                    </p>
                    <p className="text-xs text-slate-500">
                      Created {fmtDate(a.createdAt)}
                      {a.triggeredAt ? ` · Triggered ${fmtDate(a.triggeredAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={a.status === "triggered" ? "positive" : a.status === "active" ? "neutral" : "warning"}>
                      {a.status}
                    </Badge>
                    <Button variant="ghost" onClick={() => remove(a.id)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">New alert</h2>
          <form onSubmit={create} className="space-y-4">
            <div>
              <Label>Symbol</Label>
              <Select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {SYMBOLS.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.symbol}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Condition</Label>
              <Select value={condition} onChange={(e) => setCondition(e.target.value as "above" | "below")}>
                <option value="above">Price goes above</option>
                <option value="below">Price goes below</option>
              </Select>
            </div>
            <div>
              <Label>Target price (USD)</Label>
              <Input type="number" step="any" min="0" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} required />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Creating…" : "Create alert"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
