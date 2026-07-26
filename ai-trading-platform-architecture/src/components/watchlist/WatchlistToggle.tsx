"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

export function WatchlistToggle({ symbol }: { symbol: string }) {
  const [inWatchlist, setInWatchlist] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/watchlist")
      .then((r) => r.json())
      .then((data) => {
        const list = data.watchlist ?? [];
        setInWatchlist(list.some((w: { symbol: string }) => w.symbol === symbol));
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  async function toggle() {
    setLoading(true);
    if (inWatchlist) {
      await fetch(`/api/watchlist?symbol=${symbol}`, { method: "DELETE" });
      setInWatchlist(false);
    } else {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      setInWatchlist(true);
    }
    setLoading(false);
  }

  return (
    <Button variant={inWatchlist ? "secondary" : "primary"} disabled={loading} onClick={toggle}>
      {inWatchlist ? "★ In watchlist" : "☆ Add to watchlist"}
    </Button>
  );
}
