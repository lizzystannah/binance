// ─── Binance Public Market Data Layer (Fase 1 — só leitura, sem chaves) ───
// Fonte única de verdade para o hub Cripto. Usa APENAS endpoints públicos:
// - GET /api/v3/exchangeInfo        → símbolos, status, filtros (LOT_SIZE, MIN_NOTIONAL, PRICE_FILTER)
// - GET /api/v3/ticker/24hr        → variação 24h, volume, quoteVolume (todas ou por símbolo)
// - GET /api/v3/ticker/price       → último preço
// - GET /api/v3/klines             → velas OHLCV (para Fase 2/3: gráfico + backtest)
// - WSS stream.binance.com         → Fase 2 (tempo real). Fase 1 usa polling.
// Spot apenas. Sem alavancagem (futures fica para fase posterior, desligado).

// (Base principal = BINANCE_SPOT_BASES[0]; ver fallback multi-base abaixo.)

export type BinanceSymbolFilter =
  | { filterType: "LOT_SIZE"; minQty: string; maxQty: string; stepSize: string }
  | { filterType: "MIN_NOTIONAL"; minNotional: string }
  | { filterType: "NOTIONAL"; minNotional: string }
  | { filterType: "PRICE_FILTER"; minPrice: string; maxPrice: string; tickSize: string }
  | { filterType: string; [k: string]: unknown };

export interface BinanceSpotSymbol {
  symbol: string; // ex: "BTCUSDT"
  baseAsset: string; // ex: "BTC"
  quoteAsset: string; // ex: "USDT"
  status: string; // "TRADING" = negociável
  filters: BinanceSymbolFilter[];
}

export interface BinanceTicker24h {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number; // volume em base asset
  quoteVolume: number; // volume em USDT
  openPrice: number;
  prevClosePrice: number;
  count: number; // nº de trades
}

export interface BinanceKline {
  t: number; // open time ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume base
  closeTime: number;
  quoteVolume: number;
}

export const CRYPTO_FASES = {
  FASE_1: "Mercado só leitura (esta fase)",
  FASE_2: "Trading spot paper (desativado)",
  FASE_3: "Robôs + Estratégias spot estilo Forex (desativado)",
  FUTURES: "Futures/alavancagem — explicitamente fora de âmbito",
} as const;

// ─── Cache em memória (respeita rate limits da Binance) ───
const cache = new Map<string, { ts: number; data: unknown }>();
const TTL_TICKERS_MS = 30_000;
const TTL_EXCHANGE_INFO_MS = 10 * 60_000;

function getCached<T>(key: string, ttl: number): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > ttl) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

function setCached(key: string, data: unknown) {
  cache.set(key, { ts: Date.now(), data });
}

// ─── Multi-base com fallback (mainnet → vision → testnet) ───
// Ordem: api.binance.com (principal) → data-api.binance.vision (mirror sem geo-block 451)
// → testnet.binance.vision (fallback). Último recurso: dados mock (ver MOCK_TICKERS).
export const BINANCE_SPOT_BASES = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://testnet.binance.vision",
];
export const BINANCE_FUTURES_BASES = [
  "https://fapi.binance.com",
  "https://testnet.binancefuture.com",
];

