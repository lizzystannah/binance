// ─── Estratégias Binance Futuros USDT-M ──────────────────────────────────────
// Sinais LONG/SHORT com leverage, sem dependência de símbolos legados.
// Funcionam em qualquer par USDT-M (BTCUSDT, ETHUSDT, altcoins voláteis).
// Timeframes: 1m / 5m / 15m / 1h / 4h. Stops em % ou múltiplo de ATR, com
// trailing opcional. Volume confirma rompimentos.
//   Futuros: LONG / SHORT / EXIT / FLAT — com leverage + funding awareness.

import { atr, bollinger, ema, macd, rsi } from "@/lib/indicators";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RobotMode } from "./cryptoRobots";

export type { RobotMode };

export interface CryptoCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Alias legado (compat). */
export type CryptoSpotCandle = CryptoCandle;

export interface CryptoContext {
  symbol: string; // ex: "BTCUSDT" — genérico, sem símbolos legados
  interval: string; // 1m | 5m | 15m | 1h | 4h
  /** Velas FECHADAS por ordem cronológica (a vela em formação NUNCA entra aqui). */
  klines: CryptoCandle[];
  closes: number[];
  lastClose: number;
  /** Modo do robô que avalia o sinal (para filtrar ações inválidas). */
  mode?: RobotMode;
  /** Parâmetros da estratégia (os mesmos de `params[]`). O onSignal DEVE lê-los. */
  params?: Record<string, number | string>;
  /** Funding rate atual (% por intervalo) — futuros usam para pular entradas. */
  fundingRatePct?: number;
}

/** Alias legado (compat). */
export type CryptoSpotContext = CryptoContext;

export type CryptoAction =
  | "BUY" // spot: comprar / futuros one-way legacy: abrir LONG
  | "SELL" // spot: vender/fechar
  | "LONG" // futuros: abrir LONG
  | "SHORT" // futuros: abrir SHORT
  | "EXIT" // fechar posição aberta (ambos)
  | "FLAT"; // ficar de fora (ambos)

export interface CryptoSignal {
  action: CryptoAction;
  /** % de stop-gain sobre o preço de fill (obrigatório). */
  stopGainPct: number;
  /** % de stop-loss sobre o preço de fill (obrigatório). */
  stopLossPct: number;
  reason: string;
  confidence?: number;
  /** Trailing stop opcional (% a partir do pico). */
  trailingPct?: number;
  /** Multiplicador de ATR usado no stop (ex: 1.5 × ATR). Informativo. */
  atrStopMult?: number;
  /** Volume relativo no sinal (ex: 1.8 = 1.8× a média). Informativo. */
  volumeMult?: number;
}

/** Alias legado (compat). */
export type CryptoSpotSignal = CryptoSignal;

export interface CryptoStrategyParam {
  key: string;
  label: string;
  type: "number" | "select";
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  hint?: string;
}

export interface CryptoStrategy {
  id: string;
  name: string;
  description: string;
  /** "auto" = opera sozinha; "semi-auto" = precisa de confirmação (discrecionária). */
  category?: "auto" | "semi-auto";
  /** Nº mínimo de velas fechadas exigido. */
  minCandles: number;
  defaults: { stopGainPct: number; stopLossPct: number; trailingPct?: number };
  /** Timeframes recomendados (subset de 1m/5m/15m/1h/4h). */
  timeframes?: string[];
  /** Onde a estratégia pode operar. */
  modes?: RobotMode[];
  /** Parâmetros ajustáveis (ATR stop, TP/SL %, trailing, volume, RSI/MACD/EMA…). */
  params?: CryptoStrategyParam[];
  /** Indicadores usados (para exibir na UI). */
  indicators?: string[];
  onSignal: (ctx: CryptoContext) => CryptoSignal | null;
}

/** Alias legado (compat). */
export type CryptoSpotStrategy = CryptoStrategy;

