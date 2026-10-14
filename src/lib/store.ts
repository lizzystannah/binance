import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type StrategyFilterValue, mergeStrategyFilters } from "@/lib/strategyFilters";
import { getTradingDay, mergeTradeArrays, mergeSingleTrade } from "@/lib/utils";

export type Trade = {
  id: string;
  asset: string;
  type: "CALL" | "PUT" | "BUY" | "SELL";
  amount: number;
  entry: number;
  exit?: number;
  payout?: number;
  result?: "WIN" | "LOSS" | "OPEN";
  pnl?: number;
  ts: number;
  entryTime?: number;
  durationS: number;
  mode: "demo" | "real" | "backtest";
  entryCandleIdx?: number;
  expiryCandles?: number;
  indicator?: string;
  snapshot?: Record<string, unknown>;
  strategyId?: string;
  /** Custom stats from strategy — each key is a stat category */
  customStats?: Record<string, string | number | boolean>;
  /** Timeframe used (e.g. "1m", "5m") */
  timeframe?: string;
  /** Robot ID that placed this trade (for attribution) */
  robotId?: string;
  /** True if this trade was placed in warmup mode (before entry condition was met) */
  warmup?: boolean;
  /** Meta-robot flag to indicate validation/supervision was active */
  metaActive?: boolean;
};

/**
 * Verifica o filtro VD escaneando os últimos 15 trades fechados.
 * Detecta padrão VDVD (Vitória → Derrota → Vitória → Derrota) no histórico.
 * Se VDVD encontrado e não houve 2 vitórias consecutivas após ele → paused.
 * @param trades Lista de trades para escanear
 * @returns Estado do filtro VD: isPausedByVD, waitingForWins, vdCycle
 */
export function checkVdFilter(trades: (Trade | ManagementTrade)[]): {
  isPausedByVD: boolean;
  waitingForWins: number;
  vdCycle: string;
} {
  // Últimos 15 trades fechados, ordenados por timestamp ascendente
  const recent = [...trades]
    .filter(t => t.result && t.result !== "OPEN")
    .sort((a, b) => a.ts - b.ts)
    .slice(-15);

  // Mapear cada trade para o padrão VDVD:
  // V = (isShadow || warmup) + WIN
  // D = !(isShadow || warmup) + LOSS
  // X = qualquer outra combinação
  const pattern = recent.map((t: any) => {
    const isShadow = !!(t.isShadow || t.warmup);
    if (isShadow && t.result === "WIN") return "V";
    if (!isShadow && t.result === "LOSS") return "D";
    return "X";
  }).join("");

  const vdCycle = pattern.slice(-4);
  const vdvdIndex = pattern.lastIndexOf("VDVD");

  if (vdvdIndex === -1) {
    return { isPausedByVD: false, waitingForWins: 0, vdCycle };
  }

  // Depois do padrão VDVD, verificar se já houve 2 vitórias consecutivas (qualquer tipo)
  const afterVdvd = recent.slice(vdvdIndex + 4);
  const winPattern = afterVdvd.map((t: any) => t.result === "WIN" ? "V" : "D").join("");

  if (winPattern.includes("VV")) {
    return { isPausedByVD: false, waitingForWins: 0, vdCycle };
  }

  const trailingWins = winPattern.match(/V*$/)?.[0].length || 0;
  return { isPausedByVD: true, waitingForWins: trailingWins, vdCycle };
}

export type ManagementTrade = {
  id: string;
  robotId: string;
  robotName: string;
  asset: string;
  type: "CALL" | "PUT";
  amount: number;
  result: "WIN" | "LOSS" | "OPEN";
  pnl: number;
  ts: number;
  mode: "demo" | "real";
  isShadow: boolean; // True se foi um trade de sombra (demo/warmup), false se foi entrada real
};

export type SRLine = { id: string; asset: string; price: number; kind: "support" | "resistance" };

export type TrendLine = { id: string; asset: string; t1: number; p1: number; t2: number; p2: number; kind: "support" | "resistance" };

export type SRZone = { id: string; asset: string; topPrice: number; bottomPrice: number; kind: "buy_zone" | "sell_zone" };

export type TradingMode = "demo" | "real" | "backtest";
export type AutomationMode = "manual" | "semi-auto" | "auto";

export type RiskConfig = {
  enabled: boolean;
  stopLoss: number;
  takeProfit: number;
  defaultStake: number;
  stopAfterLosses: number;
  stopAfterWins: number;
  entryAfterWin: boolean;
  entryAfterLoss: boolean;
};

export type ManagementConfig = {
  enabled: boolean;
  dailyGoal: number;
  dailyStopLoss: number;

  // Operational Filters
  rsiFilter: boolean;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;

  maFilter: boolean;
  maPeriod: number;
  maType: "sma" | "ema";

  macFilter: boolean; // Moving Average Cross
  macShortPeriod: number;
  macLongPeriod: number;

  adxFilter: boolean;
  adxPeriod: number;
  adxThreshold: number;

  // Pattern filters (VDV)
  vdvFilter: boolean; // Win-Loss-Win-Loss pause
  vdvPaused: boolean;
  vdvWinsCount: number; // Tracking wins to restart (needs 2 wins to restart)

  // Strategy sequencing
  entryAfterWin: boolean;
  entryAfterLoss: boolean;

  currentDailyPnl: number;
  lastResetDate: string; // YYYY-MM-DD
};

/** Binance Futures (perp USDT-M) — única fonte de verdade para futuros. */
export type BinanceFuturesConfig = {
  /** Guardada no store local; o segredo real deve viver no env do servidor. */
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  defaultLeverage: number;
  marginMode: "cross" | "isolated";
  hedgeMode: boolean;
  defaultOrderType: "limit" | "market";
  /** Risco por trade em % da banca (ex: 1 = 1%). */
  riskPercentPerTrade: number;
};

/** Estado de uma sequência automática ativa para um ativo específico */
export type SequenceState = {
  active: boolean;
  action: "CALL" | "PUT" | "BUY" | "SELL";
  corEsperada: "verde" | "vermelha";
  expiryCandles: number | string;
  stake: number;
  maxEntradas: number;
  /**
   * @deprecated Reservado para uso futuro. Nunca lido pelos engines (backtest/robotEngine/serverEngine).
   * Mantido no tipo para compatibilidade com snapshots antigos em MySQL/JSON.
   * Fix A: a sequência actualmente pára em maxEntradas ou cor errada — não há lógica de stopOnLoss activa.
   */
  stopOnLoss: boolean;
  totalEntradas: number;
  /** ID do último trade processado — usado para detetar novos trades fechados */
  ultimoTradeId: string | undefined;
  /**
   * Fix C: timestamp do candle onde entrou a última entrada da sequência.
   * Usado pelos engines live (robotEngine/serverEngine) para impor 1-candle gap
   * entre entradas consecutivas (já existia como `ultimoEntryCandleIdx` no backtest).
   */
  ultimoEntryCandleTs?: number;
};

