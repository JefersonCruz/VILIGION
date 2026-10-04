import { describe, expect, it, vi } from "vitest";
import { createTwilioVoiceClient, getPendingTwiml, type TwilioLikeClient } from "./twilio-voice.js";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";

const normalEvent: DetectionEvent = {
  kind: "balance-drop",
  userId: "u1",
  pctDropped: 60,
  windowMinutes: 10,
  severity: "critical",
};

function fakeClient(): TwilioLikeClient & { calls: { create: ReturnType<typeof vi.fn> }; messages: { create: ReturnType<typeof vi.fn> } } {
  return {
    calls: { create: vi.fn().mockResolvedValue({}) },
    messages: { create: vi.fn().mockResolvedValue({}) },
  };
}

const baseConfig = {
  accountSid: "AC_test",
  authToken: "token",
  fromNumber: "+15550000000",
  gatherActionUrl: "https://example.com/webhooks/twilio/gather",
  twimlUrl: "https://example.com/webhooks/twilio/voice",
};

describe("createTwilioVoiceClient - entrega do PIN", () => {
  it("liga pra todos os destinatários configurados, não só o primeiro", async () => {
    const client = fakeClient();
    const voice = createTwilioVoiceClient(baseConfig, client);

    await voice.placeAlertCall({ toNumbers: ["+5511111111111", "+5511222222222"], event: normalEvent, alertId: "a1", pin: "1234" });

    expect(client.calls.create).toHaveBeenCalledTimes(2);
  });

  it("com whatsappFromNumber configurado: envia o PIN por WhatsApp pra todos os destinatários, e o script fala 'enviado por WhatsApp'", async () => {
    const client = fakeClient();
    const voice = createTwilioVoiceClient({ ...baseConfig, whatsappFromNumber: "+14155238886" }, client);

    await voice.placeAlertCall({ toNumbers: ["+5511111111111", "+5511222222222"], event: normalEvent, alertId: "a1", pin: "1234" });

    expect(client.messages.create).toHaveBeenCalledTimes(2);
    const call = client.messages.create.mock.calls[0]?.[0];
    expect(call.from).toBe("whatsapp:+14155238886");
    expect(call.to).toBe("whatsapp:+5511111111111");
    expect(call.body).toContain("1234");

    const twiml = getPendingTwiml("a1") as string;
    expect(twiml).toMatch(/WhatsApp/);
    expect(twiml).not.toContain("1234"); // o PIN não é falado na ligação quando vai por WhatsApp
  });

  it("sem whatsappFromNumber configurado: NÃO tenta enviar WhatsApp, e fala o PIN diretamente na ligação em vez de prometer um canal inexistente", async () => {
    const client = fakeClient();
    const voice = createTwilioVoiceClient(baseConfig, client); // sem whatsappFromNumber

    await voice.placeAlertCall({ toNumbers: ["+5511111111111"], event: normalEvent, alertId: "a1", pin: "5678" });

    expect(client.messages.create).not.toHaveBeenCalled();
    const twiml = getPendingTwiml("a1") as string;
    expect(twiml).not.toMatch(/WhatsApp/);
    expect(twiml).toContain("5 6 7 8"); // dígitos separados, pra TTS falar um por um
  });

  it("nunca revela saldo/endereço no conteúdo falado, com ou sem WhatsApp configurado", async () => {
    const client = fakeClient();
    const voice = createTwilioVoiceClient(baseConfig, client);

    await voice.placeAlertCall({ toNumbers: ["+5511111111111"], event: normalEvent, alertId: "a1", pin: "9999" });

    const twiml = getPendingTwiml("a1") as string;
    expect(twiml).not.toMatch(/0x[a-fA-F0-9]{6,}/);
    expect(twiml).not.toMatch(/\$\s?\d/);
  });

  it("liga via url hospedada (contas trial rejeitam twiml inline) e o TwiML fica disponível por alertId", async () => {
    const client = fakeClient();
    const voice = createTwilioVoiceClient(baseConfig, client);

    await voice.placeAlertCall({ toNumbers: ["+5511111111111"], event: normalEvent, alertId: "a-url", pin: "1111" });

    const call = client.calls.create.mock.calls[0]?.[0];
    expect(call.url).toBe("https://example.com/webhooks/twilio/voice?alertId=a-url");
    expect(call.twiml).toBeUndefined();
    expect(getPendingTwiml("a-url")).toContain("<Gather");
    expect(getPendingTwiml("inexistente")).toBeUndefined();
  });

  it("com whatsappContentSid: envia template com o PIN em {{1}} em vez de body livre", async () => {
    const client = fakeClient();
    const voice = createTwilioVoiceClient({ ...baseConfig, whatsappFromNumber: "+14155238886", whatsappContentSid: "HXabc" }, client);

    await voice.placeAlertCall({ toNumbers: ["+5511111111111"], event: normalEvent, alertId: "a1", pin: "4321" });

    const call = client.messages.create.mock.calls[0]?.[0];
    expect(call.contentSid).toBe("HXabc");
    expect(JSON.parse(call.contentVariables)).toEqual({ "1": "4321" });
    expect(call.body).toBeUndefined();
  });
});
