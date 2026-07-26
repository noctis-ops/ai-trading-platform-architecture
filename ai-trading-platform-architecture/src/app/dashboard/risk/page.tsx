import { requireUser } from "@/lib/auth";
import { getOrCreatePrimaryAccount, getOrCreateRiskSettings } from "@/lib/api-helpers";
import { Card } from "@/components/ui";
import { RiskForm } from "@/components/risk/RiskForm";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const user = await requireUser();
  const account = await getOrCreatePrimaryAccount(user);
  const settings = await getOrCreateRiskSettings(account.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Risk Management</h1>
        <p className="text-sm text-slate-400">
          Every order — manual or strategy-driven — is validated against these limits before it can execute.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Account limits</h2>
          <RiskForm
            initial={{
              maxLeverage: Number(settings.maxLeverage),
              riskPerTradePct: Number(settings.riskPerTradePct),
              maxPositionPct: Number(settings.maxPositionPct),
              maxDailyLossPct: Number(settings.maxDailyLossPct),
              maxDrawdownPct: Number(settings.maxDrawdownPct),
              maxOpenPositions: settings.maxOpenPositions,
            }}
          />
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold">How the risk engine works</h2>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-400">
            <li>Every order is checked against your max leverage and the exchange&apos;s per-symbol leverage cap.</li>
            <li>Notional position size is compared against your equity to enforce the max position size limit.</li>
            <li>Open position count is capped to enforce diversification and avoid over-concentration.</li>
            <li>Daily realized losses are tracked; trading halts for the day once the daily loss limit is breached.</li>
            <li>Portfolio drawdown from its equity peak is monitored; a breach triggers an account-wide trading halt.</li>
            <li>Orders that pass all checks may still carry warnings (e.g. high leverage) surfaced in the order form.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