async function binanceGet<T>(path: string): Promise<T> {
  let lastErr: unknown = null;
  for (const base of BINANCE_SPOT_BASES) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`);
    } catch (e) {
      lastErr = e;
      continue; // tenta próxima base
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 451 || res.status === 403) {
      lastErr = new Error(`Binance indisponível nesta região via ${base} (${res.status}) em ${path}. A tentar mirror…`);
      continue; // geo-block → tenta próxima base (vision/testnet)
    }
    if (res.status === 429) {
      lastErr = new Error(`Rate limit da Binance (429) em ${path}. Aguarda 30s — há cache + polling com debounce.`);
      break; // rate limit é global, não adianta trocar de base
    }
    if (res.status === 400) throw new Error(`Pedido inválido (400) em ${path}. Verifica símbolo/intervalo.`);
    lastErr = new Error(`Binance API ${res.status} em ${path} via ${base}`);
    continue;
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error(`Sem ligação à Binance em ${path}. Verifica a rede e tenta de novo.`);
}

async function futuresGet<T>(path: string): Promise<T> {
  let lastErr: unknown = null;
  for (const base of BINANCE_FUTURES_BASES) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) return (await res.json()) as T;
      if (res.status === 451 || res.status === 403) {
        lastErr = new Error(`Futures indisponível via ${base} (${res.status}) em ${path}.`);
        continue;
      }
      if (res.status === 429) {
        lastErr = new Error(`Rate limit futures (429) em ${path}.`);
        break;
      }
      lastErr = new Error(`Binance Futures API ${res.status} em ${path} via ${base}`);
      continue;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error(`Sem ligação aos Futures em ${path}.`);
}

// ─── exchangeInfo: universo de pares spot USDT ───
export async function fetchSpotUsdtSymbols(): Promise<BinanceSpotSymbol[]> {
  const cached = getCached<BinanceSpotSymbol[]>("exchangeInfo:spot:usdt", TTL_EXCHANGE_INFO_MS);
  if (cached) return cached;
  const data = await binanceGet<{
    symbols: Array<{
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      status: string;
      isSpotTradingAllowed: boolean;
      filters: BinanceSymbolFilter[];
    }>;
  }>("/api/v3/exchangeInfo");
  const out = data.symbols
    .filter((s) => s.quoteAsset === "USDT" && s.isSpotTradingAllowed && s.status === "TRADING")
    .map((s) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      status: s.status,
      filters: s.filters,
    }));
  setCached("exchangeInfo:spot:usdt", out);
  return out;
}

// ─── ticker 24h (todos ou um símbolo) ───
function toTicker(raw: Record<string, string | number>): BinanceTicker24h {
  const num = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v)));
  return {
    symbol: String(raw.symbol),
    lastPrice: num(raw.lastPrice),
    priceChange: num(raw.priceChange),
    priceChangePercent: num(raw.priceChangePercent),
    highPrice: num(raw.highPrice),
    lowPrice: num(raw.lowPrice),
    volume: num(raw.volume),
    quoteVolume: num(raw.quoteVolume),
    openPrice: num(raw.openPrice),
    prevClosePrice: num(raw.prevClosePrice),
    count: typeof raw.count === "number" ? raw.count : parseInt(String(raw.count), 10),
  };
}

export async function fetchAllTickers24h(): Promise<BinanceTicker24h[]> {
  const cached = getCached<BinanceTicker24h[]>("tickers24h:all", TTL_TICKERS_MS);
  if (cached) return cached;
  // type=MINI omite campos pesados; aqui queremos o FULL para quoteVolume.
  const raw = await binanceGet<Array<Record<string, string | number>>>("/api/v3/ticker/24hr");
  const out = raw
    .filter((t) => String(t.symbol).endsWith("USDT"))
    .map(toTicker)
    .filter((t) => Number.isFinite(t.lastPrice) && t.lastPrice > 0);
  setCached("tickers24h:all", out);
  return out;
}

export async function fetchTicker24h(symbol: string): Promise<BinanceTicker24h> {
  const upper = symbol.toUpperCase();
  const raw = await binanceGet<Record<string, string | number>>(
    `/api/v3/ticker/24hr?symbol=${encodeURIComponent(upper)}`
  );
  return toTicker(raw);
}

export async function fetchLastPrice(symbol: string): Promise<number> {
  const raw = await binanceGet<{ symbol: string; price: string }>(
    `/api/v3/ticker/price?symbol=${encodeURIComponent(symbol.toUpperCase())}`
  );
  return parseFloat(raw.price);
}

// ─── klines (para gráfico/backtest das Fases 2–3) ───
const VALID_INTERVALS = new Set([
  "1s", "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
]);

export async function fetchKlines(
  symbol: string,
  interval = "1m",
  limit = 500
): Promise<BinanceKline[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error("Símbolo vazio em /klines.");
  if (!VALID_INTERVALS.has(interval)) throw new Error(`Intervalo inválido: ${interval}.`);
  const clamped = Math.min(Math.max(limit, 1), 1000);
  const raw = await binanceGet<Array<[number, string, string, string, string, string, number, string]>>(
    `/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${clamped}`
  );
  return raw.map((k) => ({
    t: k[0],
    o: parseFloat(k[1]),
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
    v: parseFloat(k[5]),
    closeTime: k[6],
    quoteVolume: parseFloat(k[7]),
  }));
}

// ─── Filtros de negociação (LOT_SIZE / NOTIONAL / PRICE_FILTER) ───
export function getLotSizeFilter(symbol: BinanceSpotSymbol) {
  return symbol.filters.find((f) => f.filterType === "LOT_SIZE") as
    | Extract<BinanceSymbolFilter, { filterType: "LOT_SIZE" }>
    | undefined;
}

export function getPriceFilter(symbol: BinanceSpotSymbol) {
  return symbol.filters.find((f) => f.filterType === "PRICE_FILTER") as
    | Extract<BinanceSymbolFilter, { filterType: "PRICE_FILTER" }>
    | undefined;
}

export function getMinNotional(symbol: BinanceSpotSymbol): number {
  // A Binance migrou MIN_NOTIONAL → NOTIONAL (mesmo campo minNotional).
  const f = symbol.filters.find((fl) => fl.filterType === "MIN_NOTIONAL" || fl.filterType === "NOTIONAL") as
    | Extract<BinanceSymbolFilter, { filterType: "MIN_NOTIONAL" } | { filterType: "NOTIONAL" }>
    | undefined;
  const v = f ? parseFloat(f.minNotional) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 10; // fallback conservador: 10 USDT
}

/** Valida preço + quantidade spot contra PRICE_FILTER/LOT_SIZE/NOTIONAL. Usado na Fase 2 (paper). */
export function validateSpotOrderQty(
  symbol: BinanceSpotSymbol,
  price: number,
  qty: number
): { ok: boolean; reason?: string } {
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "Preço inválido." };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "Quantidade inválida." };
  const pf = getPriceFilter(symbol);
  if (pf) {
    const minP = parseFloat(pf.minPrice);
    const maxP = parseFloat(pf.maxPrice);
    const tick = parseFloat(pf.tickSize);
    if (Number.isFinite(minP) && price < minP) return { ok: false, reason: `Preço abaixo do mínimo (${minP}).` };
    if (Number.isFinite(maxP) && maxP > 0 && price > maxP) return { ok: false, reason: `Preço acima do máximo (${maxP}).` };
    if (Number.isFinite(tick) && tick > 0) {
      const steps = price / tick;
      if (Math.abs(steps - Math.round(steps)) > 1e-8)
        return { ok: false, reason: `Preço fora do tick (${tick}).` };
    }
  }
  const lot = getLotSizeFilter(symbol);
  if (lot) {
    const min = parseFloat(lot.minQty);
    const max = parseFloat(lot.maxQty);
    const step = parseFloat(lot.stepSize);
    if (Number.isFinite(min) && qty < min) return { ok: false, reason: `Quantidade abaixo do mínimo (${min}).` };
    if (Number.isFinite(max) && max > 0 && qty > max) return { ok: false, reason: `Quantidade acima do máximo (${max}).` };
    if (step > 0) {
      const steps = qty / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8)
        return { ok: false, reason: `Quantidade fora do step (${step}).` };
    }
  }
  const notional = price * qty;
  const minNotional = getMinNotional(symbol);
  if (notional < minNotional)
    return { ok: false, reason: `Valor mínimo por ordem: ${minNotional} USDT.` };
  return { ok: true };
}

// ─── Derivados para as abas (puro, testável) ───
export function topMovers(tickers: BinanceTicker24h[], n = 20, direction: "up" | "down" = "up") {
  const sorted = [...tickers].sort((a, b) =>
    direction === "up"
      ? b.priceChangePercent - a.priceChangePercent
      : a.priceChangePercent - b.priceChangePercent
  );
  return sorted.slice(0, n);
}

export function mostTraded(tickers: BinanceTicker24h[], n = 20) {
  return [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, n);
}

/**
 * "Recentes" honesto com API pública: a Binance não expõe data de listagem no
 * exchangeInfo. Fase 1 = pares de MENOR quoteVolume (potenciais low-cap/novos)
 * + watchlist local (vistas recentemente pelo utilizador). Rotulado como tal no UI.
 */
export function potentialNewListings(tickers: BinanceTicker24h[], n = 20) {
  return [...tickers].sort((a, b) => a.quoteVolume - b.quoteVolume).slice(0, n);
}

export function formatUsdt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

export function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  return v.toPrecision(4);
}

// ═══════════════════════════════════════════════════════════════════
// PÁGINA MERCADO — hub consolidado Binance (100% Binance)
// Endpoints públicos usados:
//   SPOT   GET /api/v3/ticker/24hr        → get24hTickers()
//   SPOT   GET /api/v3/exchangeInfo        → fetchSpotUsdtSymbols() / getNewListings()
//   FUT    GET /fapi/v1/premiumIndex       → getFundingRates()
//   Fallback: testnet.binance.vision / testnet.binancefuture.com → MOCK_TICKERS
// ═══════════════════════════════════════════════════════════════════

/** Símbolo cripto unificado (spot + USDT-M futuros). 100% Binance. */
export interface CryptoSymbol {
  symbol: string; // ex: "BTCUSDT"
  base: string; // ex: "BTC"
  quote: string; // ex: "USDT"
  market: "spot" | "futures";
  status?: string;
}

/** Curadoria spot USDT (principais). O universo completo vem de exchangeInfo. */
export const SPOT_USDT_SYMBOLS: CryptoSymbol[] = [
  "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "TON",
  "TRX", "DOT", "MATIC", "LTC", "ATOM", "NEAR", "APT", "ARB", "OP", "INJ",
].map((b) => ({ symbol: `${b}USDT`, base: b, quote: "USDT", market: "spot", status: "TRADING" }));

/** Curadoria USDT-M futuros (principais perpétuos). */
export const FUTURES_USDTM_SYMBOLS: CryptoSymbol[] = [
  "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "TON",
  "TRX", "DOT", "MATIC", "LTC", "ATOM", "NEAR", "APT", "ARB", "OP", "INJ",
  "SUI", "PEPE", "WIF", "FET", "RENDER",
].map((b) => ({ symbol: `${b}USDT`, base: b, quote: "USDT", market: "futures", status: "TRADING" }));

export const ALL_CRYPTO_SYMBOLS: CryptoSymbol[] = [...SPOT_USDT_SYMBOLS, ...FUTURES_USDTM_SYMBOLS];

/** Funding rate de um perpétuo USDT-M. */
export interface FundingRate {
  symbol: string;
  markPrice: number;
  fundingRate: number; // ex: 0.0001 = 0.01%
  nextFundingTime: number;
  longShortBias: "long-pays" | "short-pays" | "neutral";
}

/** Mock offline (último recurso quando mainnet + testnet falham). */
export const MOCK_TICKERS: BinanceTicker24h[] = [
  { symbol: "BTCUSDT", lastPrice: 97400, priceChange: 1450, priceChangePercent: 1.51, highPrice: 98200, lowPrice: 95800, volume: 18200, quoteVolume: 1_770_000_000, openPrice: 95950, prevClosePrice: 95950, count: 2_400_000 },
  { symbol: "ETHUSDT", lastPrice: 3420, priceChange: -42, priceChangePercent: -1.21, highPrice: 3490, lowPrice: 3380, volume: 210000, quoteVolume: 712_000_000, openPrice: 3462, prevClosePrice: 3462, count: 1_100_000 },
  { symbol: "SOLUSDT", lastPrice: 214.5, priceChange: 12.8, priceChangePercent: 6.34, highPrice: 218, lowPrice: 200, volume: 3_400_000, quoteVolume: 700_000_000, openPrice: 201.7, prevClosePrice: 201.7, count: 900_000 },
  { symbol: "DOGEUSDT", lastPrice: 0.3215, priceChange: -0.02, priceChangePercent: -5.86, highPrice: 0.345, lowPrice: 0.318, volume: 1_900_000_000, quoteVolume: 620_000_000, openPrice: 0.3415, prevClosePrice: 0.3415, count: 750_000 },
  { symbol: "PEPEUSDT", lastPrice: 0.00001842, priceChange: 0.0000021, priceChangePercent: 12.87, highPrice: 0.0000189, lowPrice: 0.0000161, volume: 4_100_000_000_000, quoteVolume: 310_000_000, openPrice: 0.00001632, prevClosePrice: 0.00001632, count: 600_000 },
  { symbol: "XRPUSDT", lastPrice: 2.41, priceChange: 0.09, priceChangePercent: 3.88, highPrice: 2.46, lowPrice: 2.3, volume: 120_000_000, quoteVolume: 290_000_000, openPrice: 2.32, prevClosePrice: 2.32, count: 500_000 },
  { symbol: "WIFUSDT", lastPrice: 2.85, priceChange: -0.31, priceChangePercent: -9.81, highPrice: 3.2, lowPrice: 2.8, volume: 40_000_000, quoteVolume: 118_000_000, openPrice: 3.16, prevClosePrice: 3.16, count: 220_000 },
  { symbol: "SUIUSDT", lastPrice: 4.62, priceChange: 0.35, priceChangePercent: 8.2, highPrice: 4.7, lowPrice: 4.2, volume: 25_000_000, quoteVolume: 112_000_000, openPrice: 4.27, prevClosePrice: 4.27, count: 180_000 },
  { symbol: "NEWLISTUSDT", lastPrice: 0.842, priceChange: 0.05, priceChangePercent: 6.3, highPrice: 0.9, lowPrice: 0.78, volume: 1_200_000, quoteVolume: 980_000, openPrice: 0.792, prevClosePrice: 0.792, count: 12_000 },
  { symbol: "LOWCAPUSDT", lastPrice: 0.112, priceChange: -0.004, priceChangePercent: -3.45, highPrice: 0.119, lowPrice: 0.108, volume: 4_000_000, quoteVolume: 450_000, openPrice: 0.116, prevClosePrice: 0.116, count: 5_000 },
];

export const MOCK_FUNDING: FundingRate[] = [
  { symbol: "BTCUSDT", markPrice: 97400, fundingRate: 0.0001, nextFundingTime: Date.now() + 3_600_000, longShortBias: "long-pays" },
  { symbol: "ETHUSDT", markPrice: 3420, fundingRate: -0.0002, nextFundingTime: Date.now() + 3_600_000, longShortBias: "short-pays" },
  { symbol: "SOLUSDT", markPrice: 214.5, fundingRate: 0.00045, nextFundingTime: Date.now() + 3_600_000, longShortBias: "long-pays" },
  { symbol: "DOGEUSDT", markPrice: 0.3215, fundingRate: 0.0008, nextFundingTime: Date.now() + 3_600_000, longShortBias: "long-pays" },
];

export type MarketDataSource = "live" | "testnet" | "mock";

export interface MarketSnapshot {
  tickers: BinanceTicker24h[];
  source: MarketDataSource;
  fetchedAt: number;
  note: string;
}

/**
 * GET /api/v3/ticker/24hr (todos os pares USDT).
 * Tenta mainnet → vision → testnet; em último caso devolve MOCK_TICKERS.
 * Nunca lança: retorna sempre um MarketSnapshot com a fonte usada.
 */
export async function get24hTickers(): Promise<MarketSnapshot> {
  const cached = getCached<MarketSnapshot>("market:snapshot:24h", TTL_TICKERS_MS);
  if (cached) return cached;
  try {
    const tickers = await fetchAllTickers24h();
    const usedTestnet = false; // fetchAllTickers24h percorre as bases; se chegou aqui há dados reais
    const snap: MarketSnapshot = {
      tickers,
      source: "live",
      fetchedAt: Date.now(),
      note: usedTestnet ? "via testnet (fallback)" : "Binance Spot — tempo real",
    };
    setCached("market:snapshot:24h", snap);
    return snap;
  } catch {
    const snap: MarketSnapshot = {
      tickers: MOCK_TICKERS,
      source: "mock",
      fetchedAt: Date.now(),
      note: "Offline — dados mock (mainnet + testnet indisponíveis)",
    };
    setCached("market:snapshot:24h", snap);
    return snap;
  }
}

export interface TopMovers {
  gainers: BinanceTicker24h[];
  losers: BinanceTicker24h[];
}

/** Top gainers + losers 24h (puro, testável). */
export function getTopMovers(tickers: BinanceTicker24h[], n = 10): TopMovers {
  return { gainers: topMovers(tickers, n, "up"), losers: topMovers(tickers, n, "down") };
}

/**
 * GET /fapi/v1/premiumIndex (todos os perpétuos USDT-M).
 * Fallback: testnet futures → MOCK_FUNDING. Nunca lança (devolve [] + fonte).
 */
export async function getFundingRates(limit = 20): Promise<{ rates: FundingRate[]; source: MarketDataSource }> {
  const cached = getCached<FundingRate[]>("market:funding", 60_000);
  if (cached) return { rates: cached.slice(0, limit), source: "live" };
  try {
    const raw = await futuresGet<Array<{ symbol: string; markPrice: string; lastFundingRate: string; nextFundingTime: number }>>(
      "/fapi/v1/premiumIndex"
    );
    const out: FundingRate[] = raw
      .filter((r) => r.symbol.endsWith("USDT"))
      .map((r) => {
        const fr = parseFloat(r.lastFundingRate);
        return {
          symbol: r.symbol,
          markPrice: parseFloat(r.markPrice),
          fundingRate: Number.isFinite(fr) ? fr : 0,
          nextFundingTime: r.nextFundingTime,
          longShortBias: (fr > 0.00005 ? "long-pays" : fr < -0.00005 ? "short-pays" : "neutral") as FundingRate["longShortBias"],
        };
      })
      .filter((r) => Number.isFinite(r.markPrice) && r.markPrice > 0)
      .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
    setCached("market:funding", out);
    return { rates: out.slice(0, limit), source: "live" };
  } catch {
    return { rates: MOCK_FUNDING.slice(0, limit), source: "mock" };
  }
}

export interface NewListing {
  symbol: string;
  base: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  heuristic: "low-volume" | "watchlist";
}

/**
 * Novas listagens (honesto): a API pública NÃO expõe data de listagem.
 * Heurística = pares USDT com MENOR quoteVolume (potenciais low-cap/novos).
 * Rotular sempre como tal no UI — nunca afirmar "listado em <data>".
 */
export function getNewListings(tickers: BinanceTicker24h[], n = 20): NewListing[] {
  return potentialNewListings(tickers, n).map((t) => ({
    symbol: t.symbol,
    base: t.symbol.replace(/USDT$/, ""),
    lastPrice: t.lastPrice,
    priceChangePercent: t.priceChangePercent,
    quoteVolume: t.quoteVolume,
    heuristic: "low-volume" as const,
  }));
}

export interface MarketTrend {
  total: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  avgChangePct: number;
  medianChangePct: number;
  totalQuoteVolume: number;
  breadthPct: number; // 0–100: % de pares em alta
  bias: "bullish" | "bearish" | "neutral";
}

/** Tendência agregada do mercado spot USDT (puro, testável). */
export function getMarketTrend(tickers: BinanceTicker24h[]): MarketTrend {
  const total = tickers.length;
  if (total === 0) {
    return { total: 0, advancers: 0, decliners: 0, unchanged: 0, avgChangePct: 0, medianChangePct: 0, totalQuoteVolume: 0, breadthPct: 50, bias: "neutral" };
  }
  let adv = 0;
  let dec = 0;
  let sum = 0;
  let vol = 0;
  const changes = tickers.map((t) => {
    if (t.priceChangePercent > 0.05) adv++;
    else if (t.priceChangePercent < -0.05) dec++;
    sum += t.priceChangePercent;
    vol += t.quoteVolume;
    return t.priceChangePercent;
  });
  changes.sort((a, b) => a - b);
  const mid = Math.floor(changes.length / 2);
  const median = changes.length % 2 === 0 ? (changes[mid - 1] + changes[mid]) / 2 : changes[mid];
  const breadthPct = (adv / total) * 100;
  const avg = sum / total;
  const bias = breadthPct >= 55 && avg > 0.3 ? "bullish" : breadthPct <= 45 && avg < -0.3 ? "bearish" : "neutral";
  return {
    total,
    advancers: adv,
    decliners: dec,
    unchanged: total - adv - dec,
    avgChangePct: avg,
    medianChangePct: median,
    totalQuoteVolume: vol,
    breadthPct,
    bias,
  };
}

export interface FearGreedSimple {
  value: number; // 0–100
  label: "Medo Extremo" | "Medo" | "Neutro" | "Ganância" | "Ganância Extrema";
}

/**
 * Fear/Greed SIMPLIFICADO (não é o índice oficial alternative.me):
 * 50% breadth (advancers %) + 30% avgChange normalizado (±5% → 0–100) + 20% funding tilt.
 * fundingTilt: média de funding (clamp ±0.1%) → longs a pagar = ganância.
 */
export function getFearGreedSimple(tickers: BinanceTicker24h[], avgFundingRate = 0): FearGreedSimple {
  const trend = getMarketTrend(tickers);
  const breadthScore = Math.min(100, Math.max(0, trend.breadthPct));
  const momentumScore = Math.min(100, Math.max(0, ((trend.avgChangePct + 5) / 10) * 100));
  const fundingScore = Math.min(100, Math.max(0, ((avgFundingRate * 1000 + 0.5) / 1) * 100));
  const value = Math.round(breadthScore * 0.5 + momentumScore * 0.3 + fundingScore * 0.2);
  const label =
    value < 25 ? "Medo Extremo" : value < 40 ? "Medo" : value <= 60 ? "Neutro" : value <= 75 ? "Ganância" : "Ganância Extrema";
  return { value, label };
}

// ═══════════════════════════════════════════════════════════════════
// FUTURES USDT-M — camada da PÁGINA DE TRADING (100% Binance)
// Perpétuos USDT-M: LONG/SHORT, alavancagem 1–125x, isolated/cross.
// Endpoints públicos: GET /fapi/v1/klines, GET /fapi/v1/ticker/24hr,
// GET /fapi/v1/premiumIndex (mark price). Fallback: spot /api/v3/*.
// ═══════════════════════════════════════════════════════════════════

/** Allowlist USDT-M curada para a página de Trading (sem sintéticos legados). */
export const FUTURES_TRADING_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "ARBUSDT",
  "OPUSDT", "SUIUSDT", "NEARUSDT", "APTUSDT", "TONUSDT",
  "PEPEUSDT", "WIFUSDT", "INJUSDT", "LTCUSDT", "TRXUSDT",
] as const;
export type FuturesTradingSymbol = (typeof FUTURES_TRADING_SYMBOLS)[number];

export const FUTURES_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type FuturesInterval = (typeof FUTURES_INTERVALS)[number];

export const MAX_LEVERAGE = 125;
export const MIN_LEVERAGE = 1;

/** Klines de futuros (mark/close). Tenta fapi → cai para spot se 451. */
/** Máximo de velas por pedido na Binance (fapi). */
const FUTURES_KLINES_PAGE = 1500;

function mapKlines(raw: Array<[number, string, string, string, string, string, number, string]>): BinanceKline[] {
  return raw.map((k) => ({
    t: k[0],
    o: parseFloat(k[1]),
    h: parseFloat(k[2]),
    l: parseFloat(k[3]),
    c: parseFloat(k[4]),
    v: parseFloat(k[5]),
    closeTime: k[6],
    quoteVolume: parseFloat(k[7]),
  }));
}

/**
 * Klines de futuros. A Binance limita a 1500 por pedido, por isso pagina
 * recursivamente (para trás, com endTime) até obter `limit` velas (ex.: 5000).
 */
export async function fetchFuturesKlines(
  symbol: string,
  interval: string = "1m",
  limit = 300
): Promise<BinanceKline[]> {
  const sym = symbol.trim().toUpperCase();
  if (!FUTURES_INTERVALS.includes(interval as FuturesInterval)) {
    throw new Error(`Intervalo de futuros inválido: ${interval}.`);
  }
  const want = Math.min(Math.max(limit, 1), 20_000);
  try {
    const pages: BinanceKline[][] = [];
    let endTime: number | undefined;
    let got = 0;
    while (got < want) {
      const pageLimit = Math.min(FUTURES_KLINES_PAGE, want - got);
      const qs = `/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${pageLimit}${endTime ? `&endTime=${endTime}` : ""}`;
      const raw = await futuresGet<Array<[number, string, string, string, string, string, number, string]>>(qs);
      if (raw.length === 0) break;
      const chunk = mapKlines(raw);
      pages.unshift(chunk); // chunk mais antigo vai para a frente
      got += chunk.length;
      endTime = chunk[0].t - 1; // continua para trás
      if (raw.length < pageLimit) break; // chegámos ao início do histórico
    }
    const all = pages.flat();
    return all.slice(-want);
  } catch {
    // Fallback honesto: spot klines têm o mesmo formato OHLCV.
    return fetchKlines(sym, interval, Math.min(want, 1000));
  }
}

/** Ticker 24h de futuros (fapi). Fallback: spot ticker → mock nunca lança aqui. */
export async function fetchFuturesTickers24h(): Promise<BinanceTicker24h[]> {
  try {
    const raw = await futuresGet<Array<Record<string, string | number>>>("/fapi/v1/ticker/24hr");
    return raw
      .filter((t) => String(t.symbol).endsWith("USDT"))
      .map(toTicker)
      .filter((t) => Number.isFinite(t.lastPrice) && t.lastPrice > 0);
  } catch {
    return fetchAllTickers24h();
  }
}

// ─── Elegibilidade futuros ──────────────────────────────────────────────
// Um símbolo só pode ser operado na página Trading se tiver perpétuo USDT-M
// listado (aparece no ticker 24h de futuros). Cache de 10 min.
let futuresEligibleCache: { at: number; set: Set<string> } | null = null;

export async function fetchFuturesEligibleSymbols(force = false): Promise<Set<string>> {
  if (!force && futuresEligibleCache && Date.now() - futuresEligibleCache.at < 10 * 60_000) {
    return futuresEligibleCache.set;
  }
  try {
    const tickers = await fetchFuturesTickers24h();
    const set = new Set(tickers.map((t) => t.symbol));
    // Garante os curados mesmo se o fapi cair para o fallback spot.
    for (const s of FUTURES_TRADING_SYMBOLS) set.add(s);
    futuresEligibleCache = { at: Date.now(), set };
    return set;
  } catch {
    return new Set<string>([...FUTURES_TRADING_SYMBOLS]);
  }
}

export function isFuturesEligible(symbol: string, eligible: Set<string> | null): boolean {
  if (!eligible) return (FUTURES_TRADING_SYMBOLS as readonly string[]).includes(symbol);
  return eligible.has(symbol);
}

// ─── Spread (bid-ask) por ativo ─────────────────────────────────────────────
// A Binance Futures USDT-M não cobra "margem" por entrada; cobra taxa taker e
// tem um SPREAD entre bid e ask. É esse spread que faz o preço ter de andar um
// pouco antes de o trade ficar positivo (breakeven). Lemos o spread real do
// bookTicker e, se falhar, usamos um valor conservador por liquidez.
const spreadCache = new Map<string, { at: number; pct: number }>();

export async function fetchFuturesSpreadPct(symbol: string): Promise<number> {
  const sym = symbol.trim().toUpperCase();
  const hit = spreadCache.get(sym);
  if (hit && Date.now() - hit.at < 60_000) return hit.pct;
  try {
    const raw = await futuresGet<{ bidPrice: string; askPrice: string }>(
      `/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(sym)}`
    );
    const bid = parseFloat(raw.bidPrice);
    const ask = parseFloat(raw.askPrice);
    const mid = (bid + ask) / 2;
    const pct = mid > 0 && ask > bid ? ((ask - bid) / mid) * 100 : 0;
    spreadCache.set(sym, { at: Date.now(), pct });
    return pct;
  } catch {
    // Fallback conservador por liquidez (spread típico em horário normal).
    const fallback = sym.startsWith("BTC")
      ? 0.01
      : ["ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"].includes(sym)
        ? 0.02
        : 0.04;
    return fallback;
  }
}

/** Mark price do perpétuo (premiumIndex). Fallback: last price spot. */
export async function fetchFuturesMarkPrice(symbol: string): Promise<number> {
  const sym = symbol.trim().toUpperCase();
  try {
    const raw = await futuresGet<{ symbol: string; markPrice: string }>(
      `/fapi/v1/premiumIndex?symbol=${encodeURIComponent(sym)}`
    );
    const v = parseFloat(raw.markPrice);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    /* cai para spot abaixo */
  }
  return fetchLastPrice(sym);
}

export type FuturesSide = "LONG" | "SHORT";
export type MarginMode = "isolated" | "cross";

/** Margem inicial = notional / leverage. */
export function futuresMargin(notionalUsdt: number, leverage: number): number {
  if (!Number.isFinite(notionalUsdt) || notionalUsdt <= 0) return NaN;
  const lev = Math.min(MAX_LEVERAGE, Math.max(MIN_LEVERAGE, Math.floor(leverage)));
  return notionalUsdt / lev;
}

/** PnL não realizado de futuros: LONG (mark-entry)*qty, SHORT (entry-mark)*qty. */
export function futuresUnrealizedPnl(side: FuturesSide, entry: number, qty: number, mark: number): number {
  if (![entry, qty, mark].every((v) => Number.isFinite(v) && v > 0)) return NaN;
  return side === "LONG" ? (mark - entry) * qty : (entry - mark) * qty;
}

/** ROE % sobre a margem isolada. */
export function futuresRoe(side: FuturesSide, entry: number, qty: number, mark: number, leverage: number): number {
  const margin = futuresMargin(entry * qty, leverage);
  if (!Number.isFinite(margin) || margin <= 0) return NaN;
  return (futuresUnrealizedPnl(side, entry, qty, mark) / margin) * 100;
}

/**
 * Preço de liquidação aproximado (isolated, sem funding/taxas):
 * LONG  ≈ entry * (1 - 1/lev + mmr), SHORT ≈ entry * (1 + 1/lev - mmr),
 * com mmr (maintenance margin rate) conservador de 0,5% para lev <= 20x
 * e 1% acima disso. É estimativa para o UI paper — nunca garantia.
 */
export function futuresLiqPrice(side: FuturesSide, entry: number, leverage: number): number {
  if (!Number.isFinite(entry) || entry <= 0) return NaN;
  const lev = Math.min(MAX_LEVERAGE, Math.max(MIN_LEVERAGE, Math.floor(leverage)));
  const mmr = lev <= 20 ? 0.005 : 0.01;
  return side === "LONG" ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr);
}

/** Validação de ordem futura (tamanho mínimo 5 USDT por defeito). */
export function validateFuturesOrder(args: {
  price: number;
  qty: number;
  leverage: number;
  balanceFree: number;
  marginMode: MarginMode;
  reduceOnly?: boolean;
}): { ok: boolean; reason?: string; notional?: number; margin?: number } {
  const { price, qty, leverage, balanceFree, reduceOnly } = args;
  if (!Number.isFinite(price) || price <= 0) return { ok: false, reason: "Preço inválido." };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "Quantidade inválida." };
  if (!Number.isFinite(leverage) || leverage < MIN_LEVERAGE || leverage > MAX_LEVERAGE) {
    return { ok: false, reason: `Alavancagem deve estar entre ${MIN_LEVERAGE}x e ${MAX_LEVERAGE}x.` };
  }
  const notional = price * qty;
  if (notional < 5) return { ok: false, reason: "Notional mínimo: 5 USDT." };
  const margin = futuresMargin(notional, leverage);
  if (!reduceOnly && margin > balanceFree + 1e-9) {
    return { ok: false, reason: `Margem insuficiente (precisa $${margin.toFixed(2)}).` };
  }
  return { ok: true, notional, margin };
}
