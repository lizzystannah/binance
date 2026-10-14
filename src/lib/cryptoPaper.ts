// ─── Conta paper spot (Fase 2) — conta isolada ────────────────────
// Spot = SÓ LONG (comprar o ativo). SHORT/venda a descoberto exige margem ou
// futures e fica na Fase 4, desligada. Vender = fechar posição LONG.
// Taxas e slippage declarados (ver CRYPTO_FEE_RATE / CRYPTO_SLIPPAGE_RATE).

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CRYPTO_PAPER_START_USDT = 10_000;
/** Taxa Binance spot por lado (0,1%). Aplicada na compra E na venda. */
export const CRYPTO_FEE_RATE = 0.001;
/** Slippage assumido em ordens a mercado (0,05% contra a ordem). */
export const CRYPTO_SLIPPAGE_RATE = 0.0005;

export type CryptoCloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "MANUAL"
  | "STRATEGY_EXIT"
  | "ACCOUNT_STOP";

export interface CryptoPosition {
  id: string;
  symbol: string;
  side: "LONG";
  qty: number;
  entryPrice: number;
  stopGainPrice: number;
  stopLossPrice: number;
  /** Intervalo que originou a posição ("1m", "1h"…) ou "manual". */
  timeframe: string;
  orderType: "market" | "limit";
  strategyId?: string;
  robotId?: string;
  openedAt: number;
  /** Custo de entrada (USDT, com taxa incluída). */
  entryCost: number;
  feesPaid: number;
}

export interface CryptoPendingOrder {
  id: string;
  symbol: string;
  qty: number;
  limitPrice: number;
  stopGainPct: number;
  stopLossPct: number;
  timeframe: string;
  strategyId?: string;
  robotId?: string;
  createdAt: number;
  expiresAt: number;
}

export interface CryptoClosedTrade {
  id: string;
  symbol: string;
  side: "LONG";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  reason: CryptoCloseReason;
  strategyId?: string;
  robotId?: string;
  openedAt: number;
  closedAt: number;
  feesPaid: number;
}

