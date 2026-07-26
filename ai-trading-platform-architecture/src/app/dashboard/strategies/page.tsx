import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { strategies } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { Card, Badge } from "@/components/ui";
import { listStrategyDefinitions } from "@/lib/strategies";
import { StrategyCreateForm } from "@/components/strategies/StrategyCreateForm";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const user = await requireUser();
  const rows = await db.select().from(strategies).where(eq(strategies.userId, user.id)).orderBy(desc(strategies.createdAt));
  const definitions = listStrategyDefinitions();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Strategies</h1>
        <p className="text-sm text-slate-400">
          Build strategies from the shared framework, then validate them with backtests before activating.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Your strategies</h2>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No strategies yet — create your first one.</p>
          ) : (
            <ul className="divide-y divide-slate-900">
              {rows.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/dashboard/strategies/${s.id}`} className="font-medium hover:text-emerald-400">
                      {s.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {s.type} · {s.symbol} · {s.timeframe}
                    </p>
                  </div>
                  <Badge tone={s.status === "active" ? "positive" : s.status === "paused" ? "warning" : "neutral"}>
                    {s.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">New strategy</h2>
          <StrategyCreateForm definitions={definitions} />
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Strategy library</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {definitions.map((d) => (
            <div key={d.type} className="rounded-lg border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{d.label}</h3>
                <Badge>{d.category.replace("_", " ")}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-400">{d.description}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
