import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quantum Arena — Institutional Crypto Trading Platform",
  description:
    "A modular, risk-first cryptocurrency leveraged trading platform: strategy research, backtesting, paper trading, and portfolio risk management.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
