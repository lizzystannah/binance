// ─── Robôs Binance Futuros USDT-M ────────────────────────────────────────────
// Futuros USDT-M: LONG/SHORT com leverage, marginMode, funding awareness e hedge.
// Sem ticks/dígitos/stake de binárias, sem martingale — risco em USDT + %.
// (Robôs Spot antigos são legado: continuam válidos na store mas ocultos na UI.)

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "./cryptoPaper";
import { getCryptoStrategy } from "./cryptoStrategies";

export type RobotMode = "spot" | "futures";
export type MarginMode = "isolated" | "cross";
export type FuturesDirection = "LONG" | "SHORT" | "BOTH";

export interface CryptoRobot {
  id: string;
  name: string;
  symbol: string; // ex: "BTCUSDT"
  interval: string; // 1m | 5m | 15m | 1h | 4h
  strategyId: string;
  /** Mercado operado. Default: "futures". Robôs Spot antigos (legado) continuam válidos. */
  mode: RobotMode;
  /** Direção permitida. Spot: BUY (SELL = fechar). Futuros: LONG/SHORT/BOTH. */
  direction?: FuturesDirection | "BUY";
  /** Alavancagem (futuros apenas, 1–125). Spot: sempre 1 (omitido). */
  leverage?: number;
  /** Modo de margem (futuros apenas). */
  marginMode?: MarginMode;
  /** Hedge mode (futuros): permite LONG+SHORT simultâneos. Default false (one-way). */
  hedge?: boolean;
  /** Se true, evita abrir posição perto do funding quando fundingRate alto. */
  fundingAware?: boolean;
  /** Funding máximo tolerado (% por intervalo, ex: 0.05 = 0.05%). Acima disso, pausa entradas. */
  maxFundingRatePct?: number;
  capitalAllocated: number;
  stakePerEntry: number;
  acctStopGainPct: number;
  acctStopLossPct: number;
  maxPositions: number;
  cooldownMin: number;
  active: boolean;
  createdAt: number;
  lastEntryAt: number | null;
  stoppedReason: string | null;
}

export type NewCryptoRobot = Omit<
  CryptoRobot,
  "id" | "createdAt" | "lastEntryAt" | "stoppedReason" | "active"
> & { active?: boolean };

export const CRYPTO_INTERVALS = ["1m", "5m", "15m", "1h", "4h"] as const;
const LEGACY_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

export const FUTURES_LEVERAGE_MIN = 1;
export const FUTURES_LEVERAGE_MAX = 125;
export const DEFAULT_FUTURES_LEVERAGE = 5;
export const DEFAULT_MAX_FUNDING_RATE_PCT = 0.05;

/** Valida a config ANTES de criar/arrancar. Devolve lista de erros (vazia = ok). */
export function validateRobotConfig(r: NewCryptoRobot): string[] {
  const errs: string[] = [];
  if (!r.name.trim()) errs.push("Nome obrigatório.");
  if (!r.symbol) errs.push("Par obrigatório.");
  if (!(LEGACY_INTERVALS as readonly string[]).includes(r.interval))
    errs.push("Timeframe inválido (use 1m/5m/15m/1h/4h).");
  if (!getCryptoStrategy(r.strategyId)) errs.push("Estratégia desconhecida.");
  const mode: RobotMode = r.mode ?? "futures";
  if (mode !== "spot" && mode !== "futures") errs.push("Modo inválido (spot|futures).");

  // Direção por modo
  if (mode === "spot") {
    if (r.direction && r.direction !== ("BUY" as string) && r.direction !== "BOTH" && (r.direction as string) !== "LONG")
      errs.push("Spot opera apenas BUY (SELL = fechar posição).");
    if (r.leverage !== undefined && r.leverage !== 1)
      errs.push("Spot não usa alavancagem (leverage deve ser omitido ou 1).");
    if (r.marginMode !== undefined)
      errs.push("Spot não usa marginMode (apenas futuros).");
    if (r.hedge)
      errs.push("Spot não usa hedge (apenas futuros).");
  } else {
    const lev = r.leverage ?? DEFAULT_FUTURES_LEVERAGE;
    if (!Number.isFinite(lev) || lev < FUTURES_LEVERAGE_MIN || lev > FUTURES_LEVERAGE_MAX)
      errs.push(`Leverage inválido (futuros: ${FUTURES_LEVERAGE_MIN}–${FUTURES_LEVERAGE_MAX}x).`);
    if (r.marginMode && r.marginMode !== "isolated" && r.marginMode !== "cross")
      errs.push("marginMode inválido (isolated|cross).");
    if (r.direction && !["LONG", "SHORT", "BOTH"].includes(r.direction as string))
      errs.push("Direção de futuros inválida (LONG|SHORT|BOTH).");
    if (r.maxFundingRatePct !== undefined && (!Number.isFinite(r.maxFundingRatePct) || r.maxFundingRatePct < 0))
      errs.push("maxFundingRatePct inválido.");
  }

  if (!Number.isFinite(r.capitalAllocated) || r.capitalAllocated <= 0)
    errs.push("Capital alocado deve ser > 0.");
  if (!Number.isFinite(r.stakePerEntry) || r.stakePerEntry <= 0)
    errs.push("Stake por entrada deve ser > 0.");
  if (
    Number.isFinite(r.capitalAllocated) &&
    Number.isFinite(r.stakePerEntry) &&
    r.stakePerEntry > r.capitalAllocated
  )
    errs.push("Stake por entrada não pode exceder o capital alocado.");
  if (!Number.isFinite(r.acctStopGainPct) || r.acctStopGainPct <= 0)
    errs.push("Stop-gain da conta (%) obrigatório e > 0.");
  if (!Number.isFinite(r.acctStopLossPct) || r.acctStopLossPct <= 0)
    errs.push("Stop-loss da conta (%) obrigatório e > 0.");
  if (!Number.isInteger(r.maxPositions) || r.maxPositions < 1 || r.maxPositions > 5)
    errs.push("Nº máximo de posições: 1 a 5.");
  if (!Number.isFinite(r.cooldownMin) || r.cooldownMin < 0)
    errs.push("Cooldown (min) inválido.");
  return errs;
}