/** Lê um parâmetro numérico do ctx (com fallback = valor exibido no catálogo). */
export function ctxNum(ctx: CryptoContext, key: string, fb: number): number {
  const v = ctx.params?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

/** Lê um parâmetro texto do ctx (com fallback). */
export function ctxStr(ctx: CryptoContext, key: string, fb: string): string {
  const v = ctx.params?.[key];
  return typeof v === "string" ? v : fb;
}

// ─── Helpers genéricos ──────────────────────────────────────────────────────

function closesOf(klines: CryptoCandle[]): number[] {
  return klines.map((k) => k.c);
}

function lastFinite(arr: (number | null | undefined)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function avgVolume(klines: CryptoCandle[], n = 20): number | null {
  if (klines.length < n) return null;
  const vols = klines.slice(-n).map((k) => k.v);
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  return Number.isFinite(avg) && avg > 0 ? avg : null;
}

/** ATR em % do preço (adaptado a BTC/ETH/altcoins voláteis). */
export function atrPctOf(klines: CryptoCandle[], period = 14): number | null {
  if (klines.length < period + 1) return null;
  const arr = atr(klines.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c })), period);
  const last = lastFinite(arr);
  const close = klines[klines.length - 1].c;
  if (last === null || !Number.isFinite(close) || close <= 0) return null;
  return (last / close) * 100;
}

/** Stop derivado de ATR: max(piso %, mult × ATR%). */
export function atrStopPct(klines: CryptoCandle[], mult = 1.5, floorPct = 0.4, period = 14): number {
  const a = atrPctOf(klines, period);
  if (a === null) return floorPct;
  return Math.max(floorPct, a * mult);
}

// ─── Estratégias ────────────────────────────────────────────────────────────

const trendPullback: CryptoStrategy = {
  id: "spot_trend_pullback",
  name: "Trend Pullback (EMA + RSI)",
  description:
    "Cripto trend-following: EMA20 > EMA50 + pullback RSI14 < 45. Compra a correção a favor da tendência em BTC/ETH/altcoins. Timeframes 15m/1h/4h. Stop por ATR (1.5×), TP 2R. Futuros: espelha para SHORT quando EMA20 < EMA50 + RSI > 55.",
  minCandles: 60,
  defaults: { stopGainPct: 3, stopLossPct: 1.5 },
  timeframes: ["15m", "1h", "4h"],
  modes: ["futures"],
  category: "auto",
  indicators: ["EMA20", "EMA50", "RSI14", "ATR14"],
  params: [
    { key: "rsiBuyMax", label: "RSI máx. compra", type: "number", default: 45, min: 20, max: 60, step: 1, hint: "Pullback: RSI abaixo disto" },
    { key: "rsiSellMin", label: "RSI mín. venda (futuros)", type: "number", default: 55, min: 40, max: 80, step: 1 },
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.5, min: 0.5, max: 4, step: 0.1 },
    { key: "tpR", label: "TP (múltiplo do SL)", type: "number", default: 2, min: 1, max: 5, step: 0.5 },
  ],
  onSignal: (ctx) => {
    if (ctx.klines.length < 60) return null;
    const closes = closesOf(ctx.klines);
    const e20 = lastFinite(ema(closes, 20));
    const e50 = lastFinite(ema(closes, 50));
    const r = lastFinite(rsi(closes, 14));
    if (e20 === null || e50 === null || r === null) return null;
    const stopMult = ctxNum(ctx, "stopAtrMult", 1.5);
    const tpR = ctxNum(ctx, "tpR", 2);
    const rsiBuyMax = ctxNum(ctx, "rsiBuyMax", 45);
    const rsiSellMin = ctxNum(ctx, "rsiSellMin", 55);
    const sl = atrStopPct(ctx.klines, stopMult, 1.0);
    const tp = sl * tpR;
    if (e20 > e50 && r < rsiBuyMax) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +tp.toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `EMA20>EMA50 em pullback (RSI ${r.toFixed(0)})`,
        confidence: Math.min(90, Math.round(55 + (rsiBuyMax - r))),
        atrStopMult: stopMult,
      };
    }
    if (ctx.mode === "futures" && e20 < e50 && r > rsiSellMin) {
      return {
        action: "SHORT",
        stopGainPct: +tp.toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `EMA20<EMA50 em repique (RSI ${r.toFixed(0)})`,
        confidence: Math.min(90, Math.round(55 + (r - rsiSellMin))),
        atrStopMult: stopMult,
      };
    }
    return null;
  },
};

