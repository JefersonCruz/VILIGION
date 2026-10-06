import { describe, expect, it } from "vitest";
import { validateThresholds } from "./threshold-validation.js";
import type { UserThresholds } from "./detection-rules.js";

const ok: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 10,
  criticalBalanceDropPct: 30,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 2_000_000_000n,
  criticalBlockedTransferThreshold: 20_000_000_000n,
};

describe("validateThresholds", () => {
  it("aceita um conjunto coerente", () => {
    expect(validateThresholds(ok)).toBeNull();
  });

  it("rejeita crítico menor ou igual ao aviso", () => {
    expect(validateThresholds({ ...ok, criticalBalanceDropPct: 10 })).toMatch(/maior/);
    expect(validateThresholds({ ...ok, criticalBalanceDropPct: 5 })).toMatch(/maior/);
  });

  it("rejeita percentuais fora de 0,1–100 e valores não finitos", () => {
    expect(validateThresholds({ ...ok, maxBalanceDropPct: 0 })).toMatch(/entre/);
    expect(validateThresholds({ ...ok, criticalBalanceDropPct: 101 })).toMatch(/entre/);
    expect(validateThresholds({ ...ok, maxBalanceDropPct: Number.NaN })).toMatch(/números/);
    expect(validateThresholds({ ...ok, windowMinutes: Number.POSITIVE_INFINITY })).toMatch(/números/);
  });

  it("rejeita janela fora de 1–1440 ou não inteira", () => {
    expect(validateThresholds({ ...ok, windowMinutes: 0 })).toMatch(/janela/);
    expect(validateThresholds({ ...ok, windowMinutes: 1441 })).toMatch(/janela/);
    expect(validateThresholds({ ...ok, windowMinutes: 1.5 })).toMatch(/janela/);
  });

  it("rejeita transferência bloqueada negativa ou com crítico <= aviso", () => {
    expect(validateThresholds({ ...ok, blockedTransferAlertThreshold: -1n })).toMatch(/negativo/);
    expect(validateThresholds({ ...ok, criticalBlockedTransferThreshold: ok.blockedTransferAlertThreshold })).toMatch(/maior/);
  });
});
