import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, Search } from "lucide-react";
import { formatPrice } from "@/lib/binance";
import { useFuturesPaper } from "@/lib/cryptoFutures";

// ─── Histórico de Ordens — trades fechados da conta paper futuros ───
export default function HistoryPage() {
  const paper = useFuturesPaper();
  const [search, setSearch] = useState("");
  const [side, setSide] = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [reason, setReason] = useState<string>("ALL");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return paper.history.filter((t) => {
      if (q && !t.symbol.includes(q)) return false;
      if (side !== "ALL" && t.side !== side) return false;
      if (reason !== "ALL" && t.reason !== reason) return false;
      return true;
    });
  }, [paper.history, search, side, reason]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const pnl = filtered.reduce((s, t) => s + t.pnl, 0);
    const wins = filtered.filter((t) => t.pnl > 0).length;
    const fees = filtered.reduce((s, t) => s + (t.feesPaid ?? 0), 0);
    return { total, pnl, wins, winrate: total ? (wins / total) * 100 : 0, fees };
  }, [filtered]);

  const reasons = useMemo(
    () => Array.from(new Set(paper.history.map((t) => t.reason))),
    [paper.history]
  );

  return (
    <AppShell>
      <div className="p-4 flex flex-col gap-4 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              <History className="h-4 w-4 text-primary" /> Histórico de Ordens
            </h1>
            <p className="text-xs text-muted-foreground">
              Todas as operações fechadas da conta paper de Futuros USDT-M.
            </p>
          </div>
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link to="/trading">Ir para Trading</Link>
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">Trades</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3 font-mono text-lg font-bold">{stats.total}</CardContent></Card>
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">PnL realizado</CardTitle></CardHeader>
            <CardContent className={`px-3 pb-3 font-mono text-lg font-bold ${stats.pnl >= 0 ? "text-bull" : "text-bear"}`}>
              {stats.pnl >= 0 ? "+" : ""}${stats.pnl.toFixed(2)}
            </CardContent></Card>
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">Win rate</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3 font-mono text-lg font-bold">{stats.winrate.toFixed(1)}%</CardContent></Card>
          <Card><CardHeader className="py-2 px-3"><CardTitle className="text-[11px] text-muted-foreground">Taxas pagas</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3 font-mono text-lg font-bold text-muted-foreground">${stats.fees.toFixed(2)}</CardContent></Card>
        </div>

        <Card>
          <CardHeader className="py-2 px-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por par…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Select value={side} onValueChange={(v) => setSide(v as typeof side)}>
              <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos lados</SelectItem>
                <SelectItem value="LONG">LONG</SelectItem>
                <SelectItem value="SHORT">SHORT</SelectItem>
              </SelectContent>
            </Select>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Motivo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos motivos</SelectItem>
                {reasons.map((r) => (
                  <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">Sem operações no histórico.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>Fechada em</TableHead>
                    <TableHead>Símbolo</TableHead>
                    <TableHead>Lado</TableHead>
                    <TableHead className="text-right">Entrada → Saída</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">ROE</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 500).map((t) => (
                    <TableRow key={`${t.id}-${t.closedAt}`} className="font-mono text-xs">
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(t.closedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-bold text-white">{t.symbol}</TableCell>
                      <TableCell className={t.side === "LONG" ? "text-bull" : "text-bear"}>
                        {t.side} {t.leverage}x
                      </TableCell>
                      <TableCell className="text-right">
                        ${formatPrice(t.entryPrice)} → ${formatPrice(t.exitPrice)}
                      </TableCell>
                      <TableCell className="text-right">{t.qty.toPrecision(6)}</TableCell>
                      <TableCell className={`text-right font-bold ${t.pnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right ${t.roePct >= 0 ? "text-bull" : "text-bear"}`}>
                        {t.roePct >= 0 ? "+" : ""}{t.roePct.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground">{t.reason.replace(/_/g, " ")}</TableCell>
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
