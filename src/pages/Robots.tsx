import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { BookOpen, Cpu, Search, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { useCryptoRobots } from "@/lib/cryptoRobots";
import { getCryptoStrategy } from "@/lib/cryptoStrategies";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trash2, Play, Square } from "lucide-react";

export default function Robots() {
  const [search, setSearch] = useState("");
  const robots = useCryptoRobots((s) => s.robots).filter((r) => (r.mode ?? "futures") === "futures");
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
                FUTUROS · {String(r.direction ?? "BOTH")} · {r.leverage ?? 5}x {r.marginMode ?? "isolated"}
                {r.fundingAware ? ` · funding-aware (teto ${r.maxFundingRatePct ?? 0.05}%)` : ""}
                {r.hedge ? " · hedge" : " · one-way"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={r.active}
              onCheckedChange={(v) => {
                const ok = setActive(r.id, v, v ? null : "Parado manualmente.");
                if (!ok && v) toast.error(r.stoppedReason ?? "Config inválida.");
                else toast.info(v ? `Robô "${r.name}" ligado (paper).` : `Robô "${r.name}" parado.`);
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

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cpu className="h-6 w-6 text-cyan-400" />
            Robôs · Futuros USDT-M
          </h1>
          <p className="text-muted-foreground text-sm mt-1 mb-4">
            LONG/SHORT com leverage (1–125x), margem isolated/cross e funding awareness — criados a
            partir das <Link to="/strategies" className="text-primary underline">Estratégias</Link>.
          </p>
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-secondary/20 border border-border/30 rounded p-2 mb-4">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-cyan-400" />
            <span>
              Escolhe LONG, SHORT ou ambos; define leverage, margem e teto de funding. Com funding
              awareness ligado, o robô pausa entradas quando o funding estoura o teto. Tudo na conta
              paper — nenhuma ordem real é enviada à corretora.
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

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-lg">
            <Cpu className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              Sem robôs de Futuros. Cria um a partir de uma estratégia.
            </p>
            <Button size="sm" asChild>
              <Link to="/strategies"><BookOpen className="h-3.5 w-3.5 mr-1" /> Ir para Estratégias</Link>
            </Button>
          </div>
        ) : (
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
        )}

        <section className="mt-8 rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
            <BookOpen className="h-4 w-4 text-primary" /> Como funcionam os robôs
          </h2>
          <ul className="text-[12px] text-muted-foreground list-disc pl-5 space-y-1">
            <li><strong className="text-foreground">Nascem nas Estratégias:</strong> cada card tem “Criar robô Futuros” — o robô copia direção, timeframe e stops da estratégia e nasce parado.</li>
            <li><strong className="text-foreground">Conta paper:</strong> o robô opera com o capital alocado virtual (stake por entrada, stops da conta, cooldown, máx. 5 posições). Nada sai para a corretora.</li>
            <li><strong className="text-foreground">Direção:</strong> LONG abre compras, SHORT abre vendas, ambos aceita os dois sinais. O sinal da estratégia decide; a direção filtra.</li>
            <li><strong className="text-foreground">Proteções:</strong> stop-gain/stop-loss da conta param o robô com motivo registado; funding awareness pausa entradas com funding alto; cooldown evita overtrading.</li>
            <li><strong className="text-foreground">Ajustes:</strong> símbolo, timeframe, leverage, margem, stake e stops definem-se na criação — revê o card antes de ligar.</li>
            <li><strong className="text-foreground">Validação:</strong> ao ligar, a configuração é revalidada (margem, limites, estratégia existente). Se algo estiver errado, o robô para com o motivo visível no card.</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
