import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { accounts, subscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card, Badge } from "@/components/ui";
import { fmtDate, fmtUsd } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      plan: subscriptions.plan,
      balance: accounts.balance,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .leftJoin(accounts, eq(accounts.userId, users.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Console</h1>
        <p className="text-sm text-slate-400">Platform-wide visibility into registered traders and their accounts.</p>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Balance</th>
                <th className="py-2 pr-4">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-900">
                  <td className="py-2 pr-4 font-medium">{r.name}</td>
                  <td className="py-2 pr-4 text-slate-400">{r.email}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={r.role === "admin" ? "warning" : "neutral"}>{r.role}</Badge>
                  </td>
                  <td className="py-2 pr-4 capitalize">{r.plan ?? "free"}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.balance ? fmtUsd(Number(r.balance)) : "—"}</td>
                  <td className="py-2 pr-4 text-slate-500">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