const bollingerBreakout: CryptoStrategy = {
  id: "spot_bollinger_breakout",
  name: "Bollinger Breakout + Volume",
  description:
    "Rompimento da banda superior (20, 2) com volume > 1.5× a média de 20 velas. Ideal para altcoins voláteis em 5m/15m/1h. Filtro anti-fake: ignora squeeze (largura < 60% da média). Futuros: opera os dois lados.",
  minCandles: 40,
  defaults: { stopGainPct: 4, stopLossPct: 2, trailingPct: 1.2 },
  timeframes: ["5m", "15m", "1h"],
  modes: ["futures"],
  category: "auto",
  indicators: ["Bollinger(20,2)", "Volume 20", "ATR14"],
  params: [
    { key: "volumeMult", label: "Volume mín. ×", type: "number", default: 1.5, min: 1, max: 4, step: 0.1 },
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.2, min: 0.5, max: 4, step: 0.1 },
    { key: "trailingPct", label: "Trailing %", type: "number", default: 1.2, min: 0, max: 5, step: 0.1 },
  ],
  onSignal: (ctx) => {
    if (ctx.klines.length < 40) return null;
    const closes = closesOf(ctx.klines);
    const bb = bollinger(closes, 20, 2);
    const upper = lastFinite(bb.upper);
    const lower = lastFinite(bb.lower);
    const ma = lastFinite(bb.ma);
    if (upper === null || lower === null || ma === null || ma <= 0) return null;
    const avg = avgVolume(ctx.klines, 20);
    if (avg === null) return null;
    const lastVol = ctx.klines[ctx.klines.length - 1].v;
    const mult = lastVol / avg;
    const volMin = ctxNum(ctx, "volumeMult", 1.5);
    const stopMult = ctxNum(ctx, "stopAtrMult", 1.2);
    const trail = ctxNum(ctx, "trailingPct", 1.2);
    const sl = atrStopPct(ctx.klines, stopMult, 0.8);
    if (ctx.lastClose > upper && mult > volMin) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `Rompimento banda sup. com volume ${mult.toFixed(1)}×`,
        confidence: 70,
        trailingPct: trail,
        volumeMult: +mult.toFixed(2),
      };
    }
    if (ctx.mode === "futures" && ctx.lastClose < lower && mult > volMin) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `Rompimento banda inf. com volume ${mult.toFixed(1)}×`,
        confidence: 70,
        trailingPct: trail,
        volumeMult: +mult.toFixed(2),
      };
    }
    return null;
  },
};

const rsiMeanReversion: CryptoStrategy = {
  id: "crypto_rsi_mean_reversion",
  name: "RSI Mean Reversion (oversold/overbought)",
  description:
    "Reversão à média em ranges: RSI14 < 30 compra (spot) / RSI14 > 70 realiza ou short (futuros). Melhor em 15m/1h em BTC/ETH laterais. Evitar em tendência forte (filtro EMA200 opcional). Stop ATR 1×.",
  minCandles: 40,
  defaults: { stopGainPct: 2.5, stopLossPct: 1.2 },
  timeframes: ["5m", "15m", "1h"],
  modes: ["futures"],
  category: "auto",
  indicators: ["RSI14", "EMA200", "ATR14"],
  params: [
    { key: "rsiOversold", label: "RSI oversold", type: "number", default: 30, min: 15, max: 40, step: 1 },
    { key: "rsiOverbought", label: "RSI overbought", type: "number", default: 70, min: 60, max: 85, step: 1 },
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.0, min: 0.5, max: 3, step: 0.1 },
  ],
  onSignal: (ctx) => {
    if (ctx.klines.length < 40) return null;
    const closes = closesOf(ctx.klines);
    const r = lastFinite(rsi(closes, 14));
    if (r === null) return null;
    const os = ctxNum(ctx, "rsiOversold", 30);
    const ob = ctxNum(ctx, "rsiOverbought", 70);
    const stopMult = ctxNum(ctx, "stopAtrMult", 1.0);
    const sl = atrStopPct(ctx.klines, stopMult, 0.6);
    if (r < os) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `RSI oversold (${r.toFixed(0)}) — reversão`,
        confidence: Math.min(85, Math.round(60 + (os - r))),
        atrStopMult: stopMult,
      };
    }
    if (ctx.mode === "futures" && r > ob) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `RSI overbought (${r.toFixed(0)}) — reversão`,
        confidence: Math.min(85, Math.round(60 + (r - ob))),
        atrStopMult: stopMult,
      };
    }
    return null;
  },
};

