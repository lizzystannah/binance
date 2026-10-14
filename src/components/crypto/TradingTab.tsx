// ─── Aba Trading: spot paper LONG (Fase 2) ─────────────────────────────────
// Conta paper ISOLADA. SHORT desligado (exige margem/futures).
// Conta real (Fase 4) aparece apenas como estado — nunca executa daqui.

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Lock, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  fetchSpotUsdtSymbols,
  formatPrice,
  getMinNotional,
  validateSpotOrderQty,
  type BinanceSpotSymbol,
  type BinanceTicker24h,
} from "@/lib/binance";
import {
  CRYPTO_FEE_RATE,
  CRYPTO_PAPER_START_USDT,
  buyCost,
  calcTpSlPrices,
  livePnl,
  realizedPnl,
  lockedCost,
  useCryptoPaper,
} from "@/lib/cryptoPaper";

/** Arredonda a quantidade para baixo ao step do LOT_SIZE (se conhecido). */
function floorToStep(qty: number, spec: BinanceSpotSymbol | undefined): number {
  if (!Number.isFinite(qty) || qty <= 0) return qty;
  const lot = spec?.filters.find((f) => f.filterType === "LOT_SIZE") as
    | { filterType: string; minQty: string; stepSize: string }
    | undefined;
  const step = lot ? parseFloat(lot.stepSize) : NaN;
  if (!Number.isFinite(step) || step <= 0) return qty;
  return Math.floor(qty / step + 1e-9) * step;
}

function LiveAccountCard() {
  const [status, setStatus] = useState<{ configured: boolean; liveEnabled: boolean; message: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/crypto/live/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setStatus(d);
      })
      .catch(() => {
        /* servidor sem a rota: conta real indisponível */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Card className="bg-secondary/20 border-border/50 opacity-90">
      <CardHeader className="py-3 px-4 border-b border-border/50">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Lock className="h-4 w-4 text-warning" /> Conta real Binance — Fase 4 (desligada)
        </CardTitle>
        <CardDescription className="text-[10px]">
          As chaves vivem SÓ no env do servidor (BINANCE_API_KEY / BINANCE_API_SECRET). O frontend nunca as vê.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
        <p>Chave configurada no servidor: <strong>{status ? (status.configured ? "sim" : "não") : "…"}</strong></p>
        <p>Execução real ativa: <strong>{status ? (status.liveEnabled ? "sim" : "não") : "…"}</strong></p>
        <p>{status?.message || "A operar em conta paper. Ordens reais bloqueadas pelo servidor (403)."}</p>
      </CardContent>
    </Card>
  );
}

