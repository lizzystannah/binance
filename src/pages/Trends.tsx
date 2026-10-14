import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, RefreshCw, Star, TrendingUp, Wallet } from "lucide-react";
import { formatPrice, formatUsdt } from "@/lib/binance";
import {
  buildPortfolio,
  curatedSymbols,
  rankTrends,
  scoreBarColor,
  scoreColor,
  topSymbolsByVolume,
  type PortfolioItem,
  type TrendScore,
} from "@/lib/cryptoTrend";
import { toast } from "sonner";

const WATCHLIST_KEY = "quantern:trend-watchlist";

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded bg-secondary/60 overflow-hidden">
        <div className={`h-full ${scoreBarColor(score)}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className={`font-mono text-xs font-bold ${scoreColor(score)}`}>{score.toFixed(1)}</span>
    </div>
  );
}

function topFactors(s: TrendScore, n = 3): string {
  return [...s.factors]
    .sort((a, b) => b.points - a.points)
    .slice(0, n)
    .map((f) => `${f.label} ${f.rawLabel}`)
    .join(" · ");
}

// Monitorização · tendência quantitativa (dados Binance, sem IA).
export default function Trends() {
  const [scores, setScores] = useState<TrendScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [universe, setUniverse] = useState<"curado" | "40" | "80">("curado");
  const [capital, setCapital] = useState("1000");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHLIST_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    } catch {
      /* ignore */
    }
  }, [watchlist]);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError("");
    setProgress({ done: 0, total: 0 });
    try {
      const symbols =
        universe === "curado"
          ? curatedSymbols()
          : await topSymbolsByVolume(universe === "40" ? 40 : 80);
      const res = await rankTrends(symbols, (done, total) => setProgress({ done, total }));
      if (res.length === 0) throw new Error("Sem scores calculados (verifica a ligação à Binance).");
      setScores(res);
      setUpdatedAt(Date.now());
      toast.success(`Analisados ${res.length} pares.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na análise.");
    } finally {
      setLoading(false);
    }
  }, [universe]);

  const toggleWatch = (sym: string) =>
    setWatchlist((w) => (w.includes(sym) ? w.filter((x) => x !== sym) : [...w, sym]));

  const capitalNum = Math.max(0, parseFloat(capital) || 0);
  const portfolio: PortfolioItem[] = useMemo(() => buildPortfolio(scores, capitalNum, 5, 35), [scores, capitalNum]);
  const scoreMap = useMemo(() => new Map(scores.map((s) => [s.symbol, s])), [scores]);
  const watchRows = watchlist
    .map((sym) => scoreMap.get(sym) ?? ({ symbol: sym, score: NaN } as unknown as TrendScore))
    .sort((a, b) => (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1));

  return (
    <AppShell>
      <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Monitorização · Tendência a valorizar
          </h1>
          <div className="flex items-center gap-2">
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value as typeof universe)}
              className="h-8 text-xs bg-secondary/50 border border-border rounded-md px-2"
            >
              <option value="curado">Universo curado (20)</option>
              <option value="40">Top 40 por volume</option>
              <option value="80">Top 80 por volume</option>
            </select>
            <Button size="sm" onClick={analyze} disabled={loading} className="h-8 text-[11px] font-bold">
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              {loading ? "A analisar…" : "Analisar mercado"}
            </Button>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground bg-secondary/20 border border-border/40 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
          <span>
            O <strong>índice de tendência (0–100)</strong> combina momentum, tendência (EMA), RSI, volume,
            funding e liquidez sobre dados públicos da Binance. <strong>Não é uma probabilidade calibrada
            nem garantia de valorização</strong> — é um ranking heurístico. Só leitura; não executa ordens.
            {updatedAt && <span className="ml-1">Atualizado às {new Date(updatedAt).toLocaleTimeString()}.</span>}
          </span>
        </div>

        {loading && progress.total > 0 && (
          <div className="text-[11px] font-mono text-muted-foreground">
            A analisar {progress.done}/{progress.total} pares…
          </div>
        )}
        {error && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {scores.length === 0 && !loading && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Clica em <strong>Analisar mercado</strong> para calcular o índice de tendência e o portfólio top-5.
            </CardContent>
          </Card>
        )}

        {scores.length > 0 && (
          <Tabs defaultValue="portfolio" className="w-full">
            <TabsList className="bg-transparent border-b border-border rounded-none h-auto p-0 flex justify-start">
              <TabsTrigger value="portfolio" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs">
                <Wallet className="h-4 w-4 mr-2" /> Portfólio top-5
              </TabsTrigger>
              <TabsTrigger value="ranking" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs">
                <TrendingUp className="h-4 w-4 mr-2" /> Ranking
              </TabsTrigger>
              <TabsTrigger value="watch" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs">
                <Star className="h-4 w-4 mr-2" /> Em monitorização ({watchlist.length})
              </TabsTrigger>
            </TabsList>

            {/* ── Portfólio ── */}
            <TabsContent value="portfolio" className="m-0 mt-4">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-xs uppercase">Portfólio sugerido (peso por score, teto 35% por ativo)</CardTitle>
                  <div className="flex items-center gap-2 text-xs">
                    <label className="text-muted-foreground">Capital (USDT)</label>
                    <Input value={capital} onChange={(e) => setCapital(e.target.value)} className="h-7 w-24 text-xs font-mono" inputMode="decimal" />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {portfolio.map((p, i) => (
                    <div key={p.symbol} className="px-3 py-2.5 border-b border-border/30">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-white">
                          <span className="text-muted-foreground mr-2">#{i + 1}</span>
                          {p.symbol}
                        </span>
                        <span className="font-mono">
                          <span className={scoreColor(p.score)}>{p.score.toFixed(1)}</span>
                          <span className="text-muted-foreground ml-3">{p.weightPct.toFixed(1)}%</span>
                          <span className="text-foreground ml-3 font-bold">${p.amountUsdt.toFixed(2)}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded bg-secondary/60 overflow-hidden">
                        <div className={`h-full ${scoreBarColor(p.score)}`} style={{ width: `${Math.min(100, p.score)}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    Sugestão de alocação matemática sobre o ranking. Não é recomendação financeira.
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Ranking ── */}
            <TabsContent value="ranking" className="m-0 mt-4">
              <Card>
                <CardContent className="p-0">
                  <div className="grid grid-cols-[24px_1.1fr_1fr_auto_1.6fr_auto] items-center gap-3 px-3 py-2 text-[10px] uppercase text-muted-foreground font-bold border-b border-border/40">
                    <span>#</span><span>Par</span><span>Preço</span><span>24h</span><span>Score</span><span />
                  </div>
                  {scores.map((s, i) => {
                    const watched = watchlist.includes(s.symbol);
                    return (
                      <div key={s.symbol} className="grid grid-cols-[24px_1.1fr_1fr_auto_1.6fr_auto] items-center gap-3 px-3 py-2 text-xs border-b border-border/30 hover:bg-secondary/20">
                        <span className="text-muted-foreground font-mono">{i + 1}</span>
                        <span className="font-mono font-bold text-white">
                          {s.symbol.replace("USDT", "")}
                          <span className="text-muted-foreground font-normal">/USDT</span>
                        </span>
                        <span className="font-mono text-right">${formatPrice(s.price)}</span>
                        <span className={`font-mono text-right ${s.change24hPct >= 0 ? "text-bull" : "text-bear"}`}>
                          {s.change24hPct >= 0 ? "+" : ""}{s.change24hPct.toFixed(2)}%
                        </span>
                        <span title={s.factors.map((f) => `${f.label}: ${f.rawLabel} (${f.points.toFixed(1)}/${f.weight})`).join("\n")}>
                          <ScoreBar score={s.score} />
                        </span>
                        <button
                          onClick={() => toggleWatch(s.symbol)}
                          title={watched ? "Remover da monitorização" : "Marcar para monitorizar"}
                          className={watched ? "text-yellow-400" : "text-muted-foreground/40 hover:text-muted-foreground"}
                        >
                          <Star className="h-4 w-4" fill={watched ? "currentColor" : "none"} />
                        </button>
                        <span className="col-span-6 -mt-1 text-[10px] text-muted-foreground font-mono">
                          {topFactors(s)}
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Monitorização ── */}
            <TabsContent value="watch" className="m-0 mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase">Pares em monitorização</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {watchRows.length === 0 && (
                    <p className="text-xs text-muted-foreground p-4">
                      Sem pares marcados. Vai a <strong>Ranking</strong> e clica na estrela.
                    </p>
                  )}
                  {watchRows.map((s) => (
                    <div key={s.symbol} className="flex items-center gap-3 px-3 py-2 border-b border-border/30 text-xs">
                      <Star className="h-3.5 w-3.5 text-yellow-400" fill="currentColor" />
                      <span className="font-mono font-bold text-white w-32">{s.symbol}</span>
                      {Number.isFinite(s.score) ? (
                        <>
                          <ScoreBar score={s.score} />
                          <span className="ml-auto font-mono text-muted-foreground">${formatPrice(s.price)}</span>
                          <span className={`font-mono ${s.change24hPct >= 0 ? "text-bull" : "text-bear"}`}>
                            {s.change24hPct >= 0 ? "+" : ""}{s.change24hPct.toFixed(2)}%
                          </span>
                          <span className="hidden md:block text-[10px] text-muted-foreground font-mono">{formatUsdt(s.quoteVolume)}</span>
                        </>
                      ) : (
                        <span className="ml-auto text-muted-foreground">Clica em Analisar para atualizar o score.</span>
                      )}
                      <button onClick={() => toggleWatch(s.symbol)} className="text-muted-foreground hover:text-bear" title="Remover">
                        ✕
                      </button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}