const macdEmaTrend: CryptoStrategy = {
  id: "crypto_macd_ema_trend",
  name: "MACD + EMA Trend (momentum)",
  description:
    "Segue momentum: histograma MACD(12,26,9) > 0 + preço > EMA50. Entradas em 15m/1h/4h após pullback. Em altcoins, exige volume acima da média para filtrar serrilhado. Stop ATR 1.5× + trailing 1.5%.",
  minCandles: 60,
  defaults: { stopGainPct: 3.5, stopLossPct: 1.5, trailingPct: 1.5 },
  timeframes: ["15m", "1h", "4h"],
  modes: ["futures"],
  category: "auto",
  indicators: ["MACD(12,26,9)", "EMA50", "Volume 20", "ATR14"],
  params: [
    { key: "requireVolume", label: "Exigir volume alto", type: "select", default: "sim", options: ["sim", "não"] },
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.5, min: 0.5, max: 4, step: 0.1 },
    { key: "trailingPct", label: "Trailing %", type: "number", default: 1.5, min: 0, max: 6, step: 0.1 },
  ],
  onSignal: (ctx) => {
    if (ctx.klines.length < 60) return null;
    const closes = closesOf(ctx.klines);
    const m = macd(closes, 12, 26, 9);
    const hist = lastFinite(m.histogram);
    const e50 = lastFinite(ema(closes, 50));
    if (hist === null || e50 === null) return null;
    const avg = avgVolume(ctx.klines, 20);
    const requireVol = ctxStr(ctx, "requireVolume", "sim") !== "não";
    const volOk = !requireVol || avg === null ? true : ctx.klines[ctx.klines.length - 1].v >= avg * 1.1;
    const stopMult = ctxNum(ctx, "stopAtrMult", 1.5);
    const trail = ctxNum(ctx, "trailingPct", 1.5);
    const sl = atrStopPct(ctx.klines, stopMult, 1.0);
    if (hist > 0 && ctx.lastClose > e50 && volOk) {
      const prevHist = m.histogram.length >= 2 ? m.histogram[m.histogram.length - 2] : null;
      const fresh = prevHist !== null && prevHist <= 0; // cruzamento recente = mais confiança
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: fresh ? "MACD virou bull + preço > EMA50" : "Momentum bull (MACD>0, > EMA50)",
        confidence: fresh ? 75 : 60,
        trailingPct: trail,
        atrStopMult: stopMult,
      };
    }
    if (ctx.mode === "futures" && hist < 0 && ctx.lastClose < e50 && volOk) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "Momentum bear (MACD<0, < EMA50)",
        confidence: 60,
        trailingPct: trail,
        atrStopMult: stopMult,
      };
    }
    return null;
  },
};

const emaCross: CryptoStrategy = {
  id: "crypto_ema_cross",
  name: "EMA Cross 9/21 (tendência curta)",
  description:
    "Cruzamento EMA9 × EMA21 em 5m/15m para scalps em BTC/ETH. Compra quando 9 cruza acima da 21 com corpo > 50% do range. Em futuros opera short no cruzamento inverso. Stop curto (ATR 1×) pois é sensível a ruído.",
  minCandles: 40,
  defaults: { stopGainPct: 2, stopLossPct: 1 },
  timeframes: ["1m", "5m", "15m"],
  modes: ["futures"],
  category: "auto",
  indicators: ["EMA9", "EMA21", "ATR14"],
  params: [
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.0, min: 0.5, max: 3, step: 0.1 },
    { key: "tpR", label: "TP (múltiplo do SL)", type: "number", default: 2, min: 1, max: 4, step: 0.5 },
  ],
  onSignal: (ctx) => {
    if (ctx.klines.length < 40) return null;
    const closes = closesOf(ctx.klines);
    const e9 = ema(closes, 9);
    const e21 = ema(closes, 21);
    const n = closes.length;
    const cur9 = e9[n - 1];
    const cur21 = e21[n - 1];
    const prev9 = e9[n - 2];
    const prev21 = e21[n - 2];
    if (cur9 == null || cur21 == null || prev9 == null || prev21 == null) return null;
    const stopMult = ctxNum(ctx, "stopAtrMult", 1.0);
    const tpR = ctxNum(ctx, "tpR", 2);
    const sl = atrStopPct(ctx.klines, stopMult, 0.5);
    if (prev9 <= prev21 && cur9 > cur21) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * tpR).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "EMA9 cruzou acima da EMA21",
        confidence: 62,
        atrStopMult: stopMult,
      };
    }
    if (ctx.mode === "futures" && prev9 >= prev21 && cur9 < cur21) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * tpR).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "EMA9 cruzou abaixo da EMA21",
        confidence: 62,
        atrStopMult: stopMult,
      };
    }
    return null;
  },
};

