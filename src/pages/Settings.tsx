import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { Eye, EyeOff, Save, KeyRound, FlaskConical, Crosshair } from "lucide-react";
import { useState } from "react";

// Binance-only: Configurações de futuros (API, testnet, leverage, margem, risco).
export default function Settings() {
  const { binanceFutures, setBinanceFutures, tradingMode, setTradingMode } = useStore();
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const toastId = toast.loading("Salvando configurações de futuros Binance...");
    try {
      // Persiste localmente via Zustand (persist). Tenta espelhar no servidor (best-effort).
      try {
        const res = await fetch("/api/settings/binance-futures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            testnet: binanceFutures.testnet,
            defaultLeverage: binanceFutures.defaultLeverage,
            marginMode: binanceFutures.marginMode,
            hedgeMode: binanceFutures.hedgeMode,
            defaultOrderType: binanceFutures.defaultOrderType,
            riskPercentPerTrade: binanceFutures.riskPercentPerTrade,
            // Nunca envia o secret em claro do frontend por padrão — apenas flag de presença.
            hasApiKey: binanceFutures.apiKey.length > 0,
          }),
        });
        if (!res.ok) throw new Error("server");
        toast.success("Configurações salvas (local + servidor).", { id: toastId });
      } catch {
        toast.success("Configurações salvas localmente (servidor offline).", { id: toastId });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="p-4 space-y-3 max-w-5xl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            Configurações · Futuros Binance (USDT-M)
          </h1>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-xs font-semibold gap-1.5">
            <Save className="h-3.5 w-3.5" /> {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>

        <div className="grid lg:grid-cols-2 gap-3">
          {/* Ambiente */}
          <div className="panel p-4 space-y-3">
            <div className="text-xs uppercase text-primary font-bold tracking-wider">Ambiente</div>
            <div className="grid grid-cols-3 gap-2">
              {(["demo", "real", "backtest"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTradingMode(m)}
                  className={`py-2.5 text-xs border rounded-sm uppercase font-bold ${
                    tradingMode === m
                      ? "border-primary text-primary bg-secondary/40"
                      : "border-border text-muted-foreground hover:bg-secondary/20"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between p-3 rounded-md bg-secondary/20 border border-border/70">
              <div>
                <div className="text-xs font-bold flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5 text-warning" /> Testnet Binance
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Usa o ambiente de testes da Binance (sem fundos reais).
                </div>
              </div>
              <Switch
                checked={binanceFutures.testnet}
                onCheckedChange={(v) => setBinanceFutures({ testnet: v })}
              />
            </div>
            {tradingMode === "real" && !binanceFutures.testnet && (
              <div className="text-[11px] text-bear border border-bear/30 bg-bear/10 rounded-sm p-2">
                Atenção: modo REAL + testnet desligado = ordens com fundos reais.
              </div>
            )}
          </div>

          {/* API credentials */}
          <div className="panel p-4 space-y-3">
            <div className="text-xs uppercase text-primary font-bold tracking-wider flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> API Credentials Binance
            </div>
            <p className="text-[11px] text-muted-foreground">
              Crie a chave em binance.com → API Management (ative apenas Futures). O segredo idealmente vive no env do servidor.
            </p>
            <div>
              <label className="text-[10px] text-muted-foreground">API Key</label>
              <div className="flex gap-1 mt-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={binanceFutures.apiKey}
                  onChange={(e) => setBinanceFutures({ apiKey: e.target.value.trim() })}
                  placeholder="Binance API Key (futures)"
                  className="h-9 ticker"
                  autoComplete="off"
                />
                <Button variant="outline" size="icon" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">API Secret</label>
              <div className="flex gap-1 mt-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={binanceFutures.apiSecret}
                  onChange={(e) => setBinanceFutures({ apiSecret: e.target.value.trim() })}
                  placeholder="Binance API Secret"
                  className="h-9 ticker"
                  autoComplete="off"
                />
                <Button variant="outline" size="icon" onClick={() => setShowSecret((s) => !s)}>
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Futuros defaults */}
          <div className="panel p-4 space-y-3">
            <div className="text-xs uppercase text-primary font-bold tracking-wider">Padrões de Futuros</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Alavancagem padrão (1–125x)</label>
                <Input
                  type="number"
                  min={1}
                  max={125}
                  value={binanceFutures.defaultLeverage}
                  onChange={(e) =>
                    setBinanceFutures({
                      defaultLeverage: Math.min(125, Math.max(1, parseInt(e.target.value) || 1)),
                    })
                  }
                  className="h-9 text-xs ticker mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Risco % por trade</label>
                <Input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={binanceFutures.riskPercentPerTrade}
                  onChange={(e) =>
                    setBinanceFutures({
                      riskPercentPerTrade: Math.min(100, Math.max(0.1, parseFloat(e.target.value) || 0.1)),
                    })
                  }
                  className="h-9 text-xs ticker mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Margin mode padrão</label>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {(["cross", "isolated"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setBinanceFutures({ marginMode: m })}
                    className={`py-2 text-xs border rounded-sm uppercase font-bold ${
                      binanceFutures.marginMode === m
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {m === "cross" ? "Cross" : "Isolated"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Ordem padrão</label>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {(["market", "limit"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setBinanceFutures({ defaultOrderType: m })}
                    className={`py-2 text-xs border rounded-sm uppercase font-bold ${
                      binanceFutures.defaultOrderType === m
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-md bg-secondary/20 border border-border/70">
              <div>
                <div className="text-xs font-bold">Hedge mode</div>
                <div className="text-[10px] text-muted-foreground">Permite LONG + SHORT simultâneos (positionSide).</div>
              </div>
              <Switch
                checked={binanceFutures.hedgeMode}
                onCheckedChange={(v) => setBinanceFutures({ hedgeMode: v })}
              />
            </div>
          </div>

          {/* Resumo */}
          <div className="panel p-4 space-y-2">
            <div className="text-xs uppercase text-primary font-bold tracking-wider">Resumo ativo</div>
            <div className="text-xs font-mono space-y-1 text-muted-foreground">
              <div>Ambiente: <span className="text-foreground font-bold uppercase">{tradingMode}</span> · {binanceFutures.testnet ? "TESTNET" : "MAINNET"}</div>
              <div>Leverage: <span className="text-foreground font-bold">{binanceFutures.defaultLeverage}x</span> · Margem: <span className="text-foreground font-bold uppercase">{binanceFutures.marginMode}</span></div>
              <div>Hedge: <span className="text-foreground font-bold">{binanceFutures.hedgeMode ? "ON" : "OFF"}</span> · Ordem: <span className="text-foreground font-bold uppercase">{binanceFutures.defaultOrderType}</span></div>
              <div>Risco/trade: <span className="text-foreground font-bold">{binanceFutures.riskPercentPerTrade}%</span> · API key: <span className="text-foreground font-bold">{binanceFutures.apiKey ? "configurada" : "ausente"}</span></div>
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> Salvar configurações
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
