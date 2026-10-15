import { AppShell } from "@/components/AppShell";
import { useMemo, useState } from "react";
import { BookOpen, Bot, FlaskConical, Play, Plus, Search, Star, Info, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  STRATEGY_TEMPLATES,
  listAllStrategies,
  useActiveStrategy,
  useCustomStrategies,
  type CryptoStrategy,
  type StrategyDirection,
  type StrategyTemplateId,
} from "@/lib/cryptoStrategies";
import { useCryptoRobots, type FuturesDirection } from "@/lib/cryptoRobots";
import { FUTURES_TRADING_SYMBOLS, fetchFuturesKlines, formatPrice } from "@/lib/binance";
import { runCryptoBacktest, type CryptoBacktestResult } from "@/lib/cryptoBacktest";

const DIR_LABEL: Record<StrategyDirection, string> = {
  all: "Todas",
  long: "Long",
  short: "Short",
};

const ALL_TFS = ["1m", "5m", "15m", "1h", "4h"];

function dirToRobot(d: StrategyDirection): FuturesDirection {
  return d === "long" ? "LONG" : d === "short" ? "SHORT" : "BOTH";
}

function DocsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" /> Documentação — Como criar estratégias
          </DialogTitle>
          <DialogDescription>
            Estratégias de Futuros USDT-M (Binance). Sinais LONG/SHORT avaliados sobre velas
            fechadas, na conta paper. Sem binárias, sem martingale no motor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 text-sm">
          <section>
            <h3 className="font-bold text-white mb-1">1. Duas formas de criar</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li><strong className="text-foreground">Botão “Nova estratégia”</strong> (recomendado): escolhe um template auditado (RSI, EMA, Bollinger), ajusta parâmetros, TP/SL e timeframes. Fica guardada e funciona em robôs e backtest como as embutidas.</li>
              <li><strong className="text-foreground">Em código:</strong> objeto em <code className="font-mono text-[12px]">src/lib/cryptoStrategies.ts</code> registado em <code className="font-mono text-[12px]">CRYPTO_STRATEGIES</code> (ver secção 2).</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">2. Interface em código (CryptoStrategy)</h3>
            <pre className="bg-background/60 border border-border/50 rounded p-3 text-[11px] font-mono overflow-x-auto">{`{
  id: "minha_estrategia",        // único, minúsculas + _
  name: "Nome visível",
  description: "O que faz, em 1 frase",
  minCandles: 60,                // velas fechadas mínimas
  defaults: { stopGainPct: 3, stopLossPct: 1.2, trailingPct: 1 },
  timeframes: ["15m", "1h"],     // subset de 1m/5m/15m/1h/4h
  modes: ["futures"],            // sempre ["futures"]
  indicators: ["EMA20/50", "RSI14"],
  params: [                      // parâmetros ajustáveis (info na UI)
    { key: "rsiLen", label: "Período RSI", type: "number",
      default: 14, min: 2, max: 50, step: 1,
      hint: "Janela do RSI" },
  ],
  onSignal: (ctx) => { /* ... */ return null; },
}`}</pre>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">3. O contexto (CryptoContext)</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li><code className="font-mono">symbol</code> — par, ex. <code className="font-mono">BTCUSDT</code></li>
              <li><code className="font-mono">interval</code> — timeframe do robô</li>
              <li><code className="font-mono">klines</code> — velas <strong>FECHADAS</strong> <code className="font-mono">{"{t,o,h,l,c,v}[]"}</code> (a vela em formação nunca entra)</li>
              <li><code className="font-mono">closes</code> / <code className="font-mono">lastClose</code> — atalhos</li>
              <li><code className="font-mono">mode</code> — sempre <code className="font-mono">"futures"</code> aqui</li>
              <li><code className="font-mono">fundingRatePct</code> — funding atual; pular entradas com funding extremo</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">4. O sinal (CryptoSignal)</h3>
            <pre className="bg-background/60 border border-border/50 rounded p-3 text-[11px] font-mono overflow-x-auto">{`// Entrar long na reversão do RSI
if (ctx.klines.length < 60) return null;   // 1. guarda de amostra
const r = rsi(ctx.closes, 14);
const last = r[r.length - 1];
if (last === null) return null;
if (last < 30) return {                     // 2. sinal
  action: "LONG",                           // "LONG" | "SHORT" | "EXIT" | "FLAT"
  stopGainPct: 3,                           // 3. stops SEMPRE (obrigatórios)
  stopLossPct: 1.2,
  reason: "RSI sobrevendido",
  confidence: 62,                           // opcional 0-100
  trailingPct: 1,                           // opcional
};
return null;                                // 4. sem sinal = null`}</pre>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">5. Regras de ouro</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li>Só velas fechadas: usa <code className="font-mono">ctx.klines[ctx.klines.length - 1]</code> como última fechada.</li>
              <li><code className="font-mono">stopGainPct</code> e <code className="font-mono">stopLossPct</code> são obrigatórios e &gt; 0.</li>
              <li>Devolve <code className="font-mono">EXIT</code> para fechar, <code className="font-mono">FLAT</code>/<code className="font-mono">null</code> para ficar de fora.</li>
              <li>Verifica a amostra mínima antes dos indicadores (RSI precisa de ~15+ velas).</li>
              <li>Sem gestão de risco dentro da estratégia (martingale, dobras): o motor aplica stops da conta, cooldown e limites de posição.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">6. Da estratégia ao robô ao backtest</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li><strong>Criar robô:</strong> botão no card — nasce parado, copiando direção, timeframe e stops da estratégia. Ajusta capital, stake, leverage e liga na página Robôs.</li>
              <li><strong>Ligar (Switch):</strong> marca a estratégia como <em>ligada</em> — é com ela que a página de Backtest corre.</li>
              <li><strong>Backtest:</strong> botão no card — corre já aqui sobre klines reais da Binance (velas fechadas, fill na abertura seguinte, taxas + slippage, SL antes de TP). Sem lookahead. A estratégia fica ligada para a futura página de Backtest.</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewStrategyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createCustom = useCustomStrategies((s) => s.create);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState<StrategyTemplateId>("rsi_reversao");
  const [tfs, setTfs] = useState<string[]>(["15m", "1h"]);
  const [params, setParams] = useState<Record<string, number>>({});
  const [tp, setTp] = useState("3");
  const [sl, setSl] = useState("1.2");
  const [trailing, setTrailing] = useState("");

  const tpl = STRATEGY_TEMPLATES.find((t) => t.id === template)!;

  const toggleTf = (tf: string) =>
    setTfs((prev) => (prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf]));

  const submit = () => {
    const p: Record<string, number> = {};
    for (const pd of tpl.params) {
      const raw = params[pd.key];
      p[pd.key] = Number.isFinite(raw) ? (raw as number) : (pd.default as number);
    }
    const res = createCustom({
      name,
      description,
      template,
      timeframes: tfs,
      params: p,
      stopGainPct: parseFloat(tp),
      stopLossPct: parseFloat(sl),
      ...(trailing.trim() ? { trailingPct: parseFloat(trailing) } : {}),
    });
    if (!res.ok) return toast.error(res.reason || "Falha ao criar estratégia.");
    toast.success(`Estratégia "${name.trim()}" criada. Já podes criar robô, ligar e correr backtest.`);
    setName("");
    setDescription("");
    setParams({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> Nova estratégia
          </DialogTitle>
          <DialogDescription>
            Template auditado + os teus parâmetros. Funciona em robôs e backtest como as embutidas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Nome</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: RSI agressivo BTC" maxLength={60} className="h-9" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Descrição (opcional)</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Quando entra e porquê" className="h-9" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Template</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value as StrategyTemplateId)} className="h-9 text-xs bg-secondary/50 border border-border rounded-md px-2">
              {STRATEGY_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — {t.description}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Timeframes</span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TFS.map((tf) => (
                <button
                  key={tf}
                  onClick={() => toggleTf(tf)}
                  className={`text-[11px] font-mono px-2.5 py-1 rounded border ${tfs.includes(tf) ? "bg-primary/15 border-primary/50 text-primary" : "bg-secondary/40 border-border/40 text-muted-foreground"}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Parâmetros do template</span>
            {tpl.params.map((pd) => (
              <label key={pd.key} className="flex items-center justify-between gap-2 text-xs">
                <span title={typeof pd.hint === "string" ? pd.hint : undefined}>{pd.label}</span>
                <Input
                  type="number"
                  value={params[pd.key] ?? (pd.default as number)}
                  min={pd.min}
                  max={pd.max}
                  step={pd.step}
                  onChange={(e) => setParams((prev) => ({ ...prev, [pd.key]: parseFloat(e.target.value) }))}
                  className="h-8 w-28 text-xs font-mono text-right"
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Take-profit %</span>
              <Input type="number" value={tp} min={0.1} step={0.1} onChange={(e) => setTp(e.target.value)} className="h-9 text-xs font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Stop-loss %</span>
              <Input type="number" value={sl} min={0.1} step={0.1} onChange={(e) => setSl(e.target.value)} className="h-9 text-xs font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Trailing % (opc.)</span>
              <Input type="number" value={trailing} min={0} step={0.1} placeholder="—" onChange={(e) => setTrailing(e.target.value)} className="h-9 text-xs font-mono" />
            </label>
          </div>
          <Button onClick={submit} className="h-9 text-xs font-bold">
            <Plus className="h-3.5 w-3.5 mr-1" /> Criar estratégia
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BacktestDialog({ strategy, direction, onOpenChange }: {
  strategy: CryptoStrategy;
  direction: StrategyDirection;
  onOpenChange: (v: boolean) => void;
}) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [tf, setTf] = useState(strategy.timeframes?.[0] ?? "15m");
  const [bars, setBars] = useState("500");
  const [capital, setCapital] = useState("1000");
  const [stake, setStake] = useState("100");
  const [leverage, setLeverage] = useState("5");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CryptoBacktestResult | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const cap = parseFloat(capital);
      const st = parseFloat(stake);
      if (!Number.isFinite(cap) || cap <= 0) throw new Error("Capital tem de ser > 0.");
      if (!Number.isFinite(st) || st <= 0) throw new Error("Stake tem de ser > 0.");
      if (st > cap) throw new Error("Stake não pode exceder o capital.");
      const kl = await fetchFuturesKlines(symbol, tf, parseInt(bars) || 500);
      const closed = kl.slice(0, -1); // fora a vela em formação
      if (closed.length < strategy.minCandles + 2) throw new Error("Velas insuficientes para esta estratégia.");
      const params = Object.fromEntries((strategy.params ?? []).map((p) => [p.key, p.default]));
      const wrapped: CryptoStrategy = {
        ...strategy,
        onSignal: (ctx) => {
          const sig = strategy.onSignal({ ...ctx, params });
          if (!sig) return null;
          // EXIT/FLAT (fechar) nunca são filtrados por direção.
          if (sig.action !== "LONG" && sig.action !== "SHORT" && sig.action !== "BUY" && sig.action !== "SELL") return sig;
          const side = sig.action === "SHORT" || sig.action === "SELL" ? "short" : "long";
          if (side === "long" && direction === "short") return null;
          if (side === "short" && direction === "long") return null;
          return sig;
        },
      };
      const res = runCryptoBacktest(closed, wrapped, {
        capital: cap,
        stakePerEntry: st,
        mode: "futures",
        leverage: Math.min(125, Math.max(1, parseInt(leverage) || 5)),
        strategyParams: params,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no backtest.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Backtest — {strategy.name}
          </DialogTitle>
          <DialogDescription>
            Klines reais Binance Futures (sem a vela em formação), fill na abertura seguinte,
            taxas + slippage, SL antes de TP na mesma vela. {direction !== "all" ? `Direção: ${DIR_LABEL[direction]}.` : "Ambos os lados."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2 items-end text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Par</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2 font-mono">
              {FUTURES_TRADING_SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">TF</span>
            <select value={tf} onChange={(e) => setTf(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2 font-mono">
              {(strategy.timeframes ?? ["15m"]).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Velas</span>
            <select value={bars} onChange={(e) => setBars(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2 font-mono">
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Capital $</span>
            <Input value={capital} onChange={(e) => setCapital(e.target.value)} className="h-8 w-24 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Stake $</span>
            <Input value={stake} onChange={(e) => setStake(e.target.value)} className="h-8 w-20 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Lev. x</span>
            <Input value={leverage} onChange={(e) => setLeverage(e.target.value)} className="h-8 w-16 font-mono" inputMode="numeric" />
          </label>
          <Button size="sm" onClick={run} disabled={running} className="h-8 font-bold">
            {running ? "A correr…" : "Correr backtest"}
          </Button>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        {result && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
              {[
                ["Trades", String(result.totalTrades)],
                ["Win rate", `${result.winRate.toFixed(1)}%`],
                ["PnL", `${result.pnl >= 0 ? "+" : ""}$${result.pnl.toFixed(2)}`],
                ["Equity", `$${result.finalEquity.toFixed(2)}`],
                ["DD máx", `${result.maxDrawdownPct.toFixed(1)}%`],
                ["Buy&hold", `${result.buyHoldPct >= 0 ? "+" : ""}${result.buyHoldPct.toFixed(1)}%`],
              ].map(([k, v]) => (
                <div key={k} className="rounded border border-border/50 bg-background/40 p-2">
                  <div className="text-[9px] uppercase text-muted-foreground">{k}</div>
                  <div className="font-mono font-bold text-xs">{v}</div>
                </div>
              ))}
            </div>
            {result.totalTrades < 30 && (
              <p className="text-[11px] text-warning">Amostra pequena (&lt;30 trades) — resultado pouco significativo.</p>
            )}
            {result.trades.length > 0 && (
              <div className="rounded border border-border/40 overflow-hidden">
                <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground font-bold border-b border-border/30">Últimos trades</div>
                {result.trades.slice(-20).reverse().map((t, i) => (
                  <div key={`${t.entryIndex}-${i}`} className="flex justify-between px-2 py-1 text-[11px] font-mono border-b border-border/20 last:border-0">
                    <span className={t.side === "LONG" ? "text-bull" : "text-bear"}>{t.side} {t.leverage}x</span>
                    <span>${formatPrice(t.entryPrice)} → ${formatPrice(t.exitPrice)}</span>
                    <span className="text-muted-foreground">{t.reason.replace(/_/g, " ")}</span>
                    <span className={t.pnl >= 0 ? "text-bull" : "text-bear"}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Strategies() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "fav">("all");
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState("todas");
  const [docsOpen, setDocsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [btId, setBtId] = useState<string | null>(null);
  const [directions, setDirections] = useState<Record<string, StrategyDirection>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("favoriteStrategies") || "{}");
    } catch {
      return {};
    }
  });

  const createRobot = useCryptoRobots((s) => s.createRobot);
  const activeStrategyId = useActiveStrategy((s) => s.activeStrategyId);
  const setActiveStrategy = useActiveStrategy((s) => s.setActive);
  const customSpecs = useCustomStrategies((s) => s.specs);
  const removeCustom = useCustomStrategies((s) => s.remove);
  const customIds = useMemo(() => new Set(customSpecs.map((c) => c.id)), [customSpecs]);

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("favoriteStrategies", JSON.stringify(next));
      return next;
    });
  };

  const dirOf = (id: string): StrategyDirection => directions[id] ?? "all";

  const all = useMemo(() => listAllStrategies(), [customSpecs]);

  const list = useMemo(() => {
    const q = search.toLowerCase();
    return all.filter((s) => {
      if (tab === "fav" && !favorites[s.id]) return false;
      if (timeframe !== "todas" && !(s.timeframes ?? []).includes(timeframe)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => Number(favorites[b.id] || false) - Number(favorites[a.id] || false));
  }, [all, tab, search, timeframe, favorites]);

  const nFav = all.filter((s) => favorites[s.id]).length;

  const handleCreate = (strategyId: string) => {
    const d = dirOf(strategyId);
    const s = all.find((x) => x.id === strategyId);
    if (!s) return toast.error("Estratégia desconhecida.");
    const res = createRobot({
      name: `${strategyId} #${Math.floor(Math.random() * 900) + 100}`,
      symbol: "BTCUSDT",
      interval: s.timeframes?.[0] ?? "15m",
      strategyId,
      mode: "futures",
      direction: dirToRobot(d),
      leverage: 5,
      marginMode: "isolated",
      fundingAware: true,
      capitalAllocated: 1000,
      stakePerEntry: 100,
      acctStopGainPct: s.defaults.stopGainPct,
      acctStopLossPct: s.defaults.stopLossPct,
      maxPositions: 2,
      cooldownMin: 30,
    });
    if (!res.ok) return toast.error(res.reason || "Falha ao criar robô.");
    toast.success(`Robô de Futuros criado (${s.timeframes?.[0] ?? "15m"}, TP ${s.defaults.stopGainPct}%/SL ${s.defaults.stopLossPct}%, ${DIR_LABEL[d]}). Ajusta em Robôs.`);
    navigate("/robots");
  };

  const handleToggleActive = (strategyId: string, on: boolean) => {
    if (on) {
      setActiveStrategy(strategyId, dirOf(strategyId));
      toast.success("Estratégia ligada — é com ela que o Backtest vai correr.");
    } else {
      setActiveStrategy(null);
      toast.info("Estratégia desligada.");
    }
  };

  const handleBacktest = (strategyId: string) => {
    setActiveStrategy(strategyId, dirOf(strategyId));
    setBtId(strategyId);
  };

  const handleDeleteCustom = (id: string, name: string) => {
    const using = useCryptoRobots.getState().robots.filter((r) => r.strategyId === id);
    if (using.length > 0) {
      return toast.error(
        `Há ${using.length} robô(s) a usar esta estratégia (${using.slice(0, 3).map((r) => r.name).join(", ")}${using.length > 3 ? "…" : ""}). Apaga-os primeiro em Robôs.`
      );
    }
    if (!confirm(`Apagar estratégia "${name}"?`)) return;
    if (activeStrategyId === id) setActiveStrategy(null);
    removeCustom(id);
    toast.info("Estratégia personalizada apagada.");
  };

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Estratégias · Futuros USDT-M
          </h1>
          <p className="text-muted-foreground text-sm mt-1 mb-3">
            RSI / MACD / EMA / Bollinger / Order Block para Futuros (LONG/SHORT com leverage).
            Timeframes 1m · 5m · 15m · 1h · 4h. Stops por ATR, TP/SL em %, trailing e filtro de volume.
          </p>
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-secondary/20 border border-border/30 rounded p-2 mb-4">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              O robô nasce do card da estratégia com direção, timeframe e stops copiados.
              O <strong>Switch Ligar</strong> marca a estratégia como ativa (para o Backtest e a futura execução automática).
              Tudo corre na conta paper — sem alavancagem real em corretora.
            </span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative max-w-sm flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Pesquisar estratégia..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-10" />
            </div>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="h-10 text-xs bg-secondary/50 border border-border rounded-md px-2">
              <option value="todas">Todos TFs</option>
              {["1m", "5m", "15m", "1h", "4h"].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
            <Button size="sm" className="h-10 text-xs font-bold" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nova estratégia
            </Button>
            <Button size="sm" variant="outline" className="h-10 text-xs" onClick={() => setDocsOpen(true)}>
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Documentação
            </Button>
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
            <TabsTrigger value="all">Todas ({all.length})</TabsTrigger>
            <TabsTrigger value="fav">Favoritas ({nFav})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="m-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map((s) => {
                const isActive = activeStrategyId === s.id;
                const isCustom = customIds.has(s.id);
                return (
                  <div key={s.id} className={`panel p-4 flex flex-col gap-3 rounded-lg border ${isActive ? "border-primary/60" : "border-border/50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-base text-white flex items-center gap-2 min-w-0">
                        <button onClick={() => toggleFav(s.id)} className={favorites[s.id] ? "text-yellow-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"}>
                          <Star className="h-4 w-4" fill={favorites[s.id] ? "currentColor" : "none"} />
                        </button>
                        <span className="truncate">{s.name}</span>
                        {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono shrink-0">LIGADA</span>}
                        {isCustom && <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono shrink-0">MINHA</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <code className="text-[9px] text-primary bg-primary/10 px-1 rounded font-mono">{s.id}</code>
                        {isCustom && (
                          <button
                            onClick={() => handleDeleteCustom(s.id, s.name)}
                            title="Apagar estratégia personalizada"
                            className="text-muted-foreground/50 hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                    <div className="flex flex-wrap gap-1 text-[10px] font-mono">
                      <span className="bg-secondary/60 px-1.5 py-0.5 rounded">TF: {(s.timeframes ?? []).join("/")}</span>
                      <span className="bg-secondary/60 px-1.5 py-0.5 rounded">TP {s.defaults.stopGainPct}% · SL {s.defaults.stopLossPct}%</span>
                      {s.defaults.trailingPct && <span className="bg-secondary/60 px-1.5 py-0.5 rounded">trail {s.defaults.trailingPct}%</span>}
                      <span className="bg-secondary/60 px-1.5 py-0.5 rounded">mín {s.minCandles} velas</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">Indicadores: {(s.indicators ?? []).join(" · ")}</div>
                    <div className="flex flex-wrap gap-1">
                      {(s.params ?? []).map((p) => (
                        <span key={p.key} className="text-[9px] bg-secondary/40 border border-border/30 px-1.5 py-0.5 rounded" title={p.hint}>
                          {p.label}: {String(p.default)}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">Direção</span>
                      <select
                        value={dirOf(s.id)}
                        onChange={(e) => {
                          const nd = e.target.value as StrategyDirection;
                          setDirections((prev) => ({ ...prev, [s.id]: nd }));
                          if (activeStrategyId === s.id) setActiveStrategy(s.id, nd);
                        }}
                        className="h-7 text-[11px] bg-secondary/50 border border-border rounded px-1.5"
                      >
                        <option value="all">Todas (Long+Short)</option>
                        <option value="long">Só Long</option>
                        <option value="short">Só Short</option>
                      </select>
                      <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                        <Play className="h-3 w-3" /> Ligar
                        <Switch checked={isActive} onCheckedChange={(v) => handleToggleActive(s.id, v)} />
                      </span>
                    </div>
                    <div className="flex gap-2 mt-auto pt-2">
                      <Button size="sm" className="flex-1 h-8 text-[11px] font-bold" onClick={() => handleCreate(s.id)}>
                        <Bot className="h-3.5 w-3.5 mr-1" /> Criar robô Futuros
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => handleBacktest(s.id)}>
                        <FlaskConical className="h-3.5 w-3.5 mr-1" /> Backtest
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {list.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16 border border-dashed border-border rounded-lg mt-4 flex flex-col items-center gap-3">
            <span>Nenhuma estratégia para este filtro.</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => { setSearch(""); setTimeframe("todas"); setTab("all"); }}>
                Limpar filtros
              </Button>
              <Button size="sm" className="h-8 text-[11px] font-bold" onClick={() => setNewOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Nova estratégia
              </Button>
            </div>
          </div>
        )}

        <DocsDialog open={docsOpen} onOpenChange={setDocsOpen} />
        <NewStrategyDialog open={newOpen} onOpenChange={setNewOpen} />
        {btId && (() => {
          const s = all.find((x) => x.id === btId);
          if (!s) return null;
          return <BacktestDialog strategy={s} direction={dirOf(s.id)} onOpenChange={(v) => { if (!v) setBtId(null); }} />;
        })()}
      </div>
    </AppShell>
  );
}
