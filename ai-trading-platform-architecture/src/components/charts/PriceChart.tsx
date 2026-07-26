"use client";

import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtPrice } from "@/lib/format";
import type { Candle } from "@/lib/indicators";

export function PriceChart({ candles }: { candles: Candle[] }) {
  const data = candles.map((c) => ({ time: c.time, close: c.close, high: c.high, low: c.low }));
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="time"
          tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          stroke="#64748b"
          fontSize={11}
          minTickGap={50}
        />
        <YAxis
          stroke="#64748b"
          fontSize={11}
          domain={["auto", "auto"]}
          tickFormatter={(v) => fmtPrice(v)}
          width={90}
        />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
          formatter={(v, name) => [fmtPrice(Number(v)), String(name)]}
        />
        <Line type="monotone" dataKey="close" stroke="#34d399" dot={false} strokeWidth={1.75} name="Close" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
