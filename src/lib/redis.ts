import Redis from "ioredis";
import { getTradingDay } from "./utils";

export interface RobotQuickState {
  robotId: string;
  robotName: string;
  status: "RUNNING" | "STOPPED" | "PAUSED" | "ERROR" | "IDLE";
  pnlToday: number;
  formattedPnlToday: string;
  tradesToday: number;
  winsToday: number;
  lossesToday: number;
  winRateToday: number;
  formattedWinRateToday: string;
  pendingOrder: {
    id?: string;
    action?: string;
    targetPrice?: number;
    createdTs?: number;
    expiryTs?: number;
    stake?: number;
    summary?: string;
  } | null;
  lastTrade: {
    id: string;
    action?: string;
    asset?: string;
    stake?: number;
    pnl?: number;
    result?: string;
    ts?: number;
    summary?: string;
  } | null;
  lastUpdate: string; // "HH:mm:ss"
  lastUpdateTimestamp: number;
  mode: "demo" | "real";
  asset: string;
  strategy: string;
  active: boolean;
}

let redisClient: Redis | null = null;
let isConnected = false;
let lastError: string | null = null;
let isConnecting = false;

// Fallback in-memory store in case Redis is unreachable or during local test execution
const memoryQuickStates = new Map<string, RobotQuickState>();

function formatTimeOnly(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ─── Backup de código de estratégias (self-heal após perda do volume) ────────
const STRATEGY_CODE_KEY = (id: string) => `quantern:strategy:code:${id}`;
const STRATEGY_CODE_INDEX = "quantern:strategy:code:index";

/** Salva snapshot do código da estratégia no Redis (persistente com AOF). */
export async function backupStrategyCode(id: string, code: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis || !isConnected) return false;
    await redis.set(STRATEGY_CODE_KEY(id), code);
    await redis.sadd(STRATEGY_CODE_INDEX, id);
    return true;
  } catch {
    return false;
  }
}

/** Recupera o código da estratégia a partir do snapshot no Redis. */
export async function restoreStrategyCode(id: string): Promise<string | null> {
  try {
    const redis = getRedisClient();
    if (!redis || !isConnected) return null;
    return await redis.get(STRATEGY_CODE_KEY(id));
  } catch {
    return null;
  }
}

export async function listBackedUpStrategyIds(): Promise<string[]> {
  try {
    const redis = getRedisClient();
    if (!redis || !isConnected) return [];
    return await redis.smembers(STRATEGY_CODE_INDEX);
  } catch {
    return [];
  }
}

export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  if (isConnecting) return null;

  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST || (redisUrl ? undefined : "127.0.0.1");
  const redisPort = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;
  const redisPassword = process.env.REDIS_PASSWORD || undefined;

  try {
    isConnecting = true;
    if (redisUrl) {
      console.log(`[Redis] Initializing connection with REDIS_URL...`);
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy(times) {
          const delay = Math.min(times * 1000, 10000);
          return delay;
        },
      });
    } else {
      console.log(`[Redis] Initializing connection to ${redisHost}:${redisPort}...`);
      redisClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy(times) {
          const delay = Math.min(times * 1000, 10000);
          return delay;
        },
      });
    }

    redisClient.on("connect", () => {
      isConnected = true;
      lastError = null;
      console.log(`[Redis] ⚡ Conectado ao servidor Redis com sucesso!`);
    });

    redisClient.on("ready", () => {
      isConnected = true;
      lastError = null;
      console.log(`[Redis] 🚀 Redis pronto para operações de alta velocidade!`);
    });

    redisClient.on("error", (err: any) => {
      isConnected = false;
      lastError = err?.message || String(err);
      // Suppress spamming logs if server is offline
      if (err?.code === "ECONNREFUSED" || err?.code === "ENOTFOUND") {
        // Log once or cleanly
      } else {
        console.warn(`[Redis] Aviso de conexão Redis:`, lastError);
      }
    });

    redisClient.on("close", () => {
      isConnected = false;
    });

    isConnecting = false;
    return redisClient;
  } catch (err: any) {
    isConnecting = false;
    lastError = err?.message || String(err);
    console.warn(`[Redis] Não foi possível iniciar cliente Redis:`, lastError);
    return null;
  }
}

