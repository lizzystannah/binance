// ─── Indicadores puros (técnicos) ────────────────────────────────────────────
// Extraído de src/lib/market.ts (TAREFA A). Nenhum import de store.ts ou
// server.ts. Sem dependência de corretora.
// Compatível com klines Binance (t,o,h,l,c + v opcional).
import { classifyCandleWick, analyzeLast5Wicks } from "@/lib/candleWick";
import { classifyCandleBodySize, detectCandlePattern, CANDLE_BODY_SIZE_BANDS, EXTENDED_CANDLE_PATTERNS } from "@/lib/candleSize";

export { classifyCandleBodySize, detectCandlePattern, CANDLE_BODY_SIZE_BANDS, EXTENDED_CANDLE_PATTERNS };
export { classifyCandleWick, analyzeLast5Wicks };

export type Candle = {
  t: number; // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
};

/** Vela cripto (Binance klines). `v` = volume. Compatível com Candle. */
export type CryptoCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

/** Heurística local: classifica símbolos sintéticos legados (prefixos R_/1HZ/JD). */
function isSyntheticSymbol(symbol: string): boolean {
  if (!symbol) return false;
  const s = String(symbol).toUpperCase();
  return s.startsWith("R_") || s.startsWith("1HZ") || s.startsWith("HZ") || s.startsWith("JD");
}

// Indicators
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function parabolicSar(highs: number[], lows: number[], afStep = 0.02, afMax = 0.2): { sar: number[]; trend: number[]; af: number[] } {
  const len = highs.length;
  const sar = new Array(len).fill(null);
  const trend = new Array(len).fill(1);
  const af = new Array(len).fill(afStep);

  if (len < 3) return { sar, trend, af };

  let cTrend = 1;
  let cSAR = lows[0];
  let cEP = highs[0];
  let cAF = afStep;

  sar[0] = cSAR;
  trend[0] = cTrend;
  af[0] = cAF;

  for (let i = 1; i < len; i++) {
    const h = highs[i];
    const l = lows[i];

    let newSAR = cSAR + cAF * (cEP - cSAR);

    if (cTrend === 1) {
      if (i >= 2) newSAR = Math.min(newSAR, lows[i - 1], lows[i - 2]);
      else newSAR = Math.min(newSAR, lows[i - 1]);

      if (l < newSAR) {
        cTrend = -1;
        newSAR = cEP;
        cEP = l;
        cAF = afStep;
      } else {
        if (h > cEP) {
          cEP = h;
          cAF = Math.min(cAF + afStep, afMax);
        }
      }
    } else {
      if (i >= 2) newSAR = Math.max(newSAR, highs[i - 1], highs[i - 2]);
      else newSAR = Math.max(newSAR, highs[i - 1]);

      if (h > newSAR) {
        cTrend = 1;
        newSAR = cEP;
        cEP = h;
        cAF = afStep;
      } else {
        if (l < cEP) {
          cEP = l;
          cAF = Math.min(cAF + afStep, afMax);
        }
      }
    }

    cSAR = newSAR;
    sar[i] = cSAR;
    trend[i] = cTrend;
    af[i] = cAF;
  }

  return { sar, trend, af };
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let gains = 0, losses = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = Math.max(0, diff);
    const l = Math.max(0, -diff);
    if (i <= period) {
      gains += g; losses += l;
      if (i === period) {
        const rs = gains / Math.max(losses, 1e-9);
        out.push(100 - 100 / (1 + rs));
      } else out.push(null);
    } else {
      gains = (gains * (period - 1) + g) / period;
      losses = (losses * (period - 1) + l) / period;
      const rs = gains / Math.max(losses, 1e-9);
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const ma = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || ma[i] == null) { upper.push(null); lower.push(null); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const m = ma[i] as number;
    const variance = slice.reduce((a, b) => a + (b - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { ma, upper, lower };
}

export function ema(data: number[], period: number): (number | null)[] {
  if (data.length < period) return data.map(() => null);
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let initialSma = 0;
  for (let i = 0; i < period; i++) initialSma += data[i];
  initialSma /= period;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      result.push(initialSma);
    } else {
      const prev = result[i - 1] as number;
      result.push(data[i] * k + prev * (1 - k));
    }
  }
  return result;
}

export function adx(
  candles: Candle[],
  period: number = 14
): {
  adx: (number | null)[];
  plusDi: (number | null)[];
  minusDi: (number | null)[];
} {
  const result: {
    adx: (number | null)[];
    plusDi: (number | null)[];
    minusDi: (number | null)[];
  } = { adx: [], plusDi: [], minusDi: [] };

  if (candles.length < period + 1) {
    return {
      adx: candles.map(() => null),
      plusDi: candles.map(() => null),
      minusDi: candles.map(() => null),
    };
  }

  const tr = [0];
  const plusDm = [0];
  const minusDm = [0];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevHigh = candles[i - 1].h;
    const prevLow = candles[i - 1].l;
    const prevClose = candles[i - 1].c;

    tr.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    );

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) plusDm.push(upMove);
    else plusDm.push(0);

    if (downMove > upMove && downMove > 0) minusDm.push(downMove);
    else minusDm.push(0);
  }

  // Wilder smoothing
  const smooth = (data: number[]): number[] => {
    const smoothed: number[] = [0];
    let sum = 0;
    for (let i = 1; i < period; i++) sum += data[i];
    for (let i = 1; i < data.length; i++) {
      if (i < period) {
        smoothed.push(sum);
      } else if (i === period) {
        sum += data[i];
        smoothed.push(sum);
      } else {
        smoothed.push(smoothed[i - 1] - smoothed[i - 1] / period + data[i]);
      }
    }
    return smoothed;
  };

  const str = smooth(tr);
  const splusDm = smooth(plusDm);
  const sminusDm = smooth(minusDm);

  const dx: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    if (i < period) {
      result.plusDi.push(null);
      result.minusDi.push(null);
      dx.push(0);
    } else {
      const pDi = 100 * (splusDm[i] / (str[i] || 1));
      const mDi = 100 * (sminusDm[i] / (str[i] || 1));
      result.plusDi.push(pDi);
      result.minusDi.push(mDi);
      dx.push(100 * (Math.abs(pDi - mDi) / (pDi + mDi || 1)));
    }
  }

  // ADX = Wilder smooth of DX, starting at index (period * 2 - 1)
  for (let i = 0; i < candles.length; i++) {
    if (i < period * 2 - 1) {
      result.adx.push(null);
    } else if (i === period * 2 - 1) {
      let sum = 0;
      for (let j = period; j <= i; j++) sum += dx[j];
      result.adx.push(sum / period);
    } else {
      const prevAdx = result.adx[i - 1] as number;
      result.adx.push((prevAdx * (period - 1) + dx[i]) / period);
    }
  }

  // Pad index 0 for plusDi / minusDi (they start at index 1 in the loop)
  result.plusDi.unshift(null);
  result.minusDi.unshift(null);

  // Trim to exact candles length
  while (result.plusDi.length > candles.length) result.plusDi.pop();
  while (result.minusDi.length > candles.length) result.minusDi.pop();
  while (result.adx.length > candles.length) result.adx.pop();

  return result;
}