export function TradingTab({ tickers }: { tickers: BinanceTicker24h[] }) {
  const paper = useCryptoPaper();
  const [specs, setSpecs] = useState<BinanceSpotSymbol[]>([]);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [amountUsdt, setAmountUsdt] = useState("100");
  const [tpPct, setTpPct] = useState("3");
  const [slPct, setSlPct] = useState("1.5");

  useEffect(() => {
    fetchSpotUsdtSymbols().then(setSpecs).catch(() => setSpecs([]));
  }, []);

  const ticker = useMemo(() => tickers.find((t) => t.symbol === symbol), [tickers, symbol]);
  const mark = ticker?.lastPrice ?? NaN;
  const spec = useMemo(() => specs.find((s) => s.symbol === symbol), [specs, symbol]);

  const amount = parseFloat(amountUsdt);
  const rawQty = Number.isFinite(mark) && mark > 0 && Number.isFinite(amount) ? amount / mark : NaN;
  const refPrice = orderType === "limit" ? parseFloat(limitPrice) : mark;
  // Valida a quantidade FINAL (após arredondamento ao step): sem isto, o floor
  // podia deixar a ordem abaixo do LOT_SIZE/MIN_NOTIONAL e o store não verifica filtros.
  const qty = useMemo(() => floorToStep(rawQty, spec), [rawQty, spec]);
  const tpCalc = calcTpSlPrices(refPrice, parseFloat(tpPct), parseFloat(slPct));
  const qtyCheck = useMemo(() => {
    if (!spec || !Number.isFinite(refPrice) || !Number.isFinite(qty)) return null;
    return validateSpotOrderQty(spec, refPrice, qty);
  }, [spec, refPrice, qty]);

  const canSubmit =
    Number.isFinite(qty) &&
    qty > 0 &&
    tpCalc.ok &&
    (qtyCheck === null || qtyCheck.ok) &&
    (orderType === "market" ? Number.isFinite(mark) : Number.isFinite(refPrice) && refPrice > 0);

  const submitError = !tpCalc.ok
    ? tpCalc.reason
    : qtyCheck && !qtyCheck.ok
      ? qtyCheck.reason
      : !Number.isFinite(qty) || qty <= 0
        ? "Indica um valor em USDT válido."
        : null;

  const handleSubmit = () => {
    if (!canSubmit) {
      toast.error(submitError || "Ordem inválida.");
      return;
    }
    const finalQty = qty; // já arredondada ao step e validada acima
    if (orderType === "market") {
      const res = paper.openMarketLong({
        symbol,
        markPrice: mark,
        qty: finalQty,
        stopGainPct: parseFloat(tpPct),
        stopLossPct: parseFloat(slPct),
      });
      if (res.ok) {
        toast.success(`Compra LONG ${symbol} executada (paper).`);
        return;
      }
      toast.error(res.reason || "Falha ao executar.");
    } else {
      const res = paper.placeLimitLong({
        symbol,
        limitPrice: parseFloat(limitPrice),
        qty: finalQty,
        stopGainPct: parseFloat(tpPct),
        stopLossPct: parseFloat(slPct),
      });
      if (res.ok) {
        toast.success(`Ordem limite registada (paper). Preenche se tocar $${limitPrice}.`);
        return;
      }
      toast.error(res.reason || "Falha ao registar.");
    }
  };

  const cost = Number.isFinite(refPrice) && Number.isFinite(qty) && qty > 0 ? buyCost(refPrice, qty) : null;
  const locked = lockedCost(paper.positions);
  const realized = realizedPnl(paper.history);
  const today = new Date().toDateString();
  const realizedToday = paper.history
    .filter((t) => new Date(t.closedAt).toDateString() === today)
    .reduce((s, t) => s + t.pnl, 0);

  const options = useMemo(() => {
    const sorted = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 60);
    if (!sorted.some((t) => t.symbol === symbol) && ticker) return [ticker, ...sorted];
    return sorted;
  }, [tickers, symbol, ticker]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-secondary/20 border-border/50">
          <CardHeader className="py-3 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-bold">Carteira paper (isolada)</CardTitle>
            <CardDescription className="text-[10px]">
              Nada aqui toca o saldo real. Taxa spot {(CRYPTO_FEE_RATE * 100).toFixed(1)}%/lado incluída.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 gap-2 text-xs font-mono">
            <div><div className="text-[9px] text-muted-foreground uppercase font-sans">USDT livre</div><span className="text-white font-bold">${paper.usdtFree.toFixed(2)}</span></div>
            <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Em posições</div>${locked.toFixed(2)}</div>
            <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Realizado hoje</div><span className={realizedToday >= 0 ? "text-bull" : "text-bear"}>{realizedToday >= 0 ? "+" : ""}${realizedToday.toFixed(2)}</span></div>
            <div><div className="text-[9px] text-muted-foreground uppercase font-sans">Realizado total</div><span className={realized >= 0 ? "text-bull" : "text-bear"}>{realized >= 0 ? "+" : ""}${realized.toFixed(2)}</span></div>
            <div className="col-span-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={() => {
                  if (confirm(`Repor a carteira paper para $${CRYPTO_PAPER_START_USDT.toLocaleString()}? Apaga posições, pendentes e histórico.`)) {
                    paper.resetPaper();
                    toast.info("Carteira paper reposta.");
                  }
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Repor carteira
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-secondary/20 border-border/50 lg:col-span-2">
          <CardHeader className="py-3 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-bold">Nova ordem — LONG spot</CardTitle>
            <CardDescription className="text-[10px]">
              Stop-gain e stop-loss obrigatórios. SHORT desligado (exige margem/futures — Fase 4).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="col-span-2">
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Par</label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {options.map((t) => (
                    <SelectItem key={t.symbol} value={t.symbol} className="font-mono text-xs">
                      {t.symbol} · ${formatPrice(t.lastPrice)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                Mark: {Number.isFinite(mark) ? `$${formatPrice(mark)}` : "—"}
                {spec && <span> · mín. ${getMinNotional(spec)} /ordem</span>}
              </p>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Tipo</label>
              <Select value={orderType} onValueChange={(v: "market" | "limit") => setOrderType(v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Mercado</SelectItem>
                  <SelectItem value="limit">Limite</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Lado</label>
              <div className="h-8 flex items-center gap-2">
                <span className="text-xs font-bold text-bull border border-bull/30 bg-bull/10 rounded px-2 py-1">LONG</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1" title="Venda a descoberto exige margem/futures (Fase 4)">
                  <X className="h-3 w-3" /> SHORT
                </span>
              </div>
            </div>
            {orderType === "limit" && (
              <div className="col-span-2">
                <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Preço limite (USDT)</label>
                <Input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="Ex: 65000" className="h-8 text-xs font-mono" inputMode="decimal" />
              </div>
            )}
            <div className="col-span-2">
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Valor (USDT)</label>
              <Input value={amountUsdt} onChange={(e) => setAmountUsdt(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                ≈ {Number.isFinite(qty) && qty > 0 ? qty.toPrecision(6) : "—"} {symbol.replace("USDT", "")}
                {cost && <span> · custo c/ taxa ${cost.total.toFixed(2)}</span>}
              </p>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Stop-gain % *</label>
              <Input value={tpPct} onChange={(e) => setTpPct(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
              <p className="text-[10px] text-bull mt-1 font-mono">{tpCalc.ok ? `$${formatPrice(tpCalc.tp!)}` : "—"}</p>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase font-bold block mb-1">Stop-loss % *</label>
              <Input value={slPct} onChange={(e) => setSlPct(e.target.value)} className="h-8 text-xs font-mono" inputMode="decimal" />
              <p className="text-[10px] text-bear mt-1 font-mono">{tpCalc.ok ? `$${formatPrice(tpCalc.sl!)}` : "—"}</p>
            </div>
            <div className="col-span-2 md:col-span-4">
              {submitError && <p className="text-[11px] text-rose-400 mb-2">{submitError}</p>}
              <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full h-9 text-xs font-bold">
                {orderType === "market" ? "Comprar a mercado (paper)" : "Colocar ordem limite (paper)"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-secondary/20 border-border/50">
        <CardHeader className="py-3 px-4 border-b border-border/50">
          <CardTitle className="text-sm font-bold">Posições abertas ({paper.positions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {paper.positions.length === 0 && <p className="text-xs text-muted-foreground p-4">Sem posições abertas.</p>}
          {paper.positions.map((p) => {
            const m = tickers.find((t) => t.symbol === p.symbol)?.lastPrice;
            const pnl = Number.isFinite(m) ? livePnl(p.entryPrice, p.qty, m!) : NaN;
            return (
              <div key={p.id} className="grid grid-cols-2 md:grid-cols-7 gap-2 items-center px-3 py-2 border-b border-border/30 text-xs font-mono">
                <span className="font-bold text-white">{p.symbol}{p.robotId && <span className="text-[9px] text-cyan-400 ml-1">ROBÔ</span>}</span>
                <span>{p.qty.toPrecision(6)} @ ${formatPrice(p.entryPrice)}</span>
                <span>Mark: {Number.isFinite(m) ? `$${formatPrice(m!)}` : "—"}</span>
                <span className={pnl >= 0 ? "text-bull" : "text-bear"}>{Number.isFinite(pnl) ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—"}</span>
                <span className="text-muted-foreground">TP ${formatPrice(p.stopGainPrice)} · SL ${formatPrice(p.stopLossPrice)}</span>
                <span className="text-muted-foreground">{p.timeframe}{p.strategyId ? ` · ${p.strategyId}` : ""}</span>
                <span className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] text-rose-400"
                    onClick={() => {
                      if (!Number.isFinite(m)) return toast.error("Sem cotação para fechar.");
                      paper.closePosition(p.id, m!, "MANUAL");
                      toast.info(`${p.symbol} fechada a mercado (paper).`);
                    }}
                  >
                    <ArrowDown className="h-3 w-3 mr-1" /> Fechar
                  </Button>
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {paper.pending.length > 0 && (
        <Card className="bg-secondary/20 border-border/50">
          <CardHeader className="py-3 px-4 border-b border-border/50">
            <CardTitle className="text-sm font-bold">Ordens limite pendentes ({paper.pending.length})</CardTitle>
            <CardDescription className="text-[10px]">Preenchem se o preço tocar no limite. Expiram em 24h.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {paper.pending.map((o) => (
              <div key={o.id} className="flex items-center gap-3 px-3 py-2 border-b border-border/30 text-xs font-mono">
                <span className="font-bold text-white">{o.symbol}</span>
                <span>{o.qty.toPrecision(6)} @ limite ${formatPrice(o.limitPrice)}</span>
                <span className="text-muted-foreground ml-auto">TP {o.stopGainPct}% · SL {o.stopLossPct}%</span>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => paper.cancelPending(o.id)}>
                  <Trash2 className="h-3 w-3 mr-1" /> Cancelar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-secondary/20 border-border/50">
        <CardHeader className="py-3 px-4 border-b border-border/50">
          <CardTitle className="text-sm font-bold">Histórico ({paper.history.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 max-h-72 overflow-y-auto">
          {paper.history.length === 0 && <p className="text-xs text-muted-foreground p-4">Sem operações fechadas.</p>}
          {paper.history.slice(0, 50).map((t) => (
            <div key={t.id + t.closedAt} className="grid grid-cols-2 md:grid-cols-5 gap-2 px-3 py-1.5 border-b border-border/30 text-[11px] font-mono">
              <span className="text-white">{t.symbol}</span>
              <span className="text-muted-foreground">{t.reason.replace("_", " ")}{t.robotId ? " · ROBÔ" : ""}</span>
              <span className="text-muted-foreground">${formatPrice(t.entryPrice)} → ${formatPrice(t.exitPrice)}</span>
              <span className={t.pnl >= 0 ? "text-bull" : "text-bear"}>{t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}</span>
              <span className="text-muted-foreground text-right">{new Date(t.closedAt).toLocaleString()}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <LiveAccountCard />
    </div>
  );
}
