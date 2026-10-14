// ─── Estratégias Binance Spot + Futuros ──────────────────────────────────────
// Sinais genéricos, sem dependência de símbolos de corretora legada (R_*, frx*).
// Funcionam em qualquer par cripto (BTCUSDT, ETHUSDT, altcoins voláteis).
// Timeframes: 1m / 5m / 15m / 1h / 4h. Stops em % ou múltiplo de ATR, com
// trailing opcional. Volume confirma rompimentos.
//   Spot:    BUY (abrir LONG à vista) / SELL (fechar) / EXIT — sem leverage.
//   Futuros: LONG / SHORT / EXIT / FLAT — com leverage + funding awareness.

import { atr, bollinger, ema, macd, rsi } from "@/lib/indicators";
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
  modes: ["spot", "futures"],
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
    const sl = atrStopPct(ctx.klines, 1.5, 1.0);
    const tp = sl * 2;
    if (e20 > e50 && r < 45) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +tp.toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `EMA20>EMA50 em pullback (RSI ${r.toFixed(0)})`,
        confidence: Math.min(90, Math.round(55 + (45 - r))),
        atrStopMult: 1.5,
      };
    }
    if (ctx.mode === "futures" && e20 < e50 && r > 55) {
      return {
        action: "SHORT",
        stopGainPct: +tp.toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `EMA20<EMA50 em repique (RSI ${r.toFixed(0)})`,
        confidence: Math.min(90, Math.round(55 + (r - 55))),
        atrStopMult: 1.5,
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
  modes: ["spot", "futures"],
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
    const sl = atrStopPct(ctx.klines, 1.2, 0.8);
    if (ctx.lastClose > upper && mult > 1.5) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `Rompimento banda sup. com volume ${mult.toFixed(1)}×`,
        confidence: 70,
        trailingPct: 1.2,
        volumeMult: +mult.toFixed(2),
      };
    }
    if (ctx.mode === "futures" && ctx.lastClose < lower && mult > 1.5) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `Rompimento banda inf. com volume ${mult.toFixed(1)}×`,
        confidence: 70,
        trailingPct: 1.2,
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
  modes: ["spot", "futures"],
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
    const sl = atrStopPct(ctx.klines, 1.0, 0.6);
    if (r < 30) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `RSI oversold (${r.toFixed(0)}) — reversão`,
        confidence: Math.min(85, Math.round(60 + (30 - r))),
        atrStopMult: 1.0,
      };
    }
    if (ctx.mode === "futures" && r > 70) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: `RSI overbought (${r.toFixed(0)}) — reversão`,
        confidence: Math.min(85, Math.round(60 + (r - 70))),
        atrStopMult: 1.0,
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
  modes: ["spot", "futures"],
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
    const volOk = avg === null ? true : ctx.klines[ctx.klines.length - 1].v >= avg * 1.1;
    const sl = atrStopPct(ctx.klines, 1.5, 1.0);
    if (hist > 0 && ctx.lastClose > e50 && volOk) {
      const prevHist = m.histogram.length >= 2 ? m.histogram[m.histogram.length - 2] : null;
      const fresh = prevHist !== null && prevHist <= 0; // cruzamento recente = mais confiança
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: fresh ? "MACD virou bull + preço > EMA50" : "Momentum bull (MACD>0, > EMA50)",
        confidence: fresh ? 75 : 60,
        trailingPct: 1.5,
        atrStopMult: 1.5,
      };
    }
    if (ctx.mode === "futures" && hist < 0 && ctx.lastClose < e50 && volOk) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "Momentum bear (MACD<0, < EMA50)",
        confidence: 60,
        trailingPct: 1.5,
        atrStopMult: 1.5,
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
  modes: ["spot", "futures"],
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
    const sl = atrStopPct(ctx.klines, 1.0, 0.5);
    if (prev9 <= prev21 && cur9 > cur21) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "EMA9 cruzou acima da EMA21",
        confidence: 62,
        atrStopMult: 1.0,
      };
    }
    if (ctx.mode === "futures" && prev9 >= prev21 && cur9 < cur21) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "EMA9 cruzou abaixo da EMA21",
        confidence: 62,
        atrStopMult: 1.0,
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
  modes: ["spot", "futures"],
  indicators: ["Swing H/L 20", "FVG proxy", "ATR14"],
  params: [
    { key: "lookback", label: "Lookback swing", type: "number", default: 20, min: 10, max: 50, step: 1 },
    { key: "stopAtrMult", label: "Stop ATR ×", type: "number", default: 1.0, min: 0.5, max: 3, step: 0.1 },
  ],
  onSignal: (ctx) => {
    const n = ctx.klines.length;
    if (n < 40) return null;
    const lookback = 20;
    const window = ctx.klines.slice(n - 1 - lookback, n - 1);
    if (window.length < lookback) return null;
    const swingHigh = Math.max(...window.map((k) => k.h));
    const swingLow = Math.min(...window.map((k) => k.l));
    const last = ctx.klines[n - 1];
    const sl = atrStopPct(ctx.klines, 1.0, 0.8);
    // Varredura de mínima + recuperação = absorção compradora
    if (last.l < swingLow && last.c > swingLow && last.c > last.o) {
      return {
        action: ctx.mode === "futures" ? "LONG" : "BUY",
        stopGainPct: +(sl * 2.5).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "Varredura de mínima + fecho de volta (demanda)",
        confidence: 66,
        atrStopMult: 1.0,
      };
    }
    if (ctx.mode === "futures" && last.h > swingHigh && last.c < swingHigh && last.c < last.o) {
      return {
        action: "SHORT",
        stopGainPct: +(sl * 2.5).toFixed(2),
        stopLossPct: +sl.toFixed(2),
        reason: "Varredura de máxima + fecho de volta (oferta)",
        confidence: 66,
        atrStopMult: 1.0,
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
  return CRYPTO_STRATEGIES.find((s) => s.id === id);
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
  mode: RobotMode = "spot"
): { ok: boolean; reason?: string } {
  return validateCryptoSignal(signal, minCandles, candleCount, mode);
}

export function validateCryptoSignal(
  signal: CryptoSignal | null,
  minCandles: number,
  candleCount: number,
  mode: RobotMode = "spot"
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
