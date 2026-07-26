"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUsd } from "@/lib/format";

export function EquityChart({ data }: { data: { time: number; equity: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="time"
          tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          stroke="#64748b"
          fontSize={11}
          minTickGap={40}
        />
        <YAxis
          stroke="#64748b"
          fontSize={11}
          domain={["auto", "auto"]}
          tickFormatter={(v) => fmtUsd(v, { maximumFractionDigits: 0 })}
          width={80}
        />
        <Tooltip
          contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
          formatter={(v) => [fmtUsd(Number(v)), "Equity"]}
        />
        <Area type="monotone" dataKey="equity" stroke="#34d399" fill="url(#equityFill)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
