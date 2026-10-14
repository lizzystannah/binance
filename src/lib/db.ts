import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import mysql from "mysql2/promise";
import pg from "pg";
import * as schema from "./schema";

// We only initialize the DB lazily to prevent crashing if the URL is not set yet
let dbInstance: any = null;
let initialized = false;
let isConnecting = false;

const createStrategiesTable = `
CREATE TABLE IF NOT EXISTS \`strategies\` (
  \`id\` VARCHAR(255) PRIMARY KEY,
  \`name\` VARCHAR(255) NOT NULL,
  \`description\` TEXT,
  \`code\` TEXT NOT NULL,
  \`category\` VARCHAR(100),
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;

const createRobotsTable = `
CREATE TABLE IF NOT EXISTS \`robots\` (
  \`id\` VARCHAR(255) PRIMARY KEY,
  \`name\` VARCHAR(255) NOT NULL,
  \`active\` TINYINT(1) DEFAULT 0,
  \`config\` JSON NOT NULL,
  \`managementState\` JSON,
  \`managementTrades\` JSON,
  \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;

const createTradesTable = `
CREATE TABLE IF NOT EXISTS \`trades\` (
  \`id\` VARCHAR(255) PRIMARY KEY,
  \`robotId\` VARCHAR(255) NOT NULL,
  \`contractId\` VARCHAR(255),
  \`asset\` VARCHAR(100) NOT NULL,
  \`action\` VARCHAR(50) NOT NULL,
  \`stake\` DECIMAL(10, 2) NOT NULL,
  \`payout\` DECIMAL(10, 2) DEFAULT 0.00,
  \`profit\` DECIMAL(10, 2) DEFAULT 0.00,
  \`result\` VARCHAR(50),
  \`mode\` VARCHAR(50),
  \`warmup\` TINYINT(1) DEFAULT 0,
  \`timestamp\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  \`snapshot\` JSON DEFAULT NULL
);
`;

