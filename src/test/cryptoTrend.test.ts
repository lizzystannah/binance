import { describe, expect, it } from "vitest";
import { buildPortfolio, computeTrendScore, type TrendScore } from "@/lib/cryptoTrend";
import type { BinanceKline, BinanceTicker24h } from "@/lib/binance";

function mkKlines(closes: number[], vol = 100): BinanceKline[] {
  return closes.map((c, i) => ({
    t: i * 3_600_000,
    o: i === 0 ? c : closes[i - 1],
    h: Math.max(c, i === 0 ? c : closes[i - 1]) * 1.001,
    l: Math.min(c, i === 0 ? c : closes[i - 1]) * 0.999,
    c,
    v: vol,
    closeTime: i * 3_600_000 + 3_600_000,
    quoteVolume: vol * c,
  }));
}

const ticker: BinanceTicker24h = {
  symbol: "TESTUSDT",
  lastPrice: 100,
  priceChange: 5,
  priceChangePercent: 12,
  highPrice: 101,
  lowPrice: 90,
  volume: 1000,
  quoteVolume: 500_000_000,
  openPrice: 89,
  prevClosePrice: 95,
  count: 1000,
};

describe("cryptoTrend", () => {
  it("score de tendência alta para série em subida persistente", () => {
    const up = Array.from({ length: 168 }, (_, i) => 100 * Math.pow(1.004, i));
    const s = computeTrendScore("TESTUSDT", mkKlines(up), ticker, 0.0001);
    expect(s.score).toBeGreaterThan(60);
    expect(s.factors).toHaveLength(7);
    expect(s.factors.reduce((a, f) => a + f.weight, 0)).toBe(100);
  });

  it("score baixo para série em queda", () => {
    const down = Array.from({ length: 168 }, (_, i) => 100 * Math.pow(0.996, i));
    const s = computeTrendScore("TESTUSDT", mkKlines(down), ticker, 0.0001);
    expect(s.score).toBeLessThan(45);
  });

  it("portfólio top-5 soma 100% e respeita o teto por ativo", () => {
    const scores: TrendScore[] = [90, 88, 85, 80, 78, 40].map((score, i) => ({
      symbol: `S${i}USDT`,
      score,
      price: 1,
      change24hPct: 0,
      quoteVolume: 0,
      atrPct: 1,
      factors: [],
      updatedAt: 0,
    }));
    const pf = buildPortfolio(scores, 1000, 5, 35);
    expect(pf).toHaveLength(5);
    expect(pf.every((p) => p.weightPct <= 35.0001)).toBe(true);
    const sumPct = pf.reduce((a, p) => a + p.weightPct, 0);
    const sumUsd = pf.reduce((a, p) => a + p.amountUsdt, 0);
    expect(Math.abs(sumPct - 100)).toBeLessThan(0.01);
    expect(Math.abs(sumUsd - 1000)).toBeLessThan(0.01);
  });

  it("portfólio vazio sem scores", () => {
    expect(buildPortfolio([], 1000)).toEqual([]);
  });
});
