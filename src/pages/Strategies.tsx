import { AppShell } from "@/components/AppShell";
import { useMemo, useState } from "react";
import { BookOpen, Bot, FlaskConical, Play, Search, Star, Info } from "lucide-react";
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
  CRYPTO_STRATEGIES,
  useActiveStrategy,
  type StrategyDirection,
} from "@/lib/cryptoStrategies";
import { useCryptoRobots, type FuturesDirection } from "@/lib/cryptoRobots";

const DIR_LABEL: Record<StrategyDirection, string> = {
  all: "Todas",
  long: "Long",
  short: "Short",
};

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
            <h3 className="font-bold text-white mb-1">1. Onde vivem</h3>
            <p className="text-muted-foreground text-[13px]">
              Cada estratégia é um objeto em <code className="font-mono text-[12px]">src/lib/cryptoStrategies.ts</code>,
              registado no array <code className="font-mono text-[12px]">CRYPTO_STRATEGIES</code> no fim do ficheiro.
              Adicionar uma nova = acrescentar o objeto + 1 linha no array. Nada mais precisa de mudar:
              catálogo, robôs, validação e backtest usam o registo.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">2. Interface obrigatória</h3>
            <pre className="bg-background/60 border border-border/50 rounded p-3 text-[11px] font-mono overflow-x-auto">{`{
  id: "minha_estrategia",        // único, minúsculas + _
  name: "Nome visível",
  description: "O que faz, em 1 frase",
  category: "auto",              // "auto" | "semi-auto"
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
              <li><strong>Backtest:</strong> corre a estratégia ligada sobre klines reais da Binance (velas fechadas, fill na abertura seguinte, taxas + slippage). Sem lookahead.</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Strategies() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"auto" | "semi" | "fav">("auto");
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState("todas");
  const [docsOpen, setDocsOpen] = useState(false);
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

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("favoriteStrategies", JSON.stringify(next));
      return next;
    });
  };

  const dirOf = (id: string): StrategyDirection => directions[id] ?? "all";

  const list = useMemo(() => {
    const q = search.toLowerCase();
    return CRYPTO_STRATEGIES.filter((s) => {
      if (tab === "auto" && (s.category ?? "auto") !== "auto") return false;
      if (tab === "semi" && (s.category ?? "auto") !== "semi-auto") return false;
      if (tab === "fav" && !favorites[s.id]) return false;
      if (timeframe !== "todas" && !(s.timeframes ?? []).includes(timeframe)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => Number(favorites[b.id] || false) - Number(favorites[a.id] || false));
  }, [tab, search, timeframe, favorites]);

  const nAuto = CRYPTO_STRATEGIES.filter((s) => (s.category ?? "auto") === "auto").length;
  const nSemi = CRYPTO_STRATEGIES.filter((s) => (s.category ?? "auto") === "semi-auto").length;
  const nFav = CRYPTO_STRATEGIES.filter((s) => favorites[s.id]).length;

  const handleCreate = (strategyId: string) => {
    const d = dirOf(strategyId);
    const res = createRobot({
      name: `${strategyId} #${Math.floor(Math.random() * 900) + 100}`,
      symbol: "BTCUSDT",
      interval: "15m",
      strategyId,
      mode: "futures",
      direction: dirToRobot(d),
      leverage: 5,
      marginMode: "isolated",
      fundingAware: true,
      capitalAllocated: 1000,
      stakePerEntry: 100,
      acctStopGainPct: 10,
      acctStopLossPct: 5,
      maxPositions: 2,
      cooldownMin: 30,
    });
    if (!res.ok) return toast.error(res.reason || "Falha ao criar robô.");
    toast.success(`Robô de Futuros criado a partir da estratégia (${DIR_LABEL[d]}). Ajusta em Robôs.`);
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
    toast.info("Estratégia ligada para backtest. A página de Backtest corre com a estratégia ligada.");
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
              O <strong>Switch Ligar</strong> marca a estratégia que o Backtest usa.
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
            <Button size="sm" variant="outline" className="h-10 text-xs" onClick={() => setDocsOpen(true)}>
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Documentação
            </Button>
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full max-w-lg grid-cols-3 mb-6">
            <TabsTrigger value="auto">Automáticas ({nAuto})</TabsTrigger>
            <TabsTrigger value="semi">Semi-auto ({nSemi})</TabsTrigger>
            <TabsTrigger value="fav">Favoritas ({nFav})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="m-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map((s) => {
                const isActive = activeStrategyId === s.id;
                return (
                  <div key={s.id} className={`panel p-4 flex flex-col gap-3 rounded-lg border ${isActive ? "border-primary/60" : "border-border/50"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-base text-white flex items-center gap-2 min-w-0">
                        <button onClick={() => toggleFav(s.id)} className={favorites[s.id] ? "text-yellow-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"}>
                          <Star className="h-4 w-4" fill={favorites[s.id] ? "currentColor" : "none"} />
                        </button>
                        <span className="truncate">{s.name}</span>
                        {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono shrink-0">LIGADA</span>}
                      </div>
                      <code className="text-[9px] text-primary bg-primary/10 px-1 rounded font-mono shrink-0">{s.id}</code>
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
                        onChange={(e) => setDirections((prev) => ({ ...prev, [s.id]: e.target.value as StrategyDirection }))}
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
          <div className="text-center text-sm text-muted-foreground py-16 border border-dashed border-border rounded-lg mt-4">
            Nenhuma estratégia para este filtro.
          </div>
        )}

        <DocsDialog open={docsOpen} onOpenChange={setDocsOpen} />
      </div>
    </AppShell>
  );
}
