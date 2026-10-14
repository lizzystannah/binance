import { AppShell } from "@/components/AppShell";
import { useMemo, useState } from "react";
import { Bot, Search, Star, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { CRYPTO_STRATEGIES } from "@/lib/cryptoStrategies";
import { useCryptoRobots, type RobotMode } from "@/lib/cryptoRobots";

export default function Strategies() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<RobotMode>("futures");
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState("todas");
  const [favorites, setFavorites] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("favoriteStrategies") || "{}");
    } catch {
      return {};
    }
  });
  const createRobot = useCryptoRobots((s) => s.createRobot);

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("favoriteStrategies", JSON.stringify(next));
      return next;
    });
  };

  const list = useMemo(
    () =>
      CRYPTO_STRATEGIES.filter(
        (s) =>
          ((s.modes ?? ["spot", "futures"]) as string[]).includes(mode) &&
          (timeframe === "todas" || (s.timeframes ?? []).includes(timeframe)) &&
          (s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.id.toLowerCase().includes(search.toLowerCase()))
      ).sort((a, b) => Number(favorites[b.id] || false) - Number(favorites[a.id] || false)),
    [mode, search, timeframe, favorites]
  );

  const handleCreate = (strategyId: string) => {
    const res = createRobot({
      name: `${strategyId} #${Math.floor(Math.random() * 900) + 100}`,
      symbol: "BTCUSDT",
      interval: "15m",
      strategyId,
      mode,
      direction: mode === "spot" ? ("BUY" as never) : "BOTH",
      leverage: mode === "futures" ? 5 : undefined,
      marginMode: mode === "futures" ? "isolated" : undefined,
      fundingAware: mode === "futures",
      capitalAllocated: 1000,
      stakePerEntry: 100,
      acctStopGainPct: 10,
      acctStopLossPct: 5,
      maxPositions: 2,
      cooldownMin: 30,
    });
    if (!res.ok) return toast.error(res.reason || "Falha ao criar robô.");
    toast.success(`Robô ${mode === "spot" ? "Spot" : "Futuros"} criado! Ajusta em Robôs.`);
    navigate("/robots");
  };

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Estratégias Cripto
          </h1>
          <p className="text-muted-foreground text-sm mt-1 mb-3">
            RSI / MACD / EMA / Bollinger / Order Block adaptados a BTC, ETH e altcoins voláteis.
            Timeframes 1m · 5m · 15m · 1h · 4h. Stops por ATR, TP/SL em %, trailing e filtro de volume.
          </p>
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-secondary/20 border border-border/30 rounded p-2 mb-4">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              Sinais genéricos — funcionam em qualquer par cripto USDT.{" "}
              {mode === "spot"
                ? "No Spot o robô só abre BUY; SELL/EXIT fecha a posição. Sem leverage."
                : "Em Futuros o mesmo sinal abre LONG ou SHORT com o leverage configurado; funding awareness pausa entradas com funding alto."}
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
          </div>
        </header>

        <Tabs value={mode} onValueChange={(v) => setMode(v as RobotMode)}>
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
            <TabsTrigger value="futures">Futuros (LONG/SHORT)</TabsTrigger>
            <TabsTrigger value="spot">Spot (BUY/SELL)</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map((s) => (
            <div key={s.id} className="panel p-4 flex flex-col gap-3 rounded-lg border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-base text-white flex items-center gap-2 min-w-0">
                  <button onClick={() => toggleFav(s.id)} className={favorites[s.id] ? "text-yellow-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"}>
                    <Star className="h-4 w-4" fill={favorites[s.id] ? "currentColor" : "none"} />
                  </button>
                  <span className="truncate">{s.name}</span>
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
              <div className="flex gap-2 mt-auto pt-2">
                <Button size="sm" className="flex-1 h-8 text-[11px] font-bold" onClick={() => handleCreate(s.id)}>
                  <Bot className="h-3.5 w-3.5 mr-1" /> Criar robô {mode === "spot" ? "Spot" : "Futuros"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => toast.info("Corre o backtest na aba Estratégias do hub Cripto (klines reais Binance).")}>
                  Backtest
                </Button>
              </div>
            </div>
          ))}
        </div>

        {list.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16 border border-dashed border-border rounded-lg mt-4">
            Nenhuma estratégia para este filtro.
          </div>
        )}

        <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Switch checked={false} onCheckedChange={() => toast.info("Ativação direta removida: cria um robô Spot/Futuros para operar.")} />
          <span>A ativação direta foi removida — cria um robô para operar (evita backtest misturado com produção).</span>
        </div>
      </div>
    </AppShell>
  );
}
