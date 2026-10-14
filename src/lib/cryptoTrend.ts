// ─── Motor quantitativo de tendência (score 0–100) + portfólio top-N ──────────
// 100% dados públicos da Binance (klines, tickers, funding). SEM IA, SEM chaves.
//
// IMPORTANTE: o "score" NÃO é uma probabilidade estatística calibrada — é um
// índice heurístico compósito (0–100) que ordena os pares por tendência a subir
// com base em momentum, tendência, volume, funding e liquidez.

import { atr, ema, rsi } from "@/lib/indicators";
import {
  FUTURES_TRADING_SYMBOLS,
  fetchFuturesKlines,
  fetchFuturesTickers24h,
  getFundingRates,
  type BinanceKline,
  type BinanceTicker24h,
  type FundingRate,
} from "@/lib/binance";

export interface TrendFactor {
  key: string;
  label: string;
  rawLabel: string;
  score: number; // 0..1
  weight: number; // pontos máximos
  points: number; // score * weight
}

export interface TrendScore {
  symbol: string;
  score: number; // 0..100
  price: number;
  change24hPct: number;
  quoteVolume: number;
  atrPct: number;
  factors: TrendFactor[];
  updatedAt: number;
}

export interface PortfolioItem {
  symbol: string;
  score: number;
  weightPct: number;
  amountUsdt: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const num = (x: number | null | undefined, fb = 0) => (Number.isFinite(x as number) ? (x as number) : fb);
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;

function rsiScore(r: number): number {
  if (r < 30) return 0.2;
  if (r < 50) return 0.2 + ((r - 30) / 20) * 0.6;
  if (r < 70) return 0.8 + ((r - 50) / 20) * 0.2;
  if (r < 80) return 1 - ((r - 70) / 10) * 0.6;
  return 0.2;
}

/** fundingPct = taxa por intervalo (ex.: 0.0001 = 0.01%). */
function fundingScore(fundingPct: number | null): number {
  if (fundingPct == null) return 0.7;
  const p = fundingPct * 100;
  if (p > 0.1) return 0.2; // longs demasiado lotados
  if (p > 0.05) return 0.5;
  if (p >= -0.01) return 1; // neutro / ligeiro positivo
  if (p >= -0.05) return 0.7;
  return 0.5;
}

const WEIGHTS = {
  mom24: 15,
  mom7d: 15,
  trend: 20,
  rsi: 15,
  volume: 15,
  funding: 10,
  liquidity: 10,
};

/** Calcula o score de tendência de um par a partir das suas velas 1h. */
export function computeTrendScore(
  symbol: string,
  klines: BinanceKline[],
  ticker: BinanceTicker24h | undefined,
  fundingPct: number | null
): TrendScore {
  const closes = klines.map((k) => k.c);
  const n = closes.length;
  const price = n ? closes[n - 1] : ticker?.lastPrice ?? 0;
  const change24hPct =
    ticker && Number.isFinite(ticker.priceChangePercent)
      ? ticker.priceChangePercent
      : n > 24
        ? (price / closes[n - 25] - 1) * 100
        : 0;

  const mom24 = n > 24 ? price / closes[n - 25] - 1 : 0;
  const mom7d = n > 1 ? price / closes[0] - 1 : 0;

  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);
  const e20 = num(ema20Arr[n - 1], price);
  const e20prev = num(ema20Arr[n - 2], e20);
  const e50 = num(ema50Arr[n - 1], price);

  const rsiArr = rsi(closes, 14);
  const r = num(rsiArr[n - 1], 50);

  const atrArr = atr(klines, 14);
  const a = num(atrArr[n - 1], 0);
  const atrPct = price > 0 ? (a / price) * 100 : 0;

  const vols = klines.map((k) => k.v);
  const recent = mean(vols.slice(-24));
  const base = mean(vols.slice(0, Math.max(1, n - 24))) || mean(vols) || 1;
  const surge = base > 0 ? recent / base : 1;

  const liquidity = ticker?.quoteVolume ?? 0;

  const factors: TrendFactor[] = [
    {
      key: "mom24",
      label: "Momentum 24h",
      rawLabel: pct(change24hPct),
      score: clamp01((mom24 + 0.05) / 0.15),
      weight: WEIGHTS.mom24,
      points: 0,
    },
    {
      key: "mom7d",
      label: "Momentum 7d",
      rawLabel: pct(mom7d * 100),
      score: clamp01((mom7d + 0.15) / 0.45),
      weight: WEIGHTS.mom7d,
      points: 0,
    },
    {
      key: "trend",
      label: "Tendência (EMA20/50)",
      rawLabel: e20 >= e50 ? "EMA20 ≥ EMA50" : "EMA20 < EMA50",
      score: clamp01((e20 >= e50 ? 0.5 : 0) + (price >= e20 ? 0.3 : 0) + (e20 >= e20prev ? 0.2 : 0)),
      weight: WEIGHTS.trend,
      points: 0,
    },
    {
      key: "rsi",
      label: "RSI(14)",
      rawLabel: r.toFixed(1),
      score: rsiScore(r),
      weight: WEIGHTS.rsi,
      points: 0,
    },
    {
      key: "volume",
      label: "Volume vs média",
      rawLabel: `${surge.toFixed(2)}x`,
      score: clamp01((surge - 1) / 2),
      weight: WEIGHTS.volume,
      points: 0,
    },
    {
      key: "funding",
      label: "Funding",
      rawLabel: fundingPct == null ? "—" : `${(fundingPct * 100).toFixed(3)}%`,
      score: fundingScore(fundingPct),
      weight: WEIGHTS.funding,
      points: 0,
    },
    {
      key: "liquidity",
      label: "Liquidez 24h",
      rawLabel: liquidity > 0 ? `$${(liquidity / 1_000_000).toFixed(1)}M` : "—",
      score: clamp01((Math.log10(Math.max(1, liquidity)) - 6) / 3),
      weight: WEIGHTS.liquidity,
      points: 0,
    },
  ];

