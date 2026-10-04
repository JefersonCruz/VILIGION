import { describe, expect, it } from "vitest";
import { checkPin, generatePin } from "./pin.js";

describe("pin", () => {
  it("gera PIN de 4 dígitos atrelado ao alertId, sem tentativa nenhuma ainda", () => {
    const pending = generatePin("alert-123");
    expect(pending.alertId).toBe("alert-123");
    expect(pending.pin).toMatch(/^\d{4}$/);
    expect(pending.consumed).toBe(false);
    expect(pending.attempts).toBe(0);
  });

  it("aceita PIN correto dentro do prazo", () => {
    const pending = generatePin("alert-1");
    expect(checkPin(pending, pending.pin)).toBe("valid");
  });

  it("rejeita PIN incorreto", () => {
    const pending = generatePin("alert-1");
    const wrong = pending.pin === "0000" ? "1111" : "0000";
    expect(checkPin(pending, wrong)).toBe("invalid");
  });

  it("rejeita PIN expirado", () => {
    const pending = generatePin("alert-1");
    const future = new Date(pending.expiresAt.getTime() + 1000);
    expect(checkPin(pending, pending.pin, future)).toBe("expired");
  });

  it("rejeita PIN já consumido, mesmo se correto", () => {
    const pending = generatePin("alert-1");
    pending.consumed = true;
    expect(checkPin(pending, pending.pin)).toBe("already-consumed");
  });

  it("trava depois de 3 tentativas erradas, mesmo se a 4ª tentativa acertar o PIN", () => {
    const pending = generatePin("alert-1");
    const wrong = pending.pin === "0000" ? "1111" : "0000";

    pending.attempts++;
    pending.attempts++;
    pending.attempts++;

    expect(checkPin(pending, pending.pin)).toBe("locked"); // nem o PIN certo passa depois do limite
    expect(checkPin(pending, wrong)).toBe("locked");
  });

  it("rejeita PIN com tamanho diferente sem lançar erro (timingSafeEqual exige buffers iguais)", () => {
    const pending = generatePin("alert-1");
    expect(checkPin(pending, "123")).toBe("invalid");
    expect(checkPin(pending, "12345")).toBe("invalid");
  });
});