const orderblockSmc: CryptoStrategy = {
  id: "crypto_orderblock_smc",
  name: "Order Block SMC (institucional)",
  description:
    "Smart Money: após varredura de máxima/mínima de 20 velas + fecho de volta ao range, entra na reversão. Funciona em 15m/1h/4h em BTC/ETH. Stop além da varredura (ATR 1×, mín. 0.8%). Futuros: ambos os lados.",
  minCandles: 40,
  defaults: { stopGainPct: 3, stopLossPct: 1.2 },
  timeframes: ["15m", "1h", "4h"],
  modes: ["futures"],
  category: "auto",
  indicators: ["Swing H/L 20", "FVG proxy", "ATR14"],
  params: [
    { key: "lookback", label: "Lookback swing", type: "number", default: 20, min: 10, max: 50, step: 1 },
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.0, min: 0.5, max: 3, step: 0.1 },
  ],
  onSignal: (ctx) => {
    const n = ctx.klines.length;
    if (n < 40) return null;
    const lookback = Math.round(ctxNum(ctx, "lookback", 20));
    const stopMult = ctxNum(ctx, "stopAtrMult", 1.0);
    const window = ctx.klines.slice(n - 1 - lookback, n - 1);
    if (window.length < lookback) return null;
    const swingHigh = Math.max(...window.map((k) => k.h));
    const swingLow = Math.min(...window.map((k) => k.l));
    const last = ctx.klines[n - 1];
    const sl = atrStopPct(ctx.klines, stopMult, 0.8);
    // Varredura de mínima + recuperação = absorção compradora
    if (last.l < swingLow && last.c > swingLow && last.c > last.o) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2.5).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "Varredura de mínima + fecho de volta (demanda)",
        confidence: 66,
        atrStopMult: stopMult,
      };
    }
    if (ctx.mode === "futures" && last.h > swingHigh && last.c < swingHigh && last.c < last.o) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2.5).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "Varredura de máxima + fecho de volta (oferta)",
        confidence: 66,
        atrStopMult: stopMult,
      };
    }
    return null;
  },
};

export const CRYPTO_STRATEGIES: CryptoStrategy[] = [
  trendPullback,
  bollingerBreakout,
  rsiMeanReversion,
  macdEmaTrend,
  emaCross,
  orderblockSmc,
];

export function getCryptoStrategy(id: string): CryptoStrategy | undefined {
  return (
    CRYPTO_STRATEGIES.find((s) => s.id === id) ?? getCustomStrategy(id)
  );
}

/** Catálogo completo: embutidas + personalizadas (criadas na UI). */
export function listAllStrategies(): CryptoStrategy[] {
  const custom = useCustomStrategies.getState().specs.map(buildCustomStrategy);
  return [...CRYPTO_STRATEGIES, ...custom];
}

/** Ações válidas por modo (Binance). */
export function validActionsForMode(mode: RobotMode): CryptoAction[] {
  return mode === "spot" ? ["BUY", "SELL", "EXIT"] : ["LONG", "SHORT", "EXIT", "FLAT"];
}

/** Valida um sinal antes de qualquer execução (motor e backtest usam isto). */
export function validateSpotSignal(
  signal: CryptoSignal | null,
  minCandles: number,
  candleCount: number,
  mode: RobotMode = "futures"
): { ok: boolean; reason?: string } {
  return validateCryptoSignal(signal, minCandles, candleCount, mode);
}

