import type { Candle } from "./indicators";

/** Metadata attached to any annotation — reason, confidence, semantic layer */
export type AnnotationMeta = {
  reason?: string;
  confidence?: number;
  layer?: "support" | "resistance" | "entry" | "analysis";
};

/** A single visual annotation produced by a sandbox script */
export type ScriptAnnotation =
  | { type: "line"; id: string; candleIndex: number; price: number; label?: string; color?: string; range?: number; meta?: AnnotationMeta }
  | { type: "arrow"; id: string; candleIndex: number; direction: "up" | "down"; label?: string; color?: string; meta?: AnnotationMeta }
  | { type: "text"; id: string; candleIndex: number; text: string; position?: "above" | "below"; color?: string; meta?: AnnotationMeta }
  | { type: "zone"; id: string; startIdx: number; endIdx: number; priceHigh: number; priceLow: number; label?: string; color?: string; meta?: AnnotationMeta }
  | { type: "trendline"; id: string; idx1: number; price1: number; idx2: number; price2: number; color?: string; meta?: AnnotationMeta }
  | { type: "marker"; id: string; candleIndex: number; shape: "circle" | "diamond" | "square"; color?: string; meta?: AnnotationMeta }
  | { type: "highlight"; id: string; candleIndex: number; color: string };

/** A log entry produced by api.log() */
export type ScriptLogEntry = {
  id: number;
  text: string;
  ts: number;
};

/** Layer visibility state for filtering annotations */
export type ScriptLayerState = {
  support: boolean;
  resistance: boolean;
  entry: boolean;
  analysis: boolean;
  highlight: boolean;
};

export const DEFAULT_LAYER_STATE: ScriptLayerState = {
  support: true,
  resistance: true,
  entry: true,
  analysis: true,
  highlight: true,
};

/** Step-by-step replay state */
export type StepState = {
  enabled: boolean;
  currentStep: number;
};

/** The API object injected into the sandbox script */
export interface ScriptSandboxAPI {
  readonly candles: Candle[];

  // --- Backtest simulation (candle-by-candle) ---
  readonly index: number;
  readonly candle: Candle;
  readonly isLast: boolean;
  readonly isPenultimate: boolean;
  readonly warmUp: number;
  readonly isWarmUp: boolean;

  // --- Low-level geometry ---
  addLine(candleIndex: number, price: number, label?: string, color?: string, meta?: AnnotationMeta, range?: number): void;
  addArrow(candleIndex: number, direction: "up" | "down", label?: string, color?: string, meta?: AnnotationMeta): void;
  addText(candleIndex: number, text: string, position?: "above" | "below", color?: string, meta?: AnnotationMeta): void;
  addZone(startIdx: number, endIdx: number, priceHigh: number, priceLow: number, label?: string, color?: string, meta?: AnnotationMeta): void;
  addTrendLine(idx1: number, price1: number, idx2: number, price2: number, color?: string, meta?: AnnotationMeta): void;
  addMarker(candleIndex: number, shape: "circle" | "diamond" | "square", color?: string, meta?: AnnotationMeta): void;
  clear(): void;
  log(msg: string): void;

  // --- Candle helpers ---
  isBullish(i: number): boolean;
  isBearish(i: number): boolean;
  isSwingHigh(i: number, strength?: number): boolean;
  isSwingLow(i: number, strength?: number): boolean;

  // --- Semantic trading ---
  addResistance(i: number, label?: string): void;
  addSupport(i: number, label?: string): void;
  markEntry(i: number, direction: "buy" | "sell", meta?: AnnotationMeta): void;
  markRejection(i: number, direction: "up" | "down", meta?: AnnotationMeta): void;
  markBreakout(i: number, direction: "up" | "down", meta?: AnnotationMeta): void;
  markZone(startIdx: number, endIdx: number, type: "support" | "resistance", meta?: AnnotationMeta): void;

  // --- Visual debug ---
  highlight(i: number, color?: string): void;

  // --- Zig Zag ---
  drawZigZag(strength?: number, colorHighs?: string, colorLows?: string): void;
}

/**
 * Per-step indicator wrappers available inside onTick(ctx) sandbox mode.
 * Matches the ctx.indicators interface from StrategyContext.
 */
export interface StrategySandboxIndicators {
  rsi: (period: number, dataSource?: number[]) => (number | null)[];
  sma: (period: number, dataSource?: number[]) => number[];
  ema: (period: number, dataSource?: number[]) => (number | null)[];
  bollinger: (period: number, multiplier: number, dataSource?: number[]) => { upper: number[]; lower: number[] };
  adx: (period: number, dataSource?: Candle[]) => { adx: number[]; plusDi: number[]; minusDi: number[] };
  macd: (fast: number, slow: number, signal: number, dataSource?: number[]) => { macd: number[]; signal: number[]; histogram: number[] };
  parabolicSar: (afStep?: number, afMax?: number, dataSource?: Candle[]) => { sar: number[]; trend: number[]; af: number[] };
}

/**
 * Visual annotation API available inside onTick(ctx) sandbox mode.
 * Identical to ScriptSandboxAPI but WITHOUT markEntry — entries are ONLY via return { action }.
 */
export type StrategySandboxAPI = Omit<ScriptSandboxAPI, 'markEntry'>;

/**
 * The context object passed to onTick(ctx) in sandbox strategy mode.
 * Matches the StrategyContext interface from strategies/index.ts.
 */
export interface StrategySandboxContext {
  history: Candle[];
  candles: Candle[];
  lastPrice: number;
  currentPrice: number;
  isBacktest: true;
  intervalMs: number;
  candleTimeRemainingMs: number;
  indicators: StrategySandboxIndicators;
  api: StrategySandboxAPI;
  hasOpenTrade: boolean;
  index: number;
  candle: Candle;
  isLast: boolean;
  warmUp: number;
  isWarmUp: boolean;
}

/** Result of a full script execution */
export type ScriptResult = {
  annotations: ScriptAnnotation[];
  logs: ScriptLogEntry[];
  error: string | null;
};