export function macd(data: number[], fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(data, fast);
  const slowEma = ema(data, slow);

  const macdLine = data.map((_, i) => {
    if (fastEma[i] === null || slowEma[i] === null) return null;
    return fastEma[i]! - slowEma[i]!;
  });

  const validMacdValues = macdLine.filter(v => v !== null) as number[];
  const signalEma = ema(validMacdValues, signal);
  let signalIdx = 0;

  const signalLine = macdLine.map(v => {
    if (v === null) return null;
    return signalEma[signalIdx++] ?? null;
  });

  const histogram = macdLine.map((v, i) => {
    if (v === null || signalLine[i] === null) return null;
    return v - signalLine[i]!;
  });

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Aggregates low-granularity candles (e.g. 1m) into higher ones (e.g. 2m, 10m).
 * Ensures candles start at 'round times' (e.g. 10:00, 10:10).
 */
export function resampleCandles(candles1m: Candle[], targetMinutes: number): Candle[] {
  if (candles1m.length === 0) return [];
  const intervalMs = targetMinutes * 60 * 1000;

  // Group 1m candles by the start of their target period
  const groups: Record<number, Candle[]> = {};
  for (const c of candles1m) {
    const periodStart = Math.floor(c.t / intervalMs) * intervalMs;
    if (!groups[periodStart]) groups[periodStart] = [];
    groups[periodStart].push(c);
  }

  const sortedTs = Object.keys(groups).map(Number).sort((a, b) => a - b);
  const result: Candle[] = [];

  for (const ts of sortedTs) {
    const cluster = groups[ts];
    if (cluster.length === 0) continue;

    result.push({
      t: ts,
      o: cluster[0].o,
      h: Math.max(...cluster.map(c => c.h)),
      l: Math.min(...cluster.map(c => c.l)),
      c: cluster[cluster.length - 1].c
    });
  }

  return result;
}

export function getPattern(candles: Candle[], index: number): string | null {
  const pattern = detectCandlePattern(candles, index);
  return pattern === "Sem Padrão" ? null : pattern;
}

/**
 * Average True Range (ATR)
 */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (candles.length === 0) return [];
  const tr: number[] = [candles[0].h - candles[0].l];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  let currentAtr = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += tr[j];
      currentAtr = sum / period;
      result.push(currentAtr);
    } else {
      currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
      result.push(currentAtr);
    }
  }
  return result;
}

