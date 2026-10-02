import { describe, expect, it } from "vitest";
import { SessionStore } from "./session.js";

describe("SessionStore", () => {
  it("valida um token recém-criado", () => {
    const store = new SessionStore();
    const session = store.create("user-1");

    const validated = store.validate(session.token);
    expect(validated?.userId).toBe("user-1");
  });

  it("rejeita token inexistente", () => {
    const store = new SessionStore();
    expect(store.validate("token-que-nunca-existiu")).toBeNull();
  });

  it("rejeita token expirado", () => {
    const store = new SessionStore();
    const session = store.create("user-1");

    const depoisDeExpirar = new Date(session.expiresAt.getTime() + 1000);
    expect(store.validate(session.token, depoisDeExpirar)).toBeNull();
  });

  it("revoke() invalida o token imediatamente", () => {
    const store = new SessionStore();
    const session = store.create("user-1");

    store.revoke(session.token);
    expect(store.validate(session.token)).toBeNull();
  });

  it("cada sessão criada tem um token diferente", () => {
    const store = new SessionStore();
    const a = store.create("user-1");
    const b = store.create("user-1");
    expect(a.token).not.toBe(b.token);
  });
});
