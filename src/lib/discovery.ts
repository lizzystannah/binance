// ─── Discovery de novas criptos (triagem quantitativa → N8N/IA) ─────────────
// Pipeline em 2 fases, como pedido:
//   1. Triagem no código (barata, 100% dados públicos Binance spot): filtra o
//      universo spot USDT para ~10 candidatos com tração de alta (momentum +
//      surge de volume + RSI saudável + liquidez mínima).
//   2. Contexto via IA (N8N + agente com internet): os 10 seguem via webhook,
//      o agente cruza com notícias/segundo contexto e devolve o top-5.
// Este ficheiro só faz a fase 1 + formatos do webhook. Nada aqui executa ordens.

import { atr, ema, rsi } from "@/lib/indicators";
import {
  fetchAllTickers24h,
  fetchFuturesEligibleSymbols,
  fetchKlines,
  type BinanceKline,
  type BinanceTicker24h,
} from "@/lib/binance";

export interface TriageCandidate {
  symbol: string;
  price: number;
  change24hPct: number;
  quoteVolume: number;
  mom7dPct: number;
  volumeSurge: number;
  rsi14: number;
  atrPct: number;
  nearHigh7d: boolean;
  /** 0–100 heurístico (NÃO é probabilidade). */
  score: number;
  reasons: string[];
  futuresEligible: boolean;
}

export interface DiscoveryPayload {
  version: 1;
  generatedAt: string;
  source: "quantterm-triage";
  universe: "spot-usdt";
  candidates: Array<{
    symbol: string;
    price: number;
    change24hPct: number;
    quoteVolumeUsdt: number;
    mom7dPct: number;
    volumeSurgeX: number;
    rsi14: number;
    atrPct: number;
    nearHigh7d: boolean;
    triageScore: number;
    reasons: string[];
    futuresEligible: boolean;
  }>;
}

export interface DiscoveryPick {
  symbol: string;
  direction: "UP" | "DOWN" | "NEUTRAL";
  confidence: number; // 0–100
  thesis: string;
  catalysts: string[];
  risks: string[];
  invalidation: string;
}

const STABLES = new Set([
  "USDTUSDT", "USDCUSDT", "FDUSDUSDT", "DAIUSDT", "TUSDUSDT", "USDPUSDT",
  "EURUSDT", "AEURUSDT", "XUSDUSDT", "BFUSDUSDT",
]);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const num = (x: number | null | undefined, fb = 0) =>
  Number.isFinite(x as number) ? (x as number) : fb;

function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

/**
 * Triagem de novas/low-cap com tração de alta.
 * - Universo: spot USDT, sem stables, quoteVolume 24h entre minQv e maxQv
 *   (fora disso é gigante consolidada ou par morto/ilíquido).
 * - Pré-filtro barato por ticker (|variação| + volume) → top `prefilter`.
 * - Indicadores em klines spot 1h (168): momentum 7d, surge de volume, RSI, ATR.
 */
