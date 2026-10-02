import { describe, expect, it } from "vitest";
import { buildOtpAuthUri, generateBase32Secret, generateTotp, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("código gerado no instante T valida nesse mesmo instante", () => {
    const secret = generateBase32Secret();
    const now = new Date();
    const code = generateTotp(secret, now);

    expect(verifyTotp(secret, code, { time: now })).toBe(true);
  });

  it("rejeita código incorreto", () => {
    const secret = generateBase32Secret();
    const now = new Date();
    const code = generateTotp(secret, now);
    const wrong = code === "000000" ? "111111" : "000000";

    expect(verifyTotp(secret, wrong, { time: now })).toBe(false);
  });

  it("aceita dentro da janela de tolerância de ±1 passo (±30s)", () => {
    const secret = generateBase32Secret();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const code = generateTotp(secret, t0);

    const t1 = new Date(t0.getTime() + 30_000); // 1 passo à frente
    expect(verifyTotp(secret, code, { time: t1, windowSteps: 1 })).toBe(true);
  });

  it("rejeita fora da janela de tolerância", () => {
    const secret = generateBase32Secret();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const code = generateTotp(secret, t0);

    const muitoDepois = new Date(t0.getTime() + 5 * 60_000); // 5 minutos depois
    expect(verifyTotp(secret, code, { time: muitoDepois, windowSteps: 1 })).toBe(false);
  });

  it("segredos diferentes produzem códigos diferentes no mesmo instante", () => {
    const now = new Date();
    const codeA = generateTotp(generateBase32Secret(), now);
    const codeB = generateTotp(generateBase32Secret(), now);

    // probabilisticamente quase sempre diferentes - colisão de 6 dígitos é rara o suficiente pra não ser flaky
    expect(codeA).not.toBe(codeB);
  });

  it("gera uma otpauth:// URI válida pra setup em app autenticador", () => {
    const secret = generateBase32Secret();
    const uri = buildOtpAuthUri({ secret, accountName: "demo@viligion", issuer: "VILIGION" });

    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(`secret=${secret}`);
  });
});
