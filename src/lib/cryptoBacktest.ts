// ─── Backtest Binance Spot + Futuros sobre klines reais ──────────────────────
// Regras de honestidade:
// - Sinal calculado APENAS com velas fechadas até t; fill na abertura de t+1.
// - Intra-vela: se a vela tocar SL e TP, assume-se SL primeiro (conservador).
// - Taxas por lado + slippage declarados.
// - Spot: apenas LONG (BUY), sem alavancagem. SELL/EXIT fecha.
// - Futuros: LONG e SHORT com leverage; PnL × leverage; funding deduzido por
//   trade quando informado (fundingRatePct por trade ou por vela).

import { CRYPTO_FEE_RATE, CRYPTO_SLIPPAGE_RATE, evaluateTpSl } from "./cryptoPaper";
import type { CryptoCandle, CryptoStrategy } from "./cryptoStrategies";
import { validateCryptoSignal } from "./cryptoStrategies";
import type { RobotMode } from "./cryptoRobots";

export interface CryptoBacktestOpts {
  capital: number;
  stakePerEntry: number;
  feeRate?: number;
  slippageRate?: number;
  /** Mercado testado. Default "spot" (compat). */
  mode?: RobotMode;
  /** Alavancagem (futuros). Spot ignora (1x). */
  leverage?: number;
  /** Custo de funding por trade em % do notional (ex: 0.01 = 0.01%). Default 0. */
  fundingRatePct?: number;
}

export interface CryptoBacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  side: "LONG" | "SHORT";
  leverage: number;
  pnl: number;
  pnlPct: number;
  reason: "TAKE_PROFIT" | "STOP_LOSS" | "STRATEGY_EXIT" | "END_OF_DATA" | "TRAILING";
}

export interface CryptoBacktestResult {
  trades: CryptoBacktestTrade[];
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  finalEquity: number;
  maxDrawdownPct: number;
  buyHoldPct: number;
  bars: number;
  mode: RobotMode;
  leverage: number;
}