/**
 * Williams %R
 */
export function williamsR(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    const slice = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...slice.map(c => c.h));
    const lowest = Math.min(...slice.map(c => c.l));
    const denom = highest - lowest;
    const close = candles[i].c;
    if (denom === 0) {
      out.push(-50);
    } else {
      const r = ((highest - close) / denom) * -100;
      out.push(r);
    }
  }
  return out;
}

/**
 * Fibonacci Retracements levels (Swing 50)
 */
export function getFibonacciLevel(candles: Candle[], index: number, entryPrice: number): { closestLevel: string; pctDistance: number } {
  if (index < 50) return { closestLevel: "N/A", pctDistance: 999 };
  const slice = candles.slice(index - 49, index + 1);
  const highest = Math.max(...slice.map(c => c.h));
  const lowest = Math.min(...slice.map(c => c.l));
  const range = highest - lowest;
  if (range === 0) return { closestLevel: "N/A", pctDistance: 0 };

  const levels = {
    "Fib R0.0": lowest,
    "Fib R23.6": lowest + range * 0.236,
    "Fib R38.2": lowest + range * 0.382,
    "Fib R50.0": lowest + range * 0.5,
    "Fib R61.8": lowest + range * 0.618,
    "Fib R100.0": highest
  };

  let closestKey = "Fib R50.0";
  let minDiff = Infinity;
  Object.entries(levels).forEach(([k, val]) => {
    const diff = Math.abs(entryPrice - val);
    if (diff < minDiff) {
      minDiff = diff;
      closestKey = k;
    }
  });

  const pctDistance = (minDiff / entryPrice) * 100;
  return { closestLevel: closestKey, pctDistance };
}

/**
 * Pivot Points (Floor standard based on last 20 candles window)
 */
export function getPivotPoints(candles: Candle[], index: number, entryPrice: number) {
  if (index < 20) return { closestPivot: "N/A", pctDistance: 999 };
  const slice = candles.slice(index - 19, index + 1);
  const h = Math.max(...slice.map(c => c.h));
  const l = Math.min(...slice.map(c => c.l));
  const c = candles[index].c;

  const PP = (h + l + c) / 3;
  const R1 = 2 * PP - l;
  const S1 = 2 * PP - h;
  const R2 = PP + (h - l);
  const S2 = PP - (h - l);

  const pivots = { PP, R1, S1, R2, S2 };
  let closestKey = "PP";
  let minDiff = Infinity;
  Object.entries(pivots).forEach(([k, val]) => {
    const diff = Math.abs(entryPrice - val);
    if (diff < minDiff) {
      minDiff = diff;
      closestKey = k;
    }
  });

  const pctDistance = (minDiff / entryPrice) * 100;
  return { closestPivot: closestKey, pctDistance };
}

export function windowForIndicators(candles: Candle[], maxLookback = 800): Candle[] {
  if (!candles || candles.length <= maxLookback) return candles;
  return candles.slice(candles.length - maxLookback);
}

export function getEnabledFilterKeys(filters: Record<string, any> | undefined): Set<string> {
  const keys = new Set<string>();
  if (!filters) return keys;
  for (const [key, f] of Object.entries(filters)) {
    if (f?.enabled) keys.add(key);
  }
  return keys;
}

/**
 * Contextual Momentum Classifier
 * Reescreve com threshold adaptativo por ATR (20% do ATR%, min 0.05%, max 0.30%).
 */
