"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { SYMBOLS, TIMEFRAMES } from "@/lib/market/symbols";
import type { StrategyDefinition } from "@/lib/strategies";

export function StrategyCreateForm({ definitions }: { definitions: StrategyDefinition[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(definitions[0]?.type ?? "");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const def = useMemo(() => definitions.find((d) => d.type === type), [definitions, type]);
  const [params, setParams] = useState<Record<string, number>>(def?.defaultParams ?? {});

  function selectType(t: string) {
    setType(t);
    const found = definitions.find((d) => d.type === t);
    setParams(found?.defaultParams ?? {});
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/strategies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || def?.label, type, symbol, timeframe, params }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create strategy");
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={def?.label} />
      </div>
      <div>
        <Label>Strategy type</Label>
        <Select value={type} onChange={(e) => selectType(e.target.value)}>
          {definitions.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </Select>
        {def && <p className="mt-1 text-xs text-slate-500">{def.description}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
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
          <Label>Timeframe</Label>
          <Select value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {def && (
        <div className="space-y-3 rounded-lg bg-slate-950 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parameters</p>
          {def.paramSchema.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-3">
              <Label>{p.label}</Label>
              <Input
                type="number"
                step={p.step}
                min={p.min}
                max={p.max}
                value={params[p.key] ?? ""}
                onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
                className="w-28"
              />
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating…" : "Create strategy"}
      </Button>
    </form>
  );
}
