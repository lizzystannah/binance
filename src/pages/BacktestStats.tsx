import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, BarChart3, FlaskConical } from "lucide-react";
import { formatPrice } from "@/lib/binance";
import { useBacktestResults } from "@/lib/backtestMode";
import type { CryptoBacktestTrade } from "@/lib/cryptoBacktest";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" | "muted" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded border border-border/50 bg-background/40 p-2.5">
      <div className="text-[9px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`font-mono font-bold text-sm ${cls}`}>{value}</div>
    </div>
  );
}

function EquityCurve({ trades, capital }: { trades: CryptoBacktestTrade[]; capital: number }) {
  const { path, min, max, final } = useMemo(() => {
    let eq = capital;
    const pts: number[] = [eq];
    for (const t of trades) {
      eq += t.pnl;
      pts.push(eq);
    }
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    const span = hi - lo || 1;
    const W = 100;
    const H = 32;
    const d = pts
      .map((v, i) => {
        const x = (i / Math.max(1, pts.length - 1)) * W;
        const y = H - ((v - lo) / span) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return { path: d, min: lo, max: hi, final: eq };
  }, [trades, capital]);
  const up = final >= capital;
  return (
    <div>
      <svg viewBox={`0 0 100 32`} preserveAspectRatio="none" className="w-full h-24 bg-background/40 rounded border border-border/40">
        <path d={path} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
        <span>mín ${min.toFixed(2)}</span>
        <span>máx ${max.toFixed(2)}</span>
        <span className={up ? "text-bull" : "text-bear"}>final ${final.toFixed(2)}</span>
      </div>
    </div>
  );
}

export default function BacktestStats() {
  const run = useBacktestResults((s) => s.last);
  const history = useBacktestResults((s) => s.history);
  const setLast = useBacktestResults((s) => s.setLast);
  const clear = useBacktestResults((s) => s.clear);

  const stats = useMemo(() => {
    if (!run) return null;
    const r = run.result;
    const trades = r.trades;
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = losses.reduce((s, t) => s + t.pnl, 0);
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0;
    const expectancy = trades.length ? r.pnl / trades.length : 0;
    const best = trades.reduce((m, t) => (t.pnl > m ? t.pnl : m), -Infinity);
    const worst = trades.reduce((m, t) => (t.pnl < m ? t.pnl : m), Infinity);
    const fees = trades.reduce((s, t) => s + (t.feesPaid ?? 0), 0);
    const funding = trades.reduce((s, t) => s + (t.fundingPaid ?? 0), 0);
    const spread = trades.reduce((s, t) => s + (t.spreadPaid ?? 0), 0);
    const avgBars = trades.length ? trades.reduce((s, t) => s + (t.exitIndex - t.entryIndex), 0) / trades.length : 0;

    // Sequências
    let curW = 0, curL = 0, maxW = 0, maxL = 0;
    for (const t of trades) {
      if (t.pnl > 0) { curW += 1; curL = 0; } else { curL += 1; curW = 0; }
      maxW = Math.max(maxW, curW);
      maxL = Math.max(maxL, curL);
    }

    // Por motivo
    const byReason = new Map<string, { n: number; pnl: number }>();
    for (const t of trades) {
      const e = byReason.get(t.reason) ?? { n: 0, pnl: 0 };
      e.n += 1; e.pnl += t.pnl;
      byReason.set(t.reason, e);
    }

    // Por lado
    const bySide = (side: "LONG" | "SHORT") => {
      const arr = trades.filter((t) => t.side === side);
      return { n: arr.length, wins: arr.filter((t) => t.pnl > 0).length, pnl: arr.reduce((s, t) => s + t.pnl, 0) };
    };

    return {
      r, trades, wins: wins.length, losses: losses.length,
      grossProfit, grossLoss, avgWin, avgLoss, profitFactor, expectancy,
      best, worst, fees, funding, avgBars, spread,
      maxW, maxL, byReason: [...byReason.entries()], long: bySide("LONG"), short: bySide("SHORT"),
      returnPct: (r.pnl / run.capital) * 100,
    };
  }, [run]);

  return (
    <AppShell>
      <div className="p-4 flex flex-col gap-4 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> Estatísticas do Backtest
            </h1>
            <p className="text-xs text-muted-foreground">
              Resultado completo da última corrida (klines reais Binance Futures, conta paper).
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link to="/trading"><FlaskConical className="h-3.5 w-3.5 mr-1" /> Ir para Trading</Link>
          </Button>
          {run && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={clear}>
              Limpar
            </Button>
          )}
        </div>

        {!run || !stats ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
              <span>Sem backtest corrido. Ativa o modo backtest em Configurações e corre na página Trading.</span>
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <Link to="/trading">Ir para Trading</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-3 flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono">{run.symbol}</Badge>
                <Badge variant="outline" className="font-mono">{run.interval}</Badge>
                <span className="font-mono text-white font-bold">{run.strategyName}</span>
                <span className="text-muted-foreground">Direção: <span className="text-foreground font-mono uppercase">{run.direction}</span></span>
                <span className="text-muted-foreground">Lev: <span className="text-foreground font-mono">{run.leverage}x</span></span>
                <span className="text-muted-foreground">Capital: <span className="text-foreground font-mono">${run.capital}</span></span>
                <span className="text-muted-foreground">Stake: <span className="text-foreground font-mono">${run.stakePerEntry}</span></span>
                {run.spreadPct !== undefined && run.spreadPct > 0 && (
                  <span className="text-muted-foreground">Spread: <span className="text-foreground font-mono">{run.spreadPct.toFixed(3)}%</span></span>
                )}
                <span className="ml-auto text-muted-foreground">{new Date(run.ranAt).toLocaleString()}</span>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              <Kpi label="Trades" value={String(stats.r.totalTrades)} />
              <Kpi label="Win rate" value={`${stats.r.winRate.toFixed(1)}%`} tone={stats.r.winRate >= 50 ? "bull" : "bear"} />
              <Kpi label="PnL" value={`${stats.r.pnl >= 0 ? "+" : ""}$${stats.r.pnl.toFixed(2)}`} tone={stats.r.pnl >= 0 ? "bull" : "bear"} />
              <Kpi label="Retorno" value={`${stats.returnPct >= 0 ? "+" : ""}${stats.returnPct.toFixed(2)}%`} tone={stats.returnPct >= 0 ? "bull" : "bear"} />
              <Kpi label="Equity final" value={`$${stats.r.finalEquity.toFixed(2)}`} />
              <Kpi label="DD máx" value={`${stats.r.maxDrawdownPct.toFixed(1)}%`} tone="bear" />
              <Kpi label="Profit factor" value={Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞"} tone={stats.profitFactor >= 1 ? "bull" : "bear"} />
              <Kpi label="Expectância" value={`${stats.expectancy >= 0 ? "+" : ""}$${stats.expectancy.toFixed(2)}`} tone={stats.expectancy >= 0 ? "bull" : "bear"} />
              <Kpi label="Ganhos / Perdas" value={`${stats.wins} / ${stats.losses}`} />
              <Kpi label="Ganho médio" value={`${stats.wins ? "+" : ""}$${stats.avgWin.toFixed(2)}`} tone={stats.wins ? "bull" : "muted"} />
              <Kpi label="Perda média" value={`${stats.avgLoss < 0 ? "-" : ""}$${Math.abs(stats.avgLoss).toFixed(2)}`} tone={stats.losses ? "bear" : "muted"} />
              <Kpi label="Buy & hold" value={`${stats.r.buyHoldPct >= 0 ? "+" : ""}${stats.r.buyHoldPct.toFixed(2)}%`} tone={stats.r.buyHoldPct >= 0 ? "bull" : "bear"} />
              <Kpi label="Melhor trade" value={`+$${Number.isFinite(stats.best) ? stats.best.toFixed(2) : "0"}`} tone="bull" />
              <Kpi label="Pior trade" value={`$${Number.isFinite(stats.worst) ? stats.worst.toFixed(2) : "0"}`} tone="bear" />
              <Kpi label="Máx ganhos seg." value={String(stats.maxW)} tone="bull" />
              <Kpi label="Máx perdas seg." value={String(stats.maxL)} tone="bear" />
              <Kpi label="Duração média" value={`${stats.avgBars.toFixed(1)} velas`} />
              <Kpi label="Taxas totais" value={`$${stats.fees.toFixed(2)}`} tone="muted" />
              <Kpi label="Spread" value={`$${stats.spread.toFixed(2)}`} tone="muted" />
              <Kpi label="Funding" value={`$${stats.funding.toFixed(2)}`} tone="muted" />
            </div>

            <Card>
              <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Curva de capital</CardTitle></CardHeader>
              <CardContent className="p-3"><EquityCurve trades={stats.trades} capital={run.capital} /></CardContent>
            </Card>

            <div className="grid md:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Por motivo de saída</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {stats.byReason.map(([reason, e]) => (
                    <div key={reason} className="flex justify-between px-3 py-1.5 text-[11px] font-mono border-b border-border/30 last:border-0">
                      <span>{reason.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">{e.n}×</span>
                      <span className={e.pnl >= 0 ? "text-bull" : "text-bear"}>{e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(2)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Por lado</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {([["LONG", stats.long], ["SHORT", stats.short]] as const).map(([side, e]) => (
                    <div key={side} className="flex justify-between px-3 py-2 text-[11px] font-mono border-b border-border/30 last:border-0">
                      <span className={side === "LONG" ? "text-bull" : "text-bear"}>{side}</span>
                      <span className="text-muted-foreground">{e.n} trades · {e.n ? ((e.wins / e.n) * 100).toFixed(0) : 0}% WR</span>
                      <span className={e.pnl >= 0 ? "text-bull" : "text-bear"}>{e.pnl >= 0 ? "+" : ""}${e.pnl.toFixed(2)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Aviso</CardTitle></CardHeader>
                <CardContent className="p-3 flex items-start gap-2 text-[11px] text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning mt-0.5" />
                  <span>
                    Backtest sobre velas fechadas, sem lookahead, SL antes de TP na mesma vela, com taxas,
                    spread bid-ask e slippage. Ainda <strong>não simula liquidação</strong> nem funding real
                    — resultados em leverage alto são otimistas.
                    {stats.r.totalTrades < 30 && " Amostra <30 trades: pouco significativa."}
                  </span>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Trades ({stats.trades.length})</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px]">
                      <TableHead>#</TableHead>
                      <TableHead>Lado</TableHead>
                      <TableHead className="text-right">Entrada</TableHead>
                      <TableHead className="text-right">TP / SL</TableHead>
                      <TableHead className="text-right">Saída</TableHead>
                      <TableHead className="text-right">Duração</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">PnL</TableHead>
                      <TableHead className="text-right">ROE</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.trades.map((t, i) => (
                      <TableRow key={`${t.entryIndex}-${i}`} className="font-mono text-xs">
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className={t.side === "LONG" ? "text-bull" : "text-bear"}>{t.side} {t.leverage}x</TableCell>
                        <TableCell className="text-right">${formatPrice(t.entryPrice)}</TableCell>
                        <TableCell className="text-right text-[10px]">
                          <span className="text-bull">${formatPrice(t.takeProfitPrice)}</span> / <span className="text-bear">${formatPrice(t.stopLossPrice)}</span>
                        </TableCell>
                        <TableCell className="text-right">${formatPrice(t.exitPrice)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{t.exitIndex - t.entryIndex} velas</TableCell>
                        <TableCell className="text-muted-foreground">{t.reason.replace(/_/g, " ")}</TableCell>
                        <TableCell className={`text-right font-bold ${t.pnl >= 0 ? "text-bull" : "text-bear"}`}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</TableCell>
                        <TableCell className={`text-right ${t.pnlPct >= 0 ? "text-bull" : "text-bear"}`}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {history.length > 1 && (
              <Card>
                <CardHeader className="py-2 px-3"><CardTitle className="text-xs">Corridas anteriores ({history.length})</CardTitle></CardHeader>
                <CardContent className="p-0">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setLast(h)}
                      className={`w-full flex flex-wrap items-center gap-2 px-3 py-1.5 text-[11px] font-mono border-b border-border/30 last:border-0 hover:bg-secondary/30 text-left ${h.id === run.id ? "bg-primary/10" : ""}`}
                    >
                      <span className="font-bold text-white">{h.symbol}</span>
                      <span className="text-muted-foreground">{h.interval}</span>
                      <span className="text-muted-foreground truncate max-w-[160px]">{h.strategyName}</span>
                      <span className="text-muted-foreground">{h.result.totalTrades} trades</span>
                      <span className={h.result.pnl >= 0 ? "text-bull" : "text-bear"}>
                        {h.result.pnl >= 0 ? "+" : ""}${h.result.pnl.toFixed(2)}
                      </span>
                      <span className="ml-auto text-muted-foreground/70">{new Date(h.ranAt).toLocaleString()}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