export function classifyMarketMomentum(
  candles: Candle[],
  index: number,
  entryPrice: number,
  atrValue?: number,
  precomputed?: {
    fibInfo?: { closestLevel: string; pctDistance: number };
    pivotInfo?: { closestPivot: string; pctDistance: number };
  }
): string {
  if (index < 20) return "Sem Padrão Clássico";

  // Check micro structural pivot rejection first
  const structuralRej = checkStructuralRejection(candles, index, 5, atrValue || 0);
  if (structuralRej) return structuralRej;

  // Threshold adaptativo: 20% do ATR% ou mínimo 0.05%, máximo 0.30%
  const dynamicThresholdPct = atrValue && entryPrice > 0
    ? Math.min(0.3, Math.max(0.05, (atrValue / entryPrice) * 100 * 0.2))
    : 0.15;

  // Fibonacci bounce
  const { closestLevel, pctDistance: fibDist } = precomputed?.fibInfo ?? getFibonacciLevel(
    candles,
    index - 1,
    entryPrice
  );
  if (fibDist < dynamicThresholdPct) return `${closestLevel} Bounce`;

  // Pivot bounce
  const { closestPivot, pctDistance: pivDist } = precomputed?.pivotInfo ?? getPivotPoints(
    candles,
    index - 1,
    entryPrice
  );
  if (pivDist < dynamicThresholdPct) return `Rebate Pivot ${closestPivot}`;

  // Consecutive candle momentum (last 3 before entry)
  const recent = candles.slice(Math.max(0, index - 3), index);
  if (recent.length >= 3) {
    const bodies = recent.map((c) => Math.abs(c.c - c.o));
    const directions = recent.map((c) => (c.c > c.o ? "UP" : "DOWN"));
    const avgBody =
      candles
        .slice(Math.max(0, index - 19), index)
        .reduce((sum, c) => sum + Math.abs(c.c - c.o), 0) /
      Math.min(19, index);

    const last3Similar = directions.every((d) => d === directions[2]);
    if (last3Similar && directions[2] === "UP" && bodies[2] > avgBody * 1.1)
      return "Forte Impulso de Alta (3+ Velas)";
    if (last3Similar && directions[2] === "DOWN" && bodies[2] > avgBody * 1.1)
      return "Forte Impulso de Baixa (3+ Velas)";

    const lastCandle = candles[index - 1];
    const lastCandleHighVol =
      Math.abs(lastCandle.c - lastCandle.o) > avgBody * 1.8;
    if (lastCandleHighVol) {
      return lastCandle.c > lastCandle.o
        ? "Aceleração Explosiva Compradora"
        : "Aceleração Explosiva Vendedora";
    }
  }

  // Consolidation check
  const lookback = Math.min(9, index);
  const rangeSlice = candles.slice(index - lookback, index);
  if (rangeSlice.length > 0) {
    const rangeHigh = Math.max(...rangeSlice.map((c) => c.h));
    const rangeLow = Math.min(...rangeSlice.map((c) => c.l));
    const totalRange = rangeHigh - rangeLow;
    const avgBody2 =
      rangeSlice.reduce((sum, c) => sum + Math.abs(c.c - c.o), 0) /
      rangeSlice.length;
    if (totalRange > 0 && avgBody2 < totalRange / 8)
      return "Consolidação Estreita / Ruído";
  }

  return "Lateralização Ordenada";
}

export interface StructuralPivot {
  type: "HIGH" | "LOW";
  price: number;
  openPrice: number;
  idx: number;
  timestamp: number;
}

export interface StructuralLine {
  type: "TOPO" | "FUNDO";
  price: number;       // Candle open price at pivot
  extremePrice: number;// Candle high/low at pivot
  startIdx: number;
  endIdx: number;
}

/**
 * Detects structural pivots and active support/resistance lines.
 */
export function detectStructuralPivots(
  candles: Candle[],
  uptoIndex: number,
  pivotDepth = 8,
  lineLifeCandles = 200
): { pivots: StructuralPivot[]; activeLines: StructuralLine[] } {
  const pivots: StructuralPivot[] = [];
  const maxIdx = Math.min(uptoIndex, candles.length - 1);

  // Centered pivot detection: candle i must be extreme compared to pivotDepth left and right
  for (let i = pivotDepth; i <= maxIdx - pivotDepth; i++) {
    const cur = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let w = 1; w <= pivotDepth; w++) {
      if (candles[i - w].h >= cur.h || candles[i + w].h >= cur.h) isHigh = false;
      if (candles[i - w].l <= cur.l || candles[i + w].l <= cur.l) isLow = false;
    }

    if (isHigh) {
      pivots.push({
        type: "HIGH",
        price: cur.h,
        openPrice: cur.o,
        idx: i,
        timestamp: cur.t,
      });
    }

    if (isLow) {
      pivots.push({
        type: "LOW",
        price: cur.l,
        openPrice: cur.o,
        idx: i,
        timestamp: cur.t,
      });
    }
  }

  // Generate active lines at current index
  const activeLines: StructuralLine[] = [];
  for (const p of pivots) {
    if (p.idx < maxIdx && maxIdx - p.idx <= lineLifeCandles) {
      activeLines.push({
        type: p.type === "HIGH" ? "TOPO" : "FUNDO",
        price: p.openPrice,
        extremePrice: p.price,
        startIdx: p.idx,
        endIdx: p.idx + lineLifeCandles,
      });
    }
  }

  return { pivots, activeLines };
}

/**
 * Checks if current candle is rejecting an active structural Top/Bottom line.
 */
