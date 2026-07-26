"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function TopBar({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-3 backdrop-blur">
      <div className="text-sm text-slate-400">
        Paper trading account · <span className="text-slate-200">{name}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-slate-500 sm:inline">{email}</span>
        <Button variant="ghost" onClick={logout}>
          Log out
        </Button>
      </div>
    </header>
  );
}