export type RobotConfig = {
  id: string;
  name: string;
  /** Strategy ID this robot was created from */
  strategyId: string;
  /** Snapshot of the strategy script filename */
  strategyFileName: string;
  /** Snapshot of the filters at creation time */
  filters: Record<string, StrategyFilterValue>;
  /** Whether global invert was active */
  globalInvert: boolean;
  /** Inversão adicional ao nível do robô — aplicada APÓS a geração do sinal,
   *  no momento da execução do trade. Diferente do globalInvert (que age dentro
   *  do pipeline de filtros), esta inversão só troca CALL↔PUT no envio para a API.
   *  @temporary Esta é uma solução paliativa. O trigger de ordens pendentes deve
   *  ser corrigido para usar a posição do preço vs alvo em vez da ação (CALL/PUT),
   *  eliminando a necessidade de duas camadas de inversão. */
  robotInvert?: boolean;
  /** Permitted trade direction: all, buy, or sell */
  strategyDirection?: "all" | "buy" | "sell";
  /** Sequence config for automatic sequential entries */
  sequenceConfig?: {
    enabled: boolean;
    maxEntradas: number;
    startLevel?: number;
    onlyReal?: boolean;
    sequenceInvert?: boolean;
    ignoreMainSignal?: boolean;
    levelModes?: Record<number, "normal" | "skip" | "invert" | "invert_sell" | "invert_buy" | "only_sell" | "only_buy">;
  };
  /** Robot active state */
  active: boolean;
  /** Demo or Real trading */
  mode: "demo" | "real";
  /** Timeframe for candle reading (e.g. "1m", "5m", "15m", "1h") */
  timeframe: string;
  /** Trade duration in candles (can be fractional like "1/2" or decimal) */
  durationCandles: number | string;
  /** Meta-robot control state for Robot Analysis page */
  metaControl?: {
    active: boolean;
    invert: boolean;
    balance: number;
  };
  /** Assets to trade (from strategy filters) */
  assets: string[];
  /** Main Daily Goal */
  dailyGoal?: number;
  /** Main Daily Stop Loss */
  dailyStopLoss?: number;
  /** Management settings (Binance flow: fixed stake only) */
  management: {
    active?: boolean;
    account?: "demo" | "real";
    mode: "fixed" | "soros" | "reinvest" | "martingale";
    stake: number;
    dailyGoal: number;
    dailyStopLoss: number;
    entryAfterWin: boolean;
    entryAfterLoss?: boolean;
    vdFilter: boolean;
  };
  /** Management state (Shadow trading & Cycles) */
  managementState: {
    lastDemoResult: "WIN" | "LOSS" | null;
    vdCycle: string; // "", "V", "VD", "VDV", "VDVD"
    isPausedByVD: boolean;
    waitingForWins: number; // 0, 1, 2
    currentDailyPnl: number;
    totalPnl: number;
    lastResetDate: string;
    isManagementStoppedToday?: boolean;
    mgmtCurrentDailyPnl?: number;
    mgmtTotalPnl?: number;
    mgmtResetTimestamp?: number;
    progressionTable?: Array<{ level: number; stake: number; profit: number; timestamp: number }>;
  };
  /** Last trade result for strategy sequencing (Entry after win/loss) */
  lastTradeResult: "WIN" | "LOSS" | null;
  /** Current compounded stake (Soros/Reinvest) */
  currentStake: number;
  /** True while entry condition (entryAfterWin) has not yet been met.
   *  In this state the robot trades on DEMO with base stake regardless of mode. */
  warmupActive: boolean;
  /** Robot's own trade history */
  trades: Trade[];
  /** Management specific trade history from server */
  managementTrades?: ManagementTrade[];
  /** Creation timestamp */
  createdAt: number;
  /** Estado de sequência automática ativa, keyed por asset */
  sequenceState?: Record<string, SequenceState>;
};

export type ChatMessage = {
  role: string;
  content: string;
  ts?: number;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
};

export type AiConfig = {
  provider: "openai" | "anthropic" | "ollama" | "mcp" | "gemini" | "custom" | "openrouter";
  baseUrl: string;
  apiKey: string;
  model: string;
  mcpUrl: string;
};

