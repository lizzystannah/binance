// ─── Motor cripto (headless): TP/SL, limites e robôs por polling ────────────
// Montado uma vez na página Cripto. Lê preços/velas públicos da Binance e
// executa APENAS sobre a conta paper. Conta real (Fase 4) nunca é tocada aqui.

import { useEffect, useRef } from "react";
import {
  fetchKlines,
  fetchLastPrice,
  fetchSpotUsdtSymbols,
  validateSpotOrderQty,
  type BinanceSpotSymbol,
} from "@/lib/binance";
import {
  CRYPTO_FEE_RATE,
  CRYPTO_SLIPPAGE_RATE,
  realizedPnl,
  lockedCost,
  unrealizedPnl,
  useCryptoPaper,
} from "@/lib/cryptoPaper";
import { getCryptoStrategy, validateSpotSignal, type CryptoSpotCandle } from "@/lib/cryptoStrategies";
import { useCryptoRobots } from "@/lib/cryptoRobots";

export interface CryptoEngineStatus {
  lastRun: number | null;
  note: string;
}

const PRICE_TICK_MS = 20_000;
const ROBOT_EVERY_N_TICKS = 3; // robôs avaliados a cada ~60s

export function CryptoEngine({ onStatus }: { onStatus?: (s: CryptoEngineStatus) => void }) {
  const statusRef = useRef<CryptoEngineStatus>({ lastRun: null, note: "Motor parado." });
  const symbolsRef = useRef<BinanceSpotSymbol[] | null>(null);

  useEffect(() => {
    let stopped = false;
    let running = false;
    let tick = 0;

    const emit = (note: string) => {
      statusRef.current = { lastRun: Date.now(), note };
      onStatus?.(statusRef.current);
    };

    const ensureSymbols = async () => {
      if (!symbolsRef.current) {
        try {
          symbolsRef.current = await fetchSpotUsdtSymbols();
        } catch {
          symbolsRef.current = null;
        }
      }
      return symbolsRef.current;
    };

    const run = async () => {
      if (running || stopped) return;
      running = true;
      try {
        tick += 1;
        const paper = useCryptoPaper.getState();
        const bots = useCryptoRobots.getState();

        const symbols = new Set<string>();
        paper.positions.forEach((p) => symbols.add(p.symbol));
        paper.pending.forEach((o) => symbols.add(o.symbol));
        bots.robots.filter((r) => r.active).forEach((r) => symbols.add(r.symbol));
        if (symbols.size === 0) {
          emit("Sem posições, pendentes ou robôs ativos.");
          return;
        }

        // 1. Preços atuais → TP/SL + fills de limites.
        const marks: Record<string, number> = {};
        await Promise.all(
          [...symbols].map(async (s) => {
            try {
              marks[s] = await fetchLastPrice(s);
            } catch {
              /* símbolo sem cotação: motor ignora nesta ronda */
            }
          })
        );
        const bars: Record<string, { high: number; low: number }> = {};
        for (const [s, p] of Object.entries(marks)) bars[s] = { high: p, low: p };
        const closed = paper.evaluateAtBars(bars);

        // 2. Robôs (a cada ~60s): stop da conta + sinais.
        if (tick % ROBOT_EVERY_N_TICKS === 0) {
          const exchange = await ensureSymbols();
          for (const robot of bots.robots.filter((r) => r.active)) {
            const st = useCryptoPaper.getState();
            const unreal = unrealizedPnl(st.positions, marks, robot.id);
            const real = realizedPnl(st.history, robot.id);
            const equity = robot.capitalAllocated + real + unreal;
            if (equity >= robot.capitalAllocated * (1 + robot.acctStopGainPct / 100)) {
              for (const p of st.positions.filter((x) => x.robotId === robot.id)) {
                const m = marks[p.symbol];
                if (Number.isFinite(m)) st.closePosition(p.id, m, "ACCOUNT_STOP");
              }
              bots.setActive(robot.id, false, "Meta de ganho da conta atingida.");
              continue;
            }
            if (equity <= robot.capitalAllocated * (1 - robot.acctStopLossPct / 100)) {
              for (const p of st.positions.filter((x) => x.robotId === robot.id)) {
                const m = marks[p.symbol];
                if (Number.isFinite(m)) st.closePosition(p.id, m, "ACCOUNT_STOP");
              }
              bots.setActive(robot.id, false, "Stop-loss da conta atingido.");
              continue;
            }

            // Cooldown + máximo de posições.
            const fresh = useCryptoPaper.getState();
            const openCount = fresh.positions.filter((p) => p.robotId === robot.id).length;
            if (openCount >= robot.maxPositions) continue;
            if (
              robot.lastEntryAt &&
              Date.now() - robot.lastEntryAt < robot.cooldownMin * 60_000
            )
              continue;

            const strategy = getCryptoStrategy(robot.strategyId);
            if (!strategy) {
              bots.setActive(robot.id, false, "Estratégia desconhecida.");
              continue;
            }
            let klines;
            try {
              const raw = await fetchKlines(robot.symbol, robot.interval, 250);
              // Remove a vela em formação: só velas FECHADAS alimentam o sinal.
              klines = raw.slice(0, -1).map(
                (k): CryptoSpotCandle => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v })
              );
            } catch {
              continue;
            }
            if (klines.length < strategy.minCandles) continue;
            const ctxCloses = klines.map((k) => k.c);
            let sig = null;
            try {
              sig = strategy.onSignal({
                symbol: robot.symbol,
                interval: robot.interval,
                klines,
                closes: ctxCloses,
                lastClose: ctxCloses[ctxCloses.length - 1],
              });
            } catch {
              sig = null;
            }
            const valid = validateSpotSignal(sig, strategy.minCandles, klines.length);
            if (!sig || !valid.ok || sig.action !== "BUY") continue;

            const mark = marks[robot.symbol];
            if (!Number.isFinite(mark) || mark <= 0) continue;
            const fill = mark * (1 + CRYPTO_SLIPPAGE_RATE);
            const qty = robot.stakePerEntry / fill;
            // Filtros do exchange (LOT_SIZE/NOTIONAL) antes de qualquer entrada.
            if (exchange) {
              const spec = exchange.find((e) => e.symbol === robot.symbol);
              if (spec && !validateSpotOrderQty(spec, fill, qty).ok) continue;
            }
            const robotFree =
              robot.capitalAllocated - lockedCost(fresh.positions, robot.id);
            if (robotFree < robot.stakePerEntry) continue;
            // Custo real ≈ stake + taxa de entrada: sem isto o store rejeita
            // por 0,1% quando o saldo está à justa (ordem condenada).
            if (fresh.usdtFree < robot.stakePerEntry * (1 + CRYPTO_FEE_RATE)) continue;

            const res = fresh.openMarketLong({
              symbol: robot.symbol,
              markPrice: mark,
              qty,
              stopGainPct: sig.stopGainPct,
              stopLossPct: sig.stopLossPct,
              timeframe: robot.interval,
              strategyId: robot.strategyId,
              robotId: robot.id,
            });
            if (res.ok) bots.markEntry(robot.id);
          }
        }

        emit(
          closed.length > 0
            ? `${closed.length} posição(ões) fechada(s) por TP/SL.`
            : `Ronda ok — ${symbols.size} símbolo(s) avaliado(s).`
        );
      } catch (e) {
        emit(e instanceof Error ? `Erro: ${e.message}` : "Erro desconhecido.");
      } finally {
        running = false;
      }
    };

    run();
    const iv = setInterval(run, PRICE_TICK_MS);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [onStatus]);

  return null;
}
