import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("aceita a senha correta", () => {
    const hash = hashPassword("uma-senha-forte-qualquer");
    expect(verifyPassword("uma-senha-forte-qualquer", hash)).toBe(true);
  });

  it("rejeita senha incorreta", () => {
    const hash = hashPassword("uma-senha-forte-qualquer");
    expect(verifyPassword("senha-errada", hash)).toBe(false);
  });

  it("duas senhas iguais geram hashes diferentes (salt único)", () => {
    const hashA = hashPassword("mesma-senha");
    const hashB = hashPassword("mesma-senha");
    expect(hashA).not.toBe(hashB);
  });

  it("rejeita input malformado sem lançar exceção", () => {
    expect(verifyPassword("qualquer", "formato-invalido-sem-dois-pontos")).toBe(false);
  });
});