export function validateCryptoSignal(
  signal: CryptoSignal | null,
  minCandles: number,
  candleCount: number,
  mode: RobotMode = "futures"
): { ok: boolean; reason?: string } {
  if (!signal) return { ok: false, reason: "Sem sinal." };
  if (candleCount < minCandles)
    return { ok: false, reason: `Amostra insuficiente (${candleCount}/${minCandles} velas).` };
  const allowed = validActionsForMode(mode);
  // Compat: em spot aceita BUY/EXIT legados; LONG legado = BUY; em futuros aceita BUY(=LONG)/SELL(=SHORT)
  const normalized = signal.action === "BUY" && mode === "futures" ? "LONG" : signal.action;
  const normalized2 = normalized === "SELL" && mode === "futures" ? "SHORT" : normalized;
  if (!allowed.includes(signal.action) && !allowed.includes(normalized2))
    return { ok: false, reason: `Ação ${signal.action} inválida no modo ${mode} (${allowed.join("/")}).` };
  if (
    !Number.isFinite(signal.stopGainPct) ||
    signal.stopGainPct <= 0 ||
    !Number.isFinite(signal.stopLossPct) ||
    signal.stopLossPct <= 0
  ) {
    return { ok: false, reason: "Sinal sem stop-gain/stop-loss válidos." };
  }
  if (signal.trailingPct !== undefined && (!Number.isFinite(signal.trailingPct) || signal.trailingPct < 0))
    return { ok: false, reason: "Trailing inválido." };
  return { ok: true };
}

// ─── Estratégia ligada (para o Backtest) ────────────────────────────────────
// A página Estratégias liga UMA estratégia de cada vez (Switch no card).
// A página de Backtest lê este id e corre o backtest com a estratégia ligada.
export type StrategyDirection = "all" | "long" | "short";

interface ActiveStrategyStore {
  activeStrategyId: string | null;
  direction: StrategyDirection;
  setActive: (id: string | null, direction?: StrategyDirection) => void;
}

export const useActiveStrategy = create<ActiveStrategyStore>()(
  persist(
    (set) => ({
      activeStrategyId: null,
      direction: "all",
      setActive: (id, direction = "all") =>
        set({ activeStrategyId: id, direction }),
    }),
    { name: "quantterm:active-strategy" }
  )
);

// ─── Inversão de sinal por estratégia ───────────────────────────────────────
// Inverte LONG↔SHORT (BUY↔SELL) de todos os sinais da estratégia. Aplicado no
// backtest e copiado para o robô criado a partir da estratégia.
interface StrategyInvertStore {
  invert: Record<string, boolean>;
  setInvert: (id: string, v: boolean) => void;
  toggle: (id: string) => void;
}

export const useStrategyInvert = create<StrategyInvertStore>()(
  persist(
    (set, get) => ({
      invert: {},
      setInvert: (id, v) => set({ invert: { ...get().invert, [id]: v } }),
      toggle: (id) => set({ invert: { ...get().invert, [id]: !get().invert[id] } }),
    }),
    { name: "quantterm:strategy-invert" }
  )
);

/** Inverte a ação de um sinal (LONG↔SHORT, BUY↔SELL). EXIT/FLAT não mudam. */
export function invertCryptoAction(action: CryptoAction): CryptoAction {
  if (action === "LONG" || action === "BUY") return "SHORT";
  if (action === "SHORT" || action === "SELL") return "LONG";
  return action;
}

/**
 * Aplica o filtro de direção (sobre o sinal NATURAL) e depois a inversão.
 * Ordem igual à da referência: direção filtra o sinal bruto; inverter é o passo final.
 */
export function applyDirectionAndInvert(
  sig: CryptoSignal | null,
  direction: "all" | "long" | "short",
  invert: boolean
): CryptoSignal | null {
  if (!sig) return null;
  if (sig.action === "LONG" && direction === "short") return null;
  if (sig.action === "SHORT" && direction === "long") return null;
  if (invert) return { ...sig, action: invertCryptoAction(sig.action), reason: `[inv] ${sig.reason}` };
  return sig;
}

// ─── Estratégias personalizadas (código colado pelo utilizador) ──────────────
// A estratégia personalizada é definida por CÓDIGO. O `id` e o `name` são lidos
// do próprio objeto devolvido pelo código (nada de preencher à mão). Os stops,
// a entrada e a alavancagem são parâmetros do ROBÔ, não da estratégia.

import { evalStrategy, type LoadedStrategy } from "./strategyRuntime";

