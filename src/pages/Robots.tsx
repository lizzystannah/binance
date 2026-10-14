import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { Cpu, Search, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCryptoRobots, type RobotMode } from "@/lib/cryptoRobots";
import { getCryptoStrategy } from "@/lib/cryptoStrategies";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trash2, Play, Square } from "lucide-react";

function ModeRobots({ mode, search }: { mode: RobotMode; search: string }) {
  const robots = useCryptoRobots((s) => s.robots).filter((r) => (r.mode ?? "spot") === mode);
  const setActive = useCryptoRobots((s) => s.setActive);
  const removeRobot = useCryptoRobots((s) => s.removeRobot);

  const filtered = robots.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.symbol.toLowerCase().includes(search.toLowerCase()) ||
      r.strategyId.toLowerCase().includes(search.toLowerCase())
  );
  const active = filtered.filter((r) => r.active);
  const inactive = filtered.filter((r) => !r.active);

  const card = (r: (typeof robots)[number]) => {
    const strat = getCryptoStrategy(r.strategyId);
    return (
      <div
        key={r.id}
        className={`panel rounded-lg overflow-hidden border ${r.active ? "border-cyan-500/50" : "border-border/50 opacity-80"}`}
      >
        <div className="px-4 py-3 flex items-center justify-between bg-secondary/20">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="font-bold text-sm text-white flex items-center gap-1.5">
                {r.name}
                {r.active && <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {r.symbol} · {r.interval} · {strat?.name ?? r.strategyId}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {mode === "spot" ? (
                  <span>SPOT · BUY/SELL · 1x (sem leverage)</span>
                ) : (
                  <span>
                    FUTUROS · {String(r.direction ?? "BOTH")} · {r.leverage ?? 5}x {r.marginMode ?? "isolated"}
                    {r.fundingAware ? ` · funding-aware (teto ${r.maxFundingRatePct ?? 0.05}%)` : ""}
                    {r.hedge ? " · hedge" : " · one-way"}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={r.active}
              onCheckedChange={(v) => {
                const ok = setActive(r.id, v, v ? null : "Parado manualmente.");
                if (!ok && v) toast.error(r.stoppedReason ?? "Config inválida.");
                else toast.info(v ? `Robô "${r.name}" ligado.` : `Robô "${r.name}" parado.`);
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-rose-400"
              onClick={() => {
                if (!confirm(`Apagar robô "${r.name}"?`)) return;
                if (r.active) setActive(r.id, false, "Robô removido.");
                removeRobot(r.id);
                toast.info("Robô removido.");
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="px-4 py-3 grid grid-cols-3 gap-2 text-xs font-mono border-t border-border/30">
          <div><div className="text-[9px] text-muted-foreground uppercase">Alocado</div>${r.capitalAllocated.toFixed(0)}</div>
          <div><div className="text-[9px] text-muted-foreground uppercase">Stake</div>${r.stakePerEntry.toFixed(0)}</div>
          <div><div className="text-[9px] text-muted-foreground uppercase">Stop conta</div><span className="text-bull">+{r.acctStopGainPct}%</span> / <span className="text-bear">−{r.acctStopLossPct}%</span></div>
          {r.stoppedReason && !r.active && (
            <div className="col-span-3 text-[11px] text-warning">Parado: {r.stoppedReason}</div>
          )}
          <div className="col-span-3">
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setActive(r.id, !r.active, r.active ? "Parado manualmente." : null)}>
              {r.active ? <><Square className="h-3 w-3 mr-1" /> Parar</> : <><Play className="h-3 w-3 mr-1" /> Ligar</>}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-lg">
        <Cpu className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          Sem robôs {mode === "spot" ? "Spot" : "Futuros"}. Cria um na página Cripto ou em Estratégias.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-muted-foreground uppercase mb-3">Ativos ({active.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{active.map(card)}</div>
        </div>
      )}
      {inactive.length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-muted-foreground uppercase mb-3">Inativos ({inactive.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{inactive.map(card)}</div>
        </div>
      )}
    </div>
  );
}

export default function Robots() {
  const [tab, setTab] = useState<RobotMode>("futures");
  const [search, setSearch] = useState("");
  const robots = useCryptoRobots((s) => s.robots);
  const nFut = robots.filter((r) => (r.mode ?? "spot") === "futures").length;
  const nSpot = robots.filter((r) => (r.mode ?? "spot") === "spot").length;

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cpu className="h-6 w-6 text-cyan-400" />
            Robôs Binance
          </h1>
          <p className="text-muted-foreground text-sm mt-1 mb-4">
            Spot (BUY/SELL à vista, sem leverage) e Futuros USDT-M (LONG/SHORT com leverage, margem e funding awareness).
          </p>
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-secondary/20 border border-border/30 rounded p-2 mb-4">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-cyan-400" />
            <span>
              {tab === "futures"
                ? "Futuros: escolhe LONG, SHORT ou ambos; define leverage (1–125x), margem isolated/cross e teto de funding. Com funding awareness ligado, o robô pausa entradas quando o funding estoura o teto."
                : "Spot: apenas compra (BUY) e venda para fechar (SELL). Sem leverage, sem SHORT, sem margem. Ideal para acumular BTC/ETH."}
            </span>
          </div>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar (nome, par, estratégia)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as RobotMode)}>
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
            <TabsTrigger value="futures">Futuros ({nFut}) · LONG/SHORT</TabsTrigger>
            <TabsTrigger value="spot">Spot ({nSpot}) · BUY/SELL</TabsTrigger>
          </TabsList>
          <TabsContent value="futures">
            <ModeRobots mode="futures" search={search} />
          </TabsContent>
          <TabsContent value="spot">
            <ModeRobots mode="spot" search={search} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
