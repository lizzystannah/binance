import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";

// ─── QuantTerm — Servidor Binance-only ────────────────────────────────────────
// Entry enxuto: serve o SPA (Vite dev / build estático) + endpoints Binance
// (Futuros USDT-M) e configurações de trading de futuros.

const startTime = Date.now();

const DOCKER_VOLUME_DIR = process.env.DATA_DIR || "/data";
const BASE_DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync(DOCKER_VOLUME_DIR)
    ? DOCKER_VOLUME_DIR
    : path.join(process.cwd(), "data"));

function ensureDataDir() {
  if (!fs.existsSync(BASE_DATA_DIR)) {
    fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
  }
}

// ─── Binance Futures config ───────────────────────────────────────────────────
const BINANCE_FAPI_BASE = (process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com").replace(/\/$/, "");
const BINANCE_FAPI_TESTNET_BASE = (process.env.BINANCE_TESTNET_FAPI_BASE || "https://testnet.binancefuture.com").replace(/\/$/, "");
const BINANCE_FUTURES_FILE = path.join(BASE_DATA_DIR, "binance_futures.json");
const BINANCE_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h",
  "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);

function sanitizeBinanceSymbol(raw: unknown, fallback = "BTCUSDT"): string {
  const s = String(raw || fallback).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{4,20}$/.test(s) ? s : fallback;
}

async function fetchBinanceJson(apiPath: string): Promise<{ data: unknown; source: string }> {
  let lastErr: unknown = null;
  for (const base of [BINANCE_FAPI_BASE, BINANCE_FAPI_TESTNET_BASE]) {
    try {
      const r = await fetch(`${base}${apiPath}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Binance ${r.status} em ${base}${apiPath}`);
      return { data: await r.json(), source: base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function loadBinanceFuturesFlags() {
  const defaults = {
    leverage: Number(process.env.BINANCE_DEFAULT_LEVERAGE) || 10,
    futuresFee: Number(process.env.BINANCE_FUTURES_FEE ?? 0.0004),
    trailingPct: Number(process.env.BINANCE_TRAILING_PCT ?? 0.005),
  };
  try {
    if (fs.existsSync(BINANCE_FUTURES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BINANCE_FUTURES_FILE, "utf-8"));
      return {
        leverage: Number(raw.leverage) || defaults.leverage,
        futuresFee: Number(raw.futuresFee ?? raw.fee) || defaults.futuresFee,
        trailingPct: Number(raw.trailingPct ?? raw.trailing) || defaults.trailingPct,
      };
    }
  } catch (e) {
    console.warn("[Binance] Falha ao ler binance_futures.json, a usar defaults.", e);
  }
  return defaults;
}

async function main() {
  ensureDataDir();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      platform: "binance",
      market: "USDT-M futures + spot",
      uptimeMs: Date.now() - startTime,
      ts: Date.now(),
    });
  });

  // ── Crypto live status (Fase 4, desligada por omissão) ─────────────────────
  app.get("/api/crypto/live/status", (_req, res) => {
    const configured = !!((process.env.BINANCE_API_KEY || "").trim());
    const liveEnabled = process.env.BINANCE_LIVE_ENABLED === "true";
    res.json({
      success: true,
      paperDefault: true,
      configured,
      liveEnabled,
      message:
        liveEnabled && configured
          ? "Execução real armada no servidor (Fase 4)."
          : "A operar em conta paper. Ordens reais bloqueadas pelo servidor (403).",
    });
  });

  app.post("/api/crypto/live/order", (_req, res) => {
    const configured = !!((process.env.BINANCE_API_KEY || "").trim());
    const liveEnabled = process.env.BINANCE_LIVE_ENABLED === "true";
    if (!liveEnabled || !configured) {
      return res.status(403).json({
        error: "Conta real (Fase 4) desativada. A operar em conta paper.",
      });
    }
    return res.status(501).json({ error: "Execução real ainda não implementada (Fase 4)." });
  });

  // ── Binance Futures market-data ────────────────────────────────────────────
  app.get("/api/binance/klines", async (req, res) => {
    try {
      const symbol = sanitizeBinanceSymbol(req.query.symbol);
      const interval = BINANCE_INTERVALS.has(String(req.query.interval))
        ? String(req.query.interval)
        : "1m";
      const limit = Math.min(1500, Math.max(1, parseInt(String(req.query.limit ?? "200")) || 200));
      const qs = `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const { data, source } = await fetchBinanceJson(qs);
      const candles = (Array.isArray(data) ? data : []).map((k: any[]) => ({
        t: Number(k[0]),
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[5]),
      }));
      res.json({ success: true, symbol, interval, limit, source, data: candles });
    } catch (err: any) {
      console.error("[Binance] klines error:", err?.message || err);
      res.status(502).json({ error: "Falha ao obter klines da Binance." });
    }
  });

  app.get("/api/binance/ticker24h", async (req, res) => {
    try {
      const symbol = sanitizeBinanceSymbol(req.query.symbol);
      const { data, source } = await fetchBinanceJson(`/fapi/v1/ticker/24hr?symbol=${symbol}`);
      res.json({ success: true, symbol, source, data });
    } catch (err: any) {
      console.error("[Binance] ticker24h error:", err?.message || err);
      res.status(502).json({ error: "Falha ao obter ticker24h da Binance." });
    }
  });

  // ── Configurações de trading de futuros (persistidas em data/) ─────────────
  app.get("/api/settings/binance-futures", (_req, res) => {
    const flags = loadBinanceFuturesFlags();
    const configured = !!((process.env.BINANCE_API_KEY || "").trim());
    res.json({
      success: true,
      ...flags,
      testnet: process.env.BINANCE_TESTNET !== "false",
      liveEnabled: process.env.BINANCE_LIVE_ENABLED === "true",
      configured,
    });
  });

  app.post("/api/settings/binance-futures", (req, res) => {
    try {
      const body = req.body || {};
      const leverage = Number(body.leverage);
      if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) {
        return res.status(400).json({ error: "leverage deve ser inteiro entre 1 e 125." });
      }
      const futuresFee = Number(body.futuresFee ?? 0.0004);
      if (!(futuresFee >= 0 && futuresFee <= 0.05)) {
        return res.status(400).json({ error: "futuresFee deve estar entre 0 e 0.05." });
      }
      const trailingPct = Number(body.trailingPct ?? 0.005);
      if (!(trailingPct >= 0 && trailingPct <= 0.5)) {
        return res.status(400).json({ error: "trailingPct deve estar entre 0 e 0.5." });
      }
      // Nunca persistir secrets — apenas os defaults operacionais.
      const payload = { leverage, futuresFee, trailingPct, updatedAt: Date.now() };
      fs.writeFileSync(BINANCE_FUTURES_FILE, JSON.stringify(payload, null, 2), "utf-8");
      console.log(`[Settings] binance-futures atualizado: leverage=${leverage} fee=${futuresFee} trailing=${trailingPct}`);
      res.json({ success: true, ...payload });
    } catch (err: any) {
      console.error("[Settings] binance-futures error:", err?.message || err);
      res.status(500).json({ error: "Falha ao guardar configurações." });
    }
  });

  // ── API 404 (impede fallback HTML do SPA) ──────────────────────────────────
  app.use("/api", (req, res) => {
    console.warn(`[HTTP] 404 - API Route not found: ${req.method} ${req.path}`);
    res.status(404).json({
      error: "Rota de API não encontrada",
      details: `O endpoint ${req.method} ${req.path} não está registrado neste servidor.`,
    });
  });

  // ── Vite dev server ou build estático ──────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Starting Vite dev server middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.use((req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        res.sendFile(path.join(distPath, "index.html"));
      });
    } else {
      console.warn("[Server] ⚠ Production mode active but 'dist' folder not found. Did you run 'npm run build'?");
      app.get("/", (_req, res) =>
        res.send("Servidor a correr, mas a pasta 'dist' não foi encontrada. Execute 'npm run build'.")
      );
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    const elapsed = Date.now() - startTime;
    console.log("═══════════════════════════════════════════════════════");
    console.log(`  ✅ QuantTerm (Binance-only) on http://localhost:${PORT}`);
    console.log(`  ✅ Started in ${elapsed}ms`);
    console.log(`  📡 Health check: http://localhost:${PORT}/api/health`);
    console.log("═══════════════════════════════════════════════════════");
  });
}

main().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
