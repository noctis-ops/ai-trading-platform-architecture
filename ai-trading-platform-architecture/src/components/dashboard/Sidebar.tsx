"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/dashboard", label: "Overview", icon: "◱" },
  { href: "/dashboard/markets", label: "Markets", icon: "◇" },
  { href: "/dashboard/positions", label: "Positions", icon: "▤" },
  { href: "/dashboard/orders", label: "Orders", icon: "≡" },
  { href: "/dashboard/strategies", label: "Strategies", icon: "⌘" },
  { href: "/dashboard/backtests", label: "Backtests", icon: "◈" },
  { href: "/dashboard/risk", label: "Risk", icon: "⚑" },
  { href: "/dashboard/alerts", label: "Alerts", icon: "🔔" },
  { href: "/dashboard/docs", label: "Docs", icon: "📄" },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r border-slate-800 bg-slate-950 p-4 md:block">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-2 text-lg font-bold">
        <span className="text-emerald-400">◆</span> Quantum Arena
      </Link>
      <nav className="space-y-1">
        {LINKS.map((link) => {
          const active = link.href === "/dashboard" ? pathname === link.href : pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active ? "bg-emerald-500/10 text-emerald-400" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
              )}
            >
              <span className="w-4 text-center">{link.icon}</span>
              {link.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/dashboard/admin"
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              pathname?.startsWith("/dashboard/admin") ? "bg-emerald-500/10 text-emerald-400" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100",
            )}
          >
            <span className="w-4 text-center">⚙</span>
            Admin
          </Link>
        )}
      </nav>
    </aside>
  );
}
