import { AppShell } from "@/components/AppShell";
import { useState } from "react";
import { BookOpen, Cpu, Search, Info, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { useCryptoRobots, validateRobotConfig, type CryptoRobot } from "@/lib/cryptoRobots";
import { getCryptoStrategy } from "@/lib/cryptoStrategies";
import { FUTURES_TRADING_SYMBOLS } from "@/lib/binance";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Play, Square } from "lucide-react";

function EditRobotDialog({ robot, onOpenChange }: { robot: CryptoRobot; onOpenChange: (v: boolean) => void }) {
  const updateRobot = useCryptoRobots((s) => s.updateRobot);
  const [symbol, setSymbol] = useState(robot.symbol);
  const [interval, setInterval] = useState(robot.interval);
  const [direction, setDirection] = useState<string>(String(robot.direction ?? "BOTH"));
  const [leverage, setLeverage] = useState(String(robot.leverage ?? 5));
  const [marginMode, setMarginMode] = useState<string>(String(robot.marginMode ?? "isolated"));
  const [capital, setCapital] = useState(String(robot.capitalAllocated));
  const [stake, setStake] = useState(String(robot.stakePerEntry));
  const [gain, setGain] = useState(String(robot.acctStopGainPct));
  const [loss, setLoss] = useState(String(robot.acctStopLossPct));
  const [maxPos, setMaxPos] = useState(String(robot.maxPositions));
  const [cooldown, setCooldown] = useState(String(robot.cooldownMin));
  const [fundingAware, setFundingAware] = useState(robot.fundingAware ?? true);
  const [maxFunding, setMaxFunding] = useState(String(robot.maxFundingRatePct ?? 0.05));

  const save = () => {
    const patch = {
      symbol: symbol.trim().toUpperCase(),
      interval,
      direction: direction as CryptoRobot["direction"],
      leverage: parseInt(leverage) || 5,
      marginMode: marginMode as CryptoRobot["marginMode"],
      capitalAllocated: parseFloat(capital),
      stakePerEntry: parseFloat(stake),
      acctStopGainPct: parseFloat(gain),
      acctStopLossPct: parseFloat(loss),
      maxPositions: parseInt(maxPos) || 2,
      cooldownMin: parseFloat(cooldown) || 0,
      fundingAware,
      maxFundingRatePct: parseFloat(maxFunding),
    };
    const errs = validateRobotConfig({ ...robot, ...patch, mode: "futures" });
    if (errs.length > 0) return toast.error(errs[0]);
    if (robot.active) return toast.error("Para o robô antes de editar.");
    updateRobot(robot.id, patch);
    toast.success(`Robô "${robot.name}" atualizado.`);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" /> Editar robô — {robot.name}
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Par</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2 font-mono">
              {FUTURES_TRADING_SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
              {!FUTURES_TRADING_SYMBOLS.includes(symbol as never) && <option value={symbol}>{symbol}</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Timeframe</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2 font-mono">
              {["1m", "5m", "15m", "1h", "4h"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Direção</span>
            <select value={String(direction)} onChange={(e) => setDirection(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2">
              <option value="BOTH">Ambos</option>
              <option value="LONG">Só Long</option>
              <option value="SHORT">Só Short</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Margem</span>
            <select value={String(marginMode)} onChange={(e) => setMarginMode(e.target.value)} className="h-8 bg-secondary/50 border border-border rounded px-2">
              <option value="isolated">Isolada</option>
              <option value="cross">Cruzada</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Leverage (1–125x)</span>
            <Input value={leverage} onChange={(e) => setLeverage(e.target.value)} className="h-8 font-mono" inputMode="numeric" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Máx. posições (1–5)</span>
            <Input value={maxPos} onChange={(e) => setMaxPos(e.target.value)} className="h-8 font-mono" inputMode="numeric" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Capital alocado $</span>
            <Input value={capital} onChange={(e) => setCapital(e.target.value)} className="h-8 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Stake/entrada $</span>
            <Input value={stake} onChange={(e) => setStake(e.target.value)} className="h-8 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Stop-gain conta %</span>
            <Input value={gain} onChange={(e) => setGain(e.target.value)} className="h-8 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Stop-loss conta %</span>
            <Input value={loss} onChange={(e) => setLoss(e.target.value)} className="h-8 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Cooldown (min)</span>
            <Input value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="h-8 font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Teto funding %</span>
            <Input value={maxFunding} onChange={(e) => setMaxFunding(e.target.value)} className="h-8 font-mono" inputMode="decimal" />
          </label>
          <label className="flex items-center gap-2 col-span-2 text-muted-foreground">
            <Switch checked={fundingAware} onCheckedChange={setFundingAware} /> Funding awareness
          </label>
          <Button onClick={save} className="col-span-2 h-9 text-xs font-bold">Guardar alterações</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Robots() {
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const allRobots = useCryptoRobots((s) => s.robots);
  const robots = allRobots.filter((r) => (r.mode ?? "futures") === "futures");
  const nSpotLegacy = allRobots.filter((r) => (r.mode ?? "futures") === "spot").length;
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
              className="h-7 text-[11px]"
              title={r.active ? "Para o robô para editar" : "Editar parâmetros"}
              disabled={r.active}
              onClick={() => setEditId(r.id)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
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
          {nSpotLegacy > 0 && (
            <p className="text-[11px] text-muted-foreground mt-2">
              {nSpotLegacy} robô(s) Spot antigo(s) oculto(s) — a plataforma agora é só Futuros.
            </p>
          )}
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
            <li><strong className="text-foreground">Execução:</strong> o “Ligar” arma e valida a configuração. A execução automática das entradas pelo motor de Futuros é o próximo passo da plataforma — até lá, usa o Backtest para validar a estratégia.</li>
            <li><strong className="text-foreground">Direção:</strong> LONG abre compras, SHORT abre vendas, ambos aceita os dois sinais. O sinal da estratégia decide; a direção filtra.</li>
            <li><strong className="text-foreground">Proteções:</strong> stop-gain/stop-loss da conta param o robô com motivo registado; funding awareness pausa entradas com funding alto; cooldown evita overtrading.</li>
            <li><strong className="text-foreground">Ajustes:</strong> usa o lápis no card para editar símbolo, timeframe, leverage, margem, stake, stops e funding. Robôs ativos precisam de ser parados antes de editar.</li>
            <li><strong className="text-foreground">Validação:</strong> ao ligar, a configuração é revalidada (margem, limites, estratégia existente). Se algo estiver errado, o robô para com o motivo visível no card.</li>
          </ul>
        </section>
        {editId && (() => {
          const r = robots.find((x) => x.id === editId);
          if (!r) return null;
          return <EditRobotDialog robot={r} onOpenChange={(v) => { if (!v) setEditId(null); }} />;
        })()}
      </div>
    </AppShell>
  );
}
