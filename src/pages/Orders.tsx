import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeftRight, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchFuturesTickers24h,
  formatPrice,
  type BinanceTicker24h,
} from "@/lib/binance";
import {
  futuresLivePnl,
  futuresLiveRoe,
  futuresLockedMargin,
  futuresUnrealizedTotal,
  useFuturesPaper,
} from "@/lib/cryptoFutures";

// ─── Ordens Abertas — posições + ordens limite pendentes (conta paper futuros) ───
export default function Orders() {
  const paper = useFuturesPaper();
  const [tickers, setTickers] = useState<BinanceTicker24h[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchFuturesTickers24h();
      setTickers(data);
    } catch {
      /* mantém última cotação */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const marks = useMemo(() => {
    const m: Record<string, number> = {};
    tickers.forEach((t) => {
      m[t.symbol] = t.lastPrice;
    });
    return m;
  }, [tickers]);

  const q = search.trim().toUpperCase();
  const positions = useMemo(
    () => (q ? paper.positions.filter((p) => p.symbol.includes(q)) : paper.positions),
    [paper.positions, q]
  );
  const pending = useMemo(
    () => (q ? paper.pending.filter((o) => o.symbol.includes(q)) : paper.pending),
    [paper.pending, q]
  );

  const locked = futuresLockedMargin(paper.positions);
  const unreal = futuresUnrealizedTotal(paper.positions, marks);

  const closeAll = () => {
    if (paper.positions.length === 0) return;
    let closed = 0;
    paper.positions.forEach((p) => {
      const m = marks[p.symbol];
      if (!Number.isFinite(m)) return;
      const r = paper.closePosition(p.id, m, p.reduceOnly ? "REDUCE_ONLY" : "MANUAL");
      if (r.ok) closed += 1;
    });
    if (closed > 0) toast.success(`${closed} posição(ões) fechada(s) a mercado (paper).`);
    else toast.error("Sem cotação para fechar.");
  };

  return (
    <AppShell>
      <div className="p-4 flex flex-col gap-4 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-primary" /> Ordens Abertas
            </h1>
            <p className="text-xs text-muted-foreground">
              Posições e ordens limite pendentes da conta paper de Futuros USDT-M.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por par…"
                className="h-8 pl-7 text-xs w-48"
              />
            </div>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link to="/trading">Ir para Trading</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs text-rose-400"
              disabled={paper.positions.length === 0}
              onClick={closeAll}
            >
              <X className="h-3 w-3 mr-1" /> Fechar tudo
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">Posições</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3 font-mono text-lg font-bold">{paper.positions.length}</CardContent></Card>
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">Ordens pendentes</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3 font-mono text-lg font-bold">{paper.pending.length}</CardContent></Card>
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">Margem bloqueada</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3 font-mono text-lg font-bold">${locked.toFixed(2)}</CardContent></Card>
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">PnL não realizado</CardTitle></CardHeader>
            <CardContent className={`px-3 pb-3 font-mono text-lg font-bold ${unreal >= 0 ? "text-bull" : "text-bear"}`}>
              {unreal >= 0 ? "+" : ""}${unreal.toFixed(2)}
            </CardContent></Card>
        </div>

        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">Posições abertas ({positions.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {positions.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">Sem posições abertas.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Símbolo</TableHead>
                    <TableHead>Lado</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Entrada</TableHead>
                    <TableHead className="text-right">Mark</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">ROE</TableHead>
                    <TableHead>TP / SL / Liq</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => {
                    const m = marks[p.symbol];
                    const pnl = Number.isFinite(m) ? futuresLivePnl(p, m) : NaN;
                    const roe = Number.isFinite(m) ? futuresLiveRoe(p, m) : NaN;
                    return (
                      <TableRow key={p.id} className="font-mono text-xs">
                        <TableCell className="font-bold text-white">{p.symbol}</TableCell>
                        <TableCell>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.side === "LONG" ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"}`}>
                            {p.side} {p.leverage}x
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{p.qty.toPrecision(6)}</TableCell>
                        <TableCell className="text-right">${formatPrice(p.entryPrice)}</TableCell>
                        <TableCell className="text-right">${formatPrice(m ?? NaN)}</TableCell>
                        <TableCell className={`text-right font-bold ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                          {Number.isFinite(pnl) ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className={`text-right ${roe >= 0 ? "text-bull" : "text-bear"}`}>
                          {Number.isFinite(roe) ? `${roe >= 0 ? "+" : ""}${roe.toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {p.tpPrice !== null ? <span className="text-bull">TP ${formatPrice(p.tpPrice)} </span> : null}
                          {p.slPrice !== null ? <span className="text-orange-400">SL ${formatPrice(p.slPrice)} </span> : null}
                          <span className="text-rose-400">Liq ${formatPrice(p.liqPrice)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={() => {
                                if (!Number.isFinite(m)) return toast.error("Sem cotação para fechar.");
                                paper.closePosition(p.id, m, "REDUCE_ONLY", p.qty / 2);
                                toast.info("Reduzida 50% (paper).");
                              }}
                            >
                              ½
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] text-rose-400"
                              onClick={() => {
                                if (!Number.isFinite(m)) return toast.error("Sem cotação para fechar.");
                                paper.closePosition(p.id, m, p.reduceOnly ? "REDUCE_ONLY" : "MANUAL");
                                toast.info(`${p.symbol} fechada (paper).`);
                              }}
                            >
                              Fechar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">Ordens limite pendentes ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {pending.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">Sem ordens pendentes.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Símbolo</TableHead>
                    <TableHead>Lado</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Preço limite</TableHead>
                    <TableHead>Alavancagem</TableHead>
                    <TableHead>Expira</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((o) => (
                    <TableRow key={o.id} className="font-mono text-xs">
                      <TableCell className="font-bold text-white">{o.symbol}</TableCell>
                      <TableCell className={o.side === "LONG" ? "text-bull" : "text-bear"}>{o.side}</TableCell>
                      <TableCell className="text-right">{o.qty.toPrecision(6)}</TableCell>
                      <TableCell className="text-right">${formatPrice(o.limitPrice)}</TableCell>
                      <TableCell>{o.leverage}x {o.marginMode === "isolated" ? "Iso" : "Cross"}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(o.expiresAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] text-rose-400"
                          onClick={() => {
                            paper.cancelPending(o.id);
                            toast.info("Ordem cancelada (paper).");
                          }}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Cancelar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