const createStrategiesTablePg = `
CREATE TABLE IF NOT EXISTS strategies (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createRobotsTablePg = `
CREATE TABLE IF NOT EXISTS robots (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT FALSE,
  config JSONB NOT NULL,
  "managementState" JSONB,
  "managementTrades" JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createTradesTablePg = `
CREATE TABLE IF NOT EXISTS trades (
  id VARCHAR(255) PRIMARY KEY,
  "robotId" VARCHAR(255) NOT NULL,
  "contractId" VARCHAR(255),
  asset VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  stake DECIMAL(10, 2) NOT NULL,
  payout DECIMAL(10, 2) DEFAULT 0.00,
  profit DECIMAL(10, 2) DEFAULT 0.00,
  result VARCHAR(50),
  mode VARCHAR(50),
  warmup BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  snapshot JSONB DEFAULT NULL
);
`;

const createManagementTradesTable = `
CREATE TABLE IF NOT EXISTS \`management_trades\` (
  \`id\` VARCHAR(255) PRIMARY KEY,
  \`robotId\` VARCHAR(255) NOT NULL,
  \`robotName\` VARCHAR(255),
  \`asset\` VARCHAR(100) NOT NULL,
  \`action\` VARCHAR(50) NOT NULL,
  \`amount\` DECIMAL(10, 2) NOT NULL,
  \`payout\` DECIMAL(10, 2) DEFAULT 0.00,
  \`pnl\` DECIMAL(10, 2) DEFAULT 0.00,
  \`result\` VARCHAR(50),
  \`mode\` VARCHAR(50),
  \`isShadow\` TINYINT(1) DEFAULT 0,
  \`ts\` BIGINT,
  \`timestamp\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createManagementProgressionTable = `
CREATE TABLE IF NOT EXISTS \`management_progression\` (
  \`id\` VARCHAR(255) PRIMARY KEY,
  \`robotId\` VARCHAR(255) NOT NULL,
  \`mode\` VARCHAR(50) NOT NULL,
  \`level\` BIGINT NOT NULL DEFAULT 0,
  \`lastProfit\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  \`lastStake\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  \`baseStake\` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  \`ts\` BIGINT,
  \`timestamp\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createManagementTradesTablePg = `
CREATE TABLE IF NOT EXISTS management_trades (
  id VARCHAR(255) PRIMARY KEY,
  "robotId" VARCHAR(255) NOT NULL,
  "robotName" VARCHAR(255),
  asset VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payout DECIMAL(10, 2) DEFAULT 0.00,
  pnl DECIMAL(10, 2) DEFAULT 0.00,
  result VARCHAR(50),
  mode VARCHAR(50),
  "isShadow" BOOLEAN DEFAULT FALSE,
  ts BIGINT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createBacktestCandlesTable = `
CREATE TABLE IF NOT EXISTS \`backtest_candles\` (
  \`asset\` VARCHAR(100) PRIMARY KEY,
  \`candles\` LONGTEXT NOT NULL,
  \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
`;

const createBacktestCandlesTablePg = `
CREATE TABLE IF NOT EXISTS backtest_candles (
  asset VARCHAR(100) PRIMARY KEY,
  candles TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const createManagementProgressionTablePg = `
CREATE TABLE IF NOT EXISTS management_progression (
  id VARCHAR(255) PRIMARY KEY,
  "robotId" VARCHAR(255) NOT NULL,
  mode VARCHAR(50) NOT NULL,
  level BIGINT NOT NULL DEFAULT 0,
  "lastProfit" DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  "lastStake" DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  "baseStake" DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ts BIGINT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export async function isDbActive(): Promise<boolean> {
  if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
    return false;
  }
  try {
    const db = await getDb();
    return db !== null;
  } catch (err) {
    return false;
  }
}

export async function getDb() {
  if (dbInstance && initialized) return dbInstance;

  // Supports single string OR separated variables
  let connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    const host = process.env.DB_HOST || "localhost";
    const port = process.env.DB_PORT || "3306";
    const user = process.env.DB_USER || "root";
    const password = process.env.DB_PASSWORD || "";
    const database = process.env.DB_DATABASE || process.env.DB_NAME || "nome_do_banco";

    if (process.env.DB_HOST) {
      if (port === "5432" || port.startsWith("543") || user.includes("postgres")) {
        connectionString = `postgres://${user}:${password}@${host}:${port}/${database}`;
      } else {
        connectionString = `mysql://${user}:${password}@${host}:${port}/${database}`;
      }
    }
  }

  if (!connectionString) {
    throw new Error("Não foi possível encontrar a configuração do banco de dados (DATABASE_URL ou variáveis DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE).");
  }

  const isPostgres = connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://");

  if (isPostgres) {
    try {
      const { Pool } = pg;
      const pool = new Pool({ connectionString });
      
      // Auto-create tables once
      if (!initialized && !isConnecting) {
        isConnecting = true;
        console.log("[DB] Checking and creating PostgreSQL tables if not exists...");
        await pool.query(createStrategiesTablePg);
        await pool.query(createRobotsTablePg);
        await pool.query(createTradesTablePg);
        await pool.query(createManagementTradesTablePg);
        await pool.query(createManagementProgressionTablePg);
        try {
          await pool.query(createBacktestCandlesTablePg);
        } catch (candlesErr: any) {
          console.warn("[DB] Warning: Pg backtest_candles table auto-creation failed/warned:", candlesErr.message || candlesErr);
        }

        // Self-heal: ensure snapshot column exists
        try {
          await pool.query("SELECT snapshot FROM trades LIMIT 1");
        } catch (_) {
          console.log("[DB] Adding missing 'snapshot' column to PostgreSQL 'trades' table...");
          await pool.query("ALTER TABLE trades ADD COLUMN snapshot JSONB DEFAULT NULL");
        }

        // Self-heal: ensure managementTrades column exists in PostgreSQL
        try {
          await pool.query(`SELECT "managementTrades" FROM robots LIMIT 1`);
        } catch (_) {
          console.log("[DB] Adding missing 'managementTrades' column to PostgreSQL 'robots' table...");
          await pool.query(`ALTER TABLE robots ADD COLUMN "managementTrades" JSONB DEFAULT NULL`);
        }

        // Self-heal: ensure warmup column exists on trades
        try {
          await pool.query(`SELECT warmup FROM trades LIMIT 1`);
        } catch (_) {
          console.log("[DB] Adding missing 'warmup' column to PostgreSQL 'trades' table...");
          await pool.query(`ALTER TABLE trades ADD COLUMN warmup BOOLEAN DEFAULT FALSE`);
        }

        initialized = true;
        isConnecting = false;
        console.log("[DB] PostgreSQL tables verified successfully!");
      }

      dbInstance = drizzlePg(pool, { schema });
      return dbInstance;
    } catch (dbErr: any) {
      isConnecting = false;
      console.error("[DB] Falha crítica de conexão PostgreSQL:", dbErr.message || dbErr);
      throw dbErr;
    }
  } else {
    try {
      const poolConnection = mysql.createPool(connectionString);
      
      // Auto-create tables once
      if (!initialized && !isConnecting) {
        isConnecting = true;
        console.log("[DB] Checking and creating MySQL tables if not exists...");
        await poolConnection.query(createStrategiesTable);
        await poolConnection.query(createRobotsTable);
        await poolConnection.query(createTradesTable);
        await poolConnection.query(createManagementTradesTable);
        await poolConnection.query(createManagementProgressionTable);
        try {
          await poolConnection.query(createBacktestCandlesTable);
        } catch (candlesErr: any) {
          console.warn("[DB] Warning: MySQL backtest_candles table auto-creation failed/warned:", candlesErr.message || candlesErr);
        }

        // Self-heal: ensure snapshot column exists in MySQL
        try {
          await poolConnection.query("SELECT snapshot FROM trades LIMIT 1");
        } catch (_) {
          console.log("[DB] Adding missing 'snapshot' column to MySQL 'trades' table...");
          await poolConnection.query("ALTER TABLE `trades` ADD COLUMN `snapshot` JSON DEFAULT NULL");
        }

        // Self-heal: ensure managementTrades column exists in MySQL
        try {
          await poolConnection.query("SELECT managementTrades FROM robots LIMIT 1");
        } catch (_) {
          console.log("[DB] Adding missing 'managementTrades' column to MySQL 'robots' table...");
          await poolConnection.query("ALTER TABLE `robots` ADD COLUMN `managementTrades` JSON DEFAULT NULL");
        }

        // Self-heal: ensure warmup column exists on trades
        try {
          await poolConnection.query("SELECT warmup FROM trades LIMIT 1");
        } catch (_) {
          console.log("[DB] Adding missing 'warmup' column to MySQL 'trades' table...");
          await poolConnection.query("ALTER TABLE `trades` ADD COLUMN `warmup` TINYINT(1) DEFAULT 0");
        }

        initialized = true;
        isConnecting = false;
        console.log("[DB] MySQL tables verified successfully!");
      }

      dbInstance = drizzleMysql(poolConnection, { schema, mode: "default" });
      return dbInstance;
    } catch (dbErr: any) {
      isConnecting = false;
      console.error("[DB] Falha crítica de conexão MySQL:", dbErr.message || dbErr);
      throw dbErr;
    }
  }
}