export function isRedisConnected(): boolean {
  return isConnected && redisClient !== null && redisClient.status === "ready";
}

/**
 * Salva o estado rápido do robô no Redis (e sincroniza no fallback em memória)
 */
export async function saveRobotQuickState(robotId: string, state: RobotQuickState): Promise<void> {
  const cleanId = String(robotId);
  memoryQuickStates.set(cleanId, state);

  const client = getRedisClient();
  if (!client || !isRedisConnected()) {
    return;
  }

  try {
    const key = `robot:${cleanId}:state`;
    const jsonVal = JSON.stringify(state);
    
    // Multi pipeline for atomic updates: Set state JSON and add ID to active robots set
    const pipeline = client.pipeline();
    pipeline.set(key, jsonVal);
    if (state.active) {
      pipeline.sadd("robots:active_set", cleanId);
    } else {
      pipeline.srem("robots:active_set", cleanId);
    }
    // Also save in a global hash for single-roundtrip retrieval of all robots
    pipeline.hset("robots:quick_states", cleanId, jsonVal);
    await pipeline.exec();
  } catch (err: any) {
    lastError = err?.message || String(err);
  }
}

/**
 * Obtém o estado rápido de um robô específico do Redis
 */
export async function getRobotQuickState(robotId: string): Promise<RobotQuickState | null> {
  const cleanId = String(robotId);
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const data = await client.get(`robot:${cleanId}:state`);
      if (data) {
        const parsed = JSON.parse(data) as RobotQuickState;
        memoryQuickStates.set(cleanId, parsed);
        return parsed;
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  return memoryQuickStates.get(cleanId) || null;
}

/**
 * Retorna todos os estados rápidos armazenados no Redis
 */
export async function getAllRobotQuickStates(): Promise<Record<string, RobotQuickState>> {
  const client = getRedisClient();

  if (client && isRedisConnected()) {
    try {
      const hashData = await client.hgetall("robots:quick_states");
      if (hashData && Object.keys(hashData).length > 0) {
        const result: Record<string, RobotQuickState> = {};
        for (const [id, rawJson] of Object.entries(hashData)) {
          try {
            const parsed = JSON.parse(rawJson);
            result[id] = parsed;
            memoryQuickStates.set(id, parsed);
          } catch (jsonErr: any) {
            console.warn(`[Redis] Failed to parse cached quick state for ${id}:`, jsonErr?.message || jsonErr);
          }
        }
        return result;
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
  }

  const fallback: Record<string, RobotQuickState> = {};
  memoryQuickStates.forEach((val, key) => {
    fallback[key] = val;
  });
  return fallback;
}

/**
 * Remove o estado rápido de um robô do Redis
 */
export async function deleteRobotQuickState(robotId: string): Promise<void> {
  const cleanId = String(robotId);
  memoryQuickStates.delete(cleanId);

  const client = getRedisClient();
  if (!client || !isRedisConnected()) return;

  try {
    const pipeline = client.pipeline();
    pipeline.del(`robot:${cleanId}:state`);
    pipeline.srem("robots:active_set", cleanId);
    pipeline.hdel("robots:quick_states", cleanId);
    await pipeline.exec();
  } catch (err: any) {
    lastError = err?.message || String(err);
  }
}

/**
 * Calcula os indicadores rápidos do robô (PnL hoje, win rate hoje, ordem pendente, último trade)
 * e grava instantaneamente no Redis.
 */
export async function computeAndSaveRobotQuickState(
  robotId: string,
  runtime?: any,
  dbRobot?: any
): Promise<RobotQuickState> {
  const cleanId = String(robotId);
  const now = Date.now();
  const todayStr = getTradingDay(now);

  const cfg = runtime?.config || dbRobot?.config || dbRobot || {};
  const robotName = cfg.name || `Robô #${cleanId}`;
  const isActive = runtime ? runtime.active === true : (cfg.active === true || dbRobot?.active === true);
  const mode = (cfg.mode || "demo") as "demo" | "real";
  const asset = cfg.asset || "BTCUSDT";
  const strategy = cfg.strategy || "Unknown";

  let status: RobotQuickState["status"] = "STOPPED";
  if (isActive) {
    status = "RUNNING";
  }

  // Trades para cálculo
  const trades: any[] = runtime?.trades || dbRobot?.trades || [];
  
  const todayTrades = trades.filter((t: any) => {
    if (!t) return false;
    const tradeDate = t.ts ? getTradingDay(t.ts) : getTradingDay();
    return tradeDate === todayStr && t.result && t.result !== "OPEN";
  });

  const totalTradesToday = todayTrades.length;
  const winsToday = todayTrades.filter((t: any) => t.result === "WIN").length;
  const lossesToday = todayTrades.filter((t: any) => t.result === "LOSS").length;
  const winRateToday = totalTradesToday > 0 ? (winsToday / totalTradesToday) * 100 : 0;
  
  // PnL Hoje
  const pnlTodayRaw = todayTrades.reduce((sum: number, t: any) => sum + Number(t.pnl || t.profit || 0), 0);
  const pnlToday = Math.round(pnlTodayRaw * 100) / 100;
  const formattedPnlToday = `${pnlToday >= 0 ? "+" : ""}$${pnlToday.toFixed(2)}`;
  const formattedWinRateToday = `${winRateToday.toFixed(1)}%`;

  // Ordem pendente
  let pendingOrder: RobotQuickState["pendingOrder"] = null;
  if (runtime?.pendingOrders && runtime.pendingOrders.size > 0) {
    const firstPending = Array.from(runtime.pendingOrders.entries())[0];
    if (firstPending) {
      const [symbol, p] = firstPending as [string, any];
      pendingOrder = {
        id: `#${cleanId}-${symbol}`,
        action: p.action,
        targetPrice: p.targetPrice,
        createdTs: p.createdTs,
        expiryTs: p.expiryTs,
        stake: p.entryStake,
        summary: `#${p.action} @ ${p.targetPrice || "mkt"} (${symbol})`,
      };
    }
  }

  // Último trade
  let lastTrade: RobotQuickState["lastTrade"] = null;
  if (trades.length > 0) {
    const latest = trades[0]; // Assuming trades are sorted descending by ts
    if (latest && latest.id) {
      const lastPnl = Number(latest.pnl || latest.profit || 0);
      lastTrade = {
        id: String(latest.id),
        action: latest.action || latest.type || "CALL",
        asset: latest.asset || asset,
        stake: Number(latest.stake || latest.amount || 0),
        pnl: lastPnl,
        result: latest.result || "OPEN",
        ts: latest.ts || now,
        summary: `#${latest.id} (${latest.result || "OPEN"}) ${lastPnl >= 0 ? "+" : ""}$${lastPnl.toFixed(2)}`,
      };
    }
  }

  const quickState: RobotQuickState = {
    robotId: cleanId,
    robotName,
    status,
    pnlToday,
    formattedPnlToday,
    tradesToday: totalTradesToday,
    winsToday,
    lossesToday,
    winRateToday: Math.round(winRateToday * 10) / 10,
    formattedWinRateToday,
    pendingOrder,
    lastTrade,
    lastUpdate: formatTimeOnly(now),
    lastUpdateTimestamp: now,
    mode,
    asset,
    strategy,
    active: isActive,
  };

  await saveRobotQuickState(cleanId, quickState);
  return quickState;
}

/**
 * Informações diagnósticas do Redis
 */
export async function getRedisInfo(): Promise<{
  connected: boolean;
  status: string;
  url?: string;
  host?: string;
  port?: number;
  keyCount: number;
  lastError: string | null;
  inMemoryFallback: boolean;
}> {
  const client = getRedisClient();
  const connected = isRedisConnected();
  let keyCount = memoryQuickStates.size;

  if (client && connected) {
    try {
      const dbsize = await client.dbsize();
      keyCount = dbsize;
    } catch (dbSizeErr: any) {
      console.warn("[Redis] Failed to query dbsize:", dbSizeErr?.message || dbSizeErr);
    }
  }

  return {
    connected,
    status: client ? client.status : "uninitialized",
    url: process.env.REDIS_URL ? "(configurado via REDIS_URL)" : undefined,
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    keyCount,
    lastError,
    inMemoryFallback: !connected,
  };
}
