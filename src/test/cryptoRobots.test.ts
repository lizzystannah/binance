import { describe, expect, it } from "vitest";
import { useCryptoRobots } from "@/lib/cryptoRobots";

describe("cryptoRobots store — stops diários em USD e resultados", () => {
  it("cria com stops diários, regista trades e repõe por dia", () => {
    const { createRobot, recordTrade, ensureDay, removeRobot } = useCryptoRobots.getState();
    const res = createRobot({
      name: "Robo Teste",
      symbol: "BTCUSDT",
      interval: "15m",
      strategyId: "crypto_rsi_mean_reversion",
      mode: "futures",
      direction: "BOTH",
      leverage: 5,
      marginMode: "isolated",
      capitalAllocated: 1000,
      stakePerEntry: 100,
      dailyStopGainUsd: 50,
      dailyStopLossUsd: 20,
      maxPositions: 2,
      cooldownMin: 30,
    });
    expect(res.ok).toBe(true);
    const id = res.id!;

    let r = useCryptoRobots.getState().robots.find((x) => x.id === id)!;
    expect(r.dailyStopGainUsd).toBe(50);
    expect(r.dailyStopLossUsd).toBe(20);
    expect(r.tradesCount).toBe(0);
    expect(r.pnlUsd).toBe(0);

    recordTrade(id, 10, "2026-01-01");
    recordTrade(id, -4, "2026-01-01");
    r = useCryptoRobots.getState().robots.find((x) => x.id === id)!;
    expect(r.tradesCount).toBe(2);
    expect(r.pnlUsd).toBeCloseTo(6);
    expect(r.dailyPnlUsd).toBeCloseTo(6);
    expect(r.dailyTrades).toBe(2);

    // Novo dia → repõe os diários, mantém o total.
    ensureDay("2026-01-02");
    r = useCryptoRobots.getState().robots.find((x) => x.id === id)!;
    expect(r.dailyTrades).toBe(0);
    expect(r.dailyPnlUsd).toBe(0);
    expect(r.pnlUsd).toBeCloseTo(6);

    removeRobot(id);
    expect(useCryptoRobots.getState().robots.some((x) => x.id === id)).toBe(false);
  });

  it("valida stops diários inválidos", () => {
    const { createRobot } = useCryptoRobots.getState();
    const res = createRobot({
      name: "X",
      symbol: "BTCUSDT",
      interval: "15m",
      strategyId: "crypto_rsi_mean_reversion",
      mode: "futures",
      direction: "BOTH",
      leverage: 5,
      marginMode: "isolated",
      capitalAllocated: 1000,
      stakePerEntry: 100,
      dailyStopGainUsd: -5,
      maxPositions: 2,
      cooldownMin: 30,
    });
    expect(res.ok).toBe(false);
  });
});
