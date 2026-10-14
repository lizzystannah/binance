import { mysqlTable, varchar as mysqlVarchar, text as mysqlText, json as mysqlJson, timestamp as mysqlTimestamp, boolean as mysqlBoolean, decimal as mysqlDecimal, bigint as mysqlBigint } from "drizzle-orm/mysql-core";
import { pgTable, varchar as pgVarchar, text as pgText, jsonb as pgJson, timestamp as pgTimestamp, boolean as pgBoolean, decimal as pgDecimal, bigint as pgBigint } from "drizzle-orm/pg-core";

const connectionString = process.env.DATABASE_URL || "";
export const isPostgres = connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://") || (process.env.DB_HOST && process.env.DB_PORT === "5432") || process.env.DB_PORT?.startsWith("543") || false;

// ── ROBOTS ──
const mysqlRobots = mysqlTable("robots", {
  id: mysqlVarchar("id", { length: 255 }).primaryKey(),
  name: mysqlVarchar("name", { length: 255 }).notNull(),
  active: mysqlBoolean("active").default(false),
  config: mysqlJson("config").notNull(),
  managementState: mysqlJson("managementState"),
  managementTrades: mysqlJson("managementTrades"),
  createdAt: mysqlTimestamp("created_at").defaultNow(),
  updatedAt: mysqlTimestamp("updated_at").onUpdateNow(),
});

const pgRobots = pgTable("robots", {
  id: pgVarchar("id", { length: 255 }).primaryKey(),
  name: pgVarchar("name", { length: 255 }).notNull(),
  active: pgBoolean("active").default(false),
  config: pgJson("config").notNull(),
  managementState: pgJson("managementState"),
  managementTrades: pgJson("managementTrades"),
  createdAt: pgTimestamp("created_at").defaultNow(),
  updatedAt: pgTimestamp("updated_at").defaultNow(),
});

export const robots = isPostgres ? pgRobots : mysqlRobots;

// ── STRATEGIES ──
const mysqlStrategies = mysqlTable("strategies", {
  id: mysqlVarchar("id", { length: 255 }).primaryKey(),
  name: mysqlVarchar("name", { length: 255 }).notNull(),
  description: mysqlText("description"),
  code: mysqlText("code").notNull(),
  category: mysqlVarchar("category", { length: 100 }),
  createdAt: mysqlTimestamp("created_at").defaultNow(),
  updatedAt: mysqlTimestamp("updated_at").onUpdateNow(),
});

const pgStrategies = pgTable("strategies", {
  id: pgVarchar("id", { length: 255 }).primaryKey(),
  name: pgVarchar("name", { length: 255 }).notNull(),
  description: pgText("description"),
  code: pgText("code").notNull(),
  category: pgVarchar("category", { length: 100 }),
  createdAt: pgTimestamp("created_at").defaultNow(),
  updatedAt: pgTimestamp("updated_at").defaultNow(),
});

export const strategies = isPostgres ? pgStrategies : mysqlStrategies;

// ── TRADES ──
const mysqlTrades = mysqlTable("trades", {
  id: mysqlVarchar("id", { length: 255 }).primaryKey(),
  robotId: mysqlVarchar("robotId", { length: 255 }).notNull(),
  contractId: mysqlVarchar("contractId", { length: 255 }),
  asset: mysqlVarchar("asset", { length: 100 }).notNull(),
  action: mysqlVarchar("action", { length: 50 }).notNull(),
  stake: mysqlDecimal("stake", { precision: 10, scale: 2 }).notNull(),
  payout: mysqlDecimal("payout", { precision: 10, scale: 2 }),
  profit: mysqlDecimal("profit", { precision: 10, scale: 2 }),
  result: mysqlVarchar("result", { length: 50 }),
  mode: mysqlVarchar("mode", { length: 50 }),
  warmup: mysqlBoolean("warmup").default(false),
  timestamp: mysqlTimestamp("timestamp").defaultNow(),
  snapshot: mysqlJson("snapshot"),
});

const pgTrades = pgTable("trades", {
  id: pgVarchar("id", { length: 255 }).primaryKey(),
  robotId: pgVarchar("robotId", { length: 255 }).notNull(),
  contractId: pgVarchar("contractId", { length: 255 }),
  asset: pgVarchar("asset", { length: 100 }).notNull(),
  action: pgVarchar("action", { length: 50 }).notNull(),
  stake: pgDecimal("stake", { precision: 10, scale: 2 }).notNull(),
  payout: pgDecimal("payout", { precision: 10, scale: 2 }),
  profit: pgDecimal("profit", { precision: 10, scale: 2 }),
  result: pgVarchar("result", { length: 50 }),
  mode: pgVarchar("mode", { length: 50 }),
  warmup: pgBoolean("warmup").default(false),
  timestamp: pgTimestamp("timestamp").defaultNow(),
  snapshot: pgJson("snapshot"),
});

