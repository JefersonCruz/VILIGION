import { describe, expect, it } from "vitest";
import { parseUsdToUnits, unitsToUsdString } from "./token-units.js";
import { THRESHOLD_PRESETS } from "./threshold-presets.js";
import { validateThresholds } from "./threshold-validation.js";

describe("parseUsdToUnits", () => {
  it("converte inteiros, decimais com ponto ou vírgula e 6 casas", () => {
    expect(parseUsdToUnits("1")).toBe(1_000_000n);
    expect(parseUsdToUnits("0,5")).toBe(500_000n);
    expect(parseUsdToUnits("0.5")).toBe(500_000n);
    expect(parseUsdToUnits("1234.567891")).toBe(1_234_567_891n);
    expect(parseUsdToUnits(" 2000 ")).toBe(2_000_000_000n);
  });

  it("rejeita mais de 6 casas, negativos, vazio e lixo", () => {
    for (const bad of ["1.1234567", "-1", "", "abc", "1e6", "1.2.3", "2.000,50", undefined]) {
      expect(parseUsdToUnits(bad)).toBeNull();
    }
  });

  it("não perde precisão em valores grandes", () => {
    expect(parseUsdToUnits("999999999999.999999")).toBe(999_999_999_999_999_999n);
  });
});

describe("unitsToUsdString", () => {
  it("ida e volta sem perda e sem zeros à direita", () => {
    expect(unitsToUsdString(2_000_000_000n)).toBe("2000");
    expect(unitsToUsdString(500_000n)).toBe("0.5");
    expect(unitsToUsdString(1n)).toBe("0.000001");
    expect(unitsToUsdString(parseUsdToUnits("1234.567891")!)).toBe("1234.567891");
  });
});

describe("THRESHOLD_PRESETS", () => {
  it("todos os perfis passam na validação do servidor", () => {
    for (const p of THRESHOLD_PRESETS) {
      expect(
        validateThresholds({
          userId: "u",
          maxBalanceDropPct: p.warnPct,
          criticalBalanceDropPct: p.critPct,
          windowMinutes: p.windowMinutes,
          blockedTransferAlertThreshold: parseUsdToUnits(String(p.blockedWarnUsd))!,
          criticalBlockedTransferThreshold: parseUsdToUnits(String(p.blockedCritUsd))!,
        }),
        p.key,
      ).toBeNull();
    }
  });
});
