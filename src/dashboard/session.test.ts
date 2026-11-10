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

/**
 * A marca de sessão de avaliação morava num `Set` separado, com teto de 200
 * tokens e descarte do mais antigo (ver a nota em judge-access.ts). Estes
 * testes guardam a propriedade que faltava: a marca não pode sobreviver à
 * sessão nem desaparecer antes dela.
 */
describe("SessionStore: marca de sessão de avaliação", () => {
  it("sessão normal não é de avaliação", () => {
    const store = new SessionStore();
    expect(store.create("user-1").isJudge).toBe(false);
    expect(store.validate(store.create("user-1").token)?.isJudge).toBe(false);
  });

  it("sessão de avaliação nasce marcada, e a marca chega em quem valida", () => {
    const store = new SessionStore();
    const s = store.create("user-1", { judge: true });
    expect(s.isJudge).toBe(true);
    expect(store.validate(s.token)?.isJudge).toBe(true);
  });

  it("nenhuma quantidade de sessões novas apaga a marca de uma antiga", () => {
    // Era exatamente aqui que a restrição se perdia: o antigo conjunto
    // descartava por VOLUME, e quem abre as sessões escolhe o volume.
    const store = new SessionStore();
    const primeira = store.create("user-1", { judge: true });
    for (let i = 0; i < 1000; i++) store.create("user-1", { judge: true });

    expect(store.validate(primeira.token)?.isJudge).toBe(true);
  });

  it("revogar a sessão leva a marca embora - não sobra token marcado sem sessão", () => {
    const store = new SessionStore();
    const s = store.create("user-1", { judge: true });
    store.revoke(s.token);
    expect(store.peek(s.token)).toBeNull();
  });

  it("peek lê a marca sem empurrar o prazo", () => {
    // A política de avaliação é consultada em TODA requisição, inclusive nas
    // negadas. Se essa consulta renovasse a sessão, uma recusa manteria a
    // sessão viva - o oposto do que uma recusa deve fazer.
    const store = new SessionStore();
    const s = store.create("user-1", { judge: true });
    const prazoOriginal = s.expiresAt.getTime();

    const dezMinDepois = new Date(Date.now() + 10 * 60_000);
    expect(store.peek(s.token, dezMinDepois)?.isJudge).toBe(true);
    expect(s.expiresAt.getTime()).toBe(prazoOriginal);

    // já validate renova, como sempre
    store.validate(s.token, dezMinDepois);
    expect(s.expiresAt.getTime()).toBeGreaterThan(prazoOriginal);
  });

  it("peek respeita a expiração, e não devolve sessão vencida como se fosse válida", () => {
    const store = new SessionStore();
    const s = store.create("user-1", { judge: true });
    expect(store.peek(s.token, new Date(s.expiresAt.getTime() + 1000))).toBeNull();
    expect(store.peek(undefined)).toBeNull();
    expect(store.peek("token-que-nunca-existiu")).toBeNull();
  });
});