  let score = 0;
  for (const f of factors) {
    f.points = f.score * f.weight;
    score += f.points;
  }

  return {
    symbol,
    score: Math.round(score * 10) / 10,
    price,
    change24hPct,
    quoteVolume: liquidity,
    atrPct,
    factors,
    updatedAt: Date.now(),
  };
}

/** Analisa uma lista de símbolos (4 pedidos em paralelo) e devolve ordenado por score. */
export async function rankTrends(
  symbols: string[],
  onProgress?: (done: number, total: number) => void
): Promise<TrendScore[]> {
  const [tickers, funding] = await Promise.all([
    fetchFuturesTickers24h().catch(() => [] as BinanceTicker24h[]),
    getFundingRates(500).catch(() => ({ rates: [] as FundingRate[], source: "mock" as const })),
  ]);
  const tMap = new Map<string, BinanceTicker24h>(tickers.map((t) => [t.symbol, t] as [string, BinanceTicker24h]));
  const fMap = new Map<string, number>(funding.rates.map((r) => [r.symbol, r.fundingRate] as [string, number]));

  const out: TrendScore[] = [];
  let idx = 0;
  let done = 0;
  const run = async () => {
    while (idx < symbols.length) {
      const sym = symbols[idx++];
      try {
        const kl = await fetchFuturesKlines(sym, "1h", 168);
        if (kl.length > 30) out.push(computeTrendScore(sym, kl, tMap.get(sym), fMap.get(sym) ?? null));
      } catch {
        /* ignora pares sem histórico */
      }
      done += 1;
      onProgress?.(done, symbols.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, run));
  return out.sort((a, b) => b.score - a.score);
}

/** Universo curado (lista de futuros USDT-M). */
export function curatedSymbols(): string[] {
  return [...FUTURES_TRADING_SYMBOLS];
}

/** Top-N pares por volume 24h (futuros). */
export async function topSymbolsByVolume(n: number): Promise<string[]> {
  try {
    const tickers = await fetchFuturesTickers24h();
    return [...tickers]
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, n)
      .map((t) => t.symbol);
  } catch {
    return curatedSymbols().slice(0, n);
  }
}

/**
 * Constrói um portfólio com os N melhores scores, peso proporcional ao score
 * e teto por ativo (redistribuindo o excesso).
 */
export function buildPortfolio(
  scores: TrendScore[],
  capitalUsdt: number,
  topN = 5,
  maxWeightPct = 35
): PortfolioItem[] {
  const top = scores.slice(0, topN);
  if (top.length === 0) return [];
  const sum = top.reduce((s, x) => s + Math.max(1, x.score), 0);
  const items: PortfolioItem[] = top.map((x) => ({
    symbol: x.symbol,
    score: x.score,
    weightPct: (Math.max(1, x.score) / sum) * 100,
    amountUsdt: 0,
  }));

  for (let iter = 0; iter < 6; iter++) {
    const over = items.filter((i) => i.weightPct > maxWeightPct + 1e-9);
    if (over.length === 0) break;
    let excess = 0;
    for (const i of over) {
      excess += i.weightPct - maxWeightPct;
      i.weightPct = maxWeightPct;
    }
    const under = items.filter((i) => i.weightPct < maxWeightPct);
    const underSum = under.reduce((s, i) => s + i.weightPct, 0);
    if (underSum > 0) under.forEach((i) => (i.weightPct += excess * (i.weightPct / underSum)));
    else break;
  }

  const total = items.reduce((s, i) => s + i.weightPct, 0) || 1;
  for (const i of items) {
    i.weightPct = (i.weightPct / total) * 100;
    i.amountUsdt = (capitalUsdt * i.weightPct) / 100;
  }
  return items.sort((a, b) => b.weightPct - a.weightPct);
}

export function scoreColor(score: number): string {
  if (score >= 70) return "text-bull";
  if (score >= 45) return "text-warning";
  return "text-bear";
}

export function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-bull";
  if (score >= 45) return "bg-warning";
  return "bg-bear";
}