export function checkStructuralRejection(
  candles: Candle[],
  index: number,
  pivotDepth = 8,
  atrVal = 0
): "Rejeição no FUNDO (Linha de Pivô)" | "Rejeição no TOPO (Linha de Pivô)" | null {
  if (index < pivotDepth * 2 || index >= candles.length) return null;

  const current = candles[index];
  const { activeLines } = detectStructuralPivots(candles, index - 1, pivotDepth, 200);

  if (activeLines.length === 0) return null;

  const tolerance = atrVal > 0 ? atrVal * 0.25 : Math.abs(current.o - current.c) * 0.5;

  for (const line of activeLines) {
    if (line.type === "FUNDO") {
      // Candle low touched or dipped near line price (or extremePrice), but close rejected above
      const touchedLine = current.l <= line.price + tolerance && current.l >= line.extremePrice - tolerance * 2;
      const closedAbove = current.c > line.price;
      const possessesLowerWick = (Math.min(current.o, current.c) - current.l) > Math.abs(current.o - current.c) * 0.4;

      if (touchedLine && closedAbove && possessesLowerWick) {
        return "Rejeição no FUNDO (Linha de Pivô)";
      }
    } else if (line.type === "TOPO") {
      // Candle high touched or spiked near line price (or extremePrice), but close rejected below
      const touchedLine = current.h >= line.price - tolerance && current.h <= line.extremePrice + tolerance * 2;
      const closedBelow = current.c < line.price;
      const possessesUpperWick = (current.h - Math.max(current.o, current.c)) > Math.abs(current.o - current.c) * 0.4;

      if (touchedLine && closedBelow && possessesUpperWick) {
        return "Rejeição no TOPO (Linha de Pivô)";
      }
    }
  }

  return null;
}

export function detectMarketStructure(
  candles: Candle[],
  index: number,
  precomputed?: {
    adxData?: { adx: (number | null)[] };
    atrArr?: (number | null)[];
  }
): string {
  if (index < 40 || candles.length < 40) return "Sem Estrutura Definida";

  const slice = candles.slice(0, index + 1);
  const closes = slice.map((c) => c.c);

  const getLastValid = (arr: (number | null)[]): number | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null) return arr[i];
    }
    return null;
  };

  const atrArr = precomputed?.atrArr ?? atr(slice, 14);
  const lastAtrVal = getLastValid(atrArr) ?? 0;

  // ── 1. Check Micro Structural Rejection (Pivots Top/Bottom Line) ──────────
  const rejection = checkStructuralRejection(candles, index, 5, lastAtrVal);
  if (rejection) {
    return rejection;
  }

  // ── 2. Centered Structural Pivots (Zig-Zag) ──────────────
  const { pivots } = detectStructuralPivots(candles, index, 5, 200);

  const swingHighs = pivots.filter((p) => p.type === "HIGH");
  const swingLows = pivots.filter((p) => p.type === "LOW");

  // ── 3. EMA & ADX Context ──────────────────────────────────────────
  const e9 = getLastValid(ema(closes, 9));
  const e21 = getLastValid(ema(closes, 21));
  const e50 = getLastValid(ema(closes, Math.min(closes.length - 1, 50)));

  const emaBullish = e9 !== null && e21 !== null && e50 !== null && e9 > e21 && e21 > e50;
  const emaBearish = e9 !== null && e21 !== null && e50 !== null && e9 < e21 && e21 < e50;

  const adxData = precomputed?.adxData ?? adx(slice, 14);
  const lastAdxVal = getLastValid(adxData.adx);
  const isTrending = lastAdxVal !== null && lastAdxVal > 22;

  const currentClose = closes[index];
  const atrPct = currentClose > 0 ? (lastAtrVal / currentClose) * 100 : 0;
  const flatMargin = lastAtrVal * 0.4;

  // ── 4. Structural Zig-Zag Classification ─────────────────────────────────
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const shLast = swingHighs[swingHighs.length - 1].price;
    const shPrev = swingHighs[swingHighs.length - 2].price;
    const slLast = swingLows[swingLows.length - 1].price;
    const slPrev = swingLows[swingLows.length - 2].price;

    // Higher Highs / Higher Lows (HH + HL)
    if (shLast > shPrev + flatMargin && slLast > slPrev + flatMargin) {
      if (isTrending && emaBullish) return "Alta Forte (HH+HL ZigZag)";
      return "Zig-Zag de Alta (HH+HL)";
    }

    // Lower Highs / Lower Lows (LH + LL)
    if (shLast < shPrev - flatMargin && slLast < slPrev - flatMargin) {
      if (isTrending && emaBearish) return "Baixa Forte (LH+LL ZigZag)";
      return "Zig-Zag de Baixa (LH+LL)";
    }

    // Expanding range
    if (shLast > shPrev + flatMargin && slLast < slPrev - flatMargin) {
      return "Expansão / Reversão Estrutural";
    }

    // Compression / triangle
    if (shLast < shPrev - flatMargin && slLast > slPrev + flatMargin) {
      return "Compressão / Triângulo (Pivôs)";
    }

    // Lateral
    const highDelta = Math.abs(shLast - shPrev);
    const lowDelta = Math.abs(slLast - slPrev);
    if (lastAtrVal > 0 && highDelta <= lastAtrVal && lowDelta <= lastAtrVal) {
      return "Canal Lateral de Pivôs";
    }
  }

  // ── 5. ADX + EMA Fallback ────────────────────────────────────────────────
  if (isTrending) {
    if (emaBullish) return "Alta (ADX+EMA)";
    if (emaBearish) return "Baixa (ADX+EMA)";
  }

  // ── 6. ATR Range / Noise Detection ───────────────────────────────────────
  const last20 = slice.slice(Math.max(0, index - 19), index + 1);
  const last20High = Math.max(...last20.map((c) => c.h));
  const last20Low = Math.min(...last20.map((c) => c.l));
  const totalRange20 = last20High - last20Low;

  if (lastAtrVal > 0 && totalRange20 < lastAtrVal * 3) {
    return atrPct < 0.05 ? "Lateral Baixa Volatilidade" : "Range Comprimido";
  }

  return "Oscilação / Sem Tendência";
}

