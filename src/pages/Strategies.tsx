import { AppShell } from "@/components/AppShell";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Bot, FlaskConical, Play, Plus, Repeat, Search, Star, Info, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  CRYPTO_STRATEGIES,
  buildCustomStrategy,
  useActiveStrategy,
  useCustomStrategies,
  useStrategyInvert,
  type CryptoStrategy,
  type StrategyDirection,
} from "@/lib/cryptoStrategies";
import { useCryptoRobots, type FuturesDirection } from "@/lib/cryptoRobots";
import { FUTURES_TRADING_SYMBOLS } from "@/lib/binance";
import { useBacktestMode } from "@/lib/backtestMode";
import { useStore } from "@/lib/store";
import { compileStrategy, peekStrategyMeta } from "@/lib/strategyRuntime";
import { Textarea } from "@/components/ui/textarea";

const ALL_TFS = ["1m", "5m", "15m", "1h", "4h"];

function DocsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" /> Documentação — Como criar estratégias
          </DialogTitle>
          <DialogDescription>
            Estratégias de Futuros USDT-M (Binance). Sinais LONG/SHORT avaliados sobre velas
            fechadas, na conta paper. Sem binárias, sem martingale no motor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 text-sm">
          <section>
            <h3 className="font-bold text-white mb-1">1. Criar uma estratégia é só colar código</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li>Botão <strong className="text-foreground">“Nova estratégia”</strong>: cola o código e clica em <em>Validar e criar</em>. O <code className="font-mono">id</code>, o <code className="font-mono">name</code> e a <code className="font-mono">description</code> são lidos do próprio código — não os escreves à mão.</li>
              <li>Podes colar TypeScript (o servidor compila com esbuild) ou JavaScript puro. Usa <code className="font-mono">export default {"{ ... }"}</code> ou define uma <code className="font-mono">const</code>.</li>
              <li><strong className="text-foreground">Stops, entrada e alavancagem NÃO ficam na estratégia</strong> — definem-se ao criar o robô (SL%, TP%, entrada $, alavancagem) e são editáveis depois.</li>
              <li><strong className="text-foreground">Formato do código:</strong> usa <code className="font-mono">export default {"{ ... }"}</code> (o mais simples) — a plataforma lê o <code className="font-mono">id</code> e o <code className="font-mono">name</code> daí. Também aceita <code className="font-mono">module.exports = {"{...}"}</code> ou um export nomeado (<code className="font-mono">export const minha = {"{...}"}</code>).</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">2. Interface em código (CryptoStrategy)</h3>
            <pre className="bg-background/60 border border-border/50 rounded p-3 text-[11px] font-mono overflow-x-auto">{`import { rsi } from "@/lib/indicators"; // só se usares indicadores
import type { CryptoStrategy } from "@/lib/cryptoStrategies";

const minhaEstrategia: CryptoStrategy = {
  id: "minha_estrategia",        // único, minúsculas + _
  name: "Nome visível",
  description: "O que faz, em 1 frase",
  category: "auto",              // "auto" (automático)
  minCandles: 60,                // velas fechadas mínimas exigidas
  defaults: { stopGainPct: 3, stopLossPct: 1.2, trailingPct: 1 },
  timeframes: ["15m", "1h"],     // subset de 1m/5m/15m/1h/4h
  modes: ["futures"],            // sempre ["futures"]
  indicators: ["EMA20/50", "RSI14"],
  params: [                      // parâmetros ajustáveis (chegam em ctx.params)
    { key: "rsiLen", label: "Período RSI", type: "number",
      default: 14, min: 2, max: 50, step: 1, hint: "Janela do RSI" },
  ],
  onSignal: (ctx) => {           // devolve CryptoSignal | null
    return null;
  },
};

export default minhaEstrategia;   // Obrigatório: a plataforma lê o export default`}</pre>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">3. As velas (o mais importante) — bem catalogadas</h3>
            <p className="text-[13px] text-muted-foreground mb-1">
              <code className="font-mono">ctx.klines</code> é um array <strong>cronológico ascendente</strong>
              (índice 0 = mais antiga, último índice = mais recente) de objetos:
            </p>
            <pre className="bg-background/60 border border-border/50 rounded p-3 text-[11px] font-mono overflow-x-auto">{`interface CryptoCandle {
  t: number;  // open time da vela, em MILISSEGUNDOS (epoch)
  o: number;  // open
  h: number;  // high (máxima)
  l: number;  // low  (mínima)
  c: number;  // close (fecho)
  v: number;  // volume (ativo base)
}
// Aliases no contexto:
ctx.closes      // number[]  -> só os fechos, na mesma ordem
ctx.lastClose   // number    -> fecho da ÚLTIMA vela FECHADA`}</pre>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5 mt-2">
              <li><strong className="text-foreground">Só velas FECHADAS.</strong> A vela em formação nunca entra em <code className="font-mono">ctx.klines</code>.</li>
              <li><strong className="text-foreground">Última vela fechada:</strong> <code className="font-mono">ctx.klines[ctx.klines.length - 1]</code> (fechou agora).</li>
              <li><strong className="text-foreground">Penúltima vela fechada:</strong> <code className="font-mono">ctx.klines[ctx.klines.length - 2]</code>.</li>
              <li><strong className="text-foreground">Vela de 60 min atrás:</strong> <code className="font-mono">ctx.klines[ctx.klines.length - 1 - (60 / minutosDoIntervalo)]</code>.</li>
              <li>Converter <code className="font-mono">t</code> para minutos: <code className="font-mono">Math.floor(t / 60000)</code> (é ms, não segundos).</li>
              <li>Toda a vela é a mesma unidade de preço do par (ex.: USDT). <code className="font-mono">h &gt;= max(o,c)</code> e <code className="font-mono">l &lt;= min(o,c)</code> sempre.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">4. O contexto (CryptoContext)</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li><code className="font-mono">symbol</code> — par, ex. <code className="font-mono">BTCUSDT</code></li>
              <li><code className="font-mono">interval</code> — timeframe (<code className="font-mono">1m|5m|15m|1h|4h</code>)</li>
              <li><code className="font-mono">klines</code>, <code className="font-mono">closes</code>, <code className="font-mono">lastClose</code> — ver secção 3</li>
              <li><code className="font-mono">mode</code> — sempre <code className="font-mono">"futures"</code></li>
              <li><code className="font-mono">params</code> — os teus <code className="font-mono">params[]</code> (usa <code className="font-mono">ctxNum(ctx,"rsiLen",14)</code> para ler com fallback)</li>
              <li><code className="font-mono">fundingRatePct</code> — funding atual em % (pode ser <code className="font-mono">undefined</code>/0 quando não disponível; usa <code className="font-mono">?? 0</code> e trata como opcional)</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">5. O sinal (CryptoSignal)</h3>
            <pre className="bg-background/60 border border-border/50 rounded p-3 text-[11px] font-mono overflow-x-auto">{`// Exemplo: LONG na reversão do RSI (última vela FECHADA)
if (ctx.klines.length < 60) return null;   // 1. guarda de amostra
const last = ctx.klines[ctx.klines.length - 1];
const r = rsi(ctx.closes, 14);
const rv = r[r.length - 1];
if (rv === null) return null;               // indicador precisa de mais velas
if (rv < 30) return {                        // 2. sinal
  action: "LONG",                            // "LONG" | "SHORT" | "EXIT" | "FLAT"
  stopGainPct: 3,                            // 3. stops SEMPRE (obrigatórios, > 0)
  stopLossPct: 1.2,
  reason: \`RSI sobrevendido (\${rv.toFixed(0)})\`, // texto curto p/ o registo
  confidence: 62,                            // opcional 0-100
  trailingPct: 1,                            // opcional (trailing % do pico)
  atrStopMult: 1.5,                          // opcional (informativo)
  volumeMult: last.v > 0 ? 1.8 : undefined,  // opcional (informativo)
};
return null;                                 // 4. sem sinal = null`}</pre>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">6. Regras de ouro (evitam conflito com a plataforma)</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li><strong className="text-foreground">Função pura:</strong> só uses <code className="font-mono">ctx</code>; nunca <code className="font-mono">Date.now()</code>, <code className="font-mono">fetch</code>, <code className="font-mono">Math.random</code> nem estado global. O mesmo código corre no backtest e no robô.</li>
              <li>Só velas fechadas — nunca inventes a vela em formação.</li>
              <li><code className="font-mono">action</code> só pode ser <code className="font-mono">LONG/SHORT/EXIT/FLAT</code>. <code className="font-mono">stopGainPct</code> e <code className="font-mono">stopLossPct</code> obrigatórios e &gt; 0.</li>
              <li>Verifica sempre <code className="font-mono">ctx.klines.length &gt;= minCandles</code> antes de indicadores.</li>
              <li>Sem martingale/dobras dentro da estratégia — a gestão de risco da conta (stops, limites) é responsabilidade do robô/motor, não do teu sinal.</li>
              <li>Não lances exceções: se faltar dado, devolve <code className="font-mono">null</code>.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">7. Contrato do robô (opera pela estratégia, não por conta própria)</h3>
            <ul className="text-[13px] text-muted-foreground list-disc pl-5 space-y-0.5">
              <li>O robô é criado <strong>a partir da estratégia</strong>: guarda o <code className="font-mono">strategyId</code> e executa <strong>exatamente</strong> o <code className="font-mono">onSignal</code> dessa estratégia.</li>
              <li>O robô <strong>não gera entradas próprias</strong> — só abre/fecha quando a estratégia devolve um sinal. Direção, inversão, timeframe e stops são parâmetros do robô que <em>filtram/ajustam</em> o sinal, não o substituem.</li>
              <li>O <strong>backtest</strong> corre o mesmo <code className="font-mono">onSignal</code> sobre velas fechadas, com o mesmo contrato — serve para validar a estratégia antes de a usar.</li>
              <li><strong>Estado atual:</strong> o “Ligar” do robô valida e arma a configuração; a <em>execução automática ao vivo</em> é o próximo passo do motor — até lá, valida sempre pelo backtest.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-white mb-1">8. Checklist rápido para a IA</h3>
            <p className="text-[12px] text-muted-foreground">
              Pede à IA um objeto que cumpra: (1) <code className="font-mono">id</code> único e <code className="font-mono">modes:["futures"]</code>;
              (2) <code className="font-mono">minCandles</code> coerente com os indicadores; (3) <code className="font-mono">onSignal(ctx)</code> que lê
              <code className="font-mono"> ctx.klines</code> (só fechadas) e devolve <code className="font-mono">LONG/SHORT/EXIT/FLAT</code> com
              <code className="font-mono"> stopGainPct</code>/<code className="font-mono">stopLossPct</code> &gt; 0, ou <code className="font-mono">null</code>;
              (4) sem estado global nem chamadas de rede; (5) <code className="font-mono">params</code> lidos via <code className="font-mono">ctx.params</code>.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewStrategyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const addCustom = useCustomStrategies((s) => s.add);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const meta = peekStrategyMeta(code);

  useEffect(() => {
    if (!open) {
      setCode("");
      setError("");
    }
  }, [open]);

  const submit = async () => {
    setError("");
    if (!code.trim()) {
      setError("Cola o código da estratégia.");
      return;
    }
    setBusy(true);
    try {
      const { js, error: cErr } = await compileStrategy(code);
      if (!js) {
        setError(cErr || "Falha de compilação.");
        return;
      }
      const res = addCustom({ code, js });
      if (!res.ok) {
        setError(res.reason || "Falha ao criar estratégia.");
        return;
      }
      const m = peekStrategyMeta(code);
      toast.success(`Estratégia "${m.name || res.id}" criada (id: ${res.id}).`);
      setCode("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> Nova estratégia (código)
          </DialogTitle>
          <DialogDescription>
            Cola o código da estratégia — o <code>id</code> e o <code>name</code> são lidos do próprio
            código. Os stops, a entrada e a alavancagem definem-se depois, ao criar o robô.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          {meta.id || meta.name ? (
            <div className="text-[11px] font-mono bg-secondary/30 border border-border/40 rounded p-2 flex flex-wrap gap-3 items-center">
              <span>id: <span className="text-primary">{meta.id ?? "—"}</span></span>
              <span>nome: <span className="text-foreground">{meta.name ?? "—"}</span></span>
              {meta.description && <span className="text-muted-foreground truncate max-w-[280px]">{meta.description}</span>}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              O código deve definir <code className="font-mono">id</code> e <code className="font-mono">name</code>{" "}
              e uma função <code className="font-mono">onSignal</code>.
            </p>
          )}
          <Textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder={`export default {\n  id: "rsi_reversao",\n  name: "RSI Reversão",\n  minCandles: 60,\n  onSignal: (ctx) => {\n    // usa ctx.klines / ctx.closes e devolve LONG/SHORT/EXIT/FLAT ou null\n    return null;\n  },\n};`}
            className="font-mono text-xs h-[46vh] bg-background"
          />
          {error && <p className="text-[11px] text-rose-400 whitespace-pre-wrap">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="h-9 text-xs" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={busy} className="h-9 text-xs font-bold flex-1">
              <Plus className="h-3.5 w-3.5 mr-1" /> {busy ? "A compilar…" : "Validar e criar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateRobotDialog({ strategy, invert, direction, onOpenChange }: {
  strategy: CryptoStrategy;
  invert: boolean;
  direction: StrategyDirection;
  onOpenChange: (v: boolean) => void;
}) {
  const createRobot = useCryptoRobots((s) => s.createRobot);
  const [name, setName] = useState(`${strategy.name} #${Math.floor(Math.random() * 900) + 100}`);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState(strategy.timeframes?.[0] ?? "15m");
  const [dir, setDir] = useState<FuturesDirection>(direction === "long" ? "LONG" : direction === "short" ? "SHORT" : "BOTH");
  const [leverage, setLeverage] = useState("5");
  const [entry, setEntry] = useState("100");
  const [tp, setTp] = useState(String(strategy.defaults.stopGainPct));
  const [sl, setSl] = useState(String(strategy.defaults.stopLossPct));
  const [capital, setCapital] = useState("1000");
  const [maxPos, setMaxPos] = useState("2");
  const [cooldown, setCooldown] = useState("30");

  const submit = () => {
    const res = createRobot({
      name: name.trim() || strategy.name,
      symbol,
      interval,
      strategyId: strategy.id,
      mode: "futures",
      direction: dir,
      leverage: Math.min(125, Math.max(1, parseInt(leverage) || 5)),
      marginMode: "isolated",
      fundingAware: true,
      invert,
      capitalAllocated: parseFloat(capital) || 0,
      stakePerEntry: parseFloat(entry) || 0,
      acctStopGainPct: parseFloat(tp) || 0,
      acctStopLossPct: parseFloat(sl) || 0,
      maxPositions: parseInt(maxPos) || 2,
      cooldownMin: parseFloat(cooldown) || 0,
    });
    if (!res.ok) return toast.error(res.reason || "Falha ao criar robô.");
    toast.success(`Robô "${name.trim()}" criado (${symbol} ${interval}). Ajusta em Robôs.`);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" /> Criar robô — {strategy.name}
          </DialogTitle>
          <DialogDescription>
            O robô opera exatamente o <code>onSignal</code> desta estratégia. Aqui defines direção, entrada,
            alavancagem, stop-gain e stop-loss.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-xs text-muted-foreground">Nome do robô</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Par</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 text-xs bg-secondary/50 border border-border rounded px-2 font-mono">
              {FUTURES_TRADING_SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Timeframe</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value)} className="h-9 text-xs bg-secondary/50 border border-border rounded px-2 font-mono">
              {(strategy.timeframes?.length ? strategy.timeframes : ALL_TFS).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Direção</span>
            <select value={dir} onChange={(e) => setDir(e.target.value as FuturesDirection)} className="h-9 text-xs bg-secondary/50 border border-border rounded px-2">
              <option value="BOTH">Ambos (Long+Short)</option>
              <option value="LONG">Só Long</option>
              <option value="SHORT">Só Short</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Alavancagem (1–125x)</span>
            <Input value={leverage} onChange={(e) => setLeverage(e.target.value)} className="h-9 text-xs font-mono" inputMode="numeric" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Valor de entrada $</span>
            <Input value={entry} onChange={(e) => setEntry(e.target.value)} className="h-9 text-xs font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Capital alocado $</span>
            <Input value={capital} onChange={(e) => setCapital(e.target.value)} className="h-9 text-xs font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Stop-gain %</span>
            <Input value={tp} onChange={(e) => setTp(e.target.value)} className="h-9 text-xs font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Stop-loss %</span>
            <Input value={sl} onChange={(e) => setSl(e.target.value)} className="h-9 text-xs font-mono" inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Máx. posições (1–5)</span>
            <Input value={maxPos} onChange={(e) => setMaxPos(e.target.value)} className="h-9 text-xs font-mono" inputMode="numeric" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Cooldown (min)</span>
            <Input value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="h-9 text-xs font-mono" inputMode="decimal" />
          </label>
          {invert && <p className="col-span-2 text-[11px] text-warning">Sinais invertidos (LONG↔SHORT) — definido no card.</p>}
          <div className="col-span-2 flex gap-2 pt-1">
            <Button variant="outline" className="h-9 text-xs flex-1" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={submit} className="h-9 text-xs font-bold flex-1">
              <Bot className="h-3.5 w-3.5 mr-1" /> Criar robô
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export default function Strategies() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "fav">("all");
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState("todas");
  const [docsOpen, setDocsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [robotFor, setRobotFor] = useState<string | null>(null);
  const [directions, setDirections] = useState<Record<string, StrategyDirection>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("favoriteStrategies") || "{}");
    } catch {
      return {};
    }
  });

  const activeStrategyId = useActiveStrategy((s) => s.activeStrategyId);
  const activeDirection = useActiveStrategy((s) => s.direction);
  const setActiveStrategy = useActiveStrategy((s) => s.setActive);
  const invertMap = useStrategyInvert((s) => s.invert);
  const toggleInvert = useStrategyInvert((s) => s.toggle);
  const customSpecs = useCustomStrategies((s) => s.specs);
  const removeCustom = useCustomStrategies((s) => s.remove);
  const customIds = useMemo(() => new Set(customSpecs.map((c) => c.id)), [customSpecs]);

  const toggleFav = (id: string) => {
    setFavorites((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("favoriteStrategies", JSON.stringify(next));
      return next;
    });
  };

  const dirOf = (id: string): StrategyDirection =>
    directions[id] ?? (id === activeStrategyId ? activeDirection : "all");

  const all = useMemo(
    () => [...CRYPTO_STRATEGIES, ...customSpecs.map(buildCustomStrategy)],
    [customSpecs]
  );

  const list = useMemo(() => {
    const q = search.toLowerCase();
    return all.filter((s) => {
      if (tab === "fav" && !favorites[s.id]) return false;
      if (timeframe !== "todas" && !(s.timeframes ?? []).includes(timeframe)) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => Number(favorites[b.id] || false) - Number(favorites[a.id] || false));
  }, [all, tab, search, timeframe, favorites]);

  const nFav = all.filter((s) => favorites[s.id]).length;

  const handleCreate = (strategyId: string) => {
    if (!all.some((x) => x.id === strategyId)) return toast.error("Estratégia desconhecida.");
    setRobotFor(strategyId);
  };

  const handleToggleActive = (strategyId: string, on: boolean) => {
    if (on) {
      setActiveStrategy(strategyId, dirOf(strategyId));
      toast.success("Estratégia ligada — é com ela que o Backtest vai correr.");
    } else {
      setActiveStrategy(null);
      toast.info("Estratégia desligada.");
    }
  };

  const handleBacktest = (strategyId: string) => {
    setActiveStrategy(strategyId, dirOf(strategyId));
    useBacktestMode.getState().setEnabled(true);
    useStore.getState().setTradingMode("backtest");
    toast.info("Modo backtest ligado. A correr em Trading…");
    navigate("/trading");
  };

  const handleDeleteCustom = (id: string, name: string) => {
    const using = useCryptoRobots.getState().robots.filter((r) => r.strategyId === id);
    if (using.length > 0) {
      return toast.error(
        `Há ${using.length} robô(s) a usar esta estratégia (${using.slice(0, 3).map((r) => r.name).join(", ")}${using.length > 3 ? "…" : ""}). Apaga-os primeiro em Robôs.`
      );
    }
    if (!confirm(`Apagar estratégia "${name}"?`)) return;
    if (activeStrategyId === id) setActiveStrategy(null);
    removeCustom(id);
    toast.info("Estratégia personalizada apagada.");
  };

  return (
    <AppShell>
      <div className="p-4 max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Estratégias · Futuros USDT-M
          </h1>
          <p className="text-muted-foreground text-sm mt-1 mb-3">
            RSI / MACD / EMA / Bollinger / Order Block para Futuros (LONG/SHORT com leverage).
            Timeframes 1m · 5m · 15m · 1h · 4h. Stops por ATR, TP/SL em %, trailing e filtro de volume.
          </p>
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-secondary/20 border border-border/30 rounded p-2 mb-4">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              Cria a estratégia colando código (id/nome são lidos do código). O botão <strong>Criar robô</strong> abre
              os parâmetros (direção, entrada, alavancagem, stop-gain, stop-loss) e o robô opera exatamente o
              <code className="font-mono"> onSignal</code> desta estratégia. Tudo na conta paper — sem alavancagem real.
            </span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative max-w-sm flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Pesquisar estratégia..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-10" />
            </div>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="h-10 text-xs bg-secondary/50 border border-border rounded-md px-2">
              <option value="todas">Todos TFs</option>
              {["1m", "5m", "15m", "1h", "4h"].map((tf) => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
            <Button size="sm" className="h-10 text-xs font-bold" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Nova estratégia
            </Button>
            <Button size="sm" variant="outline" className="h-10 text-xs" onClick={() => setDocsOpen(true)}>
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Documentação
            </Button>
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
            <TabsTrigger value="all">Todas ({all.length})</TabsTrigger>
            <TabsTrigger value="fav">Favoritas ({nFav})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="m-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list.map((s) => {
                const isActive = activeStrategyId === s.id;
                const isCustom = customIds.has(s.id);
                return (
                  <div key={s.id} className={`panel p-4 flex flex-col gap-3 rounded-lg border ${isActive ? "border-primary/60" : "border-border/50"} ${invertMap[s.id] ? "ring-1 ring-warning/40" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-base text-white flex items-center gap-2 min-w-0">
                        <button onClick={() => toggleFav(s.id)} className={favorites[s.id] ? "text-yellow-400" : "text-muted-foreground/30 hover:text-muted-foreground/60"}>
                          <Star className="h-4 w-4" fill={favorites[s.id] ? "currentColor" : "none"} />
                        </button>
                        <span className="truncate">{s.name}</span>
                        {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono shrink-0">LIGADA</span>}
                        {isCustom && <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono shrink-0">MINHA</span>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <code className="text-[9px] text-primary bg-primary/10 px-1 rounded font-mono">{s.id}</code>
                        {isCustom && (
                          <button
                            onClick={() => handleDeleteCustom(s.id, s.name)}
                            title="Apagar estratégia personalizada"
                            className="text-muted-foreground/50 hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                    <div className="flex flex-wrap gap-1 text-[10px] font-mono">
                      <span className="bg-secondary/60 px-1.5 py-0.5 rounded">TF: {(s.timeframes ?? []).join("/")}</span>
                      <span className="bg-secondary/60 px-1.5 py-0.5 rounded">TP {s.defaults.stopGainPct}% · SL {s.defaults.stopLossPct}%</span>
                      {s.defaults.trailingPct && <span className="bg-secondary/60 px-1.5 py-0.5 rounded">trail {s.defaults.trailingPct}%</span>}
                      <span className="bg-secondary/60 px-1.5 py-0.5 rounded">mín {s.minCandles} velas</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">Indicadores: {(s.indicators ?? []).join(" · ")}</div>
                    <div className="flex flex-wrap gap-1">
                      {(s.params ?? []).map((p) => (
                        <span key={p.key} className="text-[9px] bg-secondary/40 border border-border/30 px-1.5 py-0.5 rounded" title={p.hint}>
                          {p.label}: {String(p.default)}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">Direção</span>
                      <select
                        value={dirOf(s.id)}
                        onChange={(e) => {
                          const nd = e.target.value as StrategyDirection;
                          setDirections((prev) => ({ ...prev, [s.id]: nd }));
                          if (activeStrategyId === s.id) setActiveStrategy(s.id, nd);
                        }}
                        className="h-7 text-[11px] bg-secondary/50 border border-border rounded px-1.5"
                      >
                        <option value="all">Todas (Long+Short)</option>
                        <option value="long">Só Long</option>
                        <option value="short">Só Short</option>
                      </select>
                      <button
                        onClick={() => {
                          toggleInvert(s.id);
                          toast.info(invertMap[s.id] ? "Sinais normais restaurados." : "Sinais invertidos (LONG↔SHORT).");
                        }}
                        title={invertMap[s.id] ? "Sinais INVERTIDOS — clica para restaurar" : "Inverter todos os sinais (LONG↔SHORT)"}
                        className={`h-7 px-2 rounded border text-[10px] font-bold flex items-center gap-1 transition-colors ${
                          invertMap[s.id]
                            ? "border-warning/60 text-warning bg-warning/10"
                            : "border-border text-muted-foreground hover:bg-secondary/50"
                        }`}
                      >
                        <Repeat className="h-3 w-3" /> {invertMap[s.id] ? "Invertido" : "Inverter"}
                      </button>
                      <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                        <Play className="h-3 w-3" /> Ligar
                        <Switch checked={isActive} onCheckedChange={(v) => handleToggleActive(s.id, v)} />
                      </span>
                    </div>
                    <div className="flex gap-2 mt-auto pt-2">
                      <Button size="sm" className="flex-1 h-8 text-[11px] font-bold" onClick={() => handleCreate(s.id)}>
                        <Bot className="h-3.5 w-3.5 mr-1" /> Criar robô Futuros
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => handleBacktest(s.id)}>
                        <FlaskConical className="h-3.5 w-3.5 mr-1" /> Backtest
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {list.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-16 border border-dashed border-border rounded-lg mt-4 flex flex-col items-center gap-3">
            <span>Nenhuma estratégia para este filtro.</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => { setSearch(""); setTimeframe("todas"); setTab("all"); }}>
                Limpar filtros
              </Button>
              <Button size="sm" className="h-8 text-[11px] font-bold" onClick={() => setNewOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Nova estratégia
              </Button>
            </div>
          </div>
        )}

        <DocsDialog open={docsOpen} onOpenChange={setDocsOpen} />
        <NewStrategyDialog open={newOpen} onOpenChange={setNewOpen} />
        {robotFor && (() => {
          const s = all.find((x) => x.id === robotFor);
          if (!s) return null;
          return (
            <CreateRobotDialog
              strategy={s}
              invert={!!invertMap[s.id]}
              direction={dirOf(s.id)}
              onOpenChange={(v) => { if (!v) setRobotFor(null); }}
            />
          );
        })()}
      </div>
    </AppShell>
  );
}
