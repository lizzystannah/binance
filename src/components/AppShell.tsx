import { NavLink, useSearchParams } from "react-router-dom";
import { Activity, ArrowLeftRight, Bot, Settings, ArrowUp, ArrowDown, X, History, CandlestickChart, FlaskConical, TrendingUp } from "lucide-react";
import { cn, getTradingDay } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useState, useEffect } from "react";

// Binance-only: apenas Trading (Futuros), Robôs (Spot/Futuros), Estratégias, Mercado, Configurações.
const links = [
  { to: "/trading", label: "Trading (Futuros)", icon: Activity },
  { to: "/orders", label: "Ordens", icon: ArrowLeftRight },
  { to: "/history", label: "Histórico", icon: History },
  { to: "/robots", label: "Robôs", icon: Bot, matchTabs: true },
  { to: "/strategies", label: "Estratégias", icon: FlaskConical },
  { to: "/market", label: "Mercado", icon: CandlestickChart },
  { to: "/trends", label: "Monitorização", icon: TrendingUp },
  { to: "/settings", label: "Configurações", icon: Settings },
];

function SidebarOperations() {
  const { trades, tradingMode, updateTrade } = useStore();
  const [limit, setLimit] = useState(5);
  const currentTrades = trades.filter((t) => t.mode === tradingMode).sort((a, b) => b.ts - a.ts).slice(0, Math.min(limit, 50));

  return (
    <div className="flex-1 min-h-0 mt-4 flex flex-col border-t border-border pt-2 overflow-hidden">
      <div className="text-[10px] text-muted-foreground uppercase px-2 mb-2 font-bold tracking-wider flex items-center justify-between">
        <div className="flex items-center gap-1"><History className="h-3 w-3" /> Posições</div>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="bg-secondary/50 border border-border text-foreground text-[9px] rounded-sm py-0.5 px-1 outline-none appearance-none cursor-pointer"
        >
          <option value={5}>5</option>
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar px-1 flex flex-col gap-1">
        {currentTrades.length === 0 && <div className="text-center text-xs text-muted-foreground py-4">Nenhuma posição</div>}
        {currentTrades.map(t => (
          <div key={t.id} className="text-xs p-2 rounded bg-secondary/30 relative overflow-hidden group">
            {t.result === "OPEN" && (
              <div className="absolute top-0 left-0 bottom-0 w-1 bg-primary/60 animate-pulse" />
            )}
            <div className="flex justify-between items-center pl-1">
              <span className="font-bold flex items-center gap-1">
                {t.type === "CALL" || t.type === "BUY" ? <ArrowUp className="h-3 w-3 text-bull" /> : <ArrowDown className="h-3 w-3 text-bear" />}
                {t.asset}
              </span>
              <span className={`font-bold ${t.result === "OPEN" ? "text-warning" : (t.pnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                {t.result === "OPEN" ? (
                  <button
                    onClick={() => updateTrade(t.id, { result: "LOSS", pnl: -t.amount })}
                    className="p-1 hover:bg-destructive hover:text-white rounded transition-colors text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : `${(t.pnl ?? 0) >= 0 ? "+" : ""}${t.pnl?.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between items-center pl-1 mt-1 opacity-60 text-[10px]">
              <span>{t.result === "OPEN" ? "Aberta" : "Fechada"}</span>
              <span>${t.amount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RobotsSubNav() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "spot" ? "spot" : "futures";
  return (
    <div className="px-3 pb-1 flex gap-1">
      {(["futures", "spot"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setParams(t === "futures" ? {} : { tab: t })}
          className={cn(
            "flex-1 text-[9px] font-bold uppercase rounded-sm border py-1 transition-colors",
            tab === t
              ? "bg-secondary border-border text-primary"
              : "text-muted-foreground border-transparent hover:bg-secondary/60"
          )}
        >
          {t === "futures" ? "Futuros" : "Spot"}
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { tradingMode, balance, automationMode, serverLatency, workerLatency, localLatency, binanceFutures } = useStore();

  const modeLabel = { demo: "DEMO", real: "REAL", backtest: "BACKTEST" }[tradingMode];
  const modeColor = { demo: "text-primary", real: "text-bear", backtest: "text-warning" }[tradingMode];
  const modeDot = { demo: "bg-primary", real: "bg-bear", backtest: "bg-warning" }[tradingMode];

  const autoLabel = { manual: "", "semi-auto": " · SEMI-AUTO", auto: " · AUTO" }[automationMode];

  useEffect(() => {
    // Check for day change to reset daily management
    const checkReset = () => {
      const { management, resetDailyPnl } = useStore.getState();
      const today = getTradingDay();
      if (management.lastResetDate !== today) {
        resetDailyPnl();
      }
    };
    checkReset();

    const interval = setInterval(() => {
      checkReset();
      const { trades, updateTrade } = useStore.getState();
      const openLiveTrades = trades.filter(t => t.result === "OPEN" && t.mode !== "backtest");
      openLiveTrades.forEach(t => {
         // Se for operação de tempo fixo baseada em segundos
         if (t.durationS) {
            // Se já passou o tempo + 3 segundos de tolerância
            const isStale = (Date.now() - t.ts) > (t.durationS * 1000 + 3000);
            if (isStale) {
               updateTrade(t.id, { result: "LOSS", pnl: -t.amount, exit: t.entry });
            }
         }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="h-12 border-b border-border flex items-center justify-between px-4 panel rounded-none">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-bold tracking-widest text-sm glow-text">QUANTTERM</span>
          <span className="text-[10px] text-muted-foreground ml-2">Binance</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 border rounded-sm ml-2 ${modeColor} border-current`}>{modeLabel}{autoLabel}</span>
          <span className="text-[10px] text-muted-foreground ml-1">
            FUTUROS USDT-M{binanceFutures.testnet ? " · TESTNET" : ""}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>SESSÃO: <span className={modeColor}>{modeLabel}</span></span>
          <span>SALDO: <span className="text-foreground ticker">${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
          <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${modeDot} animate-pulse`} /> ONLINE</span>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-44 shrink-0 border-r border-border bg-sidebar p-2 flex flex-col gap-1 min-h-0">
          {links.map(({ to, label, icon: Icon, matchTabs }: any) => (
            <div key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 px-3 py-2 text-xs rounded-sm border border-transparent transition-colors",
                    isActive
                      ? "bg-secondary border-border text-primary glow-text"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )
                }
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="uppercase tracking-wider">{label}</span>
              </NavLink>
              {matchTabs && <RobotsSubNav />}
            </div>
          ))}
          <SidebarOperations />
          <div className="mt-auto text-[10px] text-muted-foreground p-2 border-t border-border">
            <div className="flex justify-between">
              <span>Ping Local:</span>
              <span className={cn((localLatency ?? 0) < 150 ? "text-bull" : "text-bear")}>
                {localLatency !== null ? `${localLatency}ms` : "--"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Ping Server:</span>
              <span className={cn((serverLatency ?? 0) < 150 ? "text-bull" : "text-bear")}>
                {serverLatency !== null ? `${serverLatency}ms` : "--"}
              </span>
            </div>
            {workerLatency !== null && (
              <div className="flex justify-between font-bold text-primary">
                <span>⚡ Worker Ping:</span>
                <span className={cn(workerLatency < 100 ? "text-bull" : "text-bear")}>
                  {`${workerLatency}ms`}
                </span>
              </div>
            )}
            <div className="mt-1 opacity-60">Feed: Binance Futures (USDT-M){binanceFutures.testnet ? " · Testnet" : ""}</div>
          </div>
        </aside>
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
