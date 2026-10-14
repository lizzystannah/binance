import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchAllTickers24h,
  formatPrice,
  formatUsdt,
  mostTraded,
  potentialNewListings,
  topMovers,
  type BinanceTicker24h,
} from "@/lib/binance";
import { ArrowDown, ArrowUp, CandlestickChart, Flame, RefreshCw, Search, Sparkles, AlertTriangle } from "lucide-react";

function TickerRow({ t }: { t: BinanceTicker24h }) {
  const up = t.priceChangePercent >= 0;
  return (
    <div className="w-full grid grid-cols-[1fr_auto_auto] md:grid-cols-[1.2fr_repeat(4,auto)] items-center gap-3 px-3 py-2 text-left text-xs border-b border-border/30">
      <span className="font-bold text-white font-mono">
        {t.symbol.replace("USDT", "")}
        <span className="text-muted-foreground font-normal">/USDT</span>
      </span>
      <span className="font-mono text-white text-right">${formatPrice(t.lastPrice)}</span>
      <span className={`font-mono text-right flex items-center gap-1 ${up ? "text-bull" : "text-bear"}`}>
        {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {up ? "+" : ""}{t.priceChangePercent.toFixed(2)}%
      </span>
      <span className="hidden md:block font-mono text-muted-foreground text-right">{formatUsdt(t.quoteVolume)}</span>
      <span className="hidden md:block font-mono text-muted-foreground text-right">{t.count.toLocaleString()} trades</span>
    </div>
  );
}

function TickerList({ items, empty }: { items: BinanceTicker24h[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground p-4">{empty}</p>;
  return (
    <div className="divide-y divide-border/30">
      {items.map((t) => <TickerRow key={t.symbol} t={t} />)}
    </div>
  );
}

// Binance-only: Mercado (tendência + novas criptos). Só leitura, dados públicos.
export default function Market() {
  const [tickers, setTickers] = useState<BinanceTicker24h[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const loadMarket = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const all = await fetchAllTickers24h();
      setTickers(all);
      setLastUpdate(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao carregar mercado da Binance.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMarket();
    const iv = setInterval(loadMarket, 30_000);
    return () => clearInterval(iv);
  }, [loadMarket]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 100);
    return tickers.filter((t) => t.symbol.includes(q)).slice(0, 100);
  }, [tickers, search]);

  const gainers = useMemo(() => topMovers(tickers, 20, "up"), [tickers]);
  const losers = useMemo(() => topMovers(tickers, 20, "down"), [tickers]);
  const traded = useMemo(() => mostTraded(tickers, 20), [tickers]);
  const recents = useMemo(() => potentialNewListings(tickers, 20), [tickers]);

  return (
    <AppShell>
      <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CandlestickChart className="h-5 w-5 text-primary" />
            Mercado · Binance
          </h1>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {tickers.length} pares USDT
              {lastUpdate && <span> · atualizado às {new Date(lastUpdate).toLocaleTimeString()}</span>}
            </p>
            <Button size="sm" variant="outline" onClick={loadMarket} className="h-7 text-[11px]">
              <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar par (ex: BTC, ETH, SOL)..."
            className="h-9 pl-8 text-xs"
          />
        </div>

        <Tabs defaultValue="tendencias" className="w-full">
          <TabsList className="bg-card w-full justify-start border-b border-border rounded-none h-auto p-0 bg-transparent flex">
            <TabsTrigger value="tendencias" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs">
              <Flame className="h-4 w-4 mr-2" /> Tendências
            </TabsTrigger>
            <TabsTrigger value="novas" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs">
              <Sparkles className="h-4 w-4 mr-2" /> Novas criptos
            </TabsTrigger>
            <TabsTrigger value="mercado" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-3 text-xs">
              <CandlestickChart className="h-4 w-4 mr-2" /> Mercado
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tendencias" className="m-0 mt-4 grid md:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-bull">Top altas 24h</CardTitle></CardHeader>
              <CardContent className="p-0"><TickerList items={gainers} empty="Sem dados." /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-bear">Top quedas 24h</CardTitle></CardHeader>
              <CardContent className="p-0"><TickerList items={losers} empty="Sem dados." /></CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-primary">Maior volume 24h</CardTitle></CardHeader>
              <CardContent className="p-0"><TickerList items={traded} empty="Sem dados." /></CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="novas" className="m-0 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase">Novas / low-cap (menor volume)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <p className="text-[10px] text-muted-foreground px-3 py-2 border-b border-border/30">
                  A Binance não expõe data de listagem na API pública — listamos pares de menor quoteVolume como proxy honesto de low-cap/novos.
                </p>
                <TickerList items={recents} empty="Sem dados." />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="mercado" className="m-0 mt-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase">Todos os pares USDT</CardTitle></CardHeader>
              <CardContent className="p-0">
                {loading && tickers.length === 0
                  ? <p className="text-xs text-muted-foreground p-4">A carregar mercado da Binance…</p>
                  : <TickerList items={filtered} empty="Nenhum par encontrado." />}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
