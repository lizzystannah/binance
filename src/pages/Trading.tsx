// ─── PÁGINA DE TRADING — Binance Crypto Futuros USDT-M (100% Binance) ───
// Perpétuos USDT-M apenas: LONG/SHORT, alavancagem 1–125x, isolated/cross,
// TP/SL %, trailing stop, reduce-only. Conta paper isolada (cryptoFutures.ts).
// Gráfico com ferramentas de desenho (linhas) e indicadores (EMA/BOLL/VOL/RSI/MACD).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Eraser,
  FlaskConical,
  Maximize2,
  Minus,
  MousePointer2,
  MoveVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { bollinger, ema, macd, rsi } from "@/lib/indicators";
import { cn } from "@/lib/utils";
import {
  FUTURES_INTERVALS,
  FUTURES_TRADING_SYMBOLS,
  fetchFuturesKlines,
  fetchFuturesMarkPrice,
  fetchFuturesSpreadPct,
  fetchFuturesTickers24h,
  formatPrice,
  futuresLiqPrice,
  futuresMargin,
  validateFuturesOrder,
  type BinanceKline,
  type BinanceTicker24h,
  type FuturesSide,
  type MarginMode,
} from "@/lib/binance";
import {
  FUTURES_FEE_RATE,
  FUTURES_PAPER_START_USDT,
  calcFuturesTpSl,
  futuresLivePnl,
  futuresLiveRoe,
  futuresLockedMargin,
  futuresRealizedPnl,
  futuresUnrealizedTotal,
  useFuturesPaper,
} from "@/lib/cryptoFutures";
import { CRYPTO_FEE_RATE as SPOT_PAPER_FEE } from "@/lib/cryptoPaper";
import { useStore } from "@/lib/store";
import { useBacktestMode, useBacktestResults, type ChartMarker } from "@/lib/backtestMode";
import { applyDirectionAndInvert, getCryptoStrategy, listAllStrategies, useActiveStrategy, useStrategyInvert } from "@/lib/cryptoStrategies";
import { runCryptoBacktest } from "@/lib/cryptoBacktest";

type EntryLine = { price: number; color: string; label: string; includeInScale?: boolean };
type Tool = "cursor" | "trend" | "hline" | "vline" | "erase";
interface Drawing {
  id: string;
  type: "trend" | "hline" | "vline";
  idx1: number;
  price1: number;
  idx2: number;
  price2: number;
  color: string;
}
interface IndFlags {
  ema: boolean;
  boll: boolean;
  vol: boolean;
  rsi: boolean;
  macd: boolean;
}

