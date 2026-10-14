// ─── Aba Estratégias: catálogo Binance Spot + Futuros ─────────────────────────
// Backtest honesto: fill na abertura seguinte ao sinal, SL antes de TP na mesma
// vela, taxas + slippage declarados. Amostra < 30 trades = aviso explícito.
// Parâmetros cripto: timeframe 1m/5m/15m/1h/4h, ATR stop, TP/SL %, trailing,
// volume, RSI/MACD/EMA/Bollinger/OrderBlock adaptados a BTC/ETH/altcoins.

import { useMemo, useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  fetchKlines,
  formatPrice,
  type BinanceTicker24h,
} from "@/lib/binance";
import { CRYPTO_FEE_RATE, CRYPTO_SLIPPAGE_RATE } from "@/lib/cryptoPaper";
import { CRYPTO_INTERVALS, type RobotMode } from "@/lib/cryptoRobots";
import { CRYPTO_STRATEGIES, type CryptoCandle } from "@/lib/cryptoStrategies";
import { runCryptoBacktest, type CryptoBacktestResult } from "@/lib/cryptoBacktest";

export function StrategiesTab({ tickers }: { tickers: BinanceTicker24h[] }) {
  const [mode, setMode] = useState<RobotMode>("futures");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<string>("1h");
  const [klimit, setKlimit] = useState("1000");
  const [capital, setCapital] = useState("10000");
  const [stake, setStake] = useState("500");
  const [leverage, setLeverage] = useState("5");
  const [strategyId, setStrategyId] = useState(CRYPTO_STRATEGIES[0].id);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CryptoBacktestResult | null>(null);
  const [resultKey, setResultKey] = useState("");

  const strategies = useMemo(() => CRYPTO_STRATEGIES.filter((s) => (s.modes ?? ["spot", "futures"] as string[]).includes(mode)), [mode]);

  const symbolOptions = useMemo(() => {
    const sorted = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 60);
    if (!sorted.some((t) => t.symbol === symbol)) {
      const found = tickers.find((t) => t.symbol === symbol);
      if (found) return [found, ...sorted];
    }
    return sorted;
  }, [tickers, symbol]);

  const run = async () => {
    const strategy = CRYPTO_STRATEGIES.find((s) => s.id === strategyId);
    if (!strategy) return;
    const cap = parseFloat(capital);
    const stk = parseFloat(stake);
    const lev = Math.min(Math.max(parseInt(leverage) || 1, 1), 125);
    if (!Number.isFinite(cap) || cap <= 0) return toast.error("Capital inválido.");
    if (!Number.isFinite(stk) || stk <= 0) return toast.error("Stake inválido.");
    setRunning(true);
    try {
      const lim = Math.min(Math.max(parseInt(klimit) || 500, 100), 1000);
      const raw = await fetchKlines(symbol, interval, lim);
      // Remove a vela em formação: backtest só corre sobre velas FECHADAS.
      const klines: CryptoCandle[] = raw.slice(0, -1).map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));
      const res = runCryptoBacktest(klines, strategy, {
        capital: cap,
        stakePerEntry: stk,
        mode,
        leverage: mode === "futures" ? lev : 1,
      });
      setResult(res);
      setResultKey(`${strategy.name} · ${mode.toUpperCase()}${mode === "futures" ? ` ${lev}x` : ""} · ${symbol} · ${interval} · ${klines.length} velas`);
      if (res.totalTrades === 0) toast.info("Backtest sem trades — estratégia muito restritiva nestes dados.");
      else toast.success(`Backtest: ${res.totalTrades} trades · WR ${res.winRate.toFixed(1)}%`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no backtest.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={mode} onValueChange={(v) => {
        const m = v as RobotMode;
        setMode(m);
        const first = CRYPTO_STRATEGIES.find((s) => ((s.modes ?? ["spot", "futures"]) as string[]).includes(m));
        if (first) setStrategyId(first.id);
        setResult(null);
      }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="futures">Futuros (LONG/SHORT)</TabsTrigger>
          <TabsTrigger value="spot">Spot (BUY/SELL)</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strategies.map((s) => (
          <Card
            key={s.id}
            className={`bg-secondary/20 border-border/50 cursor-pointer ${strategyId === s.id ? "border-primary/50" : ""}`}
            onClick={() => setStrategyId(s.id)}
          >
            <CardHeader className="py-3 px-4 border-b border-border/50">
              <CardTitle className="text-sm font-bold">{s.name}</CardTitle>
              <div className="flex flex-wrap gap-1">
                <code className="text-[9px] text-primary bg-primary/10 px-1 rounded w-fit">{s.id}</code>
                <code className="text-[9px] text-muted-foreground bg-secondary px-1 rounded w-fit">{(s.timeframes ?? []).join(" · ")}</code>
              </div>
            </CardHeader>
            <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
              <p>{s.description}</p>
              <p className="font-mono">TP {s.defaults.stopGainPct}% · SL {s.defaults.stopLossPct}%{s.defaults.trailingPct ? ` · trail ${s.defaults.trailingPct}%` : ""} · mín. {s.minCandles} velas</p>
              <p className="font-mono text-[10px]">Indicadores: {(s.indicators ?? []).join(" · ")}</p>
              <div className="flex flex-wrap gap-1 pt-1">
                {(s.params ?? []).map((p) => (
                  <span key={p.key} className="text-[9px] bg-secondary/50 border border-border/30 px-1.5 py-0.5 rounded" title={p.hint}>
                    {p.label}: {String(p.default)}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-secondary/20 border-border/50">
        <CardHeader className="py-3 px-4 border-b border-border/50">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-warning" /> Backtest em klines reais — {mode === "spot" ? "Spot" : "Futuros"}
          </CardTitle>
          <CardDescription className="text-[10px]">
            Taxa {(CRYPTO_FEE_RATE * 100).toFixed(1)}%/lado + slippage {(CRYPTO_SLIPPAGE_RATE * 100).toFixed(2)}%. Fill na abertura seguinte ao sinal. Uma posição de cada vez{mode === "futures" ? ", PnL × leverage" : ", sem alavancagem"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
          <div className="col-span-2">
            <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Par</label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {symbolOptions.map((t) => (
                  <SelectItem key={t.symbol} value={t.symbol} className="font-mono text-xs">{t.symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Timeframe</label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRYPTO_INTERVALS.map((i) => (
                  <SelectItem key={i} value={i} className="font-mono text-xs">{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Velas</label>
            <Select value={klimit} onValueChange={setKlimit}>
              <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="1000">1000</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Capital (USDT)</label>
            <Input value={capital} onChange={(e) => setCapital(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Stake/entrada</label>
            <Input value={stake} onChange={(e) => setStake(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
          </div>
          {mode === "futures" && (
            <div>
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Leverage (1–125x)</label>
              <Input value={leverage} onChange={(e) => setLeverage(e.target.value)} className="h-8 text-xs font-mono" inputMode="numeric" />
            </div>
          )}
          <div className="col-span-2 md:col-span-6">
            <Button onClick={run} disabled={running} className="w-full h-9 text-xs font-bold">
              <Play className="h-3.5 w-3.5 mr-1" /> {running ? "A correr…" : `Correr backtest ${mode === "spot" ? "Spot" : "Futuros"}`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="bg-secondary/20 border-border/50">
          <CardHeader className="py-3 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-bold">Resultado — {resultKey}</CardTitle>
            {result.totalTrades > 0 && result.totalTrades < 30 && (
              <CardDescription className="text-[11px] text-warning">
                Amostra insuficiente ({result.totalTrades} trades &lt; 30). Não tires conclusões — testa mais velas ou outro par.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono mb-3">
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Trades</div>{result.totalTrades} ({result.wins}W / {result.losses}L)</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Win rate</div>{result.winRate.toFixed(1)}%</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">PnL</div><span className={result.pnl >= 0 ? "text-bull" : "text-bear"}>{result.pnl >= 0 ? "+" : ""}${result.pnl.toFixed(2)}</span></div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Max drawdown</div>{result.maxDrawdownPct.toFixed(2)}%</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Equity final</div>${result.finalEquity.toFixed(2)}</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Buy &amp; hold</div>{result.buyHoldPct >= 0 ? "+" : ""}{result.buyHoldPct.toFixed(2)}%</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Vela</div>{result.bars} velas</div>
              <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Lado(s)</div>{[...new Set(result.trades.map((t) => t.side))].join(" / ") || "—"}</div>
            </div>
            {result.trades.length > 0 && (
              <div className="max-h-56 overflow-y-auto border-t border-border/30 pt-2">
                {result.trades.slice(-30).reverse().map((t, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 py-1 border-b border-border/20 text-[11px] font-mono">
                    <span className="text-muted-foreground">{t.side} · {t.reason.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">${formatPrice(t.entryPrice)} → ${formatPrice(t.exitPrice)}</span>
                    <span className="text-muted-foreground text-center">{t.leverage}x</span>
                    <span className={`text-right ${t.pnl >= 0 ? "text-bull" : "text-bear"}`}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
