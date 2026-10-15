import { describe, expect, it } from "vitest";
import {
  buildDiscoveryPayload,
  parseDiscoveryResponse,
  type TriageCandidate,
} from "@/lib/discovery";

const cand: TriageCandidate = {
  symbol: "XYZUSDT",
  price: 1.23,
  change24hPct: 12.5,
  quoteVolume: 5_000_000,
  mom7dPct: 30,
  volumeSurge: 2.1,
  rsi14: 62,
  atrPct: 3.1,
  nearHigh7d: true,
  score: 78.5,
  reasons: ["momentum 7d +30.0%"],
  futuresEligible: true,
};

describe("discovery webhook contract", () => {
  it("monta payload v1 com 1 candidata", () => {
    const p = buildDiscoveryPayload([cand]);
    expect(p.version).toBe(1);
    expect(p.universe).toBe("spot-usdt");
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0].symbol).toBe("XYZUSDT");
    expect(p.candidates[0].futuresEligible).toBe(true);
  });

  it("aceita { picks } e limita ao top-5", () => {
    const picks = Array.from({ length: 7 }, (_, i) => ({
      symbol: `A${i}USDT`,
      direction: "UP",
      confidence: 80,
      thesis: "t",
      catalysts: [],
      risks: [],
      invalidation: "",
    }));
    const { picks: out, error } = parseDiscoveryResponse({ picks });
    expect(error).toBeUndefined();
    expect(out).toHaveLength(5);
  });

  it("rejeita resposta sem picks", () => {
    const { picks, error } = parseDiscoveryResponse({ foo: 1 });
    expect(picks).toHaveLength(0);
    expect(error).toBeTruthy();
  });
});
