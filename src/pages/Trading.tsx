// ─── PÁGINA DE TRADING — Binance Crypto Futuros USDT-M (100% Binance) ───
// Perpétuos USDT-M apenas: LONG/SHORT, alavancagem 1–125x, isolated/cross,
// TP/SL %, trailing stop, reduce-only. Conta paper isolada (cryptoFutures.ts).
// Dados Binance Futures (fapi) com fallback spot + atualização em tempo real.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  FUTURES_INTERVALS,
  FUTURES_TRADING_SYMBOLS,
  fetchFuturesKlines,
  fetchFuturesMarkPrice,
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

type EntryLine = { price: number; color: string; label: string };

const PAD_L = 8;
const PAD_R = 78;
const PAD_T = 14;
const PAD_B = 22;

// ─── Gráfico de velas com zoom (scroll) e arrasto (pan), preenche o container ───
function FuturesChart({
  klines,
  entryLines,
}: {
  klines: BinanceKline[];
  entryLines: EntryLine[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 420 });
  const [viewCount, setViewCount] = useState(120);
  const [endOffset, setEndOffset] = useState(0);
  const dragRef = useRef<{ x: number; endOffset: number } | null>(null);

  const total = klines.length;
  const maxOffset = Math.max(0, total - viewCount);

  const view = useMemo(() => {
    const end = total - endOffset;
    const start = Math.max(0, end - viewCount);
    return klines.slice(start, Math.max(start, end));
  }, [klines, endOffset, viewCount, total]);

  // Medir container (responsivo)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(260, Math.floor(r.height)) });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Limitar offset quando muda o número de velas / zoom
  useEffect(() => {
    setEndOffset((o) => Math.min(Math.max(0, o), Math.max(0, total - viewCount)));
  }, [total, viewCount]);

  // Zoom com a roda do rato
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

  // Arrastar para navegar (pan)
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, endOffset };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const innerW = Math.max(50, size.w - PAD_L - PAD_R);
    const plotW = Math.max(50, innerW - Math.max(24, Math.round(innerW * 0.06)));
    const perCandle = plotW / Math.max(1, viewCount);
    const delta = Math.round((e.clientX - d.x) / perCandle);
    setEndOffset(Math.min(Math.max(0, d.endOffset + delta), maxOffset));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };
  const resetView = () => {
    setViewCount(120);
    setEndOffset(0);
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
    const innerH = size.h - PAD_T - PAD_B;
    // Reserva margem à direita para a última vela (em formação) não encostar ao eixo.
    const plotW = Math.max(50, innerW - Math.max(24, Math.round(innerW * 0.06)));
    if (view.length === 0) {
      ctx.fillStyle = "hsl(150 8% 45%)";
      ctx.font = "12px JetBrains Mono, monospace";
      ctx.fillText("A carregar velas Binance Futures…", PAD_L + 12, PAD_T + 24);
      return;
    }
    const lo = Math.min(...view.map((c) => c.l));
    const hi = Math.max(...view.map((c) => c.h));
    const range = hi - lo || 1;
    const pad = range * 0.08;
    const vLo = lo - pad;
    const vHi = hi + pad;
    const yOf = (p: number) => PAD_T + (1 - (p - vLo) / (vHi - vLo)) * innerH;
    const cw = plotW / view.length;
    const xOf = (i: number) => PAD_L + i * cw + cw / 2;

    // Grelha
    ctx.strokeStyle = "hsl(220 14% 14%)";
    ctx.lineWidth = 1;
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillStyle = "hsl(150 8% 45%)";
    for (let g = 0; g <= 6; g++) {
      const y = PAD_T + (innerH / 6) * g;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(innerW, y);
      ctx.stroke();
      const p = vHi - (g / 6) * (vHi - vLo);
      ctx.fillText(formatPrice(p), innerW + 6, y + 3);
    }

    // Linhas de posição (entrada/liq/TP/SL)
    entryLines.forEach((l) => {
      if (l.price < vLo || l.price > vHi) return;
      const y = yOf(l.price);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(innerW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = l.color;
      const label = `${l.label} ${formatPrice(l.price)}`;
      const w = ctx.measureText(label).width + 10;
      ctx.fillRect(innerW, y - 9, Math.min(w, PAD_R + 40), 18);
      ctx.fillStyle = "#0a0e14";
      ctx.fillText(label, innerW + 4, y + 4);
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

    // Última cotação
    const last = view[view.length - 1];
    const ly = yOf(last.c);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(innerW, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = last.c >= last.o ? "#22c55e" : "#ef4444";
    ctx.fillRect(innerW, ly - 9, PAD_R, 18);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillText(formatPrice(last.c), innerW + 5, ly + 4);
  }, [size, view, entryLines]);

  return (
    <div
      ref={wrapRef}
      className="w-full h-full min-h-[260px] bg-[#131722] rounded-sm overflow-hidden relative cursor-grab active:cursor-grabbing select-none touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDoubleClick={resetView}
    >
      <canvas ref={canvasRef} />
      <div className="absolute top-2 left-2 flex items-center gap-2 text-[9px] font-mono text-white/45 uppercase tracking-widest pointer-events-none">
        <span>Binance Futures · tempo real</span>
        <span className="text-white/25">·</span>
        <span>{view.length} velas</span>
      </div>
      <button
        onClick={resetView}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 flex items-center gap-1 text-[9px] font-mono text-white/50 hover:text-white px-1.5 py-0.5 rounded border border-white/10 bg-black/30"
        title="Repor zoom (duplo-clique)"
      >
        <Maximize2 className="h-3 w-3" /> reset
      </button>
      <span className="absolute bottom-2 left-2 text-[9px] font-mono text-white/35 pointer-events-none">
        scroll = zoom · arrastar = mover
      </span>
    </div>
  );
}

// ─── Página ───
export default function Trading() {
  const paper = useFuturesPaper();

  const [symbol, setSymbol] = useState<string>(FUTURES_TRADING_SYMBOLS[0]);
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

  // Tickers polling (15s)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchFuturesTickers24h();
        if (cancelled) return;
        const allowed = new Set<string>(FUTURES_TRADING_SYMBOLS as unknown as string[]);
        setTickers(data.filter((t) => allowed.has(t.symbol)));
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
      const data = await fetchFuturesKlines(sym, timeframe, 500);
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

  // ── Tempo real: WebSocket de kline (fstream) — melhora a fluidez quando disponível ──
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
        if (candle.t > last.t) return [...prev.slice(-999), candle];
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

  // ── Atualização garantida: polling frequente do mark price (mesmo sem WS) ──
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
  const chartLines = myPositions.flatMap((p) => [
    { price: p.entryPrice, color: "#eab308", label: `${p.side} ${p.leverage}x` },
    { price: p.liqPrice, color: "#ef4444", label: "LIQ" },
    ...(p.tpPrice !== null ? [{ price: p.tpPrice, color: "#22c55e", label: "TP" }] : []),
    ...(p.slPrice !== null ? [{ price: p.slPrice, color: "#f97316", label: "SL" }] : []),
  ]);

  const posCount = paper.positions.length;
  const ordCount = paper.pending.length;
  const histCount = paper.history.length;

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
                {FUTURES_TRADING_SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">
                    {s} · Perp
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="font-mono flex items-center gap-2">
              <span className="text-lg font-bold text-white">${formatPrice(mark)}</span>
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
                <FuturesChart klines={klines} entryLines={chartLines} />
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
        </div>
      </div>
    </AppShell>
  );
}

// Re-export para compatibilidade com imports existentes.
export { useFuturesPaper as useTradingPaper };