type Store = {
  // Trading mode: demo, real, or backtest
  tradingMode: TradingMode;
  setTradingMode: (m: TradingMode) => void;

  // Automation mode
  automationMode: AutomationMode;
  setAutomationMode: (m: AutomationMode) => void;

  // Sidebar visibility
  assetsSidebarOpen: boolean;
  toggleAssetsSidebar: () => void;

  account: "demo" | "real";
  setAccount: (a: "demo" | "real") => void;

  balance: number;
  addPnl: (v: number) => void;
  setBalance: (v: number) => void;

  trades: Trade[];
  addTrade: (t: Trade) => void;
  updateTrade: (id: string, updates: Partial<Trade>) => void;
  resetTrades: (mode?: TradingMode) => void;

  srLines: SRLine[];
  srZones: SRZone[];
  trendLines: TrendLine[];
  showSRLines: boolean;
  setShowSRLines: (v: boolean) => void;
  addSR: (s: SRLine) => void;
  updateSR: (id: string, updates: Partial<SRLine>) => void;
  removeSR: (id: string) => void;
  addSRZone: (z: SRZone) => void;
  updateSRZone: (id: string, updates: Partial<SRZone>) => void;
  removeSRZone: (id: string) => void;
  addTrendLine: (t: TrendLine) => void;
  updateTrendLine: (id: string, updates: Partial<TrendLine>) => void;
  removeTrendLine: (id: string) => void;
  clearSR: (asset: string) => void;
  clearAllSR: () => void;

  timeframe: string;
  setTimeframe: (v: string) => void;

  operationalTimeframe: string;
  setOperationalTimeframe: (v: string) => void;

  risk: RiskConfig;
  setRisk: (r: Partial<RiskConfig>) => void;

  management: ManagementConfig;
  setManagement: (m: Partial<ManagementConfig>) => void;
  resetDailyPnl: () => void;

  binanceFutures: BinanceFuturesConfig;
  setBinanceFutures: (f: Partial<BinanceFuturesConfig>) => void;

  redis: { host: string; port: string; key: string; password?: string };
  setRedis: (r: Partial<{ host: string; port: string; key: string; password?: string }>) => void;

  serverLatency: number | null;
  setServerLatency: (v: number | null) => void;
  workerLatency: number | null;
  setWorkerLatency: (v: number | null) => void;
  localLatency: number | null;
  setLocalLatency: (v: number | null) => void;

  activeStrategyId: string | null;
  setActiveStrategyId: (id: string | null) => void;

  lastSelectedAsset: string | null;
  setLastSelectedAsset: (asset: string) => void;

  customBacktestData: Record<string, unknown[]>;
  setCustomBacktestData: (asset: string, candles: unknown[]) => void;

  /** Imported robot context for Stats -> Strategies flow */
  importedRobotId: string | null;
  importedRobotName: string | null;
  importedRobotStrategyId: string | null;
  importedRobotFilters: Record<string, StrategyFilterValue> | null;
  importedRobotGlobalInvert: boolean | null;
  importedRobotStrategyDirection: ("all" | "call_only" | "put_only" | "buy" | "sell") | null;
  importedRobotSequenceConfig: any | null;
  clearImportedRobot: () => void;

  /** Per-strategy filter configurations, keyed by strategyId */
  strategyFilters: Record<string, Record<string, StrategyFilterValue>>;
  setStrategyFilter: (strategyId: string, filterKey: string, value: StrategyFilterValue) => void;
  setAllStrategyFilters: (strategyId: string, filters: Record<string, StrategyFilterValue>) => void;
  clearStrategyFilters: (strategyId: string) => void;

  /** Global invert toggle per strategy — reverses ALL signals */
  strategyInvert: Record<string, boolean>;
  setStrategyInvert: (strategyId: string, invert: boolean) => void;

  /** Permitted direction per strategy — limit to buy, sell, or all */
  strategyDirection: Record<string, "all" | "buy" | "sell">;
  setStrategyDirection: (strategyId: string, direction: "all" | "buy" | "sell") => void;

  /** Sequence config per strategy — toggle + max entries + advanced per-level options */
  strategySequenceConfig: Record<string, {
    enabled: boolean;
    maxEntradas: number;
    /** Primeiro nível (1..maxEntradas) a operar como real; níveis anteriores são sombra. Default 1. */
    startLevel?: number;
    /** Se true, apenas o nível startLevel é real; o resto é sombra. Default false. */
    onlyReal?: boolean;
    /** Se true, inverte CALL↔PUT nas entradas #2..N da sequência (o trigger #1 mantém a lógica da estratégia). */
    sequenceInvert?: boolean;
    /** Se true, ignora a operação principal (sinal da estratégia) e executa apenas a sequência. */
    ignoreMainSignal?: boolean;
    /** Modo individual por nível (1..maxEntradas): normal, skip, invert, invert_sell, invert_buy, only_sell, only_buy. */
    levelModes?: Record<number, "normal" | "skip" | "invert" | "invert_sell" | "invert_buy" | "only_sell" | "only_buy">;
  }>;
  setStrategySequenceConfig: (strategyId: string, config: {
    enabled: boolean;
    maxEntradas: number;
    startLevel?: number;
    onlyReal?: boolean;
    sequenceInvert?: boolean;
    ignoreMainSignal?: boolean;
    levelModes?: Record<number, "normal" | "skip" | "invert" | "invert_sell" | "invert_buy" | "only_sell" | "only_buy">;
  }) => void;

  /** Production robots */
  robots: RobotConfig[];
  addRobot: (robot: RobotConfig) => void;
  updateRobot: (id: string, updates: Partial<RobotConfig>) => void;
  removeRobot: (id: string) => void;
  /** History of all management-triggered trades */
  managementHistory: ManagementTrade[];
  /** Stats per robot for the management page */
  managementStats: Record<string, {
    totalTrades: number;
    wins: number;
    losses: number;
    pnl: number;
  }>;
  clearManagementHistory: (robotId?: string) => void;
  addManagementTrade: (trade: ManagementTrade) => void;
  addRobotTrade: (robotId: string, trade: Trade) => void;
  updateRobotTrade: (robotId: string, tradeId: string, updates: Partial<Trade>) => void;
  resetRobotDaily: (robotId: string) => void;
  resetManagementDaily: (robotId: string) => void;
  importRobotTrades: (robotId: string) => void;
  replaceRobotTradesToStats: (robotId: string) => void;
  importMetaTradesToStats: (robotId: string) => void;
  /**
   * Limpa completamente o histórico de operações de um robô.
   * Repõe também os contadores de PnL a zero.
   * FIX: anteriormente não persistia corretamente porque o set() não era chamado
   * de forma atómica — agora usa uma única chamada set() com todos os campos.
   */
  clearRobotTrades: (robotId: string) => void;
  clearAllTrades: () => void;
  /** Chats AI store */
  chats: ChatSession[];
  activeChatId: string | null;
  createChat: (title?: string) => string;
  deleteChat: (id: string) => void;
  setActiveChatId: (id: string | null) => void;
  addMessageToChat: (chatId: string, message: ChatMessage) => void;
  clearChatHistory: (chatId: string) => void;
  chatLoading: boolean;
  setChatLoading: (loading: boolean) => void;
  /** Server sync */
  refreshRobots: () => Promise<void>;
  /** Real-time quick state from Redis/WebSocket */
  robotQuickStates: Record<string, any>;
  updateRobotQuickState: (robotId: string, state: any) => void;
  orchestratorState: any | null;
  fetchOrchestratorState: () => Promise<void>;
  updateOrchestratorConfigInStore: (updates: any) => Promise<void>;
  resetOrchestratorDailyInStore: () => Promise<void>;
  setOrchestratorState: (state: any) => void;
  aiConfig: AiConfig;
  setAiConfig: (config: Partial<AiConfig>) => void;
};

const _updateRobotTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _pendingRobotUpdates = new Map<string, any>();

