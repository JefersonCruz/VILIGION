import { describe, expect, it } from "vitest";
import { describePushSubscription, isValidPushEndpoint, parsePushSubscription } from "./push-subscription.js";

const validSubscription = JSON.stringify({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});

describe("parsePushSubscription", () => {
  it("aceita o formato que PushSubscription.toJSON() produz no navegador", () => {
    const parsed = parsePushSubscription(validSubscription);
    expect(parsed?.endpoint).toBe("https://fcm.googleapis.com/fcm/send/abc123");
    expect(parsed?.keys.auth).toBe("tBHItJI5svbpez7KI4CCXg");
  });

  it("descarta campo extra do navegador - menos dado guardado do que o necessário pra enviar", () => {
    const withExtra = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      expirationTime: 123456789,
      keys: { p256dh: "chaveP256", auth: "chaveAuth" },
    });

    const parsed = parsePushSubscription(withExtra);
    expect(parsed).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "chaveP256", auth: "chaveAuth" },
    });
    expect(parsed).not.toHaveProperty("expirationTime");
  });

  it("rejeita JSON inválido sem lançar - quem decide o erro de UI é o chamador", () => {
    expect(parsePushSubscription("não é json")).toBeNull();
    expect(parsePushSubscription("")).toBeNull();
    expect(parsePushSubscription("null")).toBeNull();
    expect(parsePushSubscription("[]")).toBeNull();
  });

  it("rejeita inscrição sem as duas chaves de criptografia - sem elas o envio falharia só na hora do alerta", () => {
    expect(parsePushSubscription(JSON.stringify({ endpoint: "https://fcm.googleapis.com/x" }))).toBeNull();
    expect(
      parsePushSubscription(JSON.stringify({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "só-essa" } })),
    ).toBeNull();
  });

  it("rejeita chave que não é base64url", () => {
    const badKey = JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "tem espaço e +/=", auth: "ok" },
    });
    expect(parsePushSubscription(badKey)).toBeNull();
  });

  it("rejeita blob gigante - o ciphertext cresce com o claro", () => {
    const huge = JSON.stringify({
      endpoint: `https://fcm.googleapis.com/fcm/send/${"a".repeat(3000)}`,
      keys: { p256dh: "k", auth: "k" },
    });
    expect(parsePushSubscription(huge)).toBeNull();
  });
});

describe("isValidPushEndpoint", () => {
  it("exige https - http seria downgrade silencioso do canal de alerta", () => {
    expect(isValidPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isValidPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
  });

  it("rejeita o que não é URL absoluta", () => {
    expect(isValidPushEndpoint("/fcm/send/abc")).toBe(false);
    expect(isValidPushEndpoint("fcm.googleapis.com")).toBe(false);
    expect(isValidPushEndpoint("https://localhost")).toBe(false);
  });
});

describe("describePushSubscription", () => {
  it("mostra só o host, nunca o endpoint inteiro - o endpoint é uma capacidade, não um identificador", () => {
    const label = describePushSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/segredo-que-nao-pode-aparecer",
      keys: { p256dh: "k", auth: "k" },
    });

    expect(label).toBe("fcm.googleapis.com");
    expect(label).not.toContain("segredo-que-nao-pode-aparecer");
  });

  it("não quebra a tela se o endpoint guardado estiver corrompido", () => {
    expect(describePushSubscription({ endpoint: "lixo", keys: { p256dh: "k", auth: "k" } })).toBe("dispositivo desconhecido");
  });
});
