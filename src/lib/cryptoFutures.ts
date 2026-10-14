// ─── Conta paper FUTUROS USDT-M (página Trading — 100% Binance) ───
// Perpétuos: LONG/SHORT, alavancagem 1–125x, isolated/cross, TP/SL %, trailing,
// reduce-only. Taxa taker futuros 0,05%/lado + slippage 0,02% a mercado.
// Isolada da conta spot paper (cryptoPaper.ts) e do saldo de corretora legada.
//
// Contabilidade (isolated e cross tratados igual no paper):
//   abertura:  usdtFree -= margem + taxa_entrada
//   fecho:     usdtFree += margem + gross - taxa_saída
//   pnl registo = gross - taxa_entrada - taxa_saída
//   gross = (exit - entry) * qty (LONG) | (entry - exit) * qty (SHORT)

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  futuresLiqPrice,
  futuresMargin,
  futuresUnrealizedPnl,
  type FuturesSide,
  type MarginMode,
} from "@/lib/binance";
import { CRYPTO_FEE_RATE as SPOT_FEE, uid } from "@/lib/cryptoPaper";

export type { FuturesSide, MarginMode };
export const FUTURES_PAPER_START_USDT = 10_000;
/** Taxa taker futuros por lado (0,05%). */
export const FUTURES_FEE_RATE = 0.0005;
/** Slippage a mercado em futuros (0,02% contra a ordem). */
export const FUTURES_SLIPPAGE_RATE = 0.0002;
export { SPOT_FEE as CRYPTO_PAPER_SPOT_FEE_REF };

export type FuturesCloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "TRAILING_STOP"
  | "LIQUIDATION"
  | "MANUAL"
  | "REDUCE_ONLY";

export interface FuturesPosition {
  id: string;
  symbol: string;
  side: FuturesSide;
  qty: number;
  entryPrice: number;
  leverage: number;
  marginMode: MarginMode;
  /** Margem reservada na abertura. */
  margin: number;
  notional: number;
  liqPrice: number;
  tpPrice: number | null;
  slPrice: number | null;
  /** Trailing: distância % do extremo favorável. */
  trailingPct: number | null;
  /** Melhor mark desde a abertura (para trailing). */
  bestMark: number;
  reduceOnly: boolean;
  orderType: "market" | "limit";
  openedAt: number;
  /** Taxa de entrada (para o registo de PnL). */
  entryFee: number;
}