export interface CustomStrategySpec {
  id: string;
  name: string;
  description: string;
  /** Código original colado (TS/JS), guardado para edição. */
  code: string;
  /** Código compilado (CommonJS), avaliado sincronamente para obter onSignal. */
  js: string;
  createdAt: number;
}

export interface NewCustomStrategy {
  code: string;
  js: string;
}

const compiledCache = new Map<string, LoadedStrategy | null>();

function erroredSpec(spec: { id: string; name: string; description: string }): CryptoStrategy {
  return {
    id: spec.id,
    name: spec.name || spec.id,
    description: spec.description || "Estratégia com erro de compilação.",
    category: "auto",
    minCandles: 9999,
    defaults: { stopGainPct: 3, stopLossPct: 1.2 },
    timeframes: [],
    modes: ["futures"],
    onSignal: () => null,
  };
}

export function buildCustomStrategy(spec: CustomStrategySpec): CryptoStrategy {
  if (!spec || typeof spec.js !== "string") return erroredSpec(spec ?? { id: "?", name: "?", description: "" });
  let loaded = compiledCache.get(spec.js);
  if (loaded === undefined) {
    loaded = evalStrategy(spec.js).strategy ?? null;
    compiledCache.set(spec.js, loaded);
  }
  if (!loaded) return erroredSpec(spec);
  const d = loaded.defaults ?? {};
  return {
    id: spec.id,
    name: spec.name || loaded.name || spec.id,
    description: spec.description || loaded.description || "",
    category: "auto",
    minCandles: Number.isFinite(loaded.minCandles) ? (loaded.minCandles as number) : 60,
    defaults: {
      stopGainPct: Number.isFinite(d.stopGainPct) ? (d.stopGainPct as number) : 3,
      stopLossPct: Number.isFinite(d.stopLossPct) ? (d.stopLossPct as number) : 1.2,
      ...(Number.isFinite(d.trailingPct) ? { trailingPct: d.trailingPct as number } : {}),
    },
    timeframes: Array.isArray(loaded.timeframes) ? (loaded.timeframes as string[]) : [],
    modes: ["futures"],
    indicators: Array.isArray(loaded.indicators) ? (loaded.indicators as string[]) : undefined,
    params: Array.isArray(loaded.params) ? (loaded.params as CryptoStrategy["params"]) : undefined,
    onSignal: (ctx) => loaded!.onSignal(ctx) as CryptoSignal | null,
  };
}

interface CustomStrategiesStore {
  specs: CustomStrategySpec[];
  add: (s: NewCustomStrategy) => { ok: boolean; reason?: string; id?: string };
  remove: (id: string) => void;
}

export const useCustomStrategies = create<CustomStrategiesStore>()(
  persist(
    (set, get) => ({
      specs: [],
      add: (s) => {
        const res = evalStrategy(s.js);
        if (!res.strategy) return { ok: false, reason: res.error || "Código inválido." };
        const id = String(res.strategy.id ?? "").trim();
        if (!id) return { ok: false, reason: "O código não define um 'id'." };
        if (!/^[a-zA-Z0-9_]+$/.test(id)) return { ok: false, reason: "O 'id' só pode ter letras, números e _." };
        if (get().specs.some((x) => x.id === id)) return { ok: false, reason: `Já existe uma estratégia com o id "${id}".` };
        const spec: CustomStrategySpec = {
          id,
          name: res.strategy.name || id,
          description: res.strategy.description || "",
          code: s.code,
          js: s.js,
          createdAt: Date.now(),
        };
        set((st) => ({ specs: [spec, ...st.specs] }));
        return { ok: true, id };
      },
      remove: (id) => {
        const spec = get().specs.find((x) => x.id === id);
        if (spec) compiledCache.delete(spec.js);
        set((st) => ({ specs: st.specs.filter((x) => x.id !== id) }));
      },
    }),
    { name: "quantterm:custom-strategies-v2" }
  )
);

export function getCustomStrategy(id: string): CryptoStrategy | undefined {
  const spec = useCustomStrategies.getState().specs.find((x) => x.id === id);
  return spec ? buildCustomStrategy(spec) : undefined;
}

export function isCustomStrategyId(id: string): boolean {
  return useCustomStrategies.getState().specs.some((x) => x.id === id);
}