export function computeIndicatorValues(
  candles: Candle[],
  symbol: string,
  rawResult: any,
  enabledKeys: Set<string> | null = null,
  sharedCache?: Record<string, any>
): Record<string, any> {
  if (!candles || candles.length === 0) {
    const isSynthetic = isSyntheticSymbol(symbol);
    return {
      _expiryCandles: rawResult?.expiryCandles ?? null,
      _asset: symbol,
      _syntheticAsset: isSynthetic ? symbol : null,
      _realAsset: !isSynthetic ? symbol : null,
      _assetCategory: isSynthetic ? "Apenas Sintéticos" : "Apenas Ativos Reais (Forex/Metais)",
      _marketType: isSynthetic ? "synthetic" : "forex",
    };
  }

  const need = (key: string) => enabledKeys === null || enabledKeys.has(key);

  const windowed = windowForIndicators(candles, 800);
  const closes = windowed.map(c => c.c);
  const lastIndex = windowed.length - 1;
  const lastC = closes[lastIndex];

  const isSynthetic = isSyntheticSymbol(symbol);

  const indicatorValues: Record<string, any> = {
    _expiryCandles: rawResult?.expiryCandles ?? null,
    _asset: symbol,
    _syntheticAsset: isSynthetic ? symbol : null,
    _realAsset: !isSynthetic ? symbol : null,
    _assetCategory: isSynthetic ? "Apenas Sintéticos" : "Apenas Ativos Reais (Forex/Metais)",
    _marketType: isSynthetic ? "synthetic" : "forex",
  };

  const needMarketMoment = need('_marketMoment');
  const needMarketStructure = need('_marketStructure');

  // RSI
  if (need('_rsi')) {
    let rsiArr = sharedCache?.['rsi_14'];
    if (!rsiArr) {
      rsiArr = rsi(closes, 14);
      if (sharedCache) sharedCache['rsi_14'] = rsiArr;
    }
    indicatorValues._rsi = rsiArr[rsiArr.length - 1];
  }

  // ADX (re-used by _adx and detectMarketStructure)
  let adxData: { adx: (number | null)[]; plusDi: (number | null)[]; minusDi: (number | null)[] } | null = null;
  if (need('_adx') || needMarketStructure) {
    let localAdx = sharedCache?.['adx_14'];
    if (!localAdx) {
      localAdx = adx(windowed, 14);
      if (sharedCache) sharedCache['adx_14'] = localAdx;
    }
    adxData = localAdx;
    if (need('_adx')) indicatorValues._adx = adxData.adx[adxData.adx.length - 1];
  }

  // MACD
  if (need('_macd')) {
    let macdData = sharedCache?.['macd_12_26_9'];
    if (!macdData) {
      macdData = macd(closes, 12, 26, 9);
      if (sharedCache) sharedCache['macd_12_26_9'] = macdData;
    }
    const lastMacdHist = macdData.histogram[macdData.histogram.length - 1] || 0;
    indicatorValues._macd = lastMacdHist > 0 ? "Bullish (Hist > 0)" : "Bearish (Hist < 0)";
  }

  // Pattern
  if (need('_pattern')) {
    indicatorValues._pattern = getPattern(windowed, lastIndex);
  }

  // MA Trend + Crossover (shares SMA 9 / 21)
  const needMaTrend = need('_maTrend');
  const needCrossover = need('_indicatorCrossover');
  let ma9Arr: (number | null)[] | null = null;
  let ma21Arr: (number | null)[] | null = null;
  if (needMaTrend || needCrossover) {
    ma9Arr = sharedCache?.['sma_9'] ?? sma(closes, 9);
    ma21Arr = sharedCache?.['sma_21'] ?? sma(closes, 21);
    if (sharedCache) {
      if (!sharedCache['sma_9']) sharedCache['sma_9'] = ma9Arr;
      if (!sharedCache['sma_21']) sharedCache['sma_21'] = ma21Arr;
    }
  }

  if (needMaTrend) {
    const ma200Arr = sharedCache?.['sma_200'] ?? sma(closes, 200);
    const ma235Arr = sharedCache?.['sma_235'] ?? sma(closes, 235);
    if (sharedCache) {
      if (!sharedCache['sma_200']) sharedCache['sma_200'] = ma200Arr;
      if (!sharedCache['sma_235']) sharedCache['sma_235'] = ma235Arr;
    }
    const lastMA9 = ma9Arr![ma9Arr!.length - 1] || 0;
    const lastMA21 = ma21Arr![ma21Arr!.length - 1] || 0;
    const lastMA200 = ma200Arr[ma200Arr.length - 1] || 0;
    const lastMA235 = ma235Arr[ma235Arr.length - 1] || 0;
    const aboveAll = lastC > lastMA9 && lastC > lastMA21 && lastC > lastMA200 && lastC > lastMA235;
    const belowAll = lastC < lastMA9 && lastC < lastMA21 && lastC < lastMA200 && lastC < lastMA235;
    let maTrend = "Ranging/Mixed";
    if (aboveAll) maTrend = "Strong Bullish";
    else if (belowAll) maTrend = "Strong Bearish";
    else if (lastC > lastMA21 && lastC > lastMA200) maTrend = "Bullish";
    else if (lastC < lastMA21 && lastC < lastMA200) maTrend = "Bearish";
    indicatorValues._maTrend = maTrend;
  }

  if (needCrossover) {
    if (closes.length >= 21) {
      const lastMa9 = ma9Arr![ma9Arr!.length - 1] || 0;
      const lastMa21 = ma21Arr![ma21Arr!.length - 1] || 0;
      const prevMa9 = ma9Arr![ma9Arr!.length - 2] || 0;
      const prevMa21 = ma21Arr![ma21Arr!.length - 2] || 0;
      if (prevMa9 <= prevMa21 && lastMa9 > lastMa21) indicatorValues._indicatorCrossover = "Cruzamento de Alta Recente (9x21)";
      else if (prevMa9 >= prevMa21 && lastMa9 < lastMa21) indicatorValues._indicatorCrossover = "Cruzamento de Baixa Recente (9x21)";
      else indicatorValues._indicatorCrossover = lastMa9 > lastMa21 ? "Alinhamento de Alta (9 > 21)" : "Alinhamento de Baixa (9 < 21)";
    } else {
      indicatorValues._indicatorCrossover = "N/A";
    }
  }

  // Parabolic SAR
  if (need('_sar')) {
    let sarData = sharedCache?.['sar_0.02_0.2'];
    if (!sarData) {
      sarData = parabolicSar(windowed.map(c => c.h), windowed.map(c => c.l));
      if (sharedCache) sharedCache['sar_0.02_0.2'] = sarData;
    }
    const lastSar = sarData.sar[sarData.sar.length - 1] || 0;
    const sarDist = lastSar ? ((lastC - lastSar) / lastC * 100) : 0;
    let sarBucket = "SAR: Baixista (Preço < SAR)";
    if (lastSar) {
      if (sarDist > 1) sarBucket = "SAR: Fortemente Altista (Preço > SAR > 1%)";
      else if (sarDist > 0) sarBucket = "SAR: Altista (Preço > SAR)";
      else if (sarDist < -1) sarBucket = "SAR: Fortemente Baixista (Preço < SAR < -1%)";
    }
    indicatorValues._sar = sarBucket;
  }

  // ATR (re-used by _atr, marketMoment, and marketStructure)
  let atrArr: (number | null)[] | null = null;
  let lastAtr = 0;
  if (need('_atr') || needMarketStructure || needMarketMoment) {
    atrArr = atr(windowed, 14);
    lastAtr = atrArr && atrArr.length > 0 ? (atrArr[atrArr.length - 1] || 0) : 0;
    if (need('_atr')) {
      const pctAtr = lastC ? ((lastAtr / lastC) * 100) : 0;
      indicatorValues._atr = pctAtr < 0.03 ? "Low Vol (< 0.03%)" : (pctAtr < 0.1 ? "Medium Vol (0.03% - 0.1%)" : "High Vol (> 0.1%)");
    }
  }

  // Williams %R
  if (need('_williams')) {
    const williamsArr = williamsR(windowed, 14);
    const lastWilliams = williamsArr && williamsArr.length > 0 ? (williamsArr[williamsArr.length - 1] ?? 0) : 0;
    indicatorValues._williams = lastWilliams <= -80 ? "Oversold (<= -80)" : (lastWilliams > -80 && lastWilliams < -20 ? "Neutral (-80 a -20)" : "Overbought (>= -20)");
  }

  // Fibonacci & Pivot
  let fibInfo: { closestLevel: string; pctDistance: number } | null = null;
  let pivotInfo: { closestPivot: string; pctDistance: number } | null = null;
  if (need('_fibLevel') || needMarketMoment) {
    fibInfo = getFibonacciLevel(windowed, lastIndex, lastC);
    if (need('_fibLevel')) indicatorValues._fibLevel = fibInfo.closestLevel;
  }
  if (need('_pivotLevel') || needMarketMoment) {
    pivotInfo = getPivotPoints(windowed, lastIndex, lastC);
    if (need('_pivotLevel')) indicatorValues._pivotLevel = pivotInfo.closestPivot;
  }

  // Market Moment
  if (needMarketMoment) {
    indicatorValues._marketMoment = classifyMarketMomentum(windowed, lastIndex, lastC, lastAtr, { fibInfo: fibInfo!, pivotInfo: pivotInfo! });
  }

  // Market Structure
  if (needMarketStructure) {
    indicatorValues._marketStructure = detectMarketStructure(windowed, lastIndex, { adxData: adxData!, atrArr: atrArr! });
  }

  // Candle Size
  if (need('_candleSize')) {
    indicatorValues._candleSize = classifyCandleBodySize(windowed, lastIndex);
  }

  // Pavio
  if (need('_pavioClass')) {
    indicatorValues._pavioClass = rawResult?.action
      ? classifyCandleWick(windowed[lastIndex], rawResult.action as "CALL" | "PUT" | "BUY" | "SELL")
      : "N/A";
  }

  // Pavis das Últimas 5 Velas (Pressão Compradora / Vendedora por Pavios)
  if (need('_last5Wicks')) {
    indicatorValues._last5Wicks = analyzeLast5Wicks(windowed.slice(-5));
  }

  // Pre-entry momentum
  if (need('_preEntryMomentum')) {
    let preEntryBucket: string;
    if (windowed.length >= 5) {
      const last5 = windowed.slice(-5);
      const greenCount = last5.filter(c => c.c > c.o).length;
      const redCount = last5.filter(c => c.c < c.o).length;
      const avgBodyPct = last5.reduce((sum, c) => sum + (Math.abs(c.c - c.o) / c.o) * 100, 0) / 5;
      if (greenCount >= 4) {
        preEntryBucket = avgBodyPct > 0.06 ? "Impulso Altista Forte" : "Impulso Altista Moderado";
      } else if (redCount >= 4) {
        preEntryBucket = avgBodyPct > 0.06 ? "Impulso Baixista Forte" : "Impulso Baixista Moderado";
      } else if (avgBodyPct < 0.02) {
        preEntryBucket = "Lateralização / Sem Força";
      } else {
        preEntryBucket = "Misto / Correção";
      }
    } else {
      preEntryBucket = "Misto / Sem Histórico";
    }
    indicatorValues._preEntryMomentum = preEntryBucket;
  }

  // Bollinger State
  if (need('_bollingerState')) {
    let bollingerBucket: string;
    if (closes.length >= 20) {
      const bb = bollinger(closes, 20, 2);
      const idx = closes.length - 1;
      const u = bb.upper[idx];
      const l = bb.lower[idx];
      const m = bb.ma[idx];
      if (u != null && l != null && m != null) {
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
        if (bandwidth < avgBandwidth * 0.85) {
          bollingerBucket = "Squeeze (Bandas Estreitas)";
        } else if (bandwidth > avgBandwidth * 1.15) {
          bollingerBucket = "Estouro / Expansão Volatilidade";
        } else {
          bollingerBucket = "Neutro / Altas e Baixas Padrão";
        }
      } else {
        bollingerBucket = "N/A";
      }
    } else {
      bollingerBucket = "N/A";
    }
    indicatorValues._bollingerState = bollingerBucket;
  }

  if (rawResult?.customStats) {
    Object.entries(rawResult.customStats).forEach(([k, v]) => {
      indicatorValues[`_stat_${k}`] = v;
      indicatorValues[k] = v;
    });
  }

  return indicatorValues;
}