export async function triageNewCryptos(
  opts: {
    topN?: number;
    prefilter?: number;
    minQuoteVolume?: number;
    maxQuoteVolume?: number;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<TriageCandidate[]> {
  const {
    topN = 10,
    prefilter = 30,
    minQuoteVolume = 300_000,
    maxQuoteVolume = 80_000_000,
    onProgress,
  } = opts;

  const [tickers, eligible] = await Promise.all([
    fetchAllTickers24h(),
    fetchFuturesEligibleSymbols().catch(() => new Set<string>()),
  ]);

  const pool = tickers.filter(
    (t) =>
      t.symbol.endsWith("USDT") &&
      !STABLES.has(t.symbol) &&
      Number.isFinite(t.lastPrice) &&
      t.lastPrice > 0 &&
      t.quoteVolume >= minQuoteVolume &&
      t.quoteVolume <= maxQuoteVolume
  );
  if (pool.length === 0) return [];

  // Pré-filtro: prioriza movimento + volume (barato, sem klines).
  const shortlist = [...pool]
    .sort((a, b) => Math.abs(b.priceChangePercent) * Math.log10(1 + b.quoteVolume) - Math.abs(a.priceChangePercent) * Math.log10(1 + a.quoteVolume))
    .slice(0, Math.max(topN, Math.min(prefilter, pool.length)));

  const scored: TriageCandidate[] = [];
  let idx = 0;
  let done = 0;
  const run = async () => {
    while (idx < shortlist.length) {
      const t: BinanceTicker24h = shortlist[idx++];
      try {
        const kl: BinanceKline[] = await fetchKlines(t.symbol, "1h", 168);
        const c = scoreOne(t, kl, eligible.has(t.symbol));
        if (c) scored.push(c);
      } catch {
        /* par sem histórico spot — ignora */
      }
      done += 1;
      onProgress?.(done, shortlist.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, shortlist.length) }, run));
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

function scoreOne(
  t: BinanceTicker24h,
  klines: BinanceKline[],
  futuresEligible: boolean
): TriageCandidate | null {
  const closes = klines.map((k) => k.c);
  const n = closes.length;
  if (n < 48) return null;
  const price = closes[n - 1];

  const mom7dPct = (price / closes[0] - 1) * 100;
  const mom24 = n > 24 ? price / closes[n - 25] - 1 : 0;

  const vols = klines.map((k) => k.v);
  const recent = vols.slice(-24).reduce((s, v) => s + v, 0) / 24;
  const base = vols.slice(0, Math.max(1, n - 24)).reduce((s, v) => s + v, 0) / Math.max(1, n - 24);
  const volumeSurge = base > 0 ? recent / base : 1;

  const rArr = rsi(closes, 14);
  const r = num(rArr[n - 1], 50);
  const atrArr = atr(klines, 14);
  const atrPct = price > 0 ? (num(atrArr[n - 1], 0) / price) * 100 : 0;

  const high7d = Math.max(...closes);
  const nearHigh7d = price >= high7d * 0.97;

  // Pesos: momentum 7d 25 + momentum 24h 15 + volume 25 + RSI 15 + proximidade topo 10 + liquidez 10
  const momScore = clamp01((mom7dPct + 10) / 60); // -10%→0, +50%→1
  const m24Score = clamp01((mom24 * 100 + 5) / 20);
  const volScore = clamp01((volumeSurge - 0.8) / 2.2); // 0.8x→0, 3x→1
  const rsiScore = r < 30 ? 0.2 : r < 50 ? 0.2 + ((r - 30) / 20) * 0.6 : r < 70 ? 0.8 + ((r - 50) / 20) * 0.2 : r < 80 ? 1 - ((r - 70) / 10) * 0.6 : 0.2;
  const proxScore = nearHigh7d ? 1 : clamp01((price / high7d - 0.8) / 0.17);
  const liqScore = clamp01((Math.log10(1 + t.quoteVolume) - 5.5) / 2); // ~$300k→0, ~$30M→1

  // Desempate técnico: preço acima da EMA20 soma bónus.
  const e20 = ema(closes, 20)[n - 1];
  const trendBonus = e20 != null && price > e20 ? 4 : 0;

  const score = Math.min(
    100,
    momScore * 25 + m24Score * 15 + volScore * 25 + rsiScore * 15 + proxScore * 10 + liqScore * 10 + trendBonus
  );

  const reasons: string[] = [];
  if (mom7dPct > 10) reasons.push(`momentum 7d +${mom7dPct.toFixed(1)}%`);
  if (t.priceChangePercent > 5) reasons.push(`24h +${t.priceChangePercent.toFixed(1)}%`);
  if (volumeSurge >= 1.5) reasons.push(`volume ${volumeSurge.toFixed(1)}x`);
  if (r >= 50 && r < 70) reasons.push(`RSI ${r.toFixed(0)} saudável`);
  if (nearHigh7d) reasons.push("a romper máxima 7d");
  if (futuresEligible) reasons.push("com futuro USDT-M");
  else reasons.push("só spot");
  if (reasons.length === 0) reasons.push("triagem quantitativa");

  return {
    symbol: t.symbol,
    price,
    change24hPct: round2(t.priceChangePercent),
    quoteVolume: Math.round(t.quoteVolume),
    mom7dPct: round2(mom7dPct),
    volumeSurge: round2(volumeSurge),
    rsi14: round2(r),
    atrPct: round2(atrPct),
    nearHigh7d,
    score: round2(score),
    reasons,
    futuresEligible,
  };
}

/** Monta o JSON enviado ao webhook do N8N (contrato em n8n-workflows/). */
export function buildDiscoveryPayload(candidates: TriageCandidate[]): DiscoveryPayload {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "quantterm-triage",
    universe: "spot-usdt",
    candidates: candidates.map((c) => ({
      symbol: c.symbol,
      price: c.price,
      change24hPct: c.change24hPct,
      quoteVolumeUsdt: c.quoteVolume,
      mom7dPct: c.mom7dPct,
      volumeSurgeX: c.volumeSurge,
      rsi14: c.rsi14,
      atrPct: c.atrPct,
      nearHigh7d: c.nearHigh7d,
      triageScore: c.score,
      reasons: c.reasons,
      futuresEligible: c.futuresEligible,
    })),
  };
}

/** Valida a resposta do N8N (top-5). Aceita { picks: [...] } ou array direto. */
export function parseDiscoveryResponse(json: unknown): { picks: DiscoveryPick[]; error?: string } {
  const arr = findPicksArray(json, 0);
  if (!arr) return { picks: [], error: `Resposta sem lista \`picks\` (recebido: ${describeJson(json)}).` };
  const picks: DiscoveryPick[] = [];
  for (const p of arr.slice(0, 8)) {
    const o = p as Record<string, unknown>;
    if (typeof o.symbol !== "string") continue;
    // Evita confundir o eco das candidatas com picks: exige pelo menos um
    // campo de análise do agente.
    if (
      !("direction" in o) &&
      !("confidence" in o) &&
      !("thesis" in o) &&
      !("catalysts" in o) &&
      !("risks" in o)
    ) {
      continue;
    }
    picks.push({
      symbol: String(o.symbol).toUpperCase(),
      direction: o.direction === "DOWN" ? "DOWN" : o.direction === "NEUTRAL" ? "NEUTRAL" : "UP",
      confidence: Number.isFinite(Number(o.confidence))
        ? Math.min(100, Math.max(0, Number(o.confidence)))
        : 50,
      thesis: typeof o.thesis === "string" ? o.thesis.slice(0, 500) : "",
      catalysts: Array.isArray(o.catalysts) ? (o.catalysts as unknown[]).map(String).slice(0, 5) : [],
      risks: Array.isArray(o.risks) ? (o.risks as unknown[]).map(String).slice(0, 5) : [],
      invalidation: typeof o.invalidation === "string" ? o.invalidation.slice(0, 300) : "",
    });
  }
  if (picks.length === 0) return { picks: [], error: "Nenhum pick válido na resposta." };
  return { picks: picks.slice(0, 5) };
}

/**
 * Procura a lista de picks em variações comuns de resposta do N8N
 * ({ picks }, { output: { picks } }, { data: ... }, array direto,
 * JSON em string, blocos ```json ... ```).
 */
function findPicksArray(node: unknown, depth: number): unknown[] | null {
  if (depth > 4 || node == null) return null;
  if (typeof node === "string") {
    const t = node.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    if (!t.startsWith("{") && !t.startsWith("[")) return null;
    try {
      return findPicksArray(JSON.parse(t) as unknown, depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(node)) {
    if (node.length > 0) {
      const first = node[0] as Record<string, unknown>;
      if (typeof first === "object" && first !== null && typeof first.symbol === "string") {
        return node;
      }
      for (const el of node) {
        const f = findPicksArray(el, depth + 1);
        if (f) return f;
      }
    }
    return null;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.picks)) return o.picks as unknown[];
    for (const k of ["output", "data", "result", "response", "body", "json", "content"]) {
      if (k in o) {
        const f = findPicksArray(o[k], depth + 1);
        if (f) return f;
      }
    }
    return null;
  }
  return null;
}

/** Resume o que chegou (para a mensagem de erro orientar o acerto no N8N). */
function describeJson(json: unknown): string {
  try {
    if (json == null) return String(json);
    if (typeof json !== "object") return `${typeof json}: ${String(json).slice(0, 120)}`;
    if (Array.isArray(json)) return `array[${json.length}]`;
    const keys = Object.keys(json as Record<string, unknown>);
    const head = keys.slice(0, 8).join(", ") || "(vazio)";
    return `{ ${head} }`;
  } catch {
    return "?";
  }
}
