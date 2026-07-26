import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Multi-Strategy Framework",
    body: "Trend following, mean reversion, breakout, and momentum strategies share one pluggable interface — validated by backtests before ever touching live capital.",
  },
  {
    title: "Institutional Risk Engine",
    body: "Every order passes through position sizing, exposure caps, drawdown limits, and daily-loss circuit breakers before it can execute.",
  },
  {
    title: "Deterministic Backtesting",
    body: "Walk historical price action bar-by-bar with realistic fees & slippage. Sharpe, CAGR, max drawdown, win rate, and profit factor — every time.",
  },
  {
    title: "Paper Trading, Real Mechanics",
    body: "Simulated leveraged positions with real margin math, liquidation pricing, and mark-to-market PnL — a safe proving ground before going live.",
  },
  {
    title: "Exchange-Agnostic Core",
    body: "The exchange adapter interface isolates strategy & risk logic from any single venue — plug in Binance, Bybit, or OKX without touching the core.",
  },
  {
    title: "Full Observability",
    body: "Structured audit logs, alerting, and an admin console give you the operational visibility a regulated trading business requires.",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <nav className="mb-16 flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="text-emerald-400">◆</span> Quantum Arena
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white">
            Log in
          </Link>
          <Link href="/register">
            <Button>Get started</Button>
          </Link>
        </div>
      </nav>

      <section className="grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <p className="mb-4 inline-block rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Risk-first · Institutional-grade
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            An autonomous, research-driven crypto leveraged trading platform.
          </h1>
          <p className="mt-5 text-lg text-slate-400">
            Design strategies, validate them with rigorous backtesting, and trade on a paper engine with
            institutional risk controls — all before a single dollar goes live.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/register">
              <Button className="px-6 py-3 text-base">Create free account</Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary" className="px-6 py-3 text-base">
                Sign in
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Paper-trading only in this environment — no real funds or exchange keys are ever used.
          </p>
        </div>
        <Card className="bg-gradient-to-br from-slate-900 to-slate-950">
          <div className="space-y-3 font-mono text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Strategy</span>
              <span>SMA Crossover · BTCUSDT · 1h</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Total Return</span>
              <span className="text-emerald-400">+34.8%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Sharpe Ratio</span>
              <span className="text-slate-100">1.62</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Max Drawdown</span>
              <span className="text-rose-400">-12.4%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Win Rate</span>
              <span className="text-slate-100">54.1%</span>
            </div>
            <div className="mt-4 h-24 rounded-lg bg-slate-950/80 p-2">
              <svg viewBox="0 0 200 60" className="h-full w-full">
                <polyline
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="2"
                  points="0,50 20,45 40,48 60,32 80,36 100,20 120,25 140,10 160,15 180,5 200,8"
                />
              </svg>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-24 grid gap-6 md:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <h3 className="font-semibold text-slate-100">{f.title}</h3>
            <p className="mt-2 text-sm text-slate-400">{f.body}</p>
          </Card>
        ))}
      </section>

      <footer className="mt-24 border-t border-slate-800 pt-8 text-center text-xs text-slate-500">
        Quantum Arena — built as a reference architecture for a modular, risk-first crypto trading platform.
      </footer>
    </main>
  );
}
