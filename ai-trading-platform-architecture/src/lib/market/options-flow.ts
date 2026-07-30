// ---------------------------------------------------------------------------
// Gamma Exposure & Options Flow (v3.2)
// Data source: Deribit (largest crypto options exchange, free public API).
// ---------------------------------------------------------------------------

export type GammaLevel = {
  strike: number; netGamma: number; openInterest: number;
  callOI: number; putOI: number;
};

export type GammaExposure = {
  symbol: string; totalGamma: number; gammaFlip: number;
  maxPain: number; levels: GammaLevel[];
  putCallRatio: number; updatedAt: number;
};

export type OptionsFlowSignal = {
  gammaBias: number; gammaConcentration: number;
  gammaMagnet: number | null;
  pcrSignal: "bullish" | "bearish" | "neutral";
  maxPainDirection: "above" | "below" | "at";
};

export function computeGammaExposure(levels: GammaLevel[], currentPrice: number): GammaExposure {
  const totalGamma = levels.reduce((s, l) => s + l.netGamma, 0);
  const totalCalls = levels.reduce((s, l) => s + l.callOI, 0);
  const totalPuts = levels.reduce((s, l) => s + l.putOI, 0);
  const sorted = [...levels].sort((a, b) => a.strike - b.strike);
  let gammaFlip = currentPrice;
  let running = 0;
  for (const l of sorted) { running += l.netGamma; if (running < 0 && gammaFlip === currentPrice) gammaFlip = l.strike; }
  let maxPain = currentPrice, maxOI = 0;
  for (const l of levels) { if (l.openInterest > maxOI) { maxOI = l.openInterest; maxPain = l.strike; } }
  return { symbol: "", totalGamma, gammaFlip, maxPain, levels: sorted, putCallRatio: totalCalls > 0 ? totalPuts / totalCalls : 1, updatedAt: Date.now() };
}

export function analyseGammaSignal(gex: GammaExposure, currentPrice: number): OptionsFlowSignal {
  let gammaBias = 0;
  if (gex.totalGamma > 0) gammaBias = 0.3; else if (gex.totalGamma < 0) gammaBias = -0.4;
  const nearStrikes = gex.levels.filter(l => l.strike >= currentPrice * 0.95 && l.strike <= currentPrice * 1.05);
  const nearGamma = nearStrikes.reduce((s, l) => s + Math.abs(l.netGamma), 0);
  const totalAbsGamma = gex.levels.reduce((s, l) => s + Math.abs(l.netGamma), 1);
  const gammaConcentration = nearGamma / totalAbsGamma;
  let gammaMagnet: number | null = null, maxGamma = 0;
  for (const l of nearStrikes) { if (Math.abs(l.netGamma) > maxGamma) { maxGamma = Math.abs(l.netGamma); gammaMagnet = l.strike; } }
  let pcrSignal: OptionsFlowSignal["pcrSignal"] = "neutral";
  if (gex.putCallRatio > 1.5) pcrSignal = "bearish"; else if (gex.putCallRatio > 1.2) pcrSignal = "bearish";
  else if (gex.putCallRatio < 0.5) pcrSignal = "bullish"; else if (gex.putCallRatio < 0.8) pcrSignal = "bullish";
  let maxPainDirection: OptionsFlowSignal["maxPainDirection"] = "at";
  if (gex.maxPain > currentPrice * 1.02) maxPainDirection = "above";
  else if (gex.maxPain < currentPrice * 0.98) maxPainDirection = "below";
  return { gammaBias, gammaConcentration, gammaMagnet, pcrSignal, maxPainDirection };
}

export function gammaRiskMultiplier(signal: OptionsFlowSignal): number {
  let m = 1.0;
  if (signal.gammaBias < -0.3) m *= 0.6; else if (signal.gammaBias < -0.1) m *= 0.8; else if (signal.gammaBias > 0.2) m *= 1.1;
  if (signal.gammaConcentration > 0.5) m *= 0.7;
  return Math.max(0.3, Math.min(1.3, m));
}

export async function fetchDeribitOptions(symbol: string): Promise<GammaExposure | null> {
  const base = symbol.replace(/USDT|USD|BUSD/, "").toUpperCase();
  try {
    const res = await fetch(`https://www.deribit.com/api/v2/public/get_instruments?currency=${base}&kind=option&expired=false`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    const instruments = data?.result ?? [];
    if (instruments.length === 0) return null;
    const priceRes = await fetch(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${base.toLowerCase()}_usd`, { signal: AbortSignal.timeout(5000) });
    const priceData = priceRes.ok ? await priceRes.json() : null;
    const currentPrice = priceData?.result?.index_price ? Number(priceData.result.index_price) : 50000;
    const strikeMap = new Map<number, { callOI: number; putOI: number }>();
    for (const inst of instruments) {
      const strike = Number(inst.strike); if (!Number.isFinite(strike)) continue;
      const entry = strikeMap.get(strike) ?? { callOI: 0, putOI: 0 };
      const oi = Number(inst.open_interest ?? 0);
      if (inst.option_type === "call") entry.callOI += oi; else entry.putOI += oi;
      strikeMap.set(strike, entry);
    }
    const levels: GammaLevel[] = [];
    for (const [strike, { callOI, putOI }] of strikeMap) {
      const dist = Math.abs(strike - currentPrice) / currentPrice;
      const netGamma = (callOI - putOI) * Math.exp(-dist * 10) * 0.001;
      levels.push({ strike, netGamma, openInterest: callOI + putOI, callOI, putOI });
    }
    const gex = computeGammaExposure(levels, currentPrice);
    gex.symbol = symbol;
    return gex;
  } catch { return null; }
}
