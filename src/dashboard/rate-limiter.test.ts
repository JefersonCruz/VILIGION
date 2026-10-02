import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  it("permite até o máximo de tentativas configurado", () => {
    const limiter = new RateLimiter(3, 60_000);
    const now = Date.now();

    expect(limiter.attempt("user-1", now)).toBe(true);
    expect(limiter.attempt("user-1", now)).toBe(true);
    expect(limiter.attempt("user-1", now)).toBe(true);
    expect(limiter.attempt("user-1", now)).toBe(false); // 4ª tentativa bloqueada
  });

  it("libera de novo depois da janela expirar", () => {
    const limiter = new RateLimiter(1, 1000);
    const now = Date.now();

    expect(limiter.attempt("user-1", now)).toBe(true);
    expect(limiter.attempt("user-1", now)).toBe(false);
    expect(limiter.attempt("user-1", now + 1001)).toBe(true);
  });

  it("identificadores diferentes têm janelas independentes", () => {
    const limiter = new RateLimiter(1, 60_000);
    const now = Date.now();

    expect(limiter.attempt("user-1", now)).toBe(true);
    expect(limiter.attempt("user-2", now)).toBe(true);
  });

  it("reset() libera a janela imediatamente, sem esperar expirar", () => {
    const limiter = new RateLimiter(1, 60_000);
    const now = Date.now();

    expect(limiter.attempt("user-1", now)).toBe(true);
    expect(limiter.attempt("user-1", now)).toBe(false);

    limiter.reset("user-1");
    expect(limiter.attempt("user-1", now)).toBe(true);
  });
});
