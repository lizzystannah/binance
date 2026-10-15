import { describe, expect, it } from "vitest";
import {
  applyDirectionAndInvert,
  buildCustomStrategy,
  getCustomStrategy,
  invertCryptoAction,
  listAllStrategies,
  useCustomStrategies,
  type CryptoCandle,
  type CryptoSignal,
} from "@/lib/cryptoStrategies";

function candles(prices: number[]): CryptoCandle[] {
  return prices.map((c, i) => ({ t: i * 60_000, o: c, h: c * 1.001, l: c * 0.999, c, v: 1000 }));
}

const down = Array.from({ length: 60 }, (_, i) => 100 - i * 0.5); // queda estável → RSI baixo
const up = Array.from({ length: 60 }, (_, i) => 70 + i * 0.5); // subida estável → RSI alto

describe("custom strategies", () => {
  it("template RSI: sobrevenda dá LONG com stops da spec", () => {
    const s = buildCustomStrategy({
      id: "custom_t1",
      name: "T",
      description: "",
      template: "rsi_reversao",
      timeframes: ["15m"],
      params: { rsiLen: 14, oversold: 30, overbought: 70 },
      stopGainPct: 3,
      stopLossPct: 1.2,
      createdAt: 0,
    });
    const sig = s.onSignal({
      symbol: "BTCUSDT",
      interval: "15m",
      klines: candles(down),
      closes: down,
      lastClose: down[down.length - 1],
      mode: "futures",
    });
    expect(sig?.action).toBe("LONG");
    expect(sig?.stopGainPct).toBe(3);
    expect(sig?.stopLossPct).toBe(1.2);
  });

  it("template RSI: sobrecompra dá SHORT", () => {
    const s = buildCustomStrategy({
      id: "custom_t2",
      name: "T",
      description: "",
      template: "rsi_reversao",
      timeframes: ["15m"],
      params: { rsiLen: 14, oversold: 30, overbought: 70 },
      stopGainPct: 3,
      stopLossPct: 1.2,
      createdAt: 0,
    });
    const sig = s.onSignal({
      symbol: "BTCUSDT",
      interval: "15m",
      klines: candles(up),
      closes: up,
      lastClose: up[up.length - 1],
      mode: "futures",
    });
    expect(sig?.action).toBe("SHORT");
  });

  it("ema_cross inválida (fast>=slow) nunca sinaliza", () => {
    const s = buildCustomStrategy({
      id: "custom_t3",
      name: "T",
      description: "",
      template: "ema_cross",
      timeframes: ["15m"],
      params: { fast: 21, slow: 21 },
      stopGainPct: 2,
      stopLossPct: 1,
      createdAt: 0,
    });
    const sig = s.onSignal({
      symbol: "BTCUSDT",
      interval: "15m",
      klines: candles(up),
      closes: up,
      lastClose: up[up.length - 1],
      mode: "futures",
    });
    expect(sig).toBeNull();
  });

  it("store: criar, resolver via getCustomStrategy e remover", () => {
    const { create, remove } = useCustomStrategies.getState();
    const res = create({
      name: "Minha RSI",
      template: "rsi_reversao",
      timeframes: ["15m"],
      params: { rsiLen: 14, oversold: 30, overbought: 70 },
      stopGainPct: 3,
      stopLossPct: 1.2,
    });
    expect(res.ok).toBe(true);
    expect(getCustomStrategy(res.id!)).toBeDefined();
    expect(listAllStrategies().some((s) => s.id === res.id)).toBe(true);
    remove(res.id!);
    expect(getCustomStrategy(res.id!)).toBeUndefined();
  });

  it("store: rejeita spec inválida", () => {
    const { create } = useCustomStrategies.getState();
    expect(create({ name: "", template: "rsi_reversao", timeframes: ["15m"], params: {}, stopGainPct: 3, stopLossPct: 1 }).ok).toBe(false);
    expect(create({ name: "X", template: "rsi_reversao", timeframes: [], params: {}, stopGainPct: 3, stopLossPct: 1 }).ok).toBe(false);
  });

  it("invertCryptoAction troca LONG↔SHORT e BUY↔SELL", () => {
    expect(invertCryptoAction("LONG")).toBe("SHORT");
    expect(invertCryptoAction("SHORT")).toBe("LONG");
    expect(invertCryptoAction("BUY")).toBe("SHORT");
    expect(invertCryptoAction("SELL")).toBe("LONG");
    expect(invertCryptoAction("EXIT")).toBe("EXIT");
    expect(invertCryptoAction("FLAT")).toBe("FLAT");
  });

  it("applyDirectionAndInvert: direção filtra o sinal natural, invert é o passo final", () => {
    const long: CryptoSignal = { action: "LONG", stopGainPct: 3, stopLossPct: 1, reason: "x" };
    const short: CryptoSignal = { action: "SHORT", stopGainPct: 3, stopLossPct: 1, reason: "x" };
    // Direção "long" + invert: LONG natural passa o filtro e é invertido -> SHORT.
    expect(applyDirectionAndInvert(long, "long", true)?.action).toBe("SHORT");
    // Direção "long" sem invert: LONG.
    expect(applyDirectionAndInvert(long, "long", false)?.action).toBe("LONG");
    // Direção "long": SHORT natural é rejeitado.
    expect(applyDirectionAndInvert(short, "long", false)).toBeNull();
    // Sem direção + invert: SHORT natural -> LONG.
    expect(applyDirectionAndInvert(short, "all", true)?.action).toBe("LONG");
    // Sem sinal -> null.
    expect(applyDirectionAndInvert(null, "all", true)).toBeNull();
  });
});
