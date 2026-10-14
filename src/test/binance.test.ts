import { describe, it, expect } from "vitest";
import {
  getMinNotional,
  mostTraded,
  potentialNewListings,
  topMovers,
  validateSpotOrderQty,
  type BinanceSpotSymbol,
  type BinanceTicker24h,
} from "@/lib/binance";

const sym = (filters: BinanceSpotSymbol["filters"]): BinanceSpotSymbol => ({
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  status: "TRADING",
  filters,
});

const tick = (symbol: string, priceChangePercent: number, quoteVolume: number): BinanceTicker24h => ({
  symbol,
  lastPrice: 100,
  priceChange: 1,
  priceChangePercent,
  highPrice: 110,
  lowPrice: 90,
  volume: 10,
  quoteVolume,
  openPrice: 99,
  prevClosePrice: 99,
  count: 100,
});

describe("binance.ts — camada pública Fase 1", () => {
  it("getMinNotional lê NOTIONAL (formato atual) e MIN_NOTIONAL (legado)", () => {
    expect(getMinNotional(sym([{ filterType: "NOTIONAL", minNotional: "5" }]))).toBe(5);
    expect(getMinNotional(sym([{ filterType: "MIN_NOTIONAL", minNotional: "7" }]))).toBe(7);
    expect(getMinNotional(sym([]))).toBe(10); // fallback conservador
  });

  it("validateSpotOrderQty aplica PRICE_FILTER + LOT_SIZE + NOTIONAL", () => {
    const s = sym([
      { filterType: "PRICE_FILTER", minPrice: "1", maxPrice: "1000", tickSize: "0.01" },
      { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "100", stepSize: "0.001" },
      { filterType: "NOTIONAL", minNotional: "10" },
    ]);
    expect(validateSpotOrderQty(s, 100, 1).ok).toBe(true);
    expect(validateSpotOrderQty(s, 0.5, 1).ok).toBe(false); // abaixo minPrice
    expect(validateSpotOrderQty(s, 100.005, 1).ok).toBe(false); // fora do tick
    expect(validateSpotOrderQty(s, 100, 0.0005).ok).toBe(false); // abaixo minQty
    expect(validateSpotOrderQty(s, 100, 0.0005 + 0.00005).ok).toBe(false); // fora do step
    expect(validateSpotOrderQty(s, 100, 0.05).ok).toBe(false); // notional 5 < 10
    expect(validateSpotOrderQty(s, 100, 200).ok).toBe(false); // acima maxQty
  });

  it("topMovers / mostTraded / potentialNewListings ordenam sem mutar", () => {
    const ts = [tick("AUSDT", 5, 300), tick("BUSDT", -8, 100), tick("CUSDT", 12, 200)];
    expect(topMovers(ts, 2, "up").map((t) => t.symbol)).toEqual(["CUSDT", "AUSDT"]);
    expect(topMovers(ts, 1, "down").map((t) => t.symbol)).toEqual(["BUSDT"]);
    expect(mostTraded(ts, 1)[0].symbol).toBe("AUSDT");
    expect(potentialNewListings(ts, 1)[0].symbol).toBe("BUSDT"); // menor volume
    expect(ts.map((t) => t.symbol)).toEqual(["AUSDT", "BUSDT", "CUSDT"]); // sem mutação
  });
});
