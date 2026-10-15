// ─── Modo Backtest (interruptor global) + resultados do último backtest ───────
// O modo é ligado em Configurações. Quando ativo, a página Trading mostra o
// gráfico em modo backtest: corre a estratégia ligada sobre klines fechadas e
// desenha entradas/saídas (e as faixas de TP/SL) no gráfico. A página de
// Estatísticas lê o último resultado guardado aqui.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CryptoBacktestResult } from "@/lib/cryptoBacktest";

interface BacktestModeStore {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useBacktestMode = create<BacktestModeStore>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (v) => set({ enabled: v }),
    }),
    { name: "quantterm:backtest-mode" }
  )
);

/** Marcador de trade desenhado no gráfico (índices da lista de velas atual). */
export interface ChartMarker {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  side: "LONG" | "SHORT";
  pnl: number;
  reason: string;
}

/** Resultado completo de uma corrida de backtest (gráfico + estatísticas). */
export interface BacktestRun {
  id: string;
  ranAt: number;
  symbol: string;
  interval: string;
  strategyId: string;
  strategyName: string;
  direction: string;
  capital: number;
  stakePerEntry: number;
  leverage: number;
  /** Spread bid-ask usado (%), se disponível. */
  spreadPct?: number;
  result: CryptoBacktestResult;
  /** Tempo (ms) das velas de entrada/saída — usado p/ mapear marcadores. */
  times: { entry: number; exit: number }[];
}

interface BacktestResultsStore {
  last: BacktestRun | null;
  history: BacktestRun[];
  setLast: (r: BacktestRun) => void;
  clear: () => void;
}

export const useBacktestResults = create<BacktestResultsStore>()((set) => ({
  last: null,
  history: [],
  setLast: (r) =>
    set((s) => ({ last: r, history: [r, ...s.history].slice(0, 20) })),
  clear: () => set({ last: null }),
}));