/** Normaliza defaults por modo (leverage/margin/funding). */
export function normalizeRobotDefaults(r: NewCryptoRobot): NewCryptoRobot {
  const mode = r.mode ?? "futures";
  if (mode === "spot") {
    const { leverage: _l, marginMode: _m, hedge: _h, ...rest } = r as Record<string, unknown>;
    return { ...rest, mode: "spot", direction: (r.direction as FuturesDirection | "BUY" | undefined) ?? "BUY" } as NewCryptoRobot;
  }
  return {
    ...r,
    mode: "futures",
    direction: (r.direction as FuturesDirection | undefined) ?? "BOTH",
    leverage: r.leverage ?? DEFAULT_FUTURES_LEVERAGE,
    marginMode: r.marginMode ?? "isolated",
    hedge: r.hedge ?? false,
    fundingAware: r.fundingAware ?? true,
    maxFundingRatePct: r.maxFundingRatePct ?? DEFAULT_MAX_FUNDING_RATE_PCT,
  } as NewCryptoRobot;
}

interface CryptoRobotsStore {
  robots: CryptoRobot[];
  createRobot: (r: NewCryptoRobot) => { ok: boolean; reason?: string; id?: string };
  updateRobot: (id: string, patch: Partial<CryptoRobot>) => void;
  removeRobot: (id: string) => void;
  /** Ao ligar, revalida a config (protege contra localStorage adulterado). */
  setActive: (id: string, active: boolean, stoppedReason?: string | null) => boolean;
  markEntry: (id: string, ts?: number) => void;
}

export const useCryptoRobots = create<CryptoRobotsStore>()(
  persist(
    (set, get) => ({
      robots: [],

      createRobot: (r) => {
        const normalized = normalizeRobotDefaults({ mode: "futures", ...r });
        const errs = validateRobotConfig(normalized);
        if (errs.length > 0) return { ok: false, reason: errs[0] };
        const id = uid("crobot");
        const robot: CryptoRobot = {
          ...normalized,
          id,
          active: r.active ?? false,
          createdAt: Date.now(),
          lastEntryAt: null,
          stoppedReason: null,
        };
        set((s) => ({ robots: [robot, ...s.robots] }));
        return { ok: true, id };
      },

      updateRobot: (id, patch) =>
        set((s) => ({
          robots: s.robots.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      removeRobot: (id) => set((s) => ({ robots: s.robots.filter((r) => r.id !== id) })),

      setActive: (id, active, stoppedReason = null) => {
        if (active) {
          const r = get().robots.find((x) => x.id === id);
          if (!r) return false;
          const errs = validateRobotConfig({ ...r, mode: r.mode ?? "futures" });
          if (errs.length > 0) {
            set((s) => ({
              robots: s.robots.map((x) =>
                x.id === id ? { ...x, active: false, stoppedReason: errs[0] } : x
              ),
            }));
            return false;
          }
        }
        set((s) => ({
          robots: s.robots.map((r) =>
            r.id === id ? { ...r, active, stoppedReason: active ? null : stoppedReason } : r
          ),
        }));
        return true;
      },

      markEntry: (id, ts) =>
        set((s) => ({
          robots: s.robots.map((r) => (r.id === id ? { ...r, lastEntryAt: ts ?? Date.now() } : r)),
        })),
    }),
    { name: "quantern:crypto-robots" }
  )
);
