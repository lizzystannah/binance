import { describe, it, expect } from "vitest";
import {
  buyCost,
  calcTpSlPrices,
  closePnl,
  evaluateTpSl,
} from "@/lib/cryptoPaper";

describe("cryptoPaper — matemática do motor", () => {
  it("calcTpSlPrices exige SL < entrada < TP", () => {
    const r = calcTpSlPrices(100, 3, 1.5);
    expect(r.ok).toBe(true);
    expect(r.tp).toBeCloseTo(103, 8);
    expect(r.sl).toBeCloseTo(98.5, 8);
    expect(calcTpSlPrices(100, 0, 1).ok).toBe(false);
    expect(calcTpSlPrices(100, 3, 0).ok).toBe(false);
    expect(calcTpSlPrices(-5, 3, 1).ok).toBe(false);
  });

  it("evaluateTpSl prefere STOP quando a vela toca nos dois (conservador)", () => {
    expect(evaluateTpSl(103, 98, 110, 90)).toBe("STOP_LOSS");
    expect(evaluateTpSl(103, 98, 110, 99)).toBe("TAKE_PROFIT");
    expect(evaluateTpSl(103, 98, 102, 99)).toBe(null);
  });

  it("buyCost + closePnl contabilizam taxas dos dois lados", () => {
    const { total, fee } = buyCost(100, 1, 0.001);
    expect(total).toBeCloseTo(100.1, 8);
    expect(fee).toBeCloseTo(0.1, 8);
    // WIN: vende a 103
    const w = closePnl(100, 1, 103, 0.1, 0.001);
    expect(w.pnl).toBeCloseTo(103 - 100 - 0.1 - 0.103, 8);
    // LOSS: vende a 98
    const l = closePnl(100, 1, 98, 0.1, 0.001);
    expect(l.pnl).toBeCloseTo(98 - 100 - 0.1 - 0.098, 8);
    expect(l.pnl).toBeLessThan(0);
  });
});