export function runCryptoBacktest(
  klines: CryptoCandle[],
  strategy: CryptoStrategy,
  opts: CryptoBacktestOpts
): CryptoBacktestResult {
  const feeRate = opts.feeRate ?? CRYPTO_FEE_RATE;
  const slip = opts.slippageRate ?? CRYPTO_SLIPPAGE_RATE;
  const mode: RobotMode = opts.mode ?? "spot";
  const leverage = mode === "futures" ? Math.min(Math.max(opts.leverage ?? 1, 1), 125) : 1;
  const fundingPct = opts.fundingRatePct ?? 0;
  const empty: CryptoBacktestResult = {
    trades: [],
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    pnl: 0,
    finalEquity: opts.capital,
    maxDrawdownPct: 0,
    buyHoldPct: 0,
    bars: klines.length,
    mode,
    leverage,
  };
  if (!klines || klines.length < strategy.minCandles + 2) return empty;
  if (!Number.isFinite(opts.capital) || opts.capital <= 0) return empty;
  if (!Number.isFinite(opts.stakePerEntry) || opts.stakePerEntry <= 0) return empty;

  const closes = klines.map((k) => k.c);
  const trades: CryptoBacktestTrade[] = [];
  let equity = opts.capital;
  let peak = equity;
  let maxDd = 0;
  const markDd = (eq: number) => {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  };

  interface Open {
    side: "LONG" | "SHORT";
    qty: number;
    entry: number;
    tp: number;
    sl: number;
    entryFee: number;
    entryIndex: number;
    trailPeak?: number;
    trailingPct?: number;
  }
  let open: Open | null = null;

  const closeOpen = (
    exitPrice: number,
    exitIndex: number,
    reason: CryptoBacktestTrade["reason"]
  ) => {
    if (!open) return;
    const notional = open.entry * open.qty;
    const proceeds =
      open.side === "LONG"
        ? exitPrice * open.qty
        : open.entry * open.qty + (open.entry - exitPrice) * open.qty;
    const exitFee = exitPrice * open.qty * feeRate;
    const fundingCost = (notional * fundingPct) / 100;
    let pnl: number;
    if (open.side === "LONG") {
      pnl = (proceeds - notional - open.entryFee - exitFee) * leverage - fundingCost;
    } else {
      pnl = ((open.entry - exitPrice) * open.qty - open.entryFee - exitFee) * leverage - fundingCost;
    }
    equity += pnl;
    markDd(equity);
    trades.push({
      entryIndex: open.entryIndex,
      exitIndex,
      entryPrice: open.entry,
      exitPrice,
      qty: open.qty,
      side: open.side,
      leverage,
      pnl,
      pnlPct: notional > 0 ? (pnl / opts.stakePerEntry) * 100 : 0,
      reason,
    });
    open = null;
  };

  const signalToSide = (action: string): "LONG" | "SHORT" | null => {
    if (action === "BUY" || action === "LONG") return "LONG";
    if (action === "SHORT") return "SHORT";
    if (action === "SELL") return mode === "futures" ? "SHORT" : null; // spot SELL = só fecha
    return null;
  };

  for (let i = strategy.minCandles; i < klines.length - 1; i++) {
    // 1. Gestão da posição aberta com a vela i (h/l reais).
    if (open) {
      const hit = evaluateTpSl(open.tp, open.sl, klines[i].h, klines[i].l);
      // Para SHORT, TP fica abaixo e SL acima — evaluateTpSl assume LONG.
      // Normalizamos: SHORT inverte a leitura (toque no SL primeiro).
      let resolved: "TAKE_PROFIT" | "STOP_LOSS" | null = null;
      if (open.side === "LONG") {
        resolved = hit;
      } else {
        if (klines[i].h >= open.sl) resolved = "STOP_LOSS";
        else if (klines[i].l <= open.tp) resolved = "TAKE_PROFIT";
      }
      if (resolved === "STOP_LOSS") {
        closeOpen(open.sl, i, "STOP_LOSS");
      } else if (resolved === "TAKE_PROFIT") {
        closeOpen(open.tp, i, "TAKE_PROFIT");
      } else {
        // Trailing (futuros e spot): acompanha o pico a favor.
        if (open.trailingPct && open.trailingPct > 0) {
          if (open.side === "LONG") {
            open.trailPeak = Math.max(open.trailPeak ?? open.entry, klines[i].h);
            const trailLine = open.trailPeak * (1 - open.trailingPct / 100);
            if (klines[i].l <= trailLine && open.trailPeak > open.entry) {
              closeOpen(trailLine, i, "TRAILING");
            }
          } else {
            open.trailPeak = Math.min(open.trailPeak ?? open.entry, klines[i].l);
            const trailLine = open.trailPeak * (1 + open.trailingPct / 100);
            if (klines[i].h >= trailLine && open.trailPeak < open.entry) {
              closeOpen(trailLine, i, "TRAILING");
            }
          }
        }
        if (open) {
          // Saída por sinal da estratégia (avaliado no fecho, sem lookahead).
          const ctx = {
            symbol: "",
            interval: "",
            klines: klines.slice(0, i + 1),
            closes: closes.slice(0, i + 1),
            lastClose: closes[i],
            mode,
          };
          let sig: ReturnType<CryptoStrategy["onSignal"]> = null;
          try {
            sig = strategy.onSignal(ctx);
          } catch {
            sig = null;
          }
          if (sig && (sig.action === "EXIT" || sig.action === "FLAT" || sig.action === "SELL")) {
            const exit = klines[i + 1].o * (1 - (open.side === "LONG" ? slip : -slip));
            closeOpen(exit, i + 1, "STRATEGY_EXIT");
          }
        }
      }
    }
    // 2. Nova entrada: sinal no fecho de i → fill na abertura de i+1.
    if (!open) {
      const ctx = {
        symbol: "",
        interval: "",
        klines: klines.slice(0, i + 1),
        closes: closes.slice(0, i + 1),
        lastClose: closes[i],
        mode,
      };
      let sig: ReturnType<CryptoStrategy["onSignal"]> = null;
      try {
        sig = strategy.onSignal(ctx);
      } catch {
        sig = null;
      }
      const valid = validateCryptoSignal(sig, strategy.minCandles, i + 1, mode);
      if (sig && valid.ok) {
        const side = signalToSide(sig.action);
        if (side) {
          // Spot nunca abre SHORT.
          if (mode === "spot" && side === "SHORT") continue;
          const fill = klines[i + 1].o * (1 + (side === "LONG" ? slip : -slip));
          if (fill > 0 && opts.stakePerEntry <= equity) {
            const qty = opts.stakePerEntry / fill;
            const tp =
              side === "LONG" ? fill * (1 + sig.stopGainPct / 100) : fill * (1 - sig.stopGainPct / 100);
            const sl =
              side === "LONG" ? fill * (1 - sig.stopLossPct / 100) : fill * (1 + sig.stopLossPct / 100);
            const okShape = side === "LONG" ? sl < fill && fill < tp : tp < fill && fill < sl;
            if (okShape) {
              const entryFee = opts.stakePerEntry * feeRate;
              open = {
                side,
                qty,
                entry: fill,
                tp,
                sl,
                entryFee,
                entryIndex: i + 1,
                trailPeak: fill,
                trailingPct: sig.trailingPct,
              };
            }
          }
        }
      }
    }
  }

  // Fecha eventual posição aberta no último fecho (fim dos dados).
  if (open) {
    const last = klines[klines.length - 1].c * (1 - (open.side === "LONG" ? slip : -slip));
    closeOpen(last, klines.length - 1, "END_OF_DATA");
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl <= 0).length;
  const pnl = trades.reduce((s, t) => s + t.pnl, 0);
  const first = klines[0].o > 0 ? klines[0].o : 1;
  const buyHoldPct = ((klines[klines.length - 1].c - first) / first) * 100;

  return {
    trades,
    totalTrades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    pnl,
    finalEquity: equity,
    maxDrawdownPct: maxDd,
    buyHoldPct,
    bars: klines.length,
    mode,
    leverage,
  };
}
