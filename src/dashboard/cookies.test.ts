import { describe, expect, it } from "vitest";
import { buildExpiredSessionCookie, buildSessionCookie, parseCookies } from "./cookies.js";

describe("parseCookies", () => {
  it("parseia múltiplos cookies separados por ponto e vírgula", () => {
    expect(parseCookies("a=1; b=2; viligion_session=tok123")).toEqual({
      a: "1",
      b: "2",
      viligion_session: "tok123",
    });
  });

  it("devolve objeto vazio sem header", () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it("decodifica valor com URI encoding", () => {
    expect(parseCookies("x=a%20b")).toEqual({ x: "a b" });
  });
});

describe("buildSessionCookie", () => {
  it("é HttpOnly - nunca legível por JS no cliente, mitiga roubo via XSS", () => {
    expect(buildSessionCookie("tok123", 1800)).toMatch(/HttpOnly/);
  });

  it("é Secure - nunca mandado por HTTP puro, só HTTPS (achado de auditoria de 2026-10-04)", () => {
    expect(buildSessionCookie("tok123", 1800)).toMatch(/Secure/);
    expect(buildExpiredSessionCookie()).toMatch(/Secure/);
  });

  it("inclui o token e o Max-Age informado", () => {
    const cookie = buildSessionCookie("tok123", 1800);
    expect(cookie).toContain("viligion_session=tok123");
    expect(cookie).toContain("Max-Age=1800");
  });
});

describe("buildExpiredSessionCookie", () => {
  it("expira imediatamente (Max-Age=0) - usado no logout", () => {
    expect(buildExpiredSessionCookie()).toMatch(/Max-Age=0/);
  });
});
