"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function StrategyActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function setStatus(next: string) {
    setLoading(true);
    await fetch(`/api/strategies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setLoading(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this strategy?")) return;
    setLoading(true);
    await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    setLoading(false);
    router.push("/dashboard/strategies");
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      {status !== "active" ? (
        <Button disabled={loading} onClick={() => setStatus("active")}>
          Activate
        </Button>
      ) : (
        <Button variant="secondary" disabled={loading} onClick={() => setStatus("paused")}>
          Pause
        </Button>
      )}
      <Button variant="danger" disabled={loading} onClick={remove}>
        Delete
      </Button>
    </div>
  );
}
