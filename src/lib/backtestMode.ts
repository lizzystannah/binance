// ─── Modo Backtest (interruptor global) ──────────────────────────────────────
// Ligado em Configurações. Quando ativo, a página Trading passa a mostrar o
// gráfico em modo backtest: corre a estratégia ligada sobre klines fechadas e
// desenha as entradas/saídas no gráfico. Persiste entre sessões.

import { create } from "zustand";
import { persist } from "zustand/middleware";

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

/** Marcador de trade desenhado no gráfico (índices da lista de velas). */
export interface ChartMarker {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  side: "LONG" | "SHORT";
  pnl: number;
  reason: string;
}
