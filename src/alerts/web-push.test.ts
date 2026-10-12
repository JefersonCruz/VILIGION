import { describe, expect, it, vi } from "vitest";
import { buildPushPayload, createWebPushNotifier, type PushSubscriptionRecord, type WebPushLikeSender } from "./web-push.js";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";

const criticalDrop: DetectionEvent = {
  kind: "balance-drop",
  userId: "u1",
  pctDropped: 60,
  windowMinutes: 60,
  severity: "critical",
};

const blockedTransfer: DetectionEvent = {
  kind: "transfer-blocked",
  userId: "u1",
  severity: "critical",
  amount: 50_000_000n,
  blockedNonce: 7n,
};

function fakeSender(): WebPushLikeSender & { sendNotification: ReturnType<typeof vi.fn> } {
  return { sendNotification: vi.fn().mockResolvedValue({}) };
}

const baseConfig = {
  vapidPublicKey: "BPublicKeyTest",
  vapidPrivateKey: "privateKeyTest",
  vapidSubject: "mailto:alerts@viligion.com",
  dashboardUrl: "https://viligion.com/dashboard",
};

function subscription(host: string): PushSubscriptionRecord {
  return { endpoint: `https://${host}/send/abc123`, keys: { p256dh: "p256dhKey", auth: "authKey" } };
}

describe("buildPushPayload - política de conteúdo", () => {
  it("não revela saldo, valor nem endereço - nem no corpo, nem no título", () => {
    for (const event of [criticalDrop, blockedTransfer]) {
      for (const locale of ["en", "pt"] as const) {
        const payload = JSON.parse(buildPushPayload(event, baseConfig, locale));

        // Título vai pra tela de bloqueio: é exatamente onde um dado sensível
        // seria lido por quem está ao lado (cenário de coação).
        expect(payload.title).not.toMatch(/\d/);
        expect(payload.body).not.toMatch(/0x[a-fA-F0-9]{6,}/);
        expect(payload.body).not.toMatch(/\$\s?\d/);
        expect(payload.body).not.toContain("60");
        expect(payload.body).not.toContain("50");
      }
    }
  });

  it("manda o usuário pro painel, porque só lá o detalhe real aparece", () => {
    const payload = JSON.parse(buildPushPayload(criticalDrop, baseConfig, "pt"));
    expect(payload.url).toBe("https://viligion.com/dashboard");
    expect(payload.actionLabel).toBe("Abrir painel");
  });

  it("respeita o locale configurado, igual voz e e-mail", () => {
    expect(JSON.parse(buildPushPayload(criticalDrop, baseConfig, "en")).title).toBe("VILIGION · critical alert");
    expect(JSON.parse(buildPushPayload(criticalDrop, baseConfig, "pt")).title).toBe("VILIGION · alerta crítico");
    expect(JSON.parse(buildPushPayload(criticalDrop, baseConfig, "pt")).lang).toBe("pt-BR");
  });

  it("usa a forma CURTA no corpo - a marca ja esta no titulo, e Android trunca", () => {
    const payload = JSON.parse(buildPushPayload(criticalDrop, baseConfig, "pt"));

    // O prefixo "Alerta VILIGION:" e da forma longa (voz/e-mail). Repeti-lo
    // aqui gastaria os poucos caracteres antes do truncamento do celular.
    expect(payload.body).not.toContain("Alerta VILIGION");
    expect(payload.body.length).toBeLessThan(90);
    expect(payload.body).toContain("tesouraria");
  });

  it("carrega o horario do evento, pra notificacao que passou a noite na tela nao dizer 'agora'", () => {
    const antes = Date.now();
    const payload = JSON.parse(buildPushPayload(criticalDrop, baseConfig, "pt"));

    expect(payload.at).toBeGreaterThanOrEqual(antes);
    expect(payload.at).toBeLessThanOrEqual(Date.now());
  });
});

describe("createWebPushNotifier - entrega", () => {
  it("entrega em todos os dispositivos inscritos, não só no primeiro", async () => {
    const sender = fakeSender();
    const notifier = createWebPushNotifier(baseConfig, sender);

    await notifier.sendAlert({
      subscriptions: [subscription("fcm.googleapis.com"), subscription("updates.push.services.mozilla.com")],
      event: criticalDrop,
      alertId: "11111111-2222-3333-4444-555555555555",
    });

    expect(sender.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("um dispositivo com inscrição expirada não impede a entrega nos outros", async () => {
    const sender = fakeSender();
    sender.sendNotification
      .mockRejectedValueOnce(new Error("410 Gone"))
      .mockResolvedValueOnce({});
    const notifier = createWebPushNotifier(baseConfig, sender);

    const results = await notifier.sendAlert({
      subscriptions: [subscription("dead.example.com"), subscription("fcm.googleapis.com")],
      event: criticalDrop,
      alertId: "a1",
    });

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
  });

  it("devolve as rejeições pro chamador inspecionar, em vez de engolir em silêncio", async () => {
    const sender = fakeSender();
    sender.sendNotification.mockRejectedValue(new Error("410 Gone"));
    const notifier = createWebPushNotifier(baseConfig, sender);

    const results = await notifier.sendAlert({
      subscriptions: [subscription("dead.example.com")],
      event: criticalDrop,
      alertId: "a1",
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("rejected");
  });

  it("envia com urgência alta e TTL curto - alerta entregue horas depois não é alerta", async () => {
    const sender = fakeSender();
    const notifier = createWebPushNotifier(baseConfig, sender);

    await notifier.sendAlert({ subscriptions: [subscription("fcm.googleapis.com")], event: criticalDrop, alertId: "a1" });

    const options = sender.sendNotification.mock.calls[0]?.[2];
    expect(options.urgency).toBe("high");
    expect(options.TTL).toBe(15 * 60);
  });

  it("topic cabe no limite de 32 caracteres do header, mesmo com alertId UUID", async () => {
    const sender = fakeSender();
    const notifier = createWebPushNotifier(baseConfig, sender);

    await notifier.sendAlert({
      subscriptions: [subscription("fcm.googleapis.com")],
      event: criticalDrop,
      alertId: "11111111-2222-3333-4444-555555555555",
    });

    const topic = sender.sendNotification.mock.calls[0]?.[2].topic;
    expect(topic.length).toBeLessThanOrEqual(32);
    expect(topic).not.toContain("-");
  });

  it("sem nenhuma inscrição: não tenta enviar nada e não quebra", async () => {
    const sender = fakeSender();
    const notifier = createWebPushNotifier(baseConfig, sender);

    const results = await notifier.sendAlert({ subscriptions: [], event: criticalDrop, alertId: "a1" });

    expect(results).toEqual([]);
    expect(sender.sendNotification).not.toHaveBeenCalled();
  });
});