export interface FuturesPendingOrder {
  id: string;
  symbol: string;
  side: FuturesSide;
  qty: number;
  limitPrice: number;
  leverage: number;
  marginMode: MarginMode;
  tpPct: number | null;
  slPct: number | null;
  trailingPct: number | null;
  reduceOnly: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface FuturesClosedTrade {
  id: string;
  symbol: string;
  side: FuturesSide;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  marginMode: MarginMode;
  pnl: number;
  roePct: number;
  reason: FuturesCloseReason;
  openedAt: number;
  closedAt: number;
  feesPaid: number;
}

/** TP/SL em preço para futuros. LONG: SL < entry < TP. SHORT: TP < entry < SL. */
export function calcFuturesTpSl(
  side: FuturesSide,
  entry: number,
  tpPct: number | null,
  slPct: number | null
): { ok: boolean; tp?: number | null; sl?: number | null; reason?: string } {
  if (!Number.isFinite(entry) || entry <= 0) return { ok: false, reason: "Preço de entrada inválido." };
  let tp: number | null = null;
  let sl: number | null = null;
  if (tpPct !== null && tpPct !== undefined) {
    if (!Number.isFinite(tpPct) || tpPct <= 0) return { ok: false, reason: "TP % deve ser > 0." };
    tp = side === "LONG" ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
  }
  if (slPct !== null && slPct !== undefined) {
    if (!Number.isFinite(slPct) || slPct <= 0) return { ok: false, reason: "SL % deve ser > 0." };
    sl = side === "LONG" ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
  }
  if (side === "LONG") {
    if (sl !== null && !(sl < entry)) return { ok: false, reason: "LONG exige stop-loss < entrada." };
    if (tp !== null && !(entry < tp)) return { ok: false, reason: "LONG exige entrada < take-profit." };
  } else {
    if (tp !== null && !(tp < entry)) return { ok: false, reason: "SHORT exige take-profit < entrada." };
    if (sl !== null && !(entry < sl)) return { ok: false, reason: "SHORT exige entrada < stop-loss." };
  }
  return { ok: true, tp, sl };
}

function feeFor(notional: number, rate = FUTURES_FEE_RATE) {
  return notional * rate;
}

function marketFill(side: FuturesSide, mark: number): number {
  return side === "LONG" ? mark * (1 + FUTURES_SLIPPAGE_RATE) : mark * (1 - FUTURES_SLIPPAGE_RATE);
}

export function futuresLivePnl(p: Pick<FuturesPosition, "side" | "entryPrice" | "qty">, mark: number): number {
  return futuresUnrealizedPnl(p.side, p.entryPrice, p.qty, mark);
}

export function futuresLiveRoe(p: Pick<FuturesPosition, "side" | "entryPrice" | "qty" | "margin">, mark: number): number {
  if (!p.margin || p.margin <= 0) return NaN;
  return (futuresLivePnl(p, mark) / p.margin) * 100;
}

/** Resultado de fechar `qty` de `pos` a `exit`. Puro e testável. */
export function futuresCloseSlice(
  pos: Pick<FuturesPosition, "side" | "entryPrice" | "qty" | "margin" | "leverage" | "entryFee">,
  exit: number,
  closeQty: number
): { pnl: number; roePct: number; exitFee: number; cashBack: number; feesTotal: number } {
  const frac = closeQty / pos.qty;
  const gross = futuresUnrealizedPnl(pos.side, pos.entryPrice, closeQty, exit);
  const exitFee = feeFor(exit * closeQty);
  const entryFeeShare = pos.entryFee * frac;
  const pnl = gross - entryFeeShare - exitFee;
  const marginShare = pos.margin * frac;
  const roePct = marginShare > 0 ? (pnl / marginShare) * 100 : 0;
  return { pnl, roePct, exitFee, cashBack: marginShare + gross - exitFee, feesTotal: entryFeeShare + exitFee };
}

interface FuturesPaperStore {
  usdtFree: number;
  positions: FuturesPosition[];
  pending: FuturesPendingOrder[];
  history: FuturesClosedTrade[];
  startedAt: number;
  openMarket: (args: {
    symbol: string;
    markPrice: number;
    side: FuturesSide;
    qty: number;
    leverage: number;
    marginMode: MarginMode;
    tpPct?: number | null;
    slPct?: number | null;
    trailingPct?: number | null;
    reduceOnly?: boolean;
  }) => { ok: boolean; reason?: string; id?: string };
  placeLimit: (args: {
    symbol: string;
    side: FuturesSide;
    limitPrice: number;
    qty: number;
    leverage: number;
    marginMode: MarginMode;
    tpPct?: number | null;
    slPct?: number | null;
    trailingPct?: number | null;
    reduceOnly?: boolean;
  }) => { ok: boolean; reason?: string; id?: string };
  cancelPending: (id: string) => void;
  closePosition: (
    id: string,
    markPrice: number,
    reason?: FuturesCloseReason,
    closeQty?: number
  ) => { ok: boolean; reason?: string };
  /** Motor: fills + TP/SL/trailing/liq contra {symbol → {high, low, mark}}. */
  evaluateAtMarks: (bars: Record<string, { high: number; low: number; mark: number }>) => string[];
  resetPaper: () => void;
}

const initialFutures = {
  usdtFree: FUTURES_PAPER_START_USDT,
  positions: [] as FuturesPosition[],
  pending: [] as FuturesPendingOrder[],
  history: [] as FuturesClosedTrade[],
  startedAt: Date.now(),
};

function clampLev(leverage: number): number {
  if (!Number.isFinite(leverage)) return 1;
  return Math.min(125, Math.max(1, Math.floor(leverage)));
}

function buildPosition(args: {
  symbol: string;
  side: FuturesSide;
  fill: number;
  qty: number;
  leverage: number;
  marginMode: MarginMode;
  tpPct?: number | null;
  slPct?: number | null;
  trailingPct?: number | null;
  reduceOnly?: boolean;
  orderType: "market" | "limit";
  entryFee: number;
  margin: number;
}): FuturesPosition {
  const tp = calcFuturesTpSl(args.side, args.fill, args.tpPct ?? null, args.slPct ?? null);
  return {
    id: uid("fpos"),
    symbol: args.symbol,
    side: args.side,
    qty: args.qty,
    entryPrice: args.fill,
    leverage: args.leverage,
    marginMode: args.marginMode,
    margin: args.margin,
    notional: args.fill * args.qty,
    liqPrice: futuresLiqPrice(args.side, args.fill, args.leverage),
    tpPrice: tp.ok ? (tp.tp ?? null) : null,
    slPrice: tp.ok ? (tp.sl ?? null) : null,
    trailingPct: args.trailingPct ?? null,
    bestMark: args.fill,
    reduceOnly: !!args.reduceOnly,
    orderType: args.orderType,
    openedAt: Date.now(),
    entryFee: args.entryFee,
  };
}

export const useFuturesPaper = create<FuturesPaperStore>()(
  persist(
    (set, get) => ({
      ...initialFutures,

      openMarket: (args) => {
        const { symbol, markPrice, side, qty, marginMode } = args;
        if (side !== "LONG" && side !== "SHORT") return { ok: false, reason: "Lado inválido." };
        if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "Quantidade inválida." };
        if (!Number.isFinite(markPrice) || markPrice <= 0) return { ok: false, reason: "Preço inválido." };
        const lev = clampLev(args.leverage);
        const fill = marketFill(side, markPrice);
        const tp = calcFuturesTpSl(side, fill, args.tpPct ?? null, args.slPct ?? null);
        if (!tp.ok) return { ok: false, reason: tp.reason };
        if (args.trailingPct !== null && args.trailingPct !== undefined) {
          if (!Number.isFinite(args.trailingPct) || args.trailingPct <= 0 || args.trailingPct > 50) {
            return { ok: false, reason: "Trailing deve estar entre 0 e 50%." };
          }
        }
        const notional = fill * qty;
        if (notional < 5) return { ok: false, reason: "Notional mínimo: 5 USDT." };
        const margin = futuresMargin(notional, lev);
        const entryFee = feeFor(notional);
        if (args.reduceOnly) {
          const opp = get().positions.find((p) => p.symbol === symbol && p.side !== side);
          if (!opp) return { ok: false, reason: "Reduce-only sem posição oposta neste símbolo." };
          if (qty > opp.qty + 1e-12) return { ok: false, reason: "Reduce-only não pode aumentar a posição." };
        } else if (margin + entryFee > get().usdtFree + 1e-9) {
          return { ok: false, reason: `Saldo insuficiente (margem + taxa $${(margin + entryFee).toFixed(2)}).` };
        }
        const pos = buildPosition({
          symbol, side, fill, qty, leverage: lev, marginMode,
          tpPct: args.tpPct ?? null, slPct: args.slPct ?? null,
          trailingPct: args.trailingPct ?? null, reduceOnly: args.reduceOnly,
          orderType: "market", entryFee, margin,
        });
        set((s) => ({
          usdtFree: args.reduceOnly ? s.usdtFree : s.usdtFree - margin - entryFee,
          positions: [pos, ...s.positions],
        }));
        return { ok: true, id: pos.id };
      },

      placeLimit: (args) => {
        const { symbol, side, limitPrice, qty, marginMode } = args;
        if (side !== "LONG" && side !== "SHORT") return { ok: false, reason: "Lado inválido." };
        if (!Number.isFinite(limitPrice) || limitPrice <= 0) return { ok: false, reason: "Preço limite inválido." };
        if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "Quantidade inválida." };
        const lev = clampLev(args.leverage);
        const tp = calcFuturesTpSl(side, limitPrice, args.tpPct ?? null, args.slPct ?? null);
        if (!tp.ok) return { ok: false, reason: tp.reason };
        if (limitPrice * qty < 5) return { ok: false, reason: "Notional mínimo: 5 USDT." };
        const id = uid("flim");
        const order: FuturesPendingOrder = {
          id, symbol, side, qty, limitPrice, leverage: lev, marginMode,
          tpPct: args.tpPct ?? null, slPct: args.slPct ?? null,
          trailingPct: args.trailingPct ?? null,
          reduceOnly: !!args.reduceOnly,
          createdAt: Date.now(), expiresAt: Date.now() + 24 * 3600 * 1000,
        };
        set((s) => ({ pending: [order, ...s.pending] }));
        return { ok: true, id };
      },

      cancelPending: (id) => set((s) => ({ pending: s.pending.filter((o) => o.id !== id) })),

      closePosition: (id, markPrice, reason = "MANUAL", closeQty) => {
        const pos = get().positions.find((p) => p.id === id);
        if (!pos) return { ok: false, reason: "Posição não encontrada." };
        if (!Number.isFinite(markPrice) || markPrice <= 0) return { ok: false, reason: "Preço inválido." };
        const qty = closeQty ?? pos.qty;
        if (!Number.isFinite(qty) || qty <= 0 || qty > pos.qty + 1e-12) {
          return { ok: false, reason: "Quantidade de fecho inválida." };
        }
        const exit = reason === "MANUAL" || reason === "REDUCE_ONLY" ? marketFill(pos.side === "LONG" ? "SHORT" : "LONG", markPrice) : markPrice;
        // Fecho a mercado: lado oposto sofre slippage contrário; marketFill com lado
        // invertido aplica exatamente isso (vende mais barato / compra mais caro).
        const { pnl, roePct, feesTotal, cashBack } = futuresCloseSlice(pos, exit, qty);
        const trade: FuturesClosedTrade = {
          id: pos.id, symbol: pos.symbol, side: pos.side, qty,
          entryPrice: pos.entryPrice, exitPrice: exit, leverage: pos.leverage,
          marginMode: pos.marginMode, pnl, roePct, reason,
          openedAt: pos.openedAt, closedAt: Date.now(), feesPaid: feesTotal,
        };
        const full = qty >= pos.qty - 1e-12;
        const frac = qty / pos.qty;
        set((s) => ({
          usdtFree: s.usdtFree + cashBack,
          positions: full
            ? s.positions.filter((p) => p.id !== id)
            : s.positions.map((p) => (p.id === id
              ? {
                ...p,
                qty: p.qty - qty,
                margin: p.margin * (1 - frac),
                entryFee: p.entryFee * (1 - frac),
                notional: p.entryPrice * (p.qty - qty),
              }
              : p)),
          history: [trade, ...s.history].slice(0, 2000),
        }));
        return { ok: true };
      },

      evaluateAtMarks: (bars) => {
        const closed: string[] = [];
        const now = Date.now();
        const state = get();

        // 1. Expiradas saem sem custo (nada foi reservado).
        const live = state.pending.filter((o) => o.expiresAt > now);

        // 2. Fills de limites tocados (conservador: fill no preço limite).
        const fills: FuturesPosition[] = [];
        let spent = 0;
        const remaining = live.filter((o) => {
          const bar = bars[o.symbol];
          if (!bar) return true;
          const touched = o.side === "LONG" ? bar.low <= o.limitPrice : bar.high >= o.limitPrice;
          if (!touched) return true;
          const notional = o.limitPrice * o.qty;
          const margin = futuresMargin(notional, o.leverage);
          const entryFee = feeFor(notional);
          if (!o.reduceOnly && state.usdtFree - spent < margin + entryFee) return true; // sem saldo: mantém
          if (o.reduceOnly) {
            const opp = [...fills, ...state.positions].find((p) => p.symbol === o.symbol && p.side !== o.side);
            if (!opp || o.qty > opp.qty + 1e-12) return true;
          } else {
            spent += margin + entryFee;
          }
          fills.push(buildPosition({
            symbol: o.symbol, side: o.side, fill: o.limitPrice, qty: o.qty,
            leverage: o.leverage, marginMode: o.marginMode,
            tpPct: o.tpPct, slPct: o.slPct, trailingPct: o.trailingPct,
            reduceOnly: o.reduceOnly, orderType: "limit", entryFee, margin,
          }));
          return false;
        });

        // 3. TP/SL/trailing/liq das posições (abertas + recém-preenchidas).
        const survivors: FuturesPosition[] = [];
        const newTrades: FuturesClosedTrade[] = [];
        let cashBack = 0;
        for (const p of [...fills, ...state.positions]) {
          const bar = bars[p.symbol];
          if (!bar) { survivors.push(p); continue; }
          const best = p.side === "LONG" ? Math.max(p.bestMark, bar.high) : Math.min(p.bestMark, bar.low);

          // 3a. Liquidação (pavio toca o liq) — perde a margem; cashBack ≈ residual.
          const liqHit = p.side === "LONG" ? bar.low <= p.liqPrice : bar.high >= p.liqPrice;
          if (liqHit) {
            const r = futuresCloseSlice(p, p.liqPrice, p.qty);
            cashBack += r.cashBack;
            closed.push(p.id);
            newTrades.push({
              id: p.id, symbol: p.symbol, side: p.side, qty: p.qty,
              entryPrice: p.entryPrice, exitPrice: p.liqPrice, leverage: p.leverage,
              marginMode: p.marginMode, pnl: r.pnl, roePct: r.roePct,
              reason: "LIQUIDATION", openedAt: p.openedAt, closedAt: now, feesPaid: r.feesTotal,
            });
            continue;
          }

          // 3b. TP/SL (conservador: SL primeiro se ambos tocados no mesmo período).
          let exit: number | null = null;
          let reason: FuturesCloseReason | null = null;
          const slHit = p.slPrice !== null && (p.side === "LONG" ? bar.low <= p.slPrice : bar.high >= p.slPrice);
          const tpHit = p.tpPrice !== null && (p.side === "LONG" ? bar.high >= p.tpPrice : bar.low <= p.tpPrice);
          if (slHit) { exit = p.slPrice as number; reason = "STOP_LOSS"; }
          else if (tpHit) { exit = p.tpPrice as number; reason = "TAKE_PROFIT"; }
          else if (p.trailingPct !== null && p.trailingPct > 0 && best !== p.entryPrice) {
            const drop = p.side === "LONG" ? (best - bar.mark) / best : (bar.mark - best) / best;
            if (drop >= p.trailingPct / 100) { exit = bar.mark; reason = "TRAILING_STOP"; }
          }
          if (exit !== null && reason !== null) {
            const r = futuresCloseSlice(p, exit, p.qty);
            cashBack += r.cashBack;
            closed.push(p.id);
            newTrades.push({
              id: p.id, symbol: p.symbol, side: p.side, qty: p.qty,
              entryPrice: p.entryPrice, exitPrice: exit, leverage: p.leverage,
              marginMode: p.marginMode, pnl: r.pnl, roePct: r.roePct, reason,
              openedAt: p.openedAt, closedAt: now, feesPaid: r.feesTotal,
            });
            continue;
          }
          survivors.push({ ...p, bestMark: best });
        }

        if (fills.length === 0 && newTrades.length === 0) {
          if (remaining.length !== state.pending.length) set({ pending: remaining });
          const moved = survivors.some((s, i) => {
            const prev = [...fills, ...state.positions][i];
            return prev && s.bestMark !== prev.bestMark;
          });
          if (moved) set({ positions: survivors });
          return closed;
        }
        set((s) => ({
          pending: remaining,
          positions: survivors,
          history: [...newTrades, ...s.history].slice(0, 2000),
          usdtFree: s.usdtFree - spent + cashBack,
        }));
        return closed;
      },

      resetPaper: () =>
        set({
          usdtFree: FUTURES_PAPER_START_USDT,
          positions: [],
          pending: [],
          history: [],
          startedAt: Date.now(),
        }),
    }),
    { name: "quantern:futures-paper" }
  )
);

/** Agregados para o UI. */
export function futuresRealizedPnl(history: FuturesClosedTrade[]): number {
  return history.reduce((s, t) => s + t.pnl, 0);
}
export function futuresLockedMargin(positions: FuturesPosition[]): number {
  return positions.reduce((s, p) => s + p.margin, 0);
}
export function futuresUnrealizedTotal(positions: FuturesPosition[], marks: Record<string, number>): number {
  return positions.reduce((s, p) => {
    const m = marks[p.symbol];
    if (!Number.isFinite(m)) return s;
    return s + futuresUnrealizedPnl(p.side, p.entryPrice, p.qty, m);
  }, 0);
}
