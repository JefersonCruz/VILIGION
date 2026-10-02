import { describe, expect, it } from "vitest";
import { assertNoSensitiveData, buildAlertMessage } from "./alert-content-policy.js";

describe("alert-content-policy", () => {
  it("mensagens padrão nunca contêm dado sensível", () => {
    const dropMsg = buildAlertMessage({
      kind: "balance-drop",
      userId: "user-1",
      pctDropped: 42,
      windowMinutes: 10,
    });
    const redirectMsg = buildAlertMessage({
      kind: "transfer-blocked",
      userId: "user-1",
      amount: 500_000_000n,
      blockedNonce: 7n,
    });

    expect(() => assertNoSensitiveData(dropMsg)).not.toThrow();
    expect(() => assertNoSensitiveData(redirectMsg)).not.toThrow();
  });

  it("detecta regressão: mensagem com endereço deve falhar", () => {
    const bad = "Sua carteira 0x1234567890abcdef1234567890abcdef12345678 teve queda de saldo.";
    expect(() => assertNoSensitiveData(bad)).toThrow();
  });

  it("detecta regressão: mensagem com valor monetário deve falhar", () => {
    const bad = "Sua tesouraria caiu $5000 USDC nos últimos 10 minutos.";
    expect(() => assertNoSensitiveData(bad)).toThrow();
  });
});