const PAD_L = 8;
const PAD_R = 78;
const PAD_T = 14;
const PAD_B = 22;

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Campo numérico com setinhas de +1/-1 (para não ter de escrever sempre). */
function NumStepper({
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const bump = (dir: number) => {
    const n = parseFloat(value);
    let v = (Number.isFinite(n) ? n : 0) + dir * step;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(String(Math.round(v * 1000) / 1000));
  };
  return (
    <div className="flex mt-1">
      <Input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 text-xs font-mono rounded-r-none"
        inputMode="decimal"
      />
      <div className={`flex flex-col overflow-hidden rounded-r border border-l-0 border-border ${disabled ? "opacity-40" : ""}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => bump(1)}
          className="h-4 w-6 flex items-center justify-center bg-secondary/60 hover:bg-secondary text-muted-foreground"
          title="+1"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => bump(-1)}
          className="h-4 w-6 flex items-center justify-center bg-secondary/60 hover:bg-secondary text-muted-foreground border-t border-border"
          title="−1"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * Posição X do centro da última vela visível.
 * - No extremo direito (offset 0, velas mais recentes) fica a ~70% da largura.
 * - Ao recuar no histórico, o espaço à direita desaparece e as velas passam a
 *   ocupar toda a largura (a última toca o eixo).
 */
function lastCandleX(canvasW: number, endOffset: number): number {
  const innerW = Math.max(50, canvasW - PAD_L - PAD_R);
  const t = Math.min(1, Math.max(0, endOffset / 8));
  const x0 = Math.min(canvasW * 0.7, innerW - 4);
  return x0 + Math.max(0, innerW - x0) * t;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "px-1.5 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1 transition-colors",
        active ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// ─── Gráfico: zoom/pan + ferramentas de desenho + indicadores ───
function FuturesChart({ klines, entryLines, markers, fitKey }: { klines: BinanceKline[]; entryLines: EntryLine[]; markers?: ChartMarker[]; fitKey?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 420 });
  const [viewCount, setViewCount] = useState(120);
  const [endOffset, setEndOffset] = useState(0);
  const [tool, setTool] = useState<Tool>("cursor");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [pending, setPending] = useState<{ idx: number; price: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [drawColor, setDrawColor] = useState("#38bdf8");
  const [ind, setInd] = useState<IndFlags>({ ema: true, boll: false, vol: true, rsi: false, macd: false });

  const dragRef = useRef<{ x: number; endOffset: number } | null>(null);
  const drawDragRef = useRef<null | {
    id: string;
    grabIdx: number;
    grabPrice: number;
    orig: Drawing;
  }>(null);
  const [hoverDrawId, setHoverDrawId] = useState<string | null>(null);
  const pendingRef = useRef<{ idx: number; price: number } | null>(null);
  const layoutRef = useRef<null | {
    start: number;
    cw: number;
    vLo: number;
    vHi: number;
    mainTop: number;
    mainH: number;
    innerW: number;
    yOf: (p: number) => number;
    idxToX: (i: number) => number;
  }>(null);

  const total = klines.length;
  const maxOffset = Math.max(0, total - viewCount);
  const closes = useMemo(() => klines.map((k) => k.c), [klines]);

  const series = useMemo(
    () => ({
      ema20: ind.ema ? ema(closes, 20) : null,
      ema50: ind.ema ? ema(closes, 50) : null,
      boll: ind.boll ? bollinger(closes, 20, 2) : null,
      rsi: ind.rsi ? rsi(closes, 14) : null,
      macd: ind.macd ? macd(closes, 12, 26, 9) : null,
    }),
    [closes, ind]
  );

  const view = useMemo(() => {
    const end = total - endOffset;
    const start = Math.max(0, end - viewCount);
    return klines.slice(start, Math.max(start, end));
  }, [klines, endOffset, viewCount, total]);

  // Medir container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(240, Math.floor(r.height)) });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Limitar offset
  useEffect(() => {
    setEndOffset((o) => Math.min(Math.max(0, o), Math.max(0, total - viewCount)));
  }, [total, viewCount]);

  // Ao correr um novo backtest (fitKey muda), ajusta a vista para mostrar os
  // trades. Só dispara num novo run — não em cada atualização de velas.
  useEffect(() => {
    if (!fitKey || !markers || markers.length === 0) return;
    let minI = Infinity;
    let maxI = -Infinity;
    for (const m of markers) {
      minI = Math.min(minI, m.entryIndex);
      maxI = Math.max(maxI, m.exitIndex);
    }
    const pad = 15;
    const start = Math.max(0, minI - pad);
    const end = Math.min(total, maxI + pad + 1);
    const span = Math.max(20, end - start);
    const cap = 1200;
    setViewCount(Math.min(cap, span));
    setEndOffset(Math.max(0, total - end));
    // Só refaz o enquadramento quando um NOVO backtest corre (fitKey muda).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Zoom com a roda
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.18 : 0.85;
      setViewCount((vc) => {
        const max = Math.max(20, total || 20);
        return Math.min(max, Math.max(20, Math.round(vc * factor)));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [total]);

  const rectXY = (e: React.PointerEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };
  const toData = (x: number, y: number) => {
    const L = layoutRef.current;
    if (!L) return null;
    const idx = L.start + (x - PAD_L - L.cw / 2) / L.cw;
    const frac = (y - L.mainTop) / L.mainH;
    return { idx, price: L.vHi - frac * (L.vHi - L.vLo) };
  };

  const eraseAt = (x: number, y: number) => {
    const L = layoutRef.current;
    if (!L) return;
    let best = -1;
    let bestD = 10;
    drawings.forEach((d, i) => {
      let dist = Infinity;
      if (d.type === "hline") dist = Math.abs(y - L.yOf(d.price1));
      else if (d.type === "vline") dist = Math.abs(x - L.idxToX(d.idx1));
      else dist = distToSegment(x, y, L.idxToX(d.idx1), L.yOf(d.price1), L.idxToX(d.idx2), L.yOf(d.price2));
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    });
    if (best >= 0) setDrawings((ds) => ds.filter((_, i) => i !== best));
  };

  /** Desenho sob o cursor (para arrastar com a ferramenta cursor). */
  const hitDrawing = (x: number, y: number): Drawing | null => {
    const L = layoutRef.current;
    if (!L) return null;
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      let dist = Infinity;
      if (d.type === "hline") dist = Math.abs(y - L.yOf(d.price1));
      else if (d.type === "vline") dist = Math.abs(x - L.idxToX(d.idx1));
      else dist = distToSegment(x, y, L.idxToX(d.idx1), L.yOf(d.price1), L.idxToX(d.idx2), L.yOf(d.price2));
      if (dist < 10) return d;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = rectXY(e);
    if (tool === "cursor") {
      // Agarrar linha existente → arrastar; senão, pan do gráfico.
      const hit = hitDrawing(x, y);
      const d = toData(x, y);
      if (hit && d) {
        drawDragRef.current = { id: hit.id, grabIdx: d.idx, grabPrice: d.price, orig: hit };
        setHoverDrawId(hit.id);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        return;
      }
      dragRef.current = { x: e.clientX, endOffset };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }
    const d = toData(x, y);
    if (!d) return;
    if (tool === "erase") {
      eraseAt(x, y);
      return;
    }
    if (tool === "hline") {
      setDrawings((ds) => [...ds, { id: uid(), type: "hline", idx1: d.idx, price1: d.price, idx2: d.idx, price2: d.price, color: drawColor }]);
      return;
    }
    if (tool === "vline") {
      setDrawings((ds) => [...ds, { id: uid(), type: "vline", idx1: d.idx, price1: d.price, idx2: d.idx, price2: d.price, color: drawColor }]);
      return;
    }
    if (tool === "trend") {
      if (!pendingRef.current) {
        pendingRef.current = d;
        setPending(d);
      } else {
        const p = pendingRef.current;
        setDrawings((ds) => [...ds, { id: uid(), type: "trend", idx1: p.idx, price1: p.price, idx2: d.idx, price2: d.price, color: drawColor }]);
        pendingRef.current = null;
        setPending(null);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = rectXY(e);
    setHover({ x, y });
    // Arrastar linha existente
    if (tool === "cursor" && drawDragRef.current) {
      const g = drawDragRef.current;
      const d = toData(x, y);
      if (d) {
        const dIdx = d.idx - g.grabIdx;
        const dPrice = d.price - g.grabPrice;
        const o = g.orig;
        let next: Drawing;
        if (o.type === "hline") {
          const p = o.price1 + dPrice;
          next = { ...o, price1: p, price2: p };
        } else if (o.type === "vline") {
          const ix = o.idx1 + dIdx;
          next = { ...o, idx1: ix, idx2: ix };
        } else {
          next = {
            ...o,
            idx1: o.idx1 + dIdx,
            idx2: o.idx2 + dIdx,
            price1: o.price1 + dPrice,
            price2: o.price2 + dPrice,
          };
        }
        setDrawings((ds) => ds.map((it) => (it.id === g.id ? next : it)));
      }
      return;
    }
    if (tool === "cursor" && dragRef.current) {
      const d = dragRef.current;
      const targetX = lastCandleX(size.w, d.endOffset);
      const perCandle = Math.max(0.5, (targetX - PAD_L) / Math.max(1, viewCount - 0.5));
      const delta = Math.round((e.clientX - d.x) / perCandle);
      setEndOffset(Math.min(Math.max(0, d.endOffset + delta), maxOffset));
      return;
    }
    // Sem arrasto: indicar linha agarrável (cursor move)
    if (tool === "cursor" && !dragRef.current) {
      const hit = hitDrawing(x, y);
      setHoverDrawId((prev) => {
        const id = hit ? hit.id : null;
        return prev === id ? prev : id;
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    drawDragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const resetView = () => {
    setViewCount(120);
    setEndOffset(0);
    pendingRef.current = null;
    setPending(null);
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    cv.style.width = `${size.w}px`;
    cv.style.height = `${size.h}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const innerW = size.w - PAD_L - PAD_R;
    const H = size.h - PAD_T - PAD_B;
    const subKeys: Array<"vol" | "rsi" | "macd"> = [];
    if (ind.vol) subKeys.push("vol");
    if (ind.rsi) subKeys.push("rsi");
    if (ind.macd) subKeys.push("macd");
    const gap = 8;
    const subH = subKeys.length ? Math.max(44, Math.min(96, Math.round((H - 40) * 0.16))) : 0;
    const mainH = Math.max(80, H - subKeys.length * (subH + gap));
    const mainTop = PAD_T;
    const mainBottom = PAD_T + mainH;

    if (view.length === 0) {
      ctx.fillStyle = "hsl(150 8% 45%)";
      ctx.font = "12px JetBrains Mono, monospace";
      ctx.fillText("A carregar velas Binance Futures…", PAD_L + 12, PAD_T + 24);
      layoutRef.current = null;
      return;
    }

    const start = Math.max(0, total - endOffset - view.length);
    const endI = start + view.length;

    let lo = Math.min(...view.map((c) => c.l));
    let hi = Math.max(...view.map((c) => c.h));
    if (series.boll) {
      for (let i = start; i < endI; i++) {
        const u = series.boll.upper[i];
        const l = series.boll.lower[i];
        if (u != null) hi = Math.max(hi, u);
        if (l != null) lo = Math.min(lo, l);
      }
    }
    entryLines.forEach((l) => {
      if (!Number.isFinite(l.price)) return;
      // LIQ fica sempre fora da auto-escala: o preço de liquidação (ex.: 1x ≈
      // 99,5% abaixo da entrada) rebentava o range vertical e o gráfico entrava
      // em "zoom out". A linha continua desenhada (cortada se fora da vista).
      if (l.includeInScale === false) return;
      // Guarda extra: ignora linhas absurdamente longe das velas visíveis
      // (ex.: TP/SL distante) para a escala vertical não colapsar.
      const mid = (hi + lo) / 2;
      const candleRange = Math.max(hi - lo, 1e-9);
      if (Math.abs(l.price - mid) > candleRange * 5) return;
      hi = Math.max(hi, l.price);
      lo = Math.min(lo, l.price);
    });
    // Inclui os preços de TP/SL/entrada/saída dos marcadores na escala vertical,
    // para as caixas verdes/vermelhas ficarem visíveis (com a mesma guarda anti-outlier).
    if (markers && markers.length > 0) {
      for (const m of markers) {
        const mid = (hi + lo) / 2;
        const candleRange = Math.max(hi - lo, 1e-9);
        for (const p of [m.takeProfitPrice, m.stopLossPrice, m.entryPrice, m.exitPrice]) {
          if (!Number.isFinite(p)) continue;
          if (Math.abs(p - mid) > candleRange * 5) continue;
          hi = Math.max(hi, p);
          lo = Math.min(lo, p);
        }
      }
    }
    const range = hi - lo || 1;
    const pad = range * 0.06;
    const vLo = lo - pad;
    const vHi = hi + pad;
    const yOf = (p: number) => mainTop + (1 - (p - vLo) / (vHi - vLo)) * mainH;

    const targetX = lastCandleX(size.w, endOffset);
    const cw = Math.max(0.5, (targetX - PAD_L) / Math.max(1, view.length - 0.5));
    const xOf = (i: number) => PAD_L + i * cw + cw / 2;
    const idxToX = (fullIdx: number) => xOf(fullIdx - start);

    layoutRef.current = { start, cw, vLo, vHi, mainTop, mainH, innerW, yOf, idxToX };

    // Painel principal
    ctx.fillStyle = "#131722";
    ctx.fillRect(PAD_L, mainTop, innerW, mainH);

    ctx.strokeStyle = "hsl(220 14% 14%)";
    ctx.lineWidth = 1;
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillStyle = "hsl(150 8% 45%)";
    for (let g = 0; g <= 6; g++) {
      const y = mainTop + (mainH / 6) * g;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(innerW, y);
      ctx.stroke();
      const p = vHi - (g / 6) * (vHi - vLo);
      ctx.fillText(formatPrice(p), innerW + 6, y + 3);
    }

    const drawSeries = (arr: (number | null)[], color: string, width = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let s = false;
      for (let i = 0; i < view.length; i++) {
        const v = arr[start + i];
        if (v == null) {
          s = false;
          continue;
        }
        const x = xOf(i);
        const y = yOf(v);
        if (!s) {
          ctx.moveTo(x, y);
          s = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_L, mainTop, innerW, mainH);
    ctx.clip();

    // Bollinger
    if (series.boll) {
      ctx.beginPath();
      let s = false;
      for (let i = 0; i < view.length; i++) {
        const v = series.boll.upper[start + i];
        if (v == null) continue;
        const x = xOf(i);
        const y = yOf(v);
        if (!s) {
          ctx.moveTo(x, y);
          s = true;
        } else ctx.lineTo(x, y);
      }
      for (let i = view.length - 1; i >= 0; i--) {
        const v = series.boll.lower[start + i];
        if (v == null) continue;
        ctx.lineTo(xOf(i), yOf(v));
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(56,189,248,0.06)";
      ctx.fill();
      drawSeries(series.boll.upper, "rgba(56,189,248,0.5)");
      drawSeries(series.boll.lower, "rgba(56,189,248,0.5)");
      drawSeries(series.boll.ma, "rgba(56,189,248,0.8)");
    }

    // EMA
    if (series.ema20) drawSeries(series.ema20, "#f59e0b", 1.2);
    if (series.ema50) drawSeries(series.ema50, "#a78bfa", 1.2);

    // Linhas de posição
    entryLines.forEach((l) => {
      if (l.price < vLo || l.price > vHi) return;
      const y = yOf(l.price);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(innerW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = `${l.label} ${formatPrice(l.price)}`;
      ctx.fillStyle = l.color;
      const w = ctx.measureText(label).width + 10;
      ctx.fillRect(innerW - w - 4, y - 9, w, 18);
      ctx.fillStyle = "#0a0e14";
      ctx.fillText(label, innerW - w + 1, y + 4);
    });

    // Velas
    view.forEach((c, i) => {
      const x = xOf(i);
      const up = c.c >= c.o;
      ctx.strokeStyle = up ? "#22c55e" : "#ef4444";
      ctx.fillStyle = up ? "#22c55e" : "#ef4444";
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();
      const yo = yOf(c.o);
      const yc = yOf(c.c);
      ctx.fillRect(x - Math.max(1, cw * 0.32), Math.min(yo, yc), Math.max(2, cw * 0.64), Math.max(1, Math.abs(yc - yo)));
    });

    // Desenhos
    drawings.forEach((d) => {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      if (d.type === "hline") {
        const y = yOf(d.price1);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(innerW, y);
        ctx.stroke();
        const label = formatPrice(d.price1);
        ctx.fillStyle = d.color;
        const w = ctx.measureText(label).width + 8;
        ctx.fillRect(innerW - w - 4, y - 8, w, 16);
        ctx.fillStyle = "#0a0e14";
        ctx.fillText(label, innerW - w + 1, y + 3);
      } else if (d.type === "vline") {
        const x = idxToX(d.idx1);
        if (x >= PAD_L - 2 && x <= innerW + 2) {
          ctx.beginPath();
          ctx.moveTo(x, mainTop);
          ctx.lineTo(x, mainBottom);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(idxToX(d.idx1), yOf(d.price1));
        ctx.lineTo(idxToX(d.idx2), yOf(d.price2));
        ctx.stroke();
      }
    });

    // Marcadores de backtest: caixas TP/SL (entrada→saída), vela de entrada e setas.
    if (markers && markers.length > 0) {
      ctx.font = "bold 9px JetBrains Mono, monospace";
      const nView = view.length;
      // Largura de uma vela para desenhar a caixa/realce.
      const halfCw = Math.max(2, cw / 2);
      markers.forEach((m) => {
        const eIdx = m.entryIndex - start;
        const xIdx = m.exitIndex - start;
        const eVisible = eIdx >= 0 && eIdx < nView;
        const xVisible = xIdx >= 0 && xIdx < nView;
        if (!eVisible && !xVisible) return;
        const ec = Math.max(0, Math.min(eIdx, nView - 1));
        const xc = Math.max(0, Math.min(xIdx, nView - 1));
        const ex = xOf(ec);
        const xx = xOf(xc);
        const entryY = yOf(m.entryPrice);
        const exitY = yOf(m.exitPrice);
        const tpY = yOf(m.takeProfitPrice);
        const slY = yOf(m.stopLossPrice);
        const isLong = m.side === "LONG";
        const col = isLong ? "#22c55e" : "#ef4444";
        const xL = Math.min(ex, xx);
        const xW = Math.max(2, Math.abs(xx - ex));

        // Caixa verde (gain) e vermelha (loss): da entrada até à saída, no
        // respetivo intervalo de preço. Transparentes para não tapar as velas.
        ctx.fillStyle = "rgba(34,197,94,0.13)";
        ctx.fillRect(xL, Math.min(entryY, tpY), xW, Math.abs(tpY - entryY));
        ctx.fillStyle = "rgba(239,68,68,0.13)";
        ctx.fillRect(xL, Math.min(entryY, slY), xW, Math.abs(slY - entryY));

        // Bordas tracejadas no TP e no SL.
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "rgba(34,197,94,0.6)";
        ctx.beginPath();
        ctx.moveTo(xL, tpY);
        ctx.lineTo(xL + xW, tpY);
        ctx.stroke();
        ctx.strokeStyle = "rgba(239,68,68,0.6)";
        ctx.beginPath();
        ctx.moveTo(xL, slY);
        ctx.lineTo(xL + xW, slY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Vela de entrada realçada (só se a vela de entrada está na vista).
        if (eVisible) {
          ctx.fillStyle = "rgba(234,179,8,0.25)";
          ctx.fillRect(ex - halfCw, mainTop, halfCw * 2, mainH);
        }

        // Trilha entrada → saída.
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(ex, entryY);
        ctx.lineTo(xx, exitY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Seta de entrada (abaixo do pavio p/ LONG, acima p/ SHORT).
        const candle = view[ec];
        if (eVisible && candle) {
          const arrowY = isLong ? yOf(candle.l) + 12 : yOf(candle.h) - 12;
          ctx.beginPath();
          ctx.fillStyle = col;
          if (isLong) {
            ctx.moveTo(ex, arrowY - 8);
            ctx.lineTo(ex - 6, arrowY + 3);
            ctx.lineTo(ex + 6, arrowY + 3);
          } else {
            ctx.moveTo(ex, arrowY + 8);
            ctx.lineTo(ex - 6, arrowY - 3);
            ctx.lineTo(ex + 6, arrowY - 3);
          }
          ctx.closePath();
          ctx.fill();
        }

        // Saída: losango colorido pelo PnL (onde bateu TP/SL/saída).
        ctx.beginPath();
        ctx.fillStyle = m.pnl >= 0 ? "#22c55e" : "#ef4444";
        const s = 4;
        ctx.moveTo(xx, exitY - s);
        ctx.lineTo(xx + s, exitY);
        ctx.lineTo(xx, exitY + s);
        ctx.lineTo(xx - s, exitY);
        ctx.closePath();
        ctx.fill();
      });
    }

    // Pré-visualização do desenho pendente (linha de tendência)
    if (pending && hover) {
      const hd = toData(hover.x, hover.y);
      if (hd) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(idxToX(pending.idx), yOf(pending.price));
        ctx.lineTo(idxToX(hd.idx), yOf(hd.price));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    // Última cotação + etiqueta no eixo
    const lastCandle = view[view.length - 1];
    const ly = yOf(lastCandle.c);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(PAD_L, ly);
    ctx.lineTo(innerW, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lastCandle.c >= lastCandle.o ? "#22c55e" : "#ef4444";
    ctx.fillRect(innerW, ly - 9, PAD_R, 18);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillText(formatPrice(lastCandle.c), innerW + 5, ly + 4);

    // Sub-painéis: volume, RSI, MACD
    let paneTop = mainBottom + gap;
    for (const key of subKeys) {
      ctx.fillStyle = "rgba(255,255,255,0.02)";
      ctx.fillRect(PAD_L, paneTop, innerW, subH);
      ctx.strokeStyle = "hsl(220 14% 18%)";
      ctx.strokeRect(PAD_L, paneTop, innerW, subH);
      ctx.fillStyle = "hsl(150 8% 55%)";
      ctx.font = "9px JetBrains Mono, monospace";
      ctx.fillText(key.toUpperCase(), PAD_L + 4, paneTop + 10);

      if (key === "vol") {
        const maxV = Math.max(1, ...view.map((c) => c.v));
        for (let i = 0; i < view.length; i++) {
          const c = view[i];
          const h = (c.v / maxV) * (subH - 14);
          const x = xOf(i);
          ctx.fillStyle = c.c >= c.o ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)";
          ctx.fillRect(x - Math.max(1, cw * 0.3), paneTop + subH - h - 4, Math.max(1, cw * 0.6), h);
        }
      } else if (key === "rsi" && series.rsi) {
        const yR = (v: number) => paneTop + 4 + (1 - v / 100) * (subH - 10);
        [30, 50, 70].forEach((lvl) => {
          ctx.strokeStyle = "hsl(220 14% 22%)";
          ctx.beginPath();
          ctx.moveTo(PAD_L, yR(lvl));
          ctx.lineTo(innerW, yR(lvl));
          ctx.stroke();
        });
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let s = false;
        for (let i = 0; i < view.length; i++) {
          const v = series.rsi[start + i];
          if (v == null) {
            s = false;
            continue;
          }
          const x = xOf(i);
          const y = yR(v);
          if (!s) {
            ctx.moveTo(x, y);
            s = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (key === "macd" && series.macd) {
        const vals: number[] = [];
        for (let i = start; i < endI; i++) {
          const m = series.macd.macd[i];
          const sg = series.macd.signal[i];
          const h = series.macd.histogram[i];
          if (m != null) vals.push(m);
          if (sg != null) vals.push(sg);
          if (h != null) vals.push(h);
        }
        const mx = Math.max(1e-9, ...vals.map((v) => Math.abs(v)));
        const yM = (v: number) => paneTop + subH / 2 - (v / mx) * (subH / 2 - 8);
        ctx.strokeStyle = "hsl(220 14% 22%)";
        ctx.beginPath();
        ctx.moveTo(PAD_L, yM(0));
        ctx.lineTo(innerW, yM(0));
        ctx.stroke();
        for (let i = 0; i < view.length; i++) {
          const h = series.macd.histogram[start + i];
          if (h == null) continue;
          const x = xOf(i);
          ctx.fillStyle = h >= 0 ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)";
          const y0 = yM(0);
          const y1 = yM(h);
          ctx.fillRect(x - Math.max(1, cw * 0.3), Math.min(y0, y1), Math.max(1, cw * 0.6), Math.abs(y1 - y0));
        }
        const line = (arr: (number | null)[], color: string) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          let s = false;
          for (let i = 0; i < view.length; i++) {
            const v = arr[start + i];
            if (v == null) {
              s = false;
              continue;
            }
            const x = xOf(i);
            const y = yM(v);
            if (!s) {
              ctx.moveTo(x, y);
              s = true;
            } else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        line(series.macd.macd, "#38bdf8");
        line(series.macd.signal, "#f59e0b");
      }

      paneTop += subH + gap;
    }

    // Crosshair
    if (hover && hover.x >= PAD_L && hover.x <= innerW && hover.y >= mainTop && hover.y <= mainBottom) {
      const price = toData(hover.x, hover.y)?.price ?? null;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(hover.x, mainTop);
      ctx.lineTo(hover.x, mainBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD_L, hover.y);
      ctx.lineTo(innerW, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (price != null) {
        ctx.fillStyle = "#2a2e39";
        ctx.fillRect(innerW, hover.y - 9, PAD_R, 18);
        ctx.fillStyle = "#fff";
        ctx.font = "10px JetBrains Mono, monospace";
        ctx.fillText(formatPrice(price), innerW + 5, hover.y + 4);
      }
    }
  }, [size, view, entryLines, series, ind, endOffset, drawings, pending, hover, total, drawColor, markers]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-1 px-1 pb-1 text-[10px] shrink-0">
        <ToolButton active={tool === "cursor"} onClick={() => { setTool("cursor"); pendingRef.current = null; setPending(null); }} title="Cursor: arrastar o gráfico para mover; passar por cima de uma linha e arrastar para a mover">
          <MousePointer2 className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={tool === "trend"} onClick={() => setTool("trend")} title="Linha de tendência (2 cliques)">
          <PenLine className="h-3 w-3" /> Linha
        </ToolButton>
        <ToolButton active={tool === "hline"} onClick={() => setTool("hline")} title="Linha horizontal">
          <Minus className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={tool === "vline"} onClick={() => setTool("vline")} title="Linha vertical">
          <MoveVertical className="h-3 w-3" />
        </ToolButton>
        <ToolButton active={tool === "erase"} onClick={() => setTool("erase")} title="Apagar desenho">
          <Eraser className="h-3 w-3" />
        </ToolButton>
        <input
          type="color"
          value={drawColor}
          onChange={(e) => setDrawColor(e.target.value)}
          title="Cor do desenho"
          className="h-5 w-7 bg-transparent border border-border rounded cursor-pointer"
        />
        <ToolButton onClick={() => setDrawings([])} title="Limpar desenhos">
          <Trash2 className="h-3 w-3" />
        </ToolButton>
        <span className="mx-1 h-4 w-px bg-border" />
        <ToolButton active={ind.ema} onClick={() => setInd((s) => ({ ...s, ema: !s.ema }))} title="EMA 20 / 50">EMA</ToolButton>
        <ToolButton active={ind.boll} onClick={() => setInd((s) => ({ ...s, boll: !s.boll }))} title="Bollinger 20,2">BOLL</ToolButton>
        <ToolButton active={ind.vol} onClick={() => setInd((s) => ({ ...s, vol: !s.vol }))} title="Volume">VOL</ToolButton>
        <ToolButton active={ind.rsi} onClick={() => setInd((s) => ({ ...s, rsi: !s.rsi }))} title="RSI 14">RSI</ToolButton>
        <ToolButton active={ind.macd} onClick={() => setInd((s) => ({ ...s, macd: !s.macd }))} title="MACD 12/26/9">MACD</ToolButton>
        <span className="ml-auto" />
        <ToolButton onClick={resetView} title="Repor vista (duplo-clique)">
          <Maximize2 className="h-3 w-3" /> reset
        </ToolButton>
      </div>

      <div
        ref={wrapRef}
        className={cn(
          "flex-1 min-h-0 bg-[#131722] rounded-sm overflow-hidden relative select-none touch-none",
          tool === "cursor"
            ? drawDragRef.current || hoverDrawId
              ? "cursor-move"
              : "cursor-grab active:cursor-grabbing"
            : "cursor-crosshair"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { dragRef.current = null; drawDragRef.current = null; setHover(null); setHoverDrawId(null); }}
        onDoubleClick={() => { if (tool === "cursor") resetView(); }}
      >
        <canvas ref={canvasRef} />
        <div className="absolute top-2 left-2 flex items-center gap-2 text-[9px] font-mono text-white/45 uppercase tracking-widest pointer-events-none">
          <span>Binance Futures · tempo real</span>
          <span className="text-white/25">·</span>
          <span>{view.length} velas</span>
          {drawings.length > 0 && <><span className="text-white/25">·</span><span>{drawings.length} desenhos</span></>}
        </div>
        <span className="absolute bottom-2 left-2 text-[9px] font-mono text-white/35 pointer-events-none">
          scroll = zoom · arrastar = mover {tool !== "cursor" ? "· clica para desenhar" : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Página ───
export default function Trading() {
  const paper = useFuturesPaper();
  const [params] = useSearchParams();
  const symbolFromUrl = (params.get("symbol") || "").toUpperCase();
  const isValidUrlSymbol = /^[A-Z0-9]{2,20}USDT$/.test(symbolFromUrl);

  const [symbol, setSymbol] = useState<string>(
    isValidUrlSymbol ? symbolFromUrl : FUTURES_TRADING_SYMBOLS[0]
  );

  // Deep-link do Mercado / Monitorização: /trading?symbol=XXXUSDT
  useEffect(() => {
    if (isValidUrlSymbol && symbolFromUrl !== symbol) setSymbol(symbolFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolFromUrl]);
  const [tf, setTf] = useState<string>(FUTURES_INTERVALS[2]);
  const [tickers, setTickers] = useState<BinanceTicker24h[]>([]);
  const [tickersNote, setTickersNote] = useState("A ligar à Binance Futures…");
  const [klines, setKlines] = useState<BinanceKline[]>([]);
  const [klinesLoading, setKlinesLoading] = useState(false);
  const [liveMarks, setLiveMarks] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);
  const [search, setSearch] = useState("");
  const [leftTab, setLeftTab] = useState<"assets" | "positions" | "orders" | "history">("assets");

  // Painel lateral recolhível
  const [showSidebar, setShowSidebar] = useState(true);

  // ── Modo backtest ──
  const backtestEnabled = useBacktestMode((s) => s.enabled);
  const setBacktestEnabled = useBacktestMode((s) => s.setEnabled);
  const setTradingMode = useStore((s) => s.setTradingMode);
  const activeStrategyId = useActiveStrategy((s) => s.activeStrategyId);
  const activeDirection = useActiveStrategy((s) => s.direction);
  const invertMap = useStrategyInvert((s) => s.invert);
  const [btStrategyId, setBtStrategyId] = useState<string>("");
  const [btRunning, setBtRunning] = useState(false);
  const [btError, setBtError] = useState("");
  const [btAmount, setBtAmount] = useState("100");
  const [btLeverage, setBtLeverage] = useState("5");
  const [btTp, setBtTp] = useState("3");
  const [btSl, setBtSl] = useState("1.5");
  const [btCapital, setBtCapital] = useState("10000");
  const [btUseStratStops, setBtUseStratStops] = useState(false);
  const lastRun = useBacktestResults((s) => s.last);
  const setLastRun = useBacktestResults((s) => s.setLast);

  // Direção efetivamente aplicada (só quando a estratégia escolhida é a ligada).
  const btDir = btStrategyId && btStrategyId === activeStrategyId ? activeDirection : "all";
  const btInvert = !!invertMap[btStrategyId];
  // O resultado só é válido para o símbolo/TF em que correu.
  const btMatches = !!lastRun && lastRun.symbol === symbol && lastRun.interval === tf;

  useEffect(() => {
    if (backtestEnabled && !btStrategyId) {
      setBtStrategyId(activeStrategyId ?? listAllStrategies()[0]?.id ?? "");
    }
  }, [backtestEnabled, activeStrategyId, btStrategyId]);

  // Ao trocar de símbolo/TF, limpa erros (o resultado fica guardado por símbolo/TF).
  useEffect(() => {
    setBtError("");
  }, [symbol, tf]);

  // Painel de ordem estilo Binance Futures
  const [marginMode, setMarginMode] = useState<MarginMode>("isolated");
  const [leverage, setLeverage] = useState(10);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [amountUsdt, setAmountUsdt] = useState("100");
  const [useTp, setUseTp] = useState(true);
  const [tpPct, setTpPct] = useState("3");
  const [useSl, setUseSl] = useState(true);
  const [slPct, setSlPct] = useState("1.5");
  const [useTrailing, setUseTrailing] = useState(false);
  const [trailingPct, setTrailingPct] = useState("1");
  const [reduceOnly, setReduceOnly] = useState(false);

  const klinesCache = useRef<Record<string, BinanceKline[]>>({});

  // Tickers polling (15s) — todos os futuros (curados primeiro na lista)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchFuturesTickers24h();
        if (cancelled) return;
        setTickers(data.filter((t) => t.symbol.endsWith("USDT")));
        setTickersNote(`Binance Futures USDT-M · ${data.length} pares · ${new Date().toLocaleTimeString()}`);
      } catch (e) {
        if (!cancelled) setTickersNote(`Falha tickers: ${(e as Error).message}`);
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Klines do símbolo ativo (histórico — refresh 30s)
  const loadKlines = useCallback(async (sym: string, timeframe: string) => {
    setKlinesLoading(true);
    try {
      const data = await fetchFuturesKlines(sym, timeframe, 5000);
      klinesCache.current[sym] = data;
      setKlines(data);
    } catch (e) {
      toast.error(`Klines ${sym}: ${(e as Error).message}`);
    } finally {
      setKlinesLoading(false);
    }
  }, []);

  useEffect(() => {
    setKlines([]);
    loadKlines(symbol, tf);
  }, [symbol, tf, loadKlines]);

  useEffect(() => {
    const id = setInterval(() => loadKlines(symbol, tf), 30_000);
    return () => clearInterval(id);
  }, [symbol, tf, loadKlines]);

  // ── Tempo real: WebSocket de kline (fstream) ──
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const applyCandle = (candle: BinanceKline) => {
      setKlines((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.t === candle.t) {
          const copy = prev.slice(0, -1);
          copy.push(candle);
          return copy;
        }
        if (candle.t > last.t) return [...prev.slice(-5999), candle];
        return prev;
      });
      setLiveMarks((m) => (m[symbol] === candle.c ? m : { ...m, [symbol]: candle.c }));
      setLive(true);
    };

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${tf}`);
      } catch {
        scheduleRetry();
        return;
      }
      ws.onopen = () => {
        attempts = 0;
        setLive(true);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const k = msg?.k ?? msg?.data?.k;
          if (!k) return;
          applyCandle({
            t: Number(k.t),
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
            v: parseFloat(k.v),
            closeTime: Number(k.T),
            quoteVolume: parseFloat(k.q),
          });
        } catch {
          /* ignora frames malformados */
        }
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* noop */ }
      };
      ws.onclose = () => {
        if (!closed) scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      attempts += 1;
      setLive(false);
      retry = setTimeout(connect, Math.min(15_000, 1_000 * attempts));
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        try { ws.close(); } catch { /* noop */ }
      }
    };
  }, [symbol, tf]);

  // ── Atualização garantida: polling frequente do mark price ──
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const px = await fetchFuturesMarkPrice(symbol);
        if (cancelled || !Number.isFinite(px)) return;
        setLiveMarks((m) => (m[symbol] === px ? m : { ...m, [symbol]: px }));
        setKlines((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          const updated: BinanceKline = { ...last, c: px, h: Math.max(last.h, px), l: Math.min(last.l, px) };
          if (updated.c === last.c && updated.h === last.h && updated.l === last.l) return prev;
          const copy = prev.slice(0, -1);
          copy.push(updated);
          return copy;
        });
      } catch {
        /* ignora falhas pontuais */
      }
    };
    const id = setInterval(tick, 1_000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  const marks = useMemo(() => {
    const m: Record<string, number> = {};
    tickers.forEach((t) => {
      m[t.symbol] = t.lastPrice;
    });
    Object.assign(m, liveMarks);
    return m;
  }, [tickers, liveMarks]);

  // Motor paper: avalia TP/SL/trailing/liq + fills a cada 3s
  useEffect(() => {
    const id = setInterval(() => {
      const st = useFuturesPaper.getState();
      if (st.positions.length === 0 && st.pending.length === 0) return;
      const needed = new Set<string>();
      st.positions.forEach((p) => needed.add(p.symbol));
      st.pending.forEach((o) => needed.add(o.symbol));
      const bars: Record<string, { high: number; low: number; mark: number }> = {};
      needed.forEach((sym) => {
        const cached = klinesCache.current[sym];
        const mark = marks[sym];
        if (cached && cached.length > 0) {
          const last = cached[cached.length - 1];
          bars[sym] = {
            high: Math.max(last.h, Number.isFinite(mark) ? mark : last.h),
            low: Math.min(last.l, Number.isFinite(mark) ? mark : last.l),
            mark: Number.isFinite(mark) ? mark : last.c,
          };
        } else if (Number.isFinite(mark)) {
          bars[sym] = { high: mark, low: mark, mark };
        }
      });
      if (Object.keys(bars).length > 0) st.evaluateAtMarks(bars);
    }, 3_000);
    return () => clearInterval(id);
  }, [marks]);

  const ticker = useMemo(() => tickers.find((t) => t.symbol === symbol), [tickers, symbol]);
  const mark = liveMarks[symbol] ?? ticker?.lastPrice ?? klines[klines.length - 1]?.c ?? NaN;
  const refPrice = orderType === "limit" ? parseFloat(limitPrice) : mark;

  const amount = parseFloat(amountUsdt);
  const qty = Number.isFinite(refPrice) && refPrice > 0 && Number.isFinite(amount) ? amount / refPrice : NaN;
  const tpNum = useTp ? parseFloat(tpPct) : null;
  const slNum = useSl ? parseFloat(slPct) : null;
  const trNum = useTrailing ? parseFloat(trailingPct) : null;

  const [previewSide, setPreviewSide] = useState<FuturesSide>("LONG");
  const tpCalc = calcFuturesTpSl(previewSide, Number.isFinite(refPrice) ? refPrice : NaN, tpNum, slNum);
  const orderCheck = useMemo(() => {
    if (!Number.isFinite(refPrice) || !Number.isFinite(qty)) return null;
    return validateFuturesOrder({
      price: refPrice,
      qty,
      leverage,
      balanceFree: paper.usdtFree,
      marginMode,
      reduceOnly,
    });
  }, [refPrice, qty, leverage, paper.usdtFree, marginMode, reduceOnly]);

  const estMargin = Number.isFinite(refPrice) && Number.isFinite(qty) ? futuresMargin(refPrice * qty, leverage) : NaN;
  const estLiq = Number.isFinite(refPrice) ? futuresLiqPrice(previewSide, refPrice, leverage) : NaN;
  const estFee = Number.isFinite(refPrice) && Number.isFinite(qty) ? refPrice * qty * FUTURES_FEE_RATE : NaN;

  const canSubmit =
    Number.isFinite(qty) &&
    qty > 0 &&
    tpCalc.ok &&
    (useTrailing ? Number.isFinite(trNum) && (trNum as number) > 0 && (trNum as number) <= 50 : true) &&
    (orderCheck === null || orderCheck.ok || reduceOnly) &&
    (orderType === "market" ? Number.isFinite(mark) : Number.isFinite(refPrice) && refPrice > 0);

  const submitError = !tpCalc.ok
    ? tpCalc.reason
    : useTrailing && (!Number.isFinite(trNum) || (trNum as number) <= 0 || (trNum as number) > 50)
      ? "Trailing deve estar entre 0 e 50%."
      : orderCheck && !orderCheck.ok
        ? orderCheck.reason
        : !Number.isFinite(qty) || qty <= 0
          ? "Indica um valor em USDT válido."
          : null;

  const submit = (side: FuturesSide) => {
    setPreviewSide(side);
    if (tickers.length > 0 && !tickers.some((t) => t.symbol === symbol)) {
      toast.error(`${symbol} sem perpétuo USDT-M listado — só spot na Binance.`);
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Indica um valor em USDT válido.");
      return;
    }
    const check = validateFuturesOrder({
      price: orderType === "limit" ? parseFloat(limitPrice) : mark,
      qty,
      leverage,
      balanceFree: paper.usdtFree,
      marginMode,
      reduceOnly,
    });
    if (!check.ok && !reduceOnly) {
      toast.error(check.reason || "Ordem inválida.");
      return;
    }
    const base = {
      symbol,
      side,
      qty,
      leverage,
      marginMode,
      tpPct: tpNum,
      slPct: slNum,
      trailingPct: trNum,
      reduceOnly,
    };
    const res =
      orderType === "market"
        ? paper.openMarket({ ...base, markPrice: mark })
        : paper.placeLimit({ ...base, limitPrice: parseFloat(limitPrice) });
    if (res.ok) {
      toast.success(
        orderType === "market"
          ? `Ordem ${side} ${symbol} ${leverage}x executada (paper).`
          : `Ordem limite ${side} ${symbol} registada (paper).`
      );
    } else {
      toast.error(res.reason || "Falha ao executar.");
    }
  };

  const filteredSymbols = useMemo(() => {
    const q = search.trim().toUpperCase();
    const rows = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume);
    const all = FUTURES_TRADING_SYMBOLS.map(
      (s) => rows.find((t) => t.symbol === s) ?? ({ symbol: s, lastPrice: NaN, priceChangePercent: NaN, quoteVolume: 0 } as BinanceTicker24h)
    );
    const rest = rows.filter((t) => !(FUTURES_TRADING_SYMBOLS as readonly string[]).includes(t.symbol));
    const list = [...all, ...rest];
    if (!q) return list;
    return list.filter((t) => t.symbol.includes(q));
  }, [tickers, search]);

  const locked = futuresLockedMargin(paper.positions);
  const unreal = futuresUnrealizedTotal(paper.positions, marks);
  const equity = paper.usdtFree + locked + unreal;
  const realized = futuresRealizedPnl(paper.history);
  const today = new Date().toDateString();
  const realizedToday = paper.history
    .filter((t) => new Date(t.closedAt).toDateString() === today)
    .reduce((s, t) => s + t.pnl, 0);

  const myPositions = paper.positions.filter((p) => p.symbol === symbol);
  const chartLines: EntryLine[] = myPositions.flatMap((p) => [
    { price: p.entryPrice, color: "#eab308", label: `${p.side} ${p.leverage}x`, includeInScale: true },
    // LIQ fora da escala vertical (ver cálculo do range no FuturesChart)
    { price: p.liqPrice, color: "#ef4444", label: "LIQ", includeInScale: false },
    ...(p.tpPrice !== null ? [{ price: p.tpPrice, color: "#22c55e", label: "TP", includeInScale: true } as EntryLine] : []),
    ...(p.slPrice !== null ? [{ price: p.slPrice, color: "#f97316", label: "SL", includeInScale: true } as EntryLine] : []),
  ]);

  const posCount = paper.positions.length;
  const ordCount = paper.pending.length;
  const histCount = paper.history.length;

  // ── Backtest: corre a estratégia ligada sobre as klines fechadas do gráfico ──
  const runBacktest = async () => {
    const strat = getCryptoStrategy(btStrategyId);
    if (!strat) {
      setBtError("Escolhe uma estratégia.");
      return;
    }
    setBtRunning(true);
    setBtError("");
    try {
      const capital = parseFloat(btCapital);
      const stake = parseFloat(btAmount);
      const lev = Math.min(125, Math.max(1, parseInt(btLeverage) || 5));
      const tpOv = parseFloat(btTp);
      const slOv = parseFloat(btSl);
      if (!Number.isFinite(capital) || capital <= 0) throw new Error("Capital inicial tem de ser > 0.");
      if (!Number.isFinite(stake) || stake <= 0) throw new Error("Valor de entrada tem de ser > 0.");
      if (stake > capital) throw new Error("Valor de entrada não pode exceder o capital.");
      if (!btUseStratStops && (!(tpOv > 0) || !(slOv > 0))) throw new Error("Stop-gain e stop-loss têm de ser > 0.");
      // Usa SEMPRE as klines do próprio gráfico (índices alinhados com os marcadores).
      const closed = klines.slice(0, -1); // sem a vela em formação
      if (closed.length < strat.minCandles + 2) throw new Error("Aguarda carregar mais velas para esta estratégia.");
      const paramsv = Object.fromEntries((strat.params ?? []).map((p) => [p.key, p.default]));
      const wrapped = {
        ...strat,
        onSignal: (ctx: Parameters<typeof strat.onSignal>[0]) => {
          const sig = applyDirectionAndInvert(strat.onSignal({ ...ctx, params: paramsv }), btDir, btInvert);
          if (!sig) return null;
          // Override dos stops pelo painel (a não ser que use os da estratégia).
          if (!btUseStratStops) {
            return { ...sig, stopGainPct: tpOv, stopLossPct: slOv, reason: `${sig.reason} · TP${tpOv}%/SL${slOv}%` };
          }
          return sig;
        },
      };
      // Spread bid-ask real do ativo (custo de transação; 0 se indisponível).
      const spreadPct = await fetchFuturesSpreadPct(symbol).catch(() => 0);
      const res = runCryptoBacktest(closed, wrapped, {
        capital,
        stakePerEntry: stake,
        mode: "futures",
        leverage: lev,
        strategyParams: paramsv,
        spreadPct,
      });
      setLastRun({
        id: `${Date.now()}`,
        ranAt: Date.now(),
        symbol,
        interval: tf,
        strategyId: btStrategyId,
        strategyName: strat.name,
        direction: btDir,
        capital,
        stakePerEntry: stake,
        leverage: lev,
        spreadPct,
        result: res,
        times: res.trades.map((t) => ({
          entry: closed[t.entryIndex]?.t ?? 0,
          exit: closed[t.exitIndex]?.t ?? 0,
        })),
      });
      if (res.totalTrades === 0) toast.info("Backtest sem entradas — a estratégia não deu sinal neste período.");
      else toast.success(`Backtest: ${res.totalTrades} trades · PnL $${res.pnl.toFixed(2)} · WR ${res.winRate.toFixed(1)}%.`);
    } catch (e) {
      setBtError(e instanceof Error ? e.message : "Falha no backtest.");
    } finally {
      setBtRunning(false);
    }
  };

  // Marcadores mapeados por TEMPO de vela → sobrevivem a deslocamentos da janela.
  const backtestMarkers: ChartMarker[] = useMemo(() => {
    if (!backtestEnabled || !lastRun || !btMatches) return [];
    const idxByT = new Map<number, number>();
    klines.forEach((k, i) => idxByT.set(k.t, i));
    const out: ChartMarker[] = [];
    lastRun.result.trades.forEach((t, i) => {
      const entryIndex = idxByT.get(lastRun.times[i]?.entry ?? -1);
      const exitIndex = idxByT.get(lastRun.times[i]?.exit ?? -1);
      if (entryIndex === undefined || exitIndex === undefined) return;
      out.push({
        entryIndex,
        exitIndex,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        takeProfitPrice: t.takeProfitPrice,
        stopLossPrice: t.stopLossPrice,
        side: t.side,
        pnl: t.pnl,
        reason: t.reason,
      });
    });
    return out;
  }, [backtestEnabled, lastRun, btMatches, klines]);

  return (
    <AppShell>
      <div className="h-full flex gap-2 p-2">
        {/* Barra lateral esquerda: Ativos + Posições + Ordens + Histórico */}
        {showSidebar ? (
          <Card className="w-[268px] shrink-0 bg-secondary/20 border-border/50 flex flex-col overflow-hidden">
            <CardHeader className="py-2 px-3 border-b border-border/50 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <CardTitle className="text-xs font-bold">Painel</CardTitle>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  title="Recolher painel"
                  onClick={() => setShowSidebar(false)}
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </button>
              </div>
              <Tabs value={leftTab} onValueChange={(v) => setLeftTab(v as typeof leftTab)}>
                <TabsList className="grid grid-cols-4 h-7 text-[10px] p-0.5">
                  <TabsTrigger value="assets" className="text-[10px] h-6">Ativos</TabsTrigger>
                  <TabsTrigger value="positions" className="text-[10px] h-6">Pos ({posCount})</TabsTrigger>
                  <TabsTrigger value="orders" className="text-[10px] h-6">Ord ({ordCount})</TabsTrigger>
                  <TabsTrigger value="history" className="text-[10px] h-6">Hist ({histCount})</TabsTrigger>
                </TabsList>
              </Tabs>
              {leftTab === "assets" && (
                <div className="relative mt-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar par…"
                    className="h-7 pl-7 text-xs"
                  />
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-0 overflow-hidden">
              <Tabs value={leftTab} className="h-full">
                {/* ── Ativos ── */}
                <TabsContent value="assets" className="m-0 h-full overflow-y-auto">
                  {filteredSymbols.map((t) => (
                    <button
                      key={t.symbol}
                      onClick={() => (FUTURES_TRADING_SYMBOLS as readonly string[]).includes(t.symbol) && setSymbol(t.symbol)}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs font-mono hover:bg-secondary/40 ${
                        t.symbol === symbol ? "bg-primary/10 border-l-2 border-primary" : "border-l-2 border-transparent"
                      }`}
                    >
                      <span className="font-bold text-white">
                        {t.symbol.replace("USDT", "")}
                        <span className="text-muted-foreground font-normal">/USDT</span>
                      </span>
                      <span className="text-right">
                        <span className="block">${formatPrice(Number.isFinite(liveMarks[t.symbol]) ? liveMarks[t.symbol] : t.lastPrice)}</span>
                        <span className={`block text-[10px] ${t.priceChangePercent >= 0 ? "text-bull" : "text-bear"}`}>
                          {Number.isFinite(t.priceChangePercent) ? `${t.priceChangePercent >= 0 ? "+" : ""}${t.priceChangePercent.toFixed(2)}%` : "—"}
                        </span>
                      </span>
                    </button>
                  ))}
                  {filteredSymbols.length === 0 && <p className="text-xs text-muted-foreground p-3">Sem pares.</p>}
                </TabsContent>

                {/* ── Posições ── */}
                <TabsContent value="positions" className="m-0 h-full overflow-y-auto p-2 flex flex-col gap-2">
                  {posCount === 0 && <p className="text-xs text-muted-foreground">Sem posições abertas.</p>}
                  {paper.positions.map((p) => {
                    const m = marks[p.symbol];
                    const pnl = Number.isFinite(m) ? futuresLivePnl(p, m) : NaN;
                    const roe = Number.isFinite(m) ? futuresLiveRoe(p, m) : NaN;
                    return (
                      <div key={p.id} className="rounded border border-border/50 bg-background/40 p-2 text-[11px] font-mono flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">
                            {p.symbol.replace("USDT", "")}
                            <span className={`ml-1 text-[9px] px-1 rounded ${p.side === "LONG" ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"}`}>
                              {p.side} {p.leverage}x
                            </span>
                          </span>
                          <span className={`font-bold ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {Number.isFinite(pnl) ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—"}
                            {Number.isFinite(roe) ? ` (${roe >= 0 ? "+" : ""}${roe.toFixed(1)}%)` : ""}
                          </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Entrada ${formatPrice(p.entryPrice)}</span>
                          <span>Mark ${formatPrice(m ?? NaN)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Qtd {p.qty.toPrecision(6)}</span>
                          <span>{p.marginMode === "isolated" ? "Isolada" : "Cruzada"}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                          <span className="text-rose-400">Liq ${formatPrice(p.liqPrice)}</span>
                          {p.tpPrice !== null && <span className="text-bull">TP ${formatPrice(p.tpPrice)}</span>}
                          {p.slPrice !== null && <span className="text-orange-400">SL ${formatPrice(p.slPrice)}</span>}
                          {p.trailingPct !== null && <span>Trail {p.trailingPct}%</span>}
                          {p.reduceOnly && <span>RO</span>}
                        </div>
                        <div className="flex gap-1 pt-0.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 flex-1 text-[10px]"
                            onClick={() => {
                              if (!Number.isFinite(m)) return toast.error("Sem cotação para fechar.");
                              paper.closePosition(p.id, m, "REDUCE_ONLY", p.qty / 2);
                              toast.info("Reduzida 50% (paper).");
                            }}
                          >
                            ½ fechar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 flex-1 text-[10px] text-rose-400"
                            onClick={() => {
                              if (!Number.isFinite(m)) return toast.error("Sem cotação para fechar.");
                              paper.closePosition(p.id, m, p.reduceOnly ? "REDUCE_ONLY" : "MANUAL");
                              toast.info(`${p.symbol} fechada (paper).`);
                            }}
                          >
                            <X className="h-3 w-3 mr-1" /> Fechar
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </TabsContent>

                {/* ── Ordens ── */}
                <TabsContent value="orders" className="m-0 h-full overflow-y-auto p-2 flex flex-col gap-2">
                  {ordCount === 0 && <p className="text-xs text-muted-foreground">Sem ordens pendentes.</p>}
                  {paper.pending.map((o) => (
                    <div key={o.id} className="rounded border border-border/50 bg-background/40 p-2 text-[11px] font-mono flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className={`font-bold ${o.side === "LONG" ? "text-bull" : "text-bear"}`}>
                          {o.side} <span className="text-white">{o.symbol.replace("USDT", "")}</span>
                        </span>
                        <span className="text-muted-foreground">{o.leverage}x {o.marginMode === "isolated" ? "Iso" : "Cross"}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>{o.qty.toPrecision(6)} @ ${formatPrice(o.limitPrice)}</span>
                        <span className="text-[10px]">exp {new Date(o.expiresAt).toLocaleTimeString()}</span>
                      </div>
                      <Button size="sm" variant="outline" className="h-6 text-[10px] text-rose-400" onClick={() => paper.cancelPending(o.id)}>
                        <Trash2 className="h-3 w-3 mr-1" /> Cancelar
                      </Button>
                    </div>
                  ))}
                </TabsContent>

                {/* ── Histórico ── */}
                <TabsContent value="history" className="m-0 h-full overflow-y-auto p-2 flex flex-col gap-1.5">
                  {histCount === 0 && <p className="text-xs text-muted-foreground">Sem operações fechadas.</p>}
                  {paper.history.slice(0, 120).map((t) => (
                    <div key={t.id + t.closedAt} className="rounded border border-border/40 bg-background/30 p-1.5 text-[10px] font-mono flex flex-col gap-0.5">
                      <div className="flex justify-between">
                        <span className="text-white">
                          {t.symbol.replace("USDT", "")}{" "}
                          <span className={t.side === "LONG" ? "text-bull" : "text-bear"}>{t.side} {t.leverage}x</span>
                        </span>
                        <span className={t.pnl >= 0 ? "text-bull" : "text-bear"}>
                          {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} ({t.roePct >= 0 ? "+" : ""}{t.roePct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>${formatPrice(t.entryPrice)} → ${formatPrice(t.exitPrice)}</span>
                        <span>{t.reason.replace(/_/g, " ")}</span>
                      </div>
                      <div className="text-muted-foreground/70">{new Date(t.closedAt).toLocaleString()}</div>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <div className="w-8 shrink-0 flex flex-col items-center pt-2 border-r border-border/40">
            <button
              className="text-muted-foreground hover:text-primary"
              title="Expandir painel (ativos/posições/ordens/histórico)"
              onClick={() => setShowSidebar(true)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            {posCount > 0 && <span className="text-[9px] text-bull mt-1 font-mono">{posCount}</span>}
          </div>
        )}

        {/* Gráfico — ocupa todo o restante */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
          {/* Barra do símbolo */}
          <div className="flex flex-wrap items-center gap-3 text-xs shrink-0">
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-9 w-44 text-sm font-mono font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {!(FUTURES_TRADING_SYMBOLS as readonly string[]).includes(symbol) && (
                  <SelectItem key={symbol} value={symbol} className="font-mono text-xs">
                    {symbol} · Perp
                  </SelectItem>
                )}
                {FUTURES_TRADING_SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">
                    {s} · Perp
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="font-mono flex items-center gap-2">
              <span className="text-lg font-bold text-white">${formatPrice(mark)}</span>
              {tickers.length > 0 && !tickers.some((t) => t.symbol === symbol) && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-sm border border-warning/50 text-warning"
                  title="Este par não tem perpétuo USDT-M listado na Binance — dados de fallback spot, ordens bloqueadas."
                >
                  SPOT · sem futuro
                </span>
              )}
              <span
                title={tickersNote}
                className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${live ? "border-bull/50 text-bull" : "border-border text-muted-foreground"}`}
              >
                {live ? "● LIVE" : "○ 1s"}
              </span>
              <span className={`font-bold ${Number(ticker?.priceChangePercent) >= 0 ? "text-bull" : "text-bear"}`}>
                {ticker && Number.isFinite(ticker.priceChangePercent)
                  ? `${ticker.priceChangePercent >= 0 ? "+" : ""}${ticker.priceChangePercent.toFixed(2)}%`
                  : "—"}
              </span>
            </div>
            <div className="text-muted-foreground font-mono hidden md:flex gap-3">
              <span>Máx 24h ${formatPrice(ticker?.highPrice ?? NaN)}</span>
              <span>Mín 24h ${formatPrice(ticker?.lowPrice ?? NaN)}</span>
              <span>Vol {ticker ? `$${(ticker.quoteVolume / 1_000_000).toFixed(1)}M` : "—"}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] uppercase text-muted-foreground font-bold">USDT-M Perp · Paper</span>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => loadKlines(symbol, tf)}>
                <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
              </Button>
            </div>
          </div>

          <Card className="flex-1 min-h-0 flex flex-col bg-secondary/20 border-border/50 overflow-hidden">
            <CardHeader className="py-2 px-3 border-b border-border/50 flex flex-row items-center gap-2 shrink-0">
              <CardTitle className="text-xs font-bold">{symbol} · Perp USDT-M</CardTitle>
              <div className="ml-auto flex items-center gap-1">
                {FUTURES_INTERVALS.map((tfi) => (
                  <button
                    key={tfi}
                    onClick={() => setTf(tfi)}
                    className={`px-2 py-1 rounded text-[11px] font-mono hover:bg-secondary/60 ${
                      tf === tfi ? "text-primary bg-secondary" : "text-muted-foreground"
                    }`}
                  >
                    {tfi}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-2 flex-1 min-h-0">
              {klinesLoading && klines.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                  A carregar velas…
                </div>
              ) : (
                <FuturesChart
                  klines={klines}
                  entryLines={chartLines}
                  markers={backtestMarkers}
                  fitKey={backtestEnabled && btMatches && lastRun ? lastRun.id : undefined}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Painel de ordem */}
        <div className="w-[300px] shrink-0 min-h-0 overflow-y-auto flex flex-col gap-2">
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="py-2 px-3 border-b border-border/50">
              <CardTitle className="text-xs font-bold flex items-center gap-2">
                <Wallet className="h-3.5 w-3.5" /> Conta futuros paper
              </CardTitle>
              <CardDescription className="text-[10px]">
                Taxa taker {(FUTURES_FEE_RATE * 100).toFixed(2)}%/lado · spot paper usa {(SPOT_PAPER_FEE * 100).toFixed(1)}% (contas separadas)
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 grid grid-cols-2 gap-2 text-xs font-mono">
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Livre</div><span className="text-white font-bold">${paper.usdtFree.toFixed(2)}</span></div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Margem presa</div>${locked.toFixed(2)}</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Não realizado</div><span className={unreal >= 0 ? "text-bull" : "text-bear"}>{unreal >= 0 ? "+" : ""}${unreal.toFixed(2)}</span></div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Equity</div>${equity.toFixed(2)}</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Realizado hoje</div><span className={realizedToday >= 0 ? "text-bull" : "text-bear"}>{realizedToday >= 0 ? "+" : ""}${realizedToday.toFixed(2)}</span></div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Realizado total</div><span className={realized >= 0 ? "text-bull" : "text-bear"}>{realized >= 0 ? "+" : ""}${realized.toFixed(2)}</span></div>
              <div className="col-span-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[11px] text-muted-foreground"
                  onClick={() => {
                    if (confirm(`Repor a conta futuros paper para $${FUTURES_PAPER_START_USDT.toLocaleString()}?`)) {
                      paper.resetPaper();
                      toast.info("Conta futuros paper reposta.");
                    }
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" /> Repor conta
                </Button>
              </div>
            </CardContent>
          </Card>

          {backtestEnabled ? (
            <Card className="bg-warning/10 border-warning/40">
              <CardHeader className="py-2 px-3 border-b border-warning/30">
                <CardTitle className="text-xs font-bold flex items-center gap-2 text-warning">
                  <FlaskConical className="h-3.5 w-3.5" /> MODO BACKTEST
                </CardTitle>
                <CardDescription className="text-[10px]">
                  Estas configurações aplicam-se ao backtest (klines reais, conta paper).
                </CardDescription>
              </CardHeader>
              <CardContent className="p-3 flex flex-col gap-3 text-xs">
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase font-bold">Estratégia</label>
                  <select
                    value={btStrategyId}
                    onChange={(e) => setBtStrategyId(e.target.value)}
                    className="h-8 w-full mt-1 text-xs bg-secondary/50 border border-border rounded px-2 font-mono"
                  >
                    {listAllStrategies().map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground font-mono mt-1">
                    {symbol} · {tf}{btDir !== "all" ? ` · ${btDir}` : ""}
                    {btInvert && <span className="ml-1 text-warning font-bold">· INVERTIDO</span>}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold">Valor de entrada $</label>
                    <NumStepper value={btAmount} onChange={setBtAmount} min={1} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold">Alavancagem x</label>
                    <NumStepper value={btLeverage} onChange={setBtLeverage} min={1} max={125} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold">Stop-gain %</label>
                    <NumStepper value={btTp} onChange={setBtTp} min={0.1} disabled={btUseStratStops} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold">Stop-loss %</label>
                    <NumStepper value={btSl} onChange={setBtSl} min={0.1} disabled={btUseStratStops} />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                  <Checkbox checked={btUseStratStops} onCheckedChange={(v) => setBtUseStratStops(!!v)} className="h-3.5 w-3.5" />
                  Usar os stops definidos pela própria estratégia
                </label>

                <div>
                  <label className="text-[9px] text-muted-foreground uppercase font-bold">Capital inicial $</label>
                  <NumStepper value={btCapital} onChange={setBtCapital} min={1} />
                </div>

                {btError && <p className="text-[11px] text-rose-400">{btError}</p>}

                <Button onClick={runBacktest} disabled={btRunning} className="h-10 text-xs font-bold w-full">
                  <Play className="h-3.5 w-3.5 mr-1" /> {btRunning ? "A correr…" : "Rodar backtesting"}
                </Button>

                {btMatches && lastRun && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div><div className="text-[9px] uppercase text-muted-foreground">Trades</div><div className="font-mono font-bold">{lastRun.result.totalTrades}</div></div>
                    <div><div className="text-[9px] uppercase text-muted-foreground">Win rate</div><div className="font-mono font-bold">{lastRun.result.winRate.toFixed(1)}%</div></div>
                    <div><div className="text-[9px] uppercase text-muted-foreground">PnL</div><div className={`font-mono font-bold ${lastRun.result.pnl >= 0 ? "text-bull" : "text-bear"}`}>{lastRun.result.pnl >= 0 ? "+" : ""}${lastRun.result.pnl.toFixed(2)}</div></div>
                    <div><div className="text-[9px] uppercase text-muted-foreground">DD máx</div><div className="font-mono font-bold">{lastRun.result.maxDrawdownPct.toFixed(1)}%</div></div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="flex-1 h-8 text-[11px]" asChild>
                    <Link to="/backtest-stats"><BarChart3 className="h-3.5 w-3.5 mr-1" /> Estatísticas</Link>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-[11px] text-muted-foreground" onClick={() => { setBacktestEnabled(false); setTradingMode("demo"); }}>
                    <X className="h-3.5 w-3.5 mr-1" /> Sair
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="py-2 px-3 border-b border-border/50">
              <CardTitle className="text-xs font-bold">Ordem · {symbol} Perp</CardTitle>
              <CardDescription className="text-[10px]">Mark ${formatPrice(mark)} · reduce-only nunca aumenta posição</CardDescription>
            </CardHeader>
            <CardContent className="p-3 flex flex-col gap-3 text-xs">
              {/* Margin mode */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-background/60 rounded">
                {(["isolated", "cross"] as MarginMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMarginMode(m)}
                    className={`py-1.5 rounded text-[11px] font-bold ${
                      marginMode === m ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "isolated" ? "Isolada" : "Cruzada"}
                  </button>
                ))}
              </div>

              {/* Leverage slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[9px] text-muted-foreground uppercase font-bold">Alavancagem</label>
                  <div className="flex items-center gap-1">
                    <Input
                      value={String(leverage)}
                      onChange={(e) => {
                        const v = Math.round(Number(e.target.value));
                        if (Number.isFinite(v)) setLeverage(Math.min(125, Math.max(1, v)));
                      }}
                      className="h-6 w-14 text-[11px] font-mono text-right"
                      inputMode="numeric"
                    />
                    <span className="font-bold text-primary">x</span>
                  </div>
                </div>
                <Slider value={[leverage]} min={1} max={125} step={1} onValueChange={([v]) => setLeverage(v)} />
                <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-0.5">
                  <span>1x</span><span>25x</span><span>50x</span><span>75x</span><span>125x</span>
                </div>
              </div>

              {/* Tipo */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-background/60 rounded">
                {(["market", "limit"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    className={`py-1.5 rounded text-[11px] font-bold ${
                      orderType === t ? "bg-secondary text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "market" ? "Mercado" : "Limite"}
                  </button>
                ))}
              </div>
              {orderType === "limit" && (
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Preço limite (USDT)</label>
                  <Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={formatPrice(mark)} className="h-8 text-xs font-mono" inputMode="decimal" />
                </div>
              )}

              {/* Quantidade */}
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Tamanho (USDT)</label>
                <Input value={amountUsdt} onChange={(e) => setAmountUsdt(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
                <div className="grid grid-cols-4 gap-1 mt-1">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => {
                        const invest = (paper.usdtFree * pct) / 100;
                        const px = orderType === "limit" ? parseFloat(limitPrice) : mark;
                        if (Number.isFinite(px) && px > 0) setAmountUsdt((invest * leverage).toFixed(2));
                      }}
                      className="text-[10px] py-1 border border-border rounded-sm text-muted-foreground hover:text-primary hover:border-primary"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                  ≈ {Number.isFinite(qty) && qty > 0 ? qty.toPrecision(6) : "—"} {symbol.replace("USDT", "")}
                  {Number.isFinite(estMargin) && <span> · margem ${estMargin.toFixed(2)} · taxa ~${estFee.toFixed(2)}</span>}
                </p>
              </div>

              {/* TP/SL */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-1 mb-1">
                    <Checkbox checked={useTp} onCheckedChange={(v) => setUseTp(!!v)} className="h-3 w-3" /> TP %
                  </label>
                  <Input value={tpPct} disabled={!useTp} onChange={(e) => setTpPct(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
                  <p className="text-[10px] text-bull mt-0.5 font-mono">{useTp && tpCalc.ok && tpCalc.tp != null ? `$${formatPrice(tpCalc.tp)}` : "—"}</p>
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-1 mb-1">
                    <Checkbox checked={useSl} onCheckedChange={(v) => setUseSl(!!v)} className="h-3 w-3" /> SL %
                  </label>
                  <Input value={slPct} disabled={!useSl} onChange={(e) => setSlPct(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
                  <p className="text-[10px] text-bear mt-0.5 font-mono">{useSl && tpCalc.ok && tpCalc.sl != null ? `$${formatPrice(tpCalc.sl)}` : "—"}</p>
                </div>
              </div>

              {/* Trailing + reduce-only */}
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-1 mb-1">
                  <Checkbox checked={useTrailing} onCheckedChange={(v) => setUseTrailing(!!v)} className="h-3 w-3" /> Trailing stop %
                </label>
                <Input value={trailingPct} disabled={!useTrailing} onChange={(e) => setTrailingPct(e.target.value)} placeholder="Ex: 1" className="h-8 text-xs font-mono" inputMode="decimal" />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                <Checkbox checked={reduceOnly} onCheckedChange={(v) => setReduceOnly(!!v)} className="h-3.5 w-3.5" />
                Reduce-only (só reduz/fecha — nunca abre nem aumenta)
              </label>

              <p className="text-[10px] text-muted-foreground font-mono">
                Liq. estimada ({previewSide}) ${formatPrice(estLiq)} · modo {marginMode === "isolated" ? "Isolada" : "Cruzada"}
              </p>
              {submitError && <p className="text-[11px] text-rose-400">{submitError}</p>}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  disabled={!canSubmit}
                  onClick={() => submit("LONG")}
                  onMouseEnter={() => setPreviewSide("LONG")}
                  className="h-10 text-xs font-bold bg-bull hover:bg-bull/90 text-white"
                >
                  <ArrowUp className="h-3.5 w-3.5 mr-1" /> Comprar LONG
                </Button>
                <Button
                  disabled={!canSubmit}
                  onClick={() => submit("SHORT")}
                  onMouseEnter={() => setPreviewSide("SHORT")}
                  className="h-10 text-xs font-bold bg-bear hover:bg-bear/90 text-white"
                >
                  <ArrowDown className="h-3.5 w-3.5 mr-1" /> Vender SHORT
                </Button>
              </div>
            </CardContent>
          </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// Re-export para compatibilidade com imports existentes.
export { useFuturesPaper as useTradingPaper };
