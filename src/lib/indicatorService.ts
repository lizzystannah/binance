/**
 * Indicator Service — SINGLE source of truth for trade indicator snapshots.
 *
 * Every trade (backtest, live strategy, pending order, sequence trigger)
 * records its indicators through buildIndicatorSnapshot(), so the snapshot
 * data is identical regardless of which engine created the trade.
 *
 * This also fixes the off-by-one bug in serverEngine.ts where
 * classifyMarketMomentum was called with length-1 instead of length.
 */

import {
  rsi, sma, bollinger, adx, macd, parabolicSar, atr, williamsR,
  getFibonacciLevel, getPivotPoints, getPattern,
  classifyMarketMomentum, detectMarketStructure,
  classifyCandleBodySize,
  type Candle,
} from "./indicators";
import { analyzeLast5Wicks } from "./candleWick";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndicatorSnapshot {
  rsi: number | null;
  adx: number | null;
  macd: number | null;
  histogram: number | null;
  pattern: string | null;
  ma9: number | null;
  ma21: number | null;
  ma200: number | null;
  ma235: number | null;
  sar: number | null;
  atr: number | null;
  williams: number | null;
  fibLevel: string;
  pivotLevel: string;
  marketMoment: string;
  marketStructure: string;
  candleSize: string;
  preEntryMomentum: string;
  bollingerState: string;
  indicatorCrossover: string;
  entryCandle: Candle | null;
  last5Wicks: string;
  last5Candles: Candle[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lastOf<T>(arr: (T | null)[]): T | null {
  return arr.length > 0 ? (arr[arr.length - 1] ?? null) : null;
}

function computeCandleSize(candles: Candle[], lastIdx: number): string {
  return classifyCandleBodySize(candles, lastIdx);
}

function computePreEntryMomentum(candles: Candle[]): string {
  if (candles.length < 5) return "Misto / Sem Histórico";
  const last5 = candles.slice(-5);
  const greenCount = last5.filter(c => c.c > c.o).length;
  const redCount = last5.filter(c => c.c < c.o).length;
  const avgBodyPct = last5.reduce((sum, c) => sum + (Math.abs(c.c - c.o) / c.o) * 100, 0) / 5;
  if (greenCount >= 4) {
    return avgBodyPct > 0.06 ? "Impulso Altista Forte" : "Impulso Altista Moderado";
  }
  if (redCount >= 4) {
    return avgBodyPct > 0.06 ? "Impulso Baixista Forte" : "Impulso Baixista Moderado";
  }
  if (avgBodyPct < 0.02) return "Lateralização / Sem Força";
  return "Misto / Correção";
}

function computeBollingerState(closes: number[]): string {
  if (closes.length < 20) return "N/A";
  const bb = bollinger(closes, 20, 2);
  const idx = closes.length - 1;
  const u = bb.upper[idx];
  const l = bb.lower[idx];
  const m = bb.ma[idx];
  if (u == null || l == null || m == null) return "N/A";

  const bandwidth = (u - l) / m;
  let sumBw = 0;
  let count = 0;
  for (let j = Math.max(0, idx - 19); j <= idx; j++) {
    const uj = bb.upper[j];
    const lj = bb.lower[j];
    const mj = bb.ma[j];
    if (uj != null && lj != null && mj != null) {
      sumBw += (uj - lj) / mj;
      count++;
    }
  }
  const avgBandwidth = count > 0 ? sumBw / count : bandwidth;

  if (bandwidth < avgBandwidth * 0.85) return "Squeeze (Bandas Estreitas)";
  if (bandwidth > avgBandwidth * 1.15) return "Estouro / Expansão Volatilidade";
  return "Neutro / Altas e Baixas Padrão";
}

function computeIndicatorCrossover(closes: number[]): string {
  if (closes.length < 21) return "N/A";
  const s9 = sma(closes, 9);
  const s21 = sma(closes, 21);
  const idx = closes.length - 1;
  const cur9 = s9[idx];
  const cur21 = s21[idx];
  const prev9 = s9[idx - 1];
  const prev21 = s21[idx - 1];
  if (cur9 == null || cur21 == null || prev9 == null || prev21 == null) {
    return "Sem Cruzamentos";
  }
  if (prev9 <= prev21 && cur9 > cur21) return "Cruzamento de Alta Recente (9x21)";
  if (prev9 >= prev21 && cur9 < cur21) return "Cruzamento de Baixa Recente (9x21)";
  return cur9 > cur21 ? "Alinhamento de Alta (9 > 21)" : "Alinhamento de Baixa (9 < 21)";
}

// ─── Main snapshot builder ───────────────────────────────────────────────────

/**
 * Build a complete indicator snapshot from closed candle data.
 *
 * This is the SINGLE source of truth for trade snapshots — used by
 * both serverEngine.ts (live) and robotEngine.ts (backtest) so that
 * every trade records the same indicator state regardless of engine.
 */
export function buildIndicatorSnapshot(
  closedCandles: Candle[],
  closedCloses: number[],
  entry: number,
): IndicatorSnapshot {
  // Return safe defaults when there is no data
  if (closedCandles.length === 0 || closedCloses.length === 0) {
    return {
      rsi: null, adx: null, macd: null, histogram: null,
      pattern: null, ma9: null, ma21: null, ma200: null, ma235: null,
      sar: null, atr: null, williams: null,
      fibLevel: "N/A", pivotLevel: "N/A",
      marketMoment: "Sem Padrão Clássico", marketStructure: "Sem Estrutura Definida",
      candleSize: "N/A", preEntryMomentum: "Misto / Sem Histórico",
      bollingerState: "N/A", indicatorCrossover: "N/A",
      entryCandle: null,
      last5Wicks: "Neutro / Indefinido",
      last5Candles: [],
    };
  }

  // Janela limitada para o cálculo do snapshot — evitar recomputar indicadores
  // sobre todo o histórico (até ~10000 velas) nos caminhos sem cap prévio.
  // sma(200)/sma(235) necessitam >=235 velas; 500 garante margem sem custo relevante.
  const SNAPSHOT_MAX_CANDLES = 500;
  if (closedCandles.length > SNAPSHOT_MAX_CANDLES) {
    closedCandles = closedCandles.slice(-SNAPSHOT_MAX_CANDLES);
    closedCloses = closedCloses.slice(-SNAPSHOT_MAX_CANDLES);
  }

  const lastIdx = closedCandles.length - 1;
  const lastCandle = closedCandles[lastIdx];
  const last5 = closedCandles.slice(-5);
  const last5WicksVal = analyzeLast5Wicks(last5);

  // ── Compute all raw indicators ──
  const rsiArr = rsi(closedCloses, 14);
  const adxData = adx(closedCandles, 14);
  const macdData = macd(closedCloses, 12, 26, 9);
  const allSma9 = sma(closedCloses, 9);
  const allSma21 = sma(closedCloses, 21);
  const allSma200 = sma(closedCloses, 200);
  const allSma235 = sma(closedCloses, 235);
  const sarData = parabolicSar(closedCandles.map(c => c.h), closedCandles.map(c => c.l));
  const atrArr = atr(closedCandles, 14);
  const williamsArr = williamsR(closedCandles, 14);

  // ── Derived classifications ──
  return {
    rsi: lastOf(rsiArr),
    adx: lastOf(adxData.adx),
    macd: lastOf(macdData.macd),
    histogram: lastOf(macdData.histogram),
    pattern: lastIdx >= 0 ? getPattern(closedCandles, lastIdx) : null,
    ma9: lastOf(allSma9),
    ma21: lastOf(allSma21),
    ma200: lastOf(allSma200),
    ma235: lastOf(allSma235),
    sar: lastOf(sarData.sar),
    atr: lastOf(atrArr),
    williams: lastOf(williamsArr),
    fibLevel: getFibonacciLevel(closedCandles, lastIdx, closedCandles[lastIdx].c).closestLevel,
    pivotLevel: getPivotPoints(closedCandles, lastIdx, closedCandles[lastIdx].c).closestPivot,
    marketMoment: classifyMarketMomentum(closedCandles, lastIdx, closedCandles[lastIdx].c),
    marketStructure: detectMarketStructure(closedCandles, lastIdx),
    candleSize: computeCandleSize(closedCandles, lastIdx),
    preEntryMomentum: computePreEntryMomentum(closedCandles),
    bollingerState: computeBollingerState(closedCloses),
    indicatorCrossover: computeIndicatorCrossover(closedCloses),
    entryCandle: lastCandle,
    last5Wicks: last5WicksVal,
    last5Candles: last5,
  };
}
