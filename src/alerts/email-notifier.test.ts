import { describe, expect, it, vi } from "vitest";
import { buildAlertEmail, createEmailNotifier } from "./email-notifier.js";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";

const normalEvent: DetectionEvent = {
  kind: "balance-drop",
  userId: "u1",
  pctDropped: 25,
  windowMinutes: 10,
  severity: "normal",
};

describe("buildAlertEmail - mesma política de conteúdo da ligação", () => {
  it("nunca inclui saldo, valor ou endereço no corpo do e-mail, em nenhum idioma", () => {
    for (const locale of ["en", "pt"] as const) {
      const { subject, text } = buildAlertEmail(normalEvent, locale);

      expect(subject).not.toMatch(/\d/);
      expect(text).not.toMatch(/0x[a-fA-F0-9]{6,}/);
      expect(text).not.toMatch(/\$\s?\d/);
    }
  });

  it("deixa claro que é severidade normal, não a crítica (por ligação), em cada idioma", () => {
    expect(buildAlertEmail(normalEvent, "en").text).toMatch(/normal-severity/i);
    expect(buildAlertEmail(normalEvent, "pt").text).toMatch(/severidade normal/i);
  });

  it("default (sem locale explícito) é inglês - pensado pro vídeo de demo", () => {
    const { text } = buildAlertEmail(normalEvent);
    expect(text).toMatch(/normal-severity/i);
  });
});

describe("createEmailNotifier", () => {
  it("tenta mandar pra todos os destinatários configurados, não só o primeiro", async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const notifier = createEmailNotifier(
      {
        smtpHost: "localhost",
        smtpPort: 587,
        smtpUser: "user",
        smtpPass: "pass",
        fromAddress: "alertas@viligion.example",
      },
      { sendMail } as unknown as Parameters<typeof createEmailNotifier>[1],
    );

    await notifier.sendAlertEmail({
      toAddresses: ["dono1@example.com", "dono2@example.com"],
      event: normalEvent,
    });

    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
