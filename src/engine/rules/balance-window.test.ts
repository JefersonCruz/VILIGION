import { describe, expect, it } from "vitest";
import { BalanceWindow } from "./balance-window.js";
import type { UserThresholds } from "./detection-rules.js";

const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 10,
  criticalBalanceDropPct: 30,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1n,
  criticalBlockedTransferThreshold: 10n,
};

const min = (m: number) => new Date(m * 60_000);

describe("BalanceWindow", () => {
  it("queda súbita entre dois pontos continua alertando (compatível com o comportamento antigo)", () => {
    const w = new BalanceWindow();
    expect(w.evaluate(1000n, min(0), thresholds)).toBeNull();
    const e = w.evaluate(600n, min(1), thresholds);
    expect(e).toMatchObject({ kind: "balance-drop", severity: "critical" });
  });

  it("dreno gradual (4 quedas de 3% em 40 min) soma e dispara, o que a comparação par-a-par nunca pegaria", () => {
    const w = new BalanceWindow();
    const steps = [1000n, 970n, 940n, 910n, 880n]; // cada passo < 10%; acumulado 12%
    const events = steps.map((b, i) => w.evaluate(b, min(i * 10), thresholds));
    expect(events.slice(0, 4).every((e) => e === null)).toBe(true);
    expect(events[4]).toMatchObject({ kind: "balance-drop", severity: "normal" });
  });

  it("a mesma queda acumulada fora da janela não dispara", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    expect(w.evaluate(850n, min(61), thresholds)).toBeNull(); // pico de 1000 já saiu da janela de 60 min
  });

  it("saldo que sobe e depois cai é medido contra o pico, não contra o início", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    w.evaluate(2000n, min(5), thresholds);
    expect(w.evaluate(1500n, min(6), thresholds)).toMatchObject({ kind: "balance-drop", severity: "normal" }); // 25% do pico
  });

  it("histórico vazio ou saldo zero não alertam nem quebram", () => {
    const w = new BalanceWindow();
    expect(w.evaluate(0n, min(0), thresholds)).toBeNull();
    expect(w.evaluate(0n, min(1), thresholds)).toBeNull();
  });

  it("não repete o alerta a cada ciclo pelo mesmo evento", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    expect(w.evaluate(850n, min(1), thresholds)).not.toBeNull(); // 15%
    expect(w.evaluate(850n, min(2), thresholds)).toBeNull();
    expect(w.evaluate(845n, min(3), thresholds)).toBeNull();
  });

  it("escalar de normal para crítico alerta de novo", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    expect(w.evaluate(850n, min(1), thresholds)?.severity).toBe("normal");
    expect(w.evaluate(650n, min(2), thresholds)?.severity).toBe("critical");
  });

  it("depois de se recuperar bem abaixo do limiar, um novo evento volta a alertar", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    expect(w.evaluate(850n, min(1), thresholds)).not.toBeNull();
    expect(w.evaluate(1000n, min(2), thresholds)).toBeNull(); // recuperou
    expect(w.evaluate(850n, min(3), thresholds)).not.toBeNull();
  });

  it("forgetLastAlert permite tentar o mesmo alerta de novo se o despacho falhou", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    expect(w.evaluate(850n, min(1), thresholds)).not.toBeNull();
    w.forgetLastAlert();
    expect(w.evaluate(850n, min(2), thresholds)).not.toBeNull();
  });

  it("reduzir a janela em tempo de execução passa a valer na hora", () => {
    const w = new BalanceWindow();
    w.evaluate(1000n, min(0), thresholds);
    expect(w.evaluate(950n, min(30), { ...thresholds, windowMinutes: 10 })).toBeNull(); // pico fora da janela de 10 min
  });
});
