export function fmtUsd(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  }).format(value);
}

export function fmtPrice(value: number): string {
  if (value >= 1000) return fmtUsd(value, { maximumFractionDigits: 0 });
  if (value >= 1) return fmtUsd(value, { maximumFractionDigits: 2 });
  return fmtUsd(value, { maximumFractionDigits: 4, minimumFractionDigits: 4 });
}

export function fmtPct(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function fmtNum(value: number, decimals = 4): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function fmtDate(value: string | number | Date): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