export function uid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}_${crypto.randomUUID()}`;
    }
  } catch {
    /* fallback abaixo */
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Calcula preços de TP/SL e valida a regra de ferro: SL < entrada < TP (LONG). */
export function calcTpSlPrices(
  entry: number,
  stopGainPct: number,
  stopLossPct: number
): { ok: boolean; tp?: number; sl?: number; reason?: string } {
  if (!Number.isFinite(entry) || entry <= 0) return { ok: false, reason: "Preço de entrada inválido." };
  if (!Number.isFinite(stopGainPct) || stopGainPct <= 0)
    return { ok: false, reason: "Stop-gain (%) obrigatório e > 0." };
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0)
    return { ok: false, reason: "Stop-loss (%) obrigatório e > 0." };
  const tp = entry * (1 + stopGainPct / 100);
  const sl = entry * (1 - stopLossPct / 100);
  if (!(sl < entry && entry < tp)) return { ok: false, reason: "Regra violada: stop-loss < entrada < stop-gain." };
  return { ok: true, tp, sl };
}

/** Custo total de compra (notional + taxa). */
export function buyCost(price: number, qty: number, feeRate = CRYPTO_FEE_RATE) {
  const notional = price * qty;
  const fee = notional * feeRate;
  return { notional, fee, total: notional + fee };
}

/** PnL de fecho LONG: (saída − entrada) × qty − taxas (entrada + saída). */
export function closePnl(
  entryPrice: number,
  qty: number,
  exitPrice: number,
  entryFee: number,
  feeRate = CRYPTO_FEE_RATE
) {
  const proceeds = exitPrice * qty;
  const exitFee = proceeds * feeRate;
  const pnl = proceeds - entryPrice * qty - entryFee - exitFee;
  return { proceeds, exitFee, pnl, feesTotal: entryFee + exitFee };
}

/**
 * Avalia TP/SL contra máxima/mínima do período.
 * Conservador: se ambos forem tocados no mesmo período, assume-se STOP primeiro.
 */
export function evaluateTpSl(
  stopGainPrice: number,
  stopLossPrice: number,
  high: number,
  low: number
): "TAKE_PROFIT" | "STOP_LOSS" | null {
  if (low <= stopLossPrice) return "STOP_LOSS";
  if (high >= stopGainPrice) return "TAKE_PROFIT";
  return null;
}

export function livePnl(entryPrice: number, qty: number, markPrice: number): number {
  return (markPrice - entryPrice) * qty;
}

// ─── Store (persistente, isolado) ────────────────────────────────────────────

interface CryptoPaperStore {
  usdtFree: number;
  positions: CryptoPosition[];
  pending: CryptoPendingOrder[];
  history: CryptoClosedTrade[];
  startedAt: number;
  openMarketLong: (args: {
    symbol: string;
    markPrice: number;
    qty: number;
    stopGainPct: number;
    stopLossPct: number;
    timeframe?: string;
    strategyId?: string;
    robotId?: string;
  }) => { ok: boolean; reason?: string; id?: string };
  placeLimitLong: (args: {
    symbol: string;
    limitPrice: number;
    qty: number;
    stopGainPct: number;
    stopLossPct: number;
    timeframe?: string;
    strategyId?: string;
    robotId?: string;
  }) => { ok: boolean; reason?: string; id?: string };
  cancelPending: (id: string) => void;
  closePosition: (id: string, markPrice: number, reason: CryptoCloseReason) => { ok: boolean; reason?: string };
  /** Motor: preenche limites + fecha TP/SL contra {symbol → {high, low}}. */
  evaluateAtBars: (bars: Record<string, { high: number; low: number }>) => string[];
  resetPaper: () => void;
}

const initial = {
  usdtFree: CRYPTO_PAPER_START_USDT,
  positions: [] as CryptoPosition[],
  pending: [] as CryptoPendingOrder[],
  history: [] as CryptoClosedTrade[],
  startedAt: Date.now(),
};

export const useCryptoPaper = create<CryptoPaperStore>()(
  persist(
    (set, get) => ({
      ...initial,

      openMarketLong: (args) => {
        const { symbol, markPrice, qty, stopGainPct, stopLossPct } = args;
        if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "Quantidade inválida." };
        if (!Number.isFinite(markPrice) || markPrice <= 0) return { ok: false, reason: "Preço inválido." };
        const fill = markPrice * (1 + CRYPTO_SLIPPAGE_RATE);
        const tp = calcTpSlPrices(fill, stopGainPct, stopLossPct);
        if (!tp.ok) return { ok: false, reason: tp.reason };
        const { total, fee } = buyCost(fill, qty);
        if (total > get().usdtFree + 1e-9)
          return { ok: false, reason: `Saldo insuficiente (precisa $${total.toFixed(2)}).` };
        const id = uid("pos");
        const pos: CryptoPosition = {
          id,
          symbol,
          side: "LONG",
          qty,
          entryPrice: fill,
          stopGainPrice: tp.tp!,
          stopLossPrice: tp.sl!,
          timeframe: args.timeframe || "manual",
          orderType: "market",
          strategyId: args.strategyId,
          robotId: args.robotId,
          openedAt: Date.now(),
          entryCost: total,
          feesPaid: fee,
        };
        set((s) => ({ usdtFree: s.usdtFree - total, positions: [pos, ...s.positions] }));
        return { ok: true, id };
      },

      placeLimitLong: (args) => {
        const { limitPrice, qty, stopGainPct, stopLossPct } = args;
        if (!Number.isFinite(limitPrice) || limitPrice <= 0)
          return { ok: false, reason: "Preço limite inválido." };
        if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "Quantidade inválida." };
        // TP/SL calculados sobre o preço limite (pior caso: fill exatamente no limite).
        const tp = calcTpSlPrices(limitPrice, stopGainPct, stopLossPct);
        if (!tp.ok) return { ok: false, reason: tp.reason };
        const { total } = buyCost(limitPrice, qty);
        if (total > get().usdtFree + 1e-9)
          return { ok: false, reason: `Saldo insuficiente para reservar (precisa $${total.toFixed(2)}).` };
        const id = uid("lim");
        const order: CryptoPendingOrder = {
          id,
          symbol: args.symbol,
          qty,
          limitPrice,
          stopGainPct,
          stopLossPct,
          timeframe: args.timeframe || "manual",
          strategyId: args.strategyId,
          robotId: args.robotId,
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 3600 * 1000,
        };
        set((s) => ({ pending: [order, ...s.pending] }));
        return { ok: true, id };
      },

      cancelPending: (id) =>
        set((s) => ({ pending: s.pending.filter((o) => o.id !== id) })),

      closePosition: (id, markPrice, reason) => {
        const pos = get().positions.find((p) => p.id === id);
        if (!pos) return { ok: false, reason: "Posição não encontrada." };
        if (!Number.isFinite(markPrice) || markPrice <= 0)
          return { ok: false, reason: "Preço inválido." };
        const exit = reason === "MANUAL" ? markPrice * (1 - CRYPTO_SLIPPAGE_RATE) : markPrice;
        const { proceeds, exitFee, pnl, feesTotal } = closePnl(pos.entryPrice, pos.qty, exit, pos.feesPaid);
        const trade: CryptoClosedTrade = {
          id: pos.id,
          symbol: pos.symbol,
          side: "LONG",
          qty: pos.qty,
          entryPrice: pos.entryPrice,
          exitPrice: exit,
          pnl,
          reason,
          strategyId: pos.strategyId,
          robotId: pos.robotId,
          openedAt: pos.openedAt,
          closedAt: Date.now(),
          feesPaid: feesTotal,
        };
        set((s) => ({
          usdtFree: s.usdtFree + proceeds - exitFee,
          positions: s.positions.filter((p) => p.id !== id),
          history: [trade, ...s.history].slice(0, 2000),
        }));
        return { ok: true };
      },

      evaluateAtBars: (bars) => {
        const closed: string[] = [];
        const now = Date.now();
        // 1. Limites expirados saem sem custo (nada foi reservado).
        const expired = get().pending.filter((o) => o.expiresAt <= now).map((o) => o.id);
        // 2. Fill de limites tocados (fill exatamente no preço limite, conservador).
        const fills: CryptoPosition[] = [];
        let spent = 0;
        const remaining = get().pending.filter((o) => {
          if (o.expiresAt <= now) return false;
          const bar = bars[o.symbol];
          if (!bar) return true;
          if (bar.low <= o.limitPrice) {
            const tp = calcTpSlPrices(o.limitPrice, o.stopGainPct, o.stopLossPct);
            if (!tp.ok) return false; // config inválida: descarta sem custo
            const { total, fee } = buyCost(o.limitPrice, o.qty);
            if (get().usdtFree - spent < total) return true; // sem saldo: mantém pendente
            spent += total;
            fills.push({
              id: uid("pos"),
              symbol: o.symbol,
              side: "LONG",
              qty: o.qty,
              entryPrice: o.limitPrice,
              stopGainPrice: tp.tp!,
              stopLossPrice: tp.sl!,
              timeframe: o.timeframe,
              orderType: "limit",
              strategyId: o.strategyId,
              robotId: o.robotId,
              openedAt: now,
              entryCost: total,
              feesPaid: fee,
            });
            return false;
          }
          return true;
        });
        // 3. TP/SL das posições (abertas + recém-preenchidas).
        const allPos = [...fills, ...get().positions];
        const survivors: CryptoPosition[] = [];
        const newTrades: CryptoClosedTrade[] = [];
        let released = 0;
        for (const p of allPos) {
          const bar = bars[p.symbol];
          if (!bar) {
            survivors.push(p);
            continue;
          }
          const hit = evaluateTpSl(p.stopGainPrice, p.stopLossPrice, bar.high, bar.low);
          if (!hit) {
            survivors.push(p);
            continue;
          }
          const exit = hit === "TAKE_PROFIT" ? p.stopGainPrice : p.stopLossPrice;
          const { proceeds, exitFee, pnl, feesTotal } = closePnl(p.entryPrice, p.qty, exit, p.feesPaid);
          released += proceeds - exitFee;
          closed.push(p.id);
          newTrades.push({
            id: p.id,
            symbol: p.symbol,
            side: "LONG",
            qty: p.qty,
            entryPrice: p.entryPrice,
            exitPrice: exit,
            pnl,
            reason: hit,
            strategyId: p.strategyId,
            robotId: p.robotId,
            openedAt: p.openedAt,
            closedAt: now,
            feesPaid: feesTotal,
          });
        }
        if (expired.length === 0 && fills.length === 0 && newTrades.length === 0) return closed;
        set((s) => ({
          pending: remaining,
          positions: survivors,
          history: [...newTrades, ...s.history].slice(0, 2000),
          usdtFree: s.usdtFree - spent + released,
        }));
        return closed;
      },

      resetPaper: () =>
        set({
          usdtFree: CRYPTO_PAPER_START_USDT,
          positions: [],
          pending: [],
          history: [],
          startedAt: Date.now(),
        }),
    }),
    { name: "quantern:crypto-paper" }
  )
);

/** PnL realizado (total ou filtrado por robô). */
export function realizedPnl(history: CryptoClosedTrade[], robotId?: string): number {
  return history
    .filter((t) => !robotId || t.robotId === robotId)
    .reduce((sum, t) => sum + t.pnl, 0);
}

/** Custo de entrada em aberto (total ou por robô). */
export function lockedCost(positions: CryptoPosition[], robotId?: string): number {
  return positions
    .filter((p) => !robotId || p.robotId === robotId)
    .reduce((sum, p) => sum + p.entryCost, 0);
}

/** PnL não realizado das posições abertas aos preços dados. */
export function unrealizedPnl(
  positions: CryptoPosition[],
  marks: Record<string, number>,
  robotId?: string
): number {
  return positions
    .filter((p) => !robotId || p.robotId === robotId)
    .reduce((sum, p) => {
      const m = marks[p.symbol];
      if (!Number.isFinite(m)) return sum;
      return sum + livePnl(p.entryPrice, p.qty, m);
    }, 0);
}
