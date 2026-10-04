import { describe, expect, it } from "vitest";
import { isValidEmail, isValidPhone } from "./recipient-validation.js";

describe("isValidPhone", () => {
  it("aceita E.164 válido", () => {
    expect(isValidPhone("+5511999999999")).toBe(true);
    expect(isValidPhone("+14155238886")).toBe(true);
  });

  it("aceita com espaço em volta (trim)", () => {
    expect(isValidPhone("  +5511999999999  ")).toBe(true);
  });

  it("rejeita sem o +", () => {
    expect(isValidPhone("5511999999999")).toBe(false);
  });

  it("rejeita com zero logo após o +", () => {
    expect(isValidPhone("+0511999999999")).toBe(false);
  });

  it("rejeita com letras ou símbolos", () => {
    expect(isValidPhone("+55119999-9999")).toBe(false);
    expect(isValidPhone("+55abc9999999")).toBe(false);
  });

  it("rejeita curto demais ou longo demais", () => {
    expect(isValidPhone("+551199")).toBe(false);
    expect(isValidPhone("+5511999999999999999")).toBe(false);
  });

  it("rejeita vazio", () => {
    expect(isValidPhone("")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("aceita e-mail com formato razoável", () => {
    expect(isValidEmail("dono@exemplo.com")).toBe(true);
    expect(isValidEmail("dono.sobrenome@exemplo.com.br")).toBe(true);
  });

  it("aceita com espaço em volta (trim)", () => {
    expect(isValidEmail("  dono@exemplo.com  ")).toBe(true);
  });

  it("rejeita sem @", () => {
    expect(isValidEmail("doneexemplo.com")).toBe(false);
  });

  it("rejeita sem domínio com ponto", () => {
    expect(isValidEmail("dono@exemplo")).toBe(false);
  });

  it("rejeita com espaço no meio", () => {
    expect(isValidEmail("dono @exemplo.com")).toBe(false);
  });

  it("rejeita vazio", () => {
    expect(isValidEmail("")).toBe(false);
  });
});
