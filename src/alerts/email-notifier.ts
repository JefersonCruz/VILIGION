/**
 * Canal de severidade "normal" (ver detection-rules.ts) - sem custo por
 * mensagem, sem o problema de retenção de CDR de operadora de telecom (ver
 * SECURITY.md). Mesma política de conteúdo da ligação: nunca revela saldo,
 * valor ou endereço (assertNoSensitiveData é a mesma função, mesma garantia).
 *
 * SMTP genérico de propósito - não amarra o projeto a um provedor pago
 * específico. Qualquer serviço (Gmail SMTP pra dev, Resend, Brevo, SES, etc)
 * funciona só trocando as variáveis de ambiente.
 */

import nodemailer, { type Transporter } from "nodemailer";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";
import { assertNoSensitiveData, buildAlertMessage } from "./alert-content-policy.js";
import { type AlertLocale, resolveLocale } from "./locale.js";

export interface EmailNotifierConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
}

export interface AlertEmail {
  subject: string;
  text: string;
}

const SUBJECT: Record<AlertLocale, string> = {
  en: "VILIGION: activity detected in your treasury",
  pt: "VILIGION: atividade detectada na sua tesouraria",
};

const FOOTER: Record<AlertLocale, string> = {
  en: "\n\nThis is a normal-severity alert. Critical alerts arrive by phone call.",
  pt: "\n\nEste é um alerta de severidade normal. Alertas críticos chegam por ligação telefônica.",
};

/** Monta o e-mail do alerta - função pura, testável sem SMTP de verdade. */
export function buildAlertEmail(event: DetectionEvent, locale: AlertLocale = resolveLocale()): AlertEmail {
  const message = buildAlertMessage(event, locale);
  assertNoSensitiveData(message); // nunca confie só na revisão manual - mesma regra da ligação

  return {
    subject: SUBJECT[locale],
    text: `${message}${FOOTER[locale]}`,
  };
}

export function createEmailNotifier(config: EmailNotifierConfig, transporter?: Transporter) {
  const mailer =
    transporter ??
    nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: { user: config.smtpUser, pass: config.smtpPass },
    });

  return {
    /** Manda o e-mail do alerta pra todos os destinatários configurados. Tenta todos, não só o primeiro. */
    async sendAlertEmail(params: { toAddresses: string[]; event: DetectionEvent; locale?: AlertLocale }) {
      const { subject, text } = buildAlertEmail(params.event, params.locale);

      return Promise.allSettled(
        params.toAddresses.map((to) =>
          mailer.sendMail({ from: config.fromAddress, to, subject, text }),
        ),
      );
    },
  };
}