export const trades = isPostgres ? pgTrades : mysqlTrades;

// ── MANAGEMENT TRADES ──
const mysqlManagementTrades = mysqlTable("management_trades", {
  id: mysqlVarchar("id", { length: 255 }).primaryKey(),
  robotId: mysqlVarchar("robotId", { length: 255 }).notNull(),
  robotName: mysqlVarchar("robotName", { length: 255 }),
  asset: mysqlVarchar("asset", { length: 100 }).notNull(),
  action: mysqlVarchar("action", { length: 50 }).notNull(),
  amount: mysqlDecimal("amount", { precision: 10, scale: 2 }).notNull(),
  payout: mysqlDecimal("payout", { precision: 10, scale: 2 }),
  pnl: mysqlDecimal("pnl", { precision: 10, scale: 2 }),
  result: mysqlVarchar("result", { length: 50 }),
  mode: mysqlVarchar("mode", { length: 50 }),
  isShadow: mysqlBoolean("isShadow").default(false),
  ts: mysqlBigint("ts", { mode: "number" }),
  timestamp: mysqlTimestamp("timestamp").defaultNow(),
});

const pgManagementTrades = pgTable("management_trades", {
  id: pgVarchar("id", { length: 255 }).primaryKey(),
  robotId: pgVarchar("robotId", { length: 255 }).notNull(),
  robotName: pgVarchar("robotName", { length: 255 }),
  asset: pgVarchar("asset", { length: 100 }).notNull(),
  action: pgVarchar("action", { length: 50 }).notNull(),
  amount: pgDecimal("amount", { precision: 10, scale: 2 }).notNull(),
  payout: pgDecimal("payout", { precision: 10, scale: 2 }),
  pnl: pgDecimal("pnl", { precision: 10, scale: 2 }),
  result: pgVarchar("result", { length: 50 }),
  mode: pgVarchar("mode", { length: 50 }),
  isShadow: pgBoolean("isShadow").default(false),
  ts: pgBigint("ts", { mode: "number" }),
  timestamp: pgTimestamp("timestamp").defaultNow(),
});

export const managementTradesTable = isPostgres ? pgManagementTrades : mysqlManagementTrades;

// ── MANAGEMENT PROGRESSION (Soros / Reinvest) ──
const mysqlManagementProgression = mysqlTable("management_progression", {
  id: mysqlVarchar("id", { length: 255 }).primaryKey(),
  robotId: mysqlVarchar("robotId", { length: 255 }).notNull(),
  mode: mysqlVarchar("mode", { length: 50 }).notNull(),
  level: mysqlBigint("level", { mode: "number" }).notNull().default(0),
  lastProfit: mysqlDecimal("lastProfit", { precision: 10, scale: 2 }).notNull().default("0"),
  lastStake: mysqlDecimal("lastStake", { precision: 10, scale: 2 }).notNull().default("0"),
  baseStake: mysqlDecimal("baseStake", { precision: 10, scale: 2 }).notNull().default("0"),
  ts: mysqlBigint("ts", { mode: "number" }),
  timestamp: mysqlTimestamp("timestamp").defaultNow(),
});

const pgManagementProgression = pgTable("management_progression", {
  id: pgVarchar("id", { length: 255 }).primaryKey(),
  robotId: pgVarchar("robotId", { length: 255 }).notNull(),
  mode: pgVarchar("mode", { length: 50 }).notNull(),
  level: pgBigint("level", { mode: "number" }).notNull().default(0),
  lastProfit: pgDecimal("lastProfit", { precision: 10, scale: 2 }).notNull().default("0"),
  lastStake: pgDecimal("lastStake", { precision: 10, scale: 2 }).notNull().default("0"),
  baseStake: pgDecimal("baseStake", { precision: 10, scale: 2 }).notNull().default("0"),
  ts: pgBigint("ts", { mode: "number" }),
  timestamp: pgTimestamp("timestamp").defaultNow(),
});

export const managementProgressionTable = isPostgres ? pgManagementProgression : mysqlManagementProgression;

// ── BACKTEST CANDLES ──
const mysqlBacktestCandles = mysqlTable("backtest_candles", {
  asset: mysqlVarchar("asset", { length: 100 }).primaryKey(),
  candles: mysqlText("candles").notNull(),
  updatedAt: mysqlTimestamp("updated_at").onUpdateNow(),
});

const pgBacktestCandles = pgTable("backtest_candles", {
  asset: pgVarchar("asset", { length: 100 }).primaryKey(),
  candles: pgText("candles").notNull(),
  updatedAt: pgTimestamp("updated_at").defaultNow(),
});

export const backtestCandles = isPostgres ? pgBacktestCandles : mysqlBacktestCandles;
