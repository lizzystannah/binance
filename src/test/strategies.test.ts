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
import { evalStrategy, peekStrategyMeta } from "@/lib/strategyRuntime";

// Código compilado (CommonJS) equivalente ao que o servidor produz.
const CJS_RSI = `"use strict";
const strategy = {
  id: "rsi_custom",
  name: "RSI Custom",
  description: "demo",
  minCandles: 30,
  onSignal: (ctx) => {
    const c = ctx.klines[ctx.klines.length - 1].c;
    const first = ctx.klines[0].c;
    if (c < first) return { action: "LONG", stopGainPct: 2, stopLossPct: 1, reason: "down" };
    return null;
  },
};
module.exports.default = strategy;`;

describe("strategy runtime", () => {
  it("avalia código CommonJS e extrai id/name", () => {
    const { strategy, error } = evalStrategy(CJS_RSI);
    expect(error).toBeUndefined();
    expect(strategy?.id).toBe("rsi_custom");
    expect(strategy?.name).toBe("RSI Custom");
  });

  it("rejeita código sem onSignal", () => {
    const { strategy, error } = evalStrategy("module.exports.default = { id: 'x' };");
    expect(strategy).toBeUndefined();
    expect(error).toBeTruthy();
  });

  it("aceita module.exports direto e export nomeado", () => {
    expect(evalStrategy("const s = { id: 'direct', onSignal: () => null }; module.exports = s;").strategy?.id).toBe("direct");
    expect(evalStrategy("exports.minha = { id: 'named', onSignal: () => null };").strategy?.id).toBe("named");
  });

  it("peekStrategyMeta captura id/name do código", () => {
    const m = peekStrategyMeta(`export default { id: "abc", name: "Nome X", description: "d" };`);
    expect(m.id).toBe("abc");
    expect(m.name).toBe("Nome X");
  });
});

describe("custom strategies (código)", () => {
  it("store: add a partir de código, resolver e remover", () => {
    const { add, remove } = useCustomStrategies.getState();
    const res = add({ code: "// demo", js: CJS_RSI });
    expect(res.ok).toBe(true);
    expect(res.id).toBe("rsi_custom");
    const s = getCustomStrategy("rsi_custom");
    expect(s).toBeDefined();
    expect(listAllStrategies().some((x) => x.id === "rsi_custom")).toBe(true);
    // onSignal vem do código
    const objs = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 100, h: 100, l: 100, c: 100 - i, v: 1 }));
    const sig = s!.onSignal({ symbol: "BTCUSDT", interval: "15m", klines: objs, closes: objs.map((k) => k.c), lastClose: objs[objs.length - 1].c, mode: "futures" });
    expect(sig?.action).toBe("LONG");
    remove("rsi_custom");
    expect(getCustomStrategy("rsi_custom")).toBeUndefined();
  });

  it("store: rejeita código sem id", () => {
    const { add } = useCustomStrategies.getState();
    expect(add({ code: "", js: "module.exports.default = { onSignal: () => null };" }).ok).toBe(false);
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
    expect(applyDirectionAndInvert(long, "long", true)?.action).toBe("SHORT");
    expect(applyDirectionAndInvert(long, "long", false)?.action).toBe("LONG");
    expect(applyDirectionAndInvert(short, "long", false)).toBeNull();
    expect(applyDirectionAndInvert(short, "all", true)?.action).toBe("LONG");
    expect(applyDirectionAndInvert(null, "all", true)).toBeNull();
  });
});
