// ─── Aba Robôs: Binance Spot + Futuros ───────────────────────────────────────
// Spot: apenas BUY/SELL à vista, sem leverage.
// Futuros USDT-M: LONG/SHORT, leverage 1–125x, isolated/cross, funding awareness,
// hedge opcional. Sem ticks/dígitos/stake de binárias, sem martingale.

import { useMemo, useState } from "react";
import { Cpu, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { BinanceTicker24h } from "@/lib/binance";
import {
  lockedCost,
  realizedPnl,
  unrealizedPnl,
  useCryptoPaper,
} from "@/lib/cryptoPaper";
import {
  CRYPTO_INTERVALS,
  DEFAULT_MAX_FUNDING_RATE_PCT,
  useCryptoRobots,
  type NewCryptoRobot,
  type RobotMode,
} from "@/lib/cryptoRobots";
import { CRYPTO_STRATEGIES } from "@/lib/cryptoStrategies";

function emptyFor(mode: RobotMode): NewCryptoRobot {
  return {
    name: "",
    symbol: "BTCUSDT",
    interval: "15m",
    strategyId: "spot_trend_pullback",
    mode,
    direction: mode === "spot" ? ("BUY" as never) : "BOTH",
    leverage: mode === "futures" ? 5 : undefined,
    marginMode: mode === "futures" ? "isolated" : undefined,
    hedge: false,
    fundingAware: mode === "futures",
    maxFundingRatePct: mode === "futures" ? DEFAULT_MAX_FUNDING_RATE_PCT : undefined,
    capitalAllocated: 1000,
    stakePerEntry: 100,
    acctStopGainPct: 10,
    acctStopLossPct: 5,
    maxPositions: 2,
    cooldownMin: 30,
  };
}

export function RobotsTab({ tickers }: { tickers: BinanceTicker24h[] }) {
  const { robots, createRobot, removeRobot, setActive } = useCryptoRobots();
  const paper = useCryptoPaper();
  const [tab, setTab] = useState<RobotMode>("futures");
  const [form, setForm] = useState<NewCryptoRobot>(emptyFor("futures"));

  const switchTab = (m: RobotMode) => {
    setTab(m);
    setForm((f) => ({ ...emptyFor(m), symbol: f.symbol }));
  };

  const set = <K extends keyof NewCryptoRobot>(k: K, v: NewCryptoRobot[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const marks = useMemo(() => {
    const m: Record<string, number> = {};
    tickers.forEach((t) => {
      m[t.symbol] = t.lastPrice;
    });
    return m;
  }, [tickers]);

  const symbolOptions = useMemo(() => {
    const sorted = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 60);
    if (!sorted.some((t) => t.symbol === form.symbol))
      return [{ symbol: form.symbol } as BinanceTicker24h, ...sorted];
    return sorted;
  }, [tickers, form.symbol]);

  const visible = robots.filter((r) => (r.mode ?? "spot") === tab);
  const strategiesForMode = CRYPTO_STRATEGIES.filter((s) => (s.modes ?? ["spot", "futures"] as string[]).includes(tab));

  const handleCreate = () => {
    const res = createRobot({ ...form, mode: tab });
    if (!res.ok) {
      toast.error(res.reason || "Config inválida.");
      return;
    }
    toast.success(`Robô "${form.name}" criado em ${tab === "spot" ? "Spot" : "Futuros"} (parado).`);
    setForm({ ...emptyFor(tab), symbol: form.symbol });
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => switchTab(v as RobotMode)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="futures">Futuros (LONG/SHORT × leverage)</TabsTrigger>
          <TabsTrigger value="spot">Spot (BUY/SELL sem leverage)</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="bg-secondary/20 border-border/50">
            <CardHeader className="py-3 px-4 border-b border-border/50">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Cpu className="h-4 w-4 text-cyan-400" />
                {tab === "futures" ? "Novo robô Futuros" : "Novo robô Spot"}
              </CardTitle>
              <CardDescription className="text-[10px]">
                {tab === "futures"
                  ? "LONG/SHORT com leverage, isolated/cross e funding awareness. O stop da conta fecha tudo e desliga."
                  : "Apenas BUY/SELL à vista, sem leverage e sem SHORT. O stop da conta fecha tudo e desliga."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="col-span-2">
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Nome *</label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={tab === "futures" ? "Ex: Scalp ETH LONG/SHORT 5m" : "Ex: DCA BTC Spot 1h"} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Par *</label>
                <Select value={form.symbol} onValueChange={(v) => set("symbol", v)}>
                  <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {symbolOptions.map((t) => (
                      <SelectItem key={t.symbol} value={t.symbol} className="font-mono text-xs">{t.symbol}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Timeframe *</label>
                <Select value={form.interval} onValueChange={(v) => set("interval", v)}>
                  <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CRYPTO_INTERVALS.map((i) => (
                      <SelectItem key={i} value={i} className="font-mono text-xs">{i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Estratégia *</label>
                <Select value={form.strategyId} onValueChange={(v) => set("strategyId", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {strategiesForMode.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Direção *</label>
                <Select value={String(form.direction ?? (tab === "spot" ? "BUY" : "BOTH"))} onValueChange={(v) => set("direction", v as never)}>
                  <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tab === "spot" ? (
                      <SelectItem value="BUY">BUY (SELL fecha)</SelectItem>
                    ) : (
                      <>
                        <SelectItem value="BOTH">LONG + SHORT</SelectItem>
                        <SelectItem value="LONG">Apenas LONG</SelectItem>
                        <SelectItem value="SHORT">Apenas SHORT</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {tab === "futures" ? (
                <>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Leverage (1–125x) *</label>
                    <Input value={String(form.leverage ?? 5)} onChange={(e) => set("leverage", Math.round(num(e.target.value, 5)))} className="h-8 text-xs font-mono" inputMode="numeric" />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Margem *</label>
                    <Select value={form.marginMode ?? "isolated"} onValueChange={(v) => set("marginMode", v as never)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="isolated">Isolated</SelectItem>
                        <SelectItem value="cross">Cross</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <div className="col-span-2 flex items-end pb-1">
                  <p className="text-[10px] text-muted-foreground">Spot = 1x fixo, sem margem, sem SHORT.</p>
                </div>
              )}

              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Capital alocado (USDT) *</label>
                <Input value={String(form.capitalAllocated)} onChange={(e) => set("capitalAllocated", num(e.target.value))} className="h-8 text-xs font-mono" inputMode="decimal" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Stake / entrada (USDT) *</label>
                <Input value={String(form.stakePerEntry)} onChange={(e) => set("stakePerEntry", num(e.target.value))} className="h-8 text-xs font-mono" inputMode="decimal" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Stop-gain conta % *</label>
                <Input value={String(form.acctStopGainPct)} onChange={(e) => set("acctStopGainPct", num(e.target.value))} className="h-8 text-xs font-mono" inputMode="decimal" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Stop-loss conta % *</label>
                <Input value={String(form.acctStopLossPct)} onChange={(e) => set("acctStopLossPct", num(e.target.value))} className="h-8 text-xs font-mono" inputMode="decimal" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Máx posições (1–5) *</label>
                <Input value={String(form.maxPositions)} onChange={(e) => set("maxPositions", Math.round(num(e.target.value, 1)))} className="h-8 text-xs font-mono" inputMode="numeric" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Cooldown (min) *</label>
                <Input value={String(form.cooldownMin)} onChange={(e) => set("cooldownMin", num(e.target.value))} className="h-8 text-xs font-mono" inputMode="numeric" />
              </div>

              {tab === "futures" && (
                <>
                  <div className="col-span-2 flex items-center justify-between bg-secondary/30 rounded border border-border/30 px-3 py-2">
                    <div>
                      <div className="text-[11px] font-bold">Funding awareness</div>
                      <div className="text-[10px] text-muted-foreground">Pausa entradas quando o funding estoura o teto.</div>
                    </div>
                    <Switch checked={!!form.fundingAware} onCheckedChange={(v) => set("fundingAware", v)} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Teto funding %</label>
                    <Input value={String(form.maxFundingRatePct ?? DEFAULT_MAX_FUNDING_RATE_PCT)} onChange={(e) => set("maxFundingRatePct", num(e.target.value))} className="h-8 text-xs font-mono" inputMode="decimal" disabled={!form.fundingAware} />
                  </div>
                  <div className="flex items-center justify-between bg-secondary/30 rounded border border-border/30 px-3 py-2">
                    <div>
                      <div className="text-[11px] font-bold">Hedge (LONG+SHORT)</div>
                      <div className="text-[10px] text-muted-foreground">One-way se desligado.</div>
                    </div>
                    <Switch checked={!!form.hedge} onCheckedChange={(v) => set("hedge", v)} />
                  </div>
                </>
              )}

              <div className="col-span-2 md:col-span-4">
                <Button onClick={handleCreate} className="w-full h-9 text-xs font-bold">
                  <Cpu className="h-3.5 w-3.5 mr-1" /> Criar robô {tab === "futures" ? "Futuros" : "Spot"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {visible.length === 0 && (
            <Card className="bg-secondary/20 border-border/50 mt-4">
              <CardContent className="p-6 text-center text-xs text-muted-foreground">
                Nenhum robô {tab === "futures" ? "de Futuros" : "Spot"} criado. Configura acima e faz backtest na aba Estratégias antes de ligar.
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {visible.map((r) => {
              const real = realizedPnl(paper.history, r.id);
              const open = paper.positions.filter((p) => p.robotId === r.id);
              const unreal = unrealizedPnl(paper.positions, marks, r.id);
              const equity = r.capitalAllocated + real + unreal;
              const eqPct = ((equity - r.capitalAllocated) / r.capitalAllocated) * 100;
              return (
                <Card key={r.id} className={`bg-secondary/20 border-border/50 ${r.active ? "border-cyan-500/40" : ""}`}>
                  <CardHeader className="py-3 px-4 border-b border-border/50">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                        {r.active && <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />}
                        {r.name}
                      </CardTitle>
                      <div className="ml-auto flex items-center gap-2">
                        <Switch
                          checked={r.active}
                          onCheckedChange={(v) => {
                            setActive(r.id, v, v ? null : "Parado manualmente.");
                            toast.info(v ? `Robô "${r.name}" ligado (paper).` : `Robô "${r.name}" parado.`);
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px] text-rose-400"
                          onClick={() => {
                            if (!confirm(`Remover o robô "${r.name}"? As posições abertas dele mantêm-se na carteira.`)) return;
                            if (r.active) setActive(r.id, false, "Robô removido.");
                            removeRobot(r.id);
                            toast.info("Robô removido.");
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-[10px] font-mono">
                      {r.symbol} · {r.interval} · {r.strategyId} · {(r.mode ?? "spot").toUpperCase()}
                      {r.mode === "futures" ? ` · ${r.leverage ?? 5}x ${r.marginMode ?? "isolated"}` : " · 1x spot"}
                      {r.mode === "futures" && r.fundingAware ? " · funding-aware" : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 grid grid-cols-3 gap-2 text-xs font-mono">
                    <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Alocado</div>${r.capitalAllocated.toFixed(0)}</div>
                    <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Equity</div><span className={eqPct >= 0 ? "text-bull" : "text-bear"}>${equity.toFixed(2)} ({eqPct >= 0 ? "+" : ""}{eqPct.toFixed(2)}%)</span></div>
                    <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Abertas</div>{open.length}/{r.maxPositions}</div>
                    <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Stake/entrada</div>${r.stakePerEntry.toFixed(0)}</div>
                    <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Stop conta</div><span className="text-bull">+{r.acctStopGainPct}%</span> / <span className="text-bear">−{r.acctStopLossPct}%</span></div>
                    <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Em uso</div>${lockedCost(paper.positions, r.id).toFixed(2)}</div>
                    {r.stoppedReason && !r.active && (
                      <div className="col-span-3 text-[11px] text-warning font-sans">Parado: {r.stoppedReason}</div>
                    )}
                    <div className="col-span-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        onClick={() => setActive(r.id, !r.active, r.active ? "Parado manualmente." : null)}
                      >
                        {r.active ? <><Square className="h-3 w-3 mr-1" /> Parar</> : <><Play className="h-3 w-3 mr-1" /> Ligar</>}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