function scheduleRobotSync(id: string, payload: any) {
  const existing = _pendingRobotUpdates.get(id) || {};
  const merged = {
    config: { ...(existing.config || {}), ...(payload.config || {}) },
    ...(existing.trades || payload.trades ? { trades: payload.trades !== undefined ? payload.trades : existing.trades } : {}),
    ...(existing.managementState || payload.managementState ? { managementState: payload.managementState !== undefined ? payload.managementState : existing.managementState } : {})
  };
  _pendingRobotUpdates.set(id, merged);

  if (_updateRobotTimers.has(id)) {
    clearTimeout(_updateRobotTimers.get(id)!);
  }

  const timer = setTimeout(() => {
    _updateRobotTimers.delete(id);
    const dataToSend = _pendingRobotUpdates.get(id);
    _pendingRobotUpdates.delete(id);
    if (!dataToSend) return;

    fetch("/api/robots/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        robots: {
          [id]: dataToSend
        }
      })
    }).catch(err => console.error("[Store] Failed to update robot config on VPS:", err));
  }, 400);

  _updateRobotTimers.set(id, timer);
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      aiConfig: {
        provider: "ollama",
        baseUrl: "http://localhost:11434/api/generate",
        apiKey: "",
        model: "llama3",
        mcpUrl: "http://localhost:3000/mcp",
      },
      setAiConfig: (config) => set((s) => ({ aiConfig: { ...s.aiConfig, ...config } })),

      tradingMode: "demo",
      setTradingMode: (m) => set({ tradingMode: m }),

      automationMode: "manual",
      setAutomationMode: (m) => set({ automationMode: m }),

      assetsSidebarOpen: true,
      toggleAssetsSidebar: () => set((s) => ({ assetsSidebarOpen: !s.assetsSidebarOpen })),

      account: "demo",
      setAccount: (a) => set({ account: a }),

      balance: 10000,
      addPnl: (v) => set((s) => {
        const isWin = v > 0;
        const newDailyPnl = s.management.currentDailyPnl + v;

        let newVdvPaused = s.management.vdvPaused;
        let newVdvWinsCount = s.management.vdvWinsCount;

        if (s.management.vdvFilter) {
          if (newVdvPaused) {
            if (isWin) {
              newVdvWinsCount += 1;
              if (newVdvWinsCount >= 2) {
                newVdvPaused = false;
                newVdvWinsCount = 0;
              }
            } else {
              newVdvWinsCount = 0;
            }
          } else {
            const results = s.trades.map(t => t.result).slice(0, 4);
            if (results[0] === "LOSS" && results[1] === "WIN" && results[2] === "LOSS" && results[3] === "WIN") {
              newVdvPaused = true;
              newVdvWinsCount = 0;
            }
          }
        }

        return {
          balance: s.balance + v,
          management: {
            ...s.management,
            currentDailyPnl: newDailyPnl,
            vdvPaused: newVdvPaused,
            vdvWinsCount: newVdvWinsCount
          }
        };
      }),
      setBalance: (v) => set({ balance: v }),

      trades: [],
      addTrade: (t) => set((s) => ({ 
        trades: [t, ...s.trades].slice(0, 500) // Limite maior para histórico global
      })),
      updateTrade: (id, updates) => set((s) => ({ trades: s.trades.map(t => t.id === id ? { ...t, ...updates } : t) })),
      resetTrades: (mode) => set((s) => {
        const remainingTrades = mode ? s.trades.filter(t => t.mode !== mode) : [];
        const isRobotContext = !!s.importedRobotId && remainingTrades.some(t => t.robotId === s.importedRobotId);
        return {
          trades: remainingTrades,
          ...(!isRobotContext ? {
            importedRobotId: null,
            importedRobotName: null,
            importedRobotStrategyId: null,
            importedRobotFilters: null,
            importedRobotGlobalInvert: null,
            importedRobotStrategyDirection: null,
            importedRobotSequenceConfig: null,
          } : {})
        };
      }),

      srLines: [],
      srZones: [],
      trendLines: [],
      showSRLines: true,
      setShowSRLines: (v) => set({ showSRLines: v }),
      addSR: (s) => set((st) => ({ srLines: [...st.srLines, s] })),
      updateSR: (id, updates) => set((st) => ({ srLines: st.srLines.map((l) => l.id === id ? { ...l, ...updates } : l) })),
      removeSR: (id) => set((st) => ({ srLines: st.srLines.filter((l) => l.id !== id) })),
      addSRZone: (z) => set((st) => ({ srZones: [...st.srZones, z] })),
      updateSRZone: (id, updates) => set((st) => ({ srZones: st.srZones.map((z) => z.id === id ? { ...z, ...updates } : z) })),
      removeSRZone: (id) => set((st) => ({ srZones: st.srZones.filter((z) => z.id !== id) })),
      addTrendLine: (t) => set((st) => ({ trendLines: [...(st.trendLines || []), t] })),
      updateTrendLine: (id, updates) => set((st) => ({ trendLines: (st.trendLines || []).map((l) => l.id === id ? { ...l, ...updates } : l) })),
      removeTrendLine: (id) => set((st) => ({ trendLines: (st.trendLines || []).filter((l) => l.id !== id) })),
      clearSR: (asset) => set((st) => ({ srLines: st.srLines.filter((l) => l.asset !== asset), srZones: st.srZones.filter((z) => z.asset !== asset), trendLines: (st.trendLines || []).filter((l) => l.asset !== asset) })),
      clearAllSR: () => set({ srLines: [], srZones: [], trendLines: [] }),

      timeframe: "1m",
      setTimeframe: (v) => set({ timeframe: v, operationalTimeframe: v }),

      operationalTimeframe: "1m",
      setOperationalTimeframe: (v) => set({ operationalTimeframe: v, timeframe: v }),

      risk: {
        enabled: false,
        stopLoss: 200,
        takeProfit: 500,
        defaultStake: 10,
        stopAfterLosses: 2,
        stopAfterWins: 0,
        entryAfterWin: false,
        entryAfterLoss: false,
      },
      setRisk: (r) => set((s) => ({ risk: { ...s.risk, ...r } })),

      management: {
        enabled: false,
        dailyGoal: 50,
        dailyStopLoss: 30,
        rsiFilter: false,
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        maFilter: false,
        maPeriod: 20,
        maType: "sma",
        macFilter: false,
        macShortPeriod: 9,
        macLongPeriod: 21,
        adxFilter: false,
        adxPeriod: 14,
        adxThreshold: 25,
        vdvFilter: false,
        vdvPaused: false,
        vdvWinsCount: 0,
        entryAfterWin: false,
        entryAfterLoss: false,
        currentDailyPnl: 0,
        lastResetDate: getTradingDay(),
      },
      setManagement: (m) => {
        set((s) => {
          const newManagement = { ...s.management, ...m };
          fetch("/api/management/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ management: newManagement })
          }).catch(err => console.error("[Store] Failed to save management config to VPS:", err));
          return { management: newManagement };
        });
      },
      resetDailyPnl: () => {
        set((s) => {
          const newManagement = { ...s.management, currentDailyPnl: 0, vdvPaused: false, vdvWinsCount: 0, lastResetDate: getTradingDay() };
          fetch("/api/management/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ management: newManagement })
          }).catch(err => console.error("[Store] Failed to reset daily PNL on VPS:", err));
          return { management: newManagement };
        });
      },

      binanceFutures: {
        apiKey: "",
        apiSecret: "",
        testnet: true,
        defaultLeverage: 10,
        marginMode: "cross",
        hedgeMode: false,
        defaultOrderType: "market",
        riskPercentPerTrade: 1,
      },
      setBinanceFutures: (f) => set((s) => ({ binanceFutures: { ...s.binanceFutures, ...f } })),

      redis: { host: "127.0.0.1", port: "6379", key: "binance:candles:BTCUSDT", password: "" },
      setRedis: (r) => set((s) => ({ redis: { ...s.redis, ...r } })),

      serverLatency: null,
      setServerLatency: (v) => set({ serverLatency: v }),
      workerLatency: null,
      setWorkerLatency: (v) => set({ workerLatency: v }),
      localLatency: null,
      setLocalLatency: (v) => set({ localLatency: v }),

      activeStrategyId: null,
      setActiveStrategyId: (id) => set({ activeStrategyId: id }),

      lastSelectedAsset: null,
      setLastSelectedAsset: (asset) => set({ lastSelectedAsset: asset }),

      customBacktestData: {},
      setCustomBacktestData: (asset, candles) => set((s) => ({
        customBacktestData: { ...s.customBacktestData, [asset]: candles }
      })),
      setBulkCustomBacktestData: (data) => set((s) => ({
        customBacktestData: { ...s.customBacktestData, ...data }
      })),

      importedRobotId: null,
      importedRobotName: null,
      importedRobotStrategyId: null,
      importedRobotFilters: null,
      importedRobotGlobalInvert: null,
      importedRobotStrategyDirection: null,
      importedRobotSequenceConfig: null,
      clearImportedRobot: () => set({
        importedRobotId: null,
        importedRobotName: null,
        importedRobotStrategyId: null,
        importedRobotFilters: null,
        importedRobotGlobalInvert: null,
        importedRobotStrategyDirection: null,
        importedRobotSequenceConfig: null,
      }),

      strategyFilters: {},
      setStrategyFilter: (strategyId, filterKey, value) => set((s) => ({
        strategyFilters: {
          ...s.strategyFilters,
          [strategyId]: {
            ...(s.strategyFilters[strategyId] || {}),
            [filterKey]: value
          }
        }
      })),
      setAllStrategyFilters: (strategyId, filters) => set((s) => ({
        strategyFilters: {
          ...s.strategyFilters,
          [strategyId]: {
            ...filters
          }
        }
      })),
      clearStrategyFilters: (strategyId) => set((s) => {
        const updatedFilters = { ...s.strategyFilters };
        delete updatedFilters[strategyId];

        const updatedInvert = { ...s.strategyInvert };
        delete updatedInvert[strategyId];

        const updatedDirection = { ...s.strategyDirection };
        delete updatedDirection[strategyId];

        const updatedSeq = { ...s.strategySequenceConfig };
        delete updatedSeq[strategyId];

        const isCurrentImported = s.importedRobotStrategyId === strategyId || s.importedRobotId === strategyId || (s.robots.find(r => r.id === s.importedRobotId)?.strategyId === strategyId);

        return {
          strategyFilters: updatedFilters,
          strategyInvert: updatedInvert,
          strategyDirection: updatedDirection,
          strategySequenceConfig: updatedSeq,
          ...(isCurrentImported ? {
            importedRobotId: null,
            importedRobotName: null,
            importedRobotStrategyId: null,
            importedRobotFilters: null,
            importedRobotGlobalInvert: null,
            importedRobotStrategyDirection: null,
            importedRobotSequenceConfig: null,
          } : {})
        };
      }),

      strategyInvert: {},
      setStrategyInvert: (strategyId, invert) => set((s) => ({
        strategyInvert: { ...s.strategyInvert, [strategyId]: invert }
      })),

      strategyDirection: {},
      setStrategyDirection: (strategyId, direction) => set((s) => ({
        strategyDirection: { ...s.strategyDirection, [strategyId]: direction }
      })),

      strategySequenceConfig: {},
      setStrategySequenceConfig: (strategyId, config) => set((s) => ({
        strategySequenceConfig: { ...s.strategySequenceConfig, [strategyId]: config }
      })),

      managementHistory: [],
      managementStats: {},
      clearManagementHistory: (robotId) => set((s) => {
        if (!robotId) {
          return {
            managementHistory: [],
            managementStats: {},
            robots: (s.robots || []).map(r => ({
              ...r,
              trades: (r.trades || []).filter(t => !t.warmup && !(t as any).isShadow),
              managementState: {
                ...r.managementState,
                totalPnl: 0,
                currentDailyPnl: 0,
                mgmtTotalPnl: 0,
                mgmtCurrentDailyPnl: 0,
                isManagementStoppedToday: false,
                lastResetDate: getTradingDay()
              }
            }))
          };
        }
        const updatedStats = { ...s.managementStats };
        delete updatedStats[robotId];
        return {
          managementHistory: (s.managementHistory || []).filter(h => h.robotId !== robotId),
          managementStats: updatedStats,
          robots: (s.robots || []).map(r =>
            r.id === robotId
              ? {
                  ...r,
                  trades: (r.trades || []).filter(t => !t.warmup && !(t as any).isShadow),
                  managementState: {
                    ...r.managementState,
                    totalPnl: 0,
                    currentDailyPnl: 0,
                    mgmtTotalPnl: 0,
                    mgmtCurrentDailyPnl: 0,
                    isManagementStoppedToday: false,
                    lastResetDate: getTradingDay()
                  }
                }
              : r
          )
        };
      }),
      addManagementTrade: (trade) => set((s) => {
        if (!trade || !trade.id) return s;
        const filtered = (s.managementHistory || []).filter(h => h.id !== trade.id);
        return {
          managementHistory: [trade, ...filtered].slice(0, 20000)
        };
      }),

      robots: [],
      addRobot: (robot) => {
        console.log(`[Store] addRobot: "${robot.name}" (${robot.id})`);
        set((s) => ({ robots: [...s.robots, robot] }));
        
        // Strip trades/managementState from config payload to prevent server configuration pollution
        const { trades, managementState, ...cleanConfig } = robot;
        fetch("/api/robots/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            robots: {
              [robot.id]: {
                config: cleanConfig,
                trades: robot.trades || [],
                managementState: robot.managementState || {}
              }
            }
          })
        }).catch(err => console.error("[Store] Failed to save new robot config to VPS:", err));
      },
      updateRobot: (id, updates) => {
        set((s) => ({
          robots: s.robots.map(r => r.id === id ? { ...r, ...updates } : r)
        }));
        
        // Strip trades/managementState from config payload to prevent server configuration pollution
        const { trades, managementState, ...cleanConfig } = updates;
        scheduleRobotSync(id, {
          config: cleanConfig,
          ...(trades !== undefined ? { trades } : {}),
          ...(managementState !== undefined ? { managementState } : {})
        });
      },
      removeRobot: (id) => {
        console.log(`[Store] removeRobot: ${id}`);
        if (_updateRobotTimers.has(id)) {
          clearTimeout(_updateRobotTimers.get(id)!);
          _updateRobotTimers.delete(id);
        }
        _pendingRobotUpdates.delete(id);

        // Remoção local no estado (fluxo paper Binance — sem socket legado).
        set((s) => ({
          robots: (s.robots || []).filter(r => r.id !== id),
          managementHistory: (s.managementHistory || []).filter(h => h.robotId !== id)
        }));
      },
      addRobotTrade: (robotId, trade) => set((s) => ({
        robots: s.robots.map(r => r.id === robotId ? { ...r, trades: mergeTradeArrays(r.trades || [], [trade]) } : r)
      })),
      updateRobotTrade: (robotId, tradeId, updates) => set((s) => {
        if (!tradeId) return s;
        const cleanUpdates = Object.fromEntries(
          Object.entries(updates).filter(([_, v]) => v !== undefined)
        );
        const updatedRobots = s.robots.map(r => {
          if (r.id !== robotId) return r;
          const trades = r.trades || [];
          const exists = trades.some(t => String(t.id) === String(tradeId));
          const updatedMgmtTrades = (r.managementTrades || []).map(m => {
            if (String(m.id) === String(tradeId)) {
              return {
                ...m,
                ...(cleanUpdates.result ? { result: cleanUpdates.result as any } : {}),
                ...(cleanUpdates.pnl !== undefined ? { pnl: cleanUpdates.pnl as number } : {}),
              };
            }
            return m;
          });
          if (exists) {
            return {
              ...r,
              trades: trades.map(t => String(t.id) === String(tradeId) ? mergeSingleTrade(t, cleanUpdates) : t),
              managementTrades: updatedMgmtTrades,
            };
          } else {
            const newT: Trade = {
              id: String(tradeId),
              asset: (updates as any).asset || "BTCUSDT",
              type: (updates as any).type || "CALL",
              amount: (updates as any).amount || (updates as any).stake || 10,
              result: (updates.result as any) || "OPEN",
              pnl: updates.pnl || 0,
              entry: (updates as any).entry || 0,
              exit: (updates as any).exit || 0,
              payout: (updates as any).payout,
              ts: (updates as any).ts || Date.now(),
              durationS: (updates as any).durationS || 60,
              mode: (updates as any).mode || r.mode || "demo",
              warmup: (updates as any).warmup
            };
            return {
              ...r,
              trades: mergeTradeArrays(trades, [newT]),
              managementTrades: updatedMgmtTrades,
            };
          }
        });

        const updatedMgmtHistory = (s.managementHistory || []).map(h => {
          if (String(h.id) === String(tradeId)) {
            return {
              ...h,
              ...(cleanUpdates.result ? { result: cleanUpdates.result as any } : {}),
              ...(cleanUpdates.pnl !== undefined ? { pnl: cleanUpdates.pnl as number } : {}),
            };
          }
          return h;
        });

        return {
          robots: updatedRobots,
          managementHistory: updatedMgmtHistory,
        };
      }),
      resetRobotDaily: (robotId) => {
        fetch(`/api/robots/${robotId}/reset-daily-pnl`, { method: "POST" }).catch(() => {});
        set((s) => ({
          robots: s.robots.map(r => r.id === robotId ? {
            ...r,
            currentDailyPnl: 0,
            managementState: {
              ...r.managementState,
              currentDailyPnl: 0,
              lastResetDate: getTradingDay()
            }
          } : r)
        }));
      },
      resetManagementDaily: (robotId) => {
        fetch(`/api/robots/${robotId}/reset-management-daily`, { method: "POST" }).catch(() => {});
        const now = Date.now();
        set((s) => ({
          robots: s.robots.map(r => r.id === robotId ? {
            ...r,
            managementState: {
              ...r.managementState,
              mgmtCurrentDailyPnl: 0,
              isManagementStoppedToday: false,
              vdCycle: "",
              isPausedByVD: false,
              waitingForWins: 0,
              lastResetDate: getTradingDay(),
              mgmtResetTimestamp: now
            }
          } : r)
        }));
      },
      importRobotTrades: (robotId) => set((s) => {
        const robot = s.robots.find(r => r.id === robotId);
        if (!robot) return s;
        const closedTrades = (robot.trades || []).filter(t => t.result === "WIN" || t.result === "LOSS");
        const newRobotTrades = closedTrades.map(t => ({
          ...t,
          robotId,
          mode: robot.mode as "demo" | "real" | "backtest",
          strategyId: t.strategyId || robot.strategyId,
          durationS: t.durationS || 60,
        })).sort((a, b) => b.ts - a.ts);

        const targetStrat = robot.strategyId || s.activeStrategyId;
        const cleanRobotFilters: Record<string, StrategyFilterValue> = robot.filters
          ? JSON.parse(JSON.stringify(robot.filters))
          : {};

        console.log(`[Store] importRobotTrades: replaced stats with ${newRobotTrades.length} trades from robot "${robot.name}" with its ${Object.keys(cleanRobotFilters).length} original filters`);
        return {
          trades: newRobotTrades,
          tradingMode: robot.mode as "demo" | "real" | "backtest",
          activeStrategyId: targetStrat,
          importedRobotId: robot.id,
          importedRobotName: robot.name,
          importedRobotStrategyId: robot.strategyId || targetStrat || null,
          importedRobotFilters: cleanRobotFilters,
          importedRobotGlobalInvert: robot.globalInvert ?? null,
          importedRobotStrategyDirection: robot.strategyDirection ?? null,
          importedRobotSequenceConfig: robot.sequenceConfig ?? null,
          strategyFilters: targetStrat ? {
            ...s.strategyFilters,
            [targetStrat]: cleanRobotFilters
          } : s.strategyFilters,
          strategyInvert: (targetStrat && robot.globalInvert !== undefined) ? {
            ...s.strategyInvert,
            [targetStrat]: robot.globalInvert
          } : s.strategyInvert,
          strategyDirection: (targetStrat && robot.strategyDirection) ? {
            ...s.strategyDirection,
            [targetStrat]: robot.strategyDirection as any
          } : s.strategyDirection,
          strategySequenceConfig: (targetStrat && robot.sequenceConfig) ? {
            ...s.strategySequenceConfig,
            [targetStrat]: robot.sequenceConfig
          } : s.strategySequenceConfig,
        };
      }),
      replaceRobotTradesToStats: (robotId) => set((s) => {
        const robot = s.robots.find(r => r.id === robotId);
        if (!robot) return s;
        const closedTrades = (robot.trades || []).filter(t => t.result === "WIN" || t.result === "LOSS");
        const newRobotTrades = closedTrades.map(t => ({
          ...t,
          robotId,
          mode: robot.mode as "demo" | "real" | "backtest",
          strategyId: t.strategyId || robot.strategyId,
          durationS: t.durationS || 60,
        })).sort((a, b) => b.ts - a.ts);

        const targetStrat = robot.strategyId || s.activeStrategyId;
        const cleanRobotFilters: Record<string, StrategyFilterValue> = robot.filters
          ? JSON.parse(JSON.stringify(robot.filters))
          : {};

        console.log(`[Store] replaceRobotTradesToStats: replaced stats with ${newRobotTrades.length} trades from robot "${robot.name}" with its ${Object.keys(cleanRobotFilters).length} original filters`);
        return {
          trades: newRobotTrades,
          tradingMode: robot.mode as "demo" | "real" | "backtest",
          activeStrategyId: targetStrat,
          importedRobotId: robot.id,
          importedRobotName: robot.name,
          importedRobotStrategyId: robot.strategyId || targetStrat || null,
          importedRobotFilters: cleanRobotFilters,
          importedRobotGlobalInvert: robot.globalInvert ?? null,
          importedRobotStrategyDirection: robot.strategyDirection ?? null,
          importedRobotSequenceConfig: robot.sequenceConfig ?? null,
          strategyFilters: targetStrat ? {
            ...s.strategyFilters,
            [targetStrat]: cleanRobotFilters
          } : s.strategyFilters,
          strategyInvert: (targetStrat && robot.globalInvert !== undefined) ? {
            ...s.strategyInvert,
            [targetStrat]: robot.globalInvert
          } : s.strategyInvert,
          strategyDirection: (targetStrat && robot.strategyDirection) ? {
            ...s.strategyDirection,
            [targetStrat]: robot.strategyDirection as any
          } : s.strategyDirection,
          strategySequenceConfig: (targetStrat && robot.sequenceConfig) ? {
            ...s.strategySequenceConfig,
            [targetStrat]: robot.sequenceConfig
          } : s.strategySequenceConfig,
        };
      }),
      importMetaTradesToStats: (robotId) => set((s) => {
        const robot = s.robots.find(r => r.id === robotId);
        if (!robot) return s;
        const metaTrades = (robot.trades || []).filter(t => (t.result === "WIN" || t.result === "LOSS") && t.metaActive);
        
        // Convert to standard stats format and merge with existing if desired, but replace matches what the other does
        const newRobotTrades = metaTrades.map(t => ({
          ...t,
          robotId: `${robotId}-meta`, // distinct marker
          mode: robot.mode as "demo" | "real" | "backtest",
          strategyId: t.strategyId || robot.strategyId,
          durationS: t.durationS || 60,
        })).sort((a, b) => b.ts - a.ts);
        
        const targetStrat = robot.strategyId || s.activeStrategyId;
        const cleanRobotFilters: Record<string, StrategyFilterValue> = robot.filters
          ? JSON.parse(JSON.stringify(robot.filters))
          : {};

        console.log(`[Store] importMetaTradesToStats: replacing stats with ${newRobotTrades.length} META trades from robot "${robot.name}" with its ${Object.keys(cleanRobotFilters).length} original filters`);
        return {
          trades: newRobotTrades,
          tradingMode: robot.mode as "demo" | "real" | "backtest",
          activeStrategyId: targetStrat,
          importedRobotId: robot.id,
          importedRobotName: `${robot.name} (Meta)`,
          importedRobotStrategyId: robot.strategyId || targetStrat || null,
          importedRobotFilters: cleanRobotFilters,
          importedRobotGlobalInvert: robot.globalInvert ?? null,
          importedRobotStrategyDirection: robot.strategyDirection ?? null,
          importedRobotSequenceConfig: robot.sequenceConfig ?? null,
          strategyFilters: targetStrat ? {
            ...s.strategyFilters,
            [targetStrat]: cleanRobotFilters
          } : s.strategyFilters,
          strategyInvert: (targetStrat && robot.globalInvert !== undefined) ? {
            ...s.strategyInvert,
            [targetStrat]: robot.globalInvert
          } : s.strategyInvert,
          strategyDirection: (targetStrat && robot.strategyDirection) ? {
            ...s.strategyDirection,
            [targetStrat]: robot.strategyDirection as any
          } : s.strategyDirection,
          strategySequenceConfig: (targetStrat && robot.sequenceConfig) ? {
            ...s.strategySequenceConfig,
            [targetStrat]: robot.sequenceConfig
          } : s.strategySequenceConfig,
        };
      }),

      // FIX: clearRobotTrades — usa uma única chamada set() atómica para garantir
      // que o Zustand persist serializa corretamente o novo estado.
      // Anteriormente o bug era que o set() era chamado mas o componente React
      // não re-renderizava porque o array de robots era mutado de forma incorreta.
      clearRobotTrades: (robotId) => {
        console.log(`[Store] clearRobotTrades: clearing history and resetting PnL for robot ${robotId}`);
        set((s) => ({
          robots: s.robots.map(r =>
            r.id === robotId
              ? {
                ...r,
                trades: [],          // limpa o array de trades
                managementState: {
                  ...r.managementState,
                  totalPnl: 0,         // repõe PnL total
                  currentDailyPnl: 0,  // repõe PnL diário
                  mgmtTotalPnl: 0,
                  mgmtCurrentDailyPnl: 0,
                  isManagementStoppedToday: false,
                  lastResetDate: getTradingDay()
                }
              }
              : r
          )
        }));
      },
      clearAllTrades: () => {
        console.log(`[Store] clearAllTrades: clearing global trade history`);
        set({ trades: [] });
      },

      chats: [],
      activeChatId: null,
      createChat: (title) => {
        const id = "chat_" + Date.now();
        const newChat: ChatSession = {
          id,
          title: title || `Novo Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          messages: [],
          createdAt: Date.now()
        };
        set((s) => ({
          chats: [newChat, ...s.chats].slice(0, 20), // Máximo 20 conversas
          activeChatId: id
        }));
        return id;
      },
      deleteChat: (id) => set((s) => ({
        chats: s.chats.filter(c => c.id !== id),
        activeChatId: s.activeChatId === id ? (s.chats.find(c => c.id !== id)?.id || null) : s.activeChatId
      })),
      setActiveChatId: (id) => set({ activeChatId: id }),
      addMessageToChat: (chatId, message) => set((s) => ({
        chats: s.chats.map(c => {
          if (c.id === chatId) {
            let newTitle = c.title;
            if (c.messages.length === 0 && message.role === 'user') {
              newTitle = message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "");
            }
            return { 
              ...c, 
              title: newTitle, 
              messages: [...c.messages, { ...message, ts: Date.now() }].slice(-50) // Últimas 50 mensagens
            };
          }
          return c;
        })
      })),
      clearChatHistory: (chatId) => set((s) => ({
        chats: s.chats.map(c => c.id === chatId ? { ...c, messages: [] } : c)
      })),
      chatLoading: false,
      setChatLoading: (loading) => set({ chatLoading: loading }),

      refreshRobots: async () => {
        try {
          const res = await fetch("/api/robots/config");
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.robots) {
              set((s) => {
                const currentRobots = s.robots || [];
                const updatedRobots = currentRobots.map((r) => {
                  const entry = data.robots[r.id];
                  if (!entry) return r;
                  const config = entry.config || entry;
                  const { trades: _unused1, managementState: _unused2, ...cleanConfig } = config;

                  const serverTrades = entry.trades || config.trades || [];
                  const mergedTrades = mergeTradeArrays(r.trades || [], serverTrades);
                  const mergedMgmtTrades = mergeTradeArrays(r.managementTrades || [], entry.managementTrades || []);

                  return {
                    ...r,
                    ...cleanConfig,
                    trades: mergedTrades,
                    managementTrades: mergedMgmtTrades,
                    managementState: {
                      ...(entry.managementState || config.managementState || {}),
                      ...(r.managementState || {}),
                    },
                  };
                });

                for (const [robotId, entry] of Object.entries(data.robots) as [string, any][]) {
                  if (!updatedRobots.find((r) => r.id === robotId)) {
                    const config = entry.config || entry;
                    const { trades: _unused3, managementState: _unused4, ...cleanConfig } = config;
                    updatedRobots.push({
                      ...cleanConfig,
                      id: robotId,
                      trades: entry.trades || [],
                      managementTrades: entry.managementTrades || [],
                      managementState: entry.managementState || {},
                      active: cleanConfig.active === true,
                    });
                  }
                }

                return { robots: updatedRobots };
              });
              console.log(`[Store] Robots refreshed from server.`);
            }
          }
        } catch (err) {
          console.error("Erro ao sincronizar robôs:", err);
        }
      },
      robotQuickStates: {},
      updateRobotQuickState: (robotId, state) => set((s) => ({
        robotQuickStates: {
          ...s.robotQuickStates,
          [robotId]: state,
        },
      })),
      orchestratorState: null,
      setOrchestratorState: (state) => set({ orchestratorState: state }),
      fetchOrchestratorState: async () => {
        try {
          const res = await fetch("/api/orchestrator/state");
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.state) {
              set({ orchestratorState: data.state });
            }
          }
        } catch (err) {
          console.error("[Store] Erro ao buscar estado do orquestrador:", err);
        }
      },
      updateOrchestratorConfigInStore: async (updates) => {
        try {
          const res = await fetch("/api/orchestrator/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.state) {
              set({ orchestratorState: data.state });
            }
          }
        } catch (err) {
          console.error("[Store] Erro ao atualizar config do orquestrador:", err);
        }
      },
      resetOrchestratorDailyInStore: async () => {
        try {
          const res = await fetch("/api/orchestrator/reset", {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.state) {
              set({ orchestratorState: data.state });
            }
          }
        } catch (err) {
          console.error("[Store] Erro ao resetar orquestrador:", err);
        }
      },
    }),
    {
      name: "quantterm-store",
      version: 2,
      migrate: (persisted: unknown, _version: number) => {
        if (!persisted || typeof persisted !== "object") return persisted as any;
        const s = persisted as Record<string, any>;
        // Apaga chaves do fluxo antigo (tokens/mt5/tipo de mercado/fx/backtest).
        for (const k of [
          "demoToken", "realToken", "candleToken", "robotTokens",
          "mt5LoginId", "mt5Password",
          "marketType", "forex", "backtestIndices",
        ]) delete s[k];
        if (s.risk && typeof s.risk === "object") {
          delete s.risk.martingale;
          delete s.risk.martingaleFactor;
          delete s.risk.payout;
        }
        if (Array.isArray(s.robots)) {
          for (const r of s.robots) {
            if (!r || typeof r !== "object") continue;
            delete r.marketType;
            delete r.forexConfig;
            if (r.management && typeof r.management === "object") {
              delete r.management.payout;
              delete r.management.sorosMaxStake;
              delete r.management.sorosLevels;
              delete r.management.protectFirstProfit;
              delete r.management.martingaleFactor;
              delete r.management.martingaleMaxSteps;
            }
            if (r.managementState && typeof r.managementState === "object") {
              delete r.managementState.sorosConsecutiveWins;
              delete r.managementState.martingaleStep;
            }
          }
        }
        // Chaves de redis do fluxo antigo não começam com "binance:" — normaliza.
        if (s.redis && typeof s.redis === "object" && typeof s.redis.key === "string") {
          if (!s.redis.key.startsWith("binance:")) {
            s.redis.key = "binance:candles:BTCUSDT";
          }
        }
        return s as any;
      },
      partialize: (state) => {
        const {
          customBacktestData,
          serverLatency,
          localLatency,
          trades,
          managementHistory,
          robots,
          chatLoading,
          ...rest
        } = state;

        // Elimina o armazenamento de robôs, trades e histórico de operações no navegador (local cache)
        // O volume Docker no servidor de backend passa a ser a única fonte de verdade.
        return {
          ...rest,
          chats: (rest.chats || []).slice(0, 5).map(c => ({ ...c, messages: (c.messages || []).slice(-10) })),
        } as unknown as Partial<Store>;
      },
      // Merge server data on hydration
      merge: (persisted, current) => {
        // O estado em memória atual (carregado via API e Sockets) prevalece sempre sobre cache do navegador
        return {
          ...current,
          ...(persisted as any),
          robots: current.robots || [],
          trades: current.trades || [],
          managementHistory: current.managementHistory || [],
        };
      },
    }
  )
);
