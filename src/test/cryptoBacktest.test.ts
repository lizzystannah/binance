import { describe, it, expect } from "vitest";
import { runCryptoBacktest } from "@/lib/cryptoBacktest";
import type { CryptoSpotCandle, CryptoSpotStrategy } from "@/lib/cryptoStrategies";

// Estratégia de teste determinística: compra SEMPRE no primeiro sinal possível.
const alwaysBuy: CryptoSpotStrategy = {
  id: "test_always_buy",
  name: "Test Always Buy",
  description: "Compra sempre (só para testes).",
  minCandles: 5,
  defaults: { stopGainPct: 1000, stopLossPct: 1000 }, // TP/SL inalcançáveis
  onSignal: () => ({ action: "BUY", stopGainPct: 1000, stopLossPct: 1000, reason: "test" }),
};

function candle(t: number, o: number, h: number, l: number, c: number): CryptoSpotCandle {
  return { t, o, h, l, c, v: 100 };
}

describe("cryptoBacktest — honestidade", () => {
  it("sem velas suficientes → zero trades", () => {
    const klines = [1, 2, 3].map((i) => candle(i, 100, 101, 99, 100));
    const r = runCryptoBacktest(klines, alwaysBuy, { capital: 1000, stakePerEntry: 100 });
    expect(r.totalTrades).toBe(0);
    expect(r.finalEquity).toBe(1000);
  });

  it("fill na abertura seguinte ao sinal (sem lookahead)", () => {
    // 6 velas planas a 100 + salto na abertura da 8ª vela.
    const klines = [
      candle(1, 100, 100.5, 99.5, 100),
      candle(2, 100, 100.5, 99.5, 100),
      candle(3, 100, 100.5, 99.5, 100),
      candle(4, 100, 100.5, 99.5, 100),
      candle(5, 100, 100.5, 99.5, 100),
      candle(6, 100, 100.5, 99.5, 100),
      candle(7, 100, 100.5, 99.5, 100),
      candle(8, 110, 110.5, 109.5, 110),
      candle(9, 110, 110.5, 109.5, 110),
      candle(10, 110, 110.5, 109.5, 110),
    ];
    const r = runCryptoBacktest(klines, alwaysBuy, {
      capital: 10000,
      stakePerEntry: 1000,
      feeRate: 0,
      slippageRate: 0,
    });
    // Sinal no fecho da vela 6 (índice 5) → fill na abertura da vela 7 (=100, não 110).
    expect(r.totalTrades).toBeGreaterThan(0);
    expect(r.trades[0].entryPrice).toBe(100);
  });

  it("stop-loss antes de take-profit na mesma vela", () => {
    const killer: CryptoSpotStrategy = {
      ...alwaysBuy,
      id: "test_killer",
      onSignal: () => ({ action: "BUY", stopGainPct: 1, stopLossPct: 1, reason: "test" }),
    };
    const klines = [
      candle(1, 100, 100.1, 99.9, 100),
      candle(2, 100, 100.1, 99.9, 100),
      candle(3, 100, 100.1, 99.9, 100),
      candle(4, 100, 100.1, 99.9, 100),
      candle(5, 100, 100.1, 99.9, 100),
      candle(6, 100, 100.1, 99.9, 100),
      // Vela toca SL (99) e TP (101) — deve sair no SL.
      candle(7, 100, 101, 99, 100.5),
      candle(8, 100.5, 101, 100, 100.5),
      candle(9, 100.5, 101, 100, 100.5),
      candle(10, 100.5, 101, 100, 100.5),
    ];
    const r = runCryptoBacktest(klines, killer, {
      capital: 10000,
      stakePerEntry: 1000,
      feeRate: 0,
      slippageRate: 0,
    });
    expect(r.totalTrades).toBeGreaterThan(0);
    expect(r.trades[0].reason).toBe("STOP_LOSS");
    expect(r.trades[0].pnl).toBeLessThan(0);
  });

  it("round-trip a preço plano custa exatamente as 2 taxas (sem duplo-desconto)", () => {
    const flat = Array.from({ length: 10 }, (_, i) => candle(i, 100, 100, 100, 100));
    const r = runCryptoBacktest(flat, alwaysBuy, {
      capital: 10000,
      stakePerEntry: 1000,
      feeRate: 0.001,
      slippageRate: 0,
    });
    expect(r.totalTrades).toBeGreaterThan(0);
    // entryFee (1) + exitFee (1) = 2; a taxa de entrada não pode ser contada 2×.
    expect(r.finalEquity).toBeCloseTo(9998, 6);
  });

  it("expõe TP/SL e taxas por trade (para o gráfico e estatísticas)", () => {
    const killer: CryptoSpotStrategy = {
      ...alwaysBuy,
      id: "test_tpsl",
      onSignal: () => ({ action: "BUY", stopGainPct: 1, stopLossPct: 1, reason: "test" }),
    };
    const klines = [
      ...Array.from({ length: 6 }, (_, i) => candle(i, 100, 100.1, 99.9, 100)),
      candle(7, 100, 101, 99, 100.5),
      candle(8, 100.5, 101, 100, 100.5),
      candle(9, 100.5, 101, 100, 100.5),
      candle(10, 100.5, 101, 100, 100.5),
    ];
    const r = runCryptoBacktest(klines, killer, {
      capital: 10000,
      stakePerEntry: 1000,
      feeRate: 0.001,
      slippageRate: 0,
    });
    expect(r.totalTrades).toBeGreaterThan(0);
    const t = r.trades[0];
    // fill = 100; TP 1% acima, SL 1% abaixo.
    expect(t.takeProfitPrice).toBeCloseTo(101, 6);
    expect(t.stopLossPrice).toBeCloseTo(99, 6);
    expect(t.feesPaid).toBeGreaterThan(0);
    expect(t.fundingPaid).toBe(0);
  });

  it("spread bid-ask aumenta o custo (pnl pior) e é registado por trade", () => {
    const killer: CryptoSpotStrategy = {
      ...alwaysBuy,
      id: "test_spread",
      onSignal: () => ({ action: "BUY", stopGainPct: 1, stopLossPct: 1, reason: "test" }),
    };
    const klines = [
      ...Array.from({ length: 6 }, (_, i) => candle(i, 100, 100.1, 99.9, 100)),
      candle(7, 100, 101, 99, 100.5),
      candle(8, 100.5, 101, 100, 100.5),
      candle(9, 100.5, 101, 100, 100.5),
      candle(10, 100.5, 101, 100, 100.5),
    ];
    const base = { capital: 10000, stakePerEntry: 1000, feeRate: 0, slippageRate: 0 };
    const noSpread = runCryptoBacktest(klines, killer, base);
    const withSpread = runCryptoBacktest(klines, killer, { ...base, spreadPct: 0.05, leverage: 5 });
    expect(withSpread.trades[0].spreadPaid).toBeGreaterThan(0);
    expect(withSpread.trades[0].pnl).toBeLessThan(noSpread.trades[0].pnl);
  });

  it("trailing fecha o trade antes do SL; sem trailing só sai no fim dos dados", () => {
    const withTrail: CryptoSpotStrategy = {
      ...alwaysBuy,
      id: "test_trail",
      onSignal: () => ({ action: "BUY", stopGainPct: 1000, stopLossPct: 1000, trailingPct: 1, reason: "t" }),
    };
    const noTrail: CryptoSpotStrategy = {
      ...alwaysBuy,
      id: "test_notrail",
      onSignal: () => ({ action: "BUY", stopGainPct: 1000, stopLossPct: 1000, reason: "t" }),
    };
    const klines = [
      ...Array.from({ length: 6 }, (_, i) => candle(i, 100, 100, 100, 100)),
      candle(6, 100, 110, 100, 110), // sobe até 110
      candle(7, 110, 110, 105, 106), // recua
      ...Array.from({ length: 4 }, (_, i) => candle(8 + i, 106, 106, 100, 100)),
    ];
    const opts = { capital: 10000, stakePerEntry: 1000, feeRate: 0, slippageRate: 0 };
    expect(runCryptoBacktest(klines, withTrail, opts).trades[0].reason).toBe("TRAILING");
    expect(runCryptoBacktest(klines, noTrail, opts).trades[0].reason).toBe("END_OF_DATA");
  });
});
