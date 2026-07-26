"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

type RiskValues = {
  maxLeverage: number;
  riskPerTradePct: number;
  maxPositionPct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
};

export function RiskForm({ initial }: { initial: RiskValues }) {
  const router = useRouter();
  const [values, setValues] = useState<RiskValues>(initial);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof RiskValues>(key: K, v: number) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/risk-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const fields: { key: keyof RiskValues; label: string; help: string; step?: number }[] = [
    { key: "maxLeverage", label: "Max leverage (x)", help: "Hard cap on leverage for any single order." },
    { key: "riskPerTradePct", label: "Risk per trade (%)", help: "Suggested % of equity risked per trade when sizing by stop distance.", step: 0.1 },
    { key: "maxPositionPct", label: "Max position size (% of equity)", help: "Caps notional exposure of any single position." },
    { key: "maxDailyLossPct", label: "Max daily loss (%)", help: "Trading halts for the day once realized losses reach this threshold." },
    { key: "maxDrawdownPct", label: "Max drawdown (%)", help: "Trading halts entirely once equity drawdown from peak reaches this threshold." },
    { key: "maxOpenPositions", label: "Max open positions", help: "Caps the number of concurrently open positions." },
  ];

  return (
    <form onSubmit={submit} className="space-y-5">
      {fields.map((f) => (
        <div key={f.key}>
          <div className="flex items-center justify-between">
            <Label>{f.label}</Label>
            <Input
              type="number"
              step={f.step ?? 1}
              value={values[f.key]}
              onChange={(e) => set(f.key, Number(e.target.value))}
              className="w-28"
            />
          </div>
          <p className="text-xs text-slate-500">{f.help}</p>
        </div>
      ))}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Risk settings saved.</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Saving…" : "Save risk settings"}
      </Button>
    </form>
  );
}
