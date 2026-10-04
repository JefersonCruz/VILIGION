/**
 * Dispara a ligação telefônica real do alerta. O conteúdo falado vem sempre
 * de alert-content-policy.ts (nunca escreva texto de alerta direto aqui) e
 * pede confirmação por PIN via <Gather>, que a Twilio envia pro webhook de
 * action — validado em twilio-webhook-validator.ts.
 *
 * Entrega do PIN (corrigido 2026-10-04): o prompt da ligação sempre disse
 * "código enviado por WhatsApp", mas nenhum código de verdade enviava esse
 * WhatsApp - a variável TWILIO_WHATSAPP_NUMBER existia em .env.example sem
 * nenhum uso. Na prática, nenhum usuário real tinha como saber o PIN pra
 * digitar (só "funcionava" na demo porque o PIN aparece no log do servidor).
 * Agora: se `whatsappFromNumber` estiver configurado, o PIN é enviado por
 * WhatsApp de verdade (API de mensagens da própria Twilio, mesmo client);
 * sem isso, o PIN é falado diretamente na ligação em vez de prometer um
 * canal que não existe - degrada, não quebra.
 */

import twilio from "twilio";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";
import { assertNoSensitiveData, buildAlertMessage } from "./alert-content-policy.js";
import { type AlertLocale, resolveLocale, twilioSayLanguage } from "./locale.js";

const GATHER_PROMPT: Record<AlertLocale, string> = {
  en: "Press the 4-digit code sent via WhatsApp to confirm you received this alert.",
  pt: "Digite o código de 4 dígitos enviado por WhatsApp para confirmar que recebeu este alerta.",
};

/** Só usado quando `whatsappFromNumber` não está configurado - fala o PIN direto, dígito por dígito, em vez de prometer um canal inexistente. */
const SPOKEN_PIN_PROMPT: Record<AlertLocale, (pin: string) => string> = {
  en: (pin) => `Press ${spacedOutDigits(pin)} now to confirm you received this alert.`,
  pt: (pin) => `Digite ${spacedOutDigits(pin)} agora para confirmar que recebeu este alerta.`,
};

const WHATSAPP_PIN_MESSAGE: Record<AlertLocale, (pin: string) => string> = {
  en: (pin) => `VILIGION confirmation code: ${pin}. Valid for 5 minutes - enter it during the phone call to confirm you received the alert.`,
  pt: (pin) => `Código de confirmação VILIGION: ${pin}. Válido por 5 minutos - digite durante a ligação pra confirmar que recebeu o alerta.`,
};

const NO_CODE_FALLBACK: Record<AlertLocale, string> = {
  en: "No code received. Check the dashboard for details.",
  pt: "Nenhum código recebido. Acesse o painel para ver os detalhes.",
};

export interface TwilioVoiceConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** URL pública (webhook) que recebe a resposta do <Gather> - precisa de validação de assinatura */
  gatherActionUrl: string;
  /**
   * Número "from" pro envio do PIN via WhatsApp (formato E.164, ex:
   * "+14155238886" - prefixo "whatsapp:" é adicionado internamente).
   * OPCIONAL: sem isto configurado, o PIN é falado na própria ligação em
   * vez de enviado por WhatsApp (ver cabeçalho do arquivo).
   */
  whatsappFromNumber?: string;
}

/** Só o que este módulo realmente usa do client da Twilio - injetável pra testar sem SDK/rede de verdade (mesmo padrão de `Transporter` em email-notifier.ts). */
export interface TwilioLikeClient {
  calls: { create(params: { to: string; from: string; twiml: string }): Promise<unknown> };
  messages: { create(params: { to: string; from: string; body: string }): Promise<unknown> };
}

export function createTwilioVoiceClient(config: TwilioVoiceConfig, client?: TwilioLikeClient) {
  const twilioClient = client ?? (twilio(config.accountSid, config.authToken) as unknown as TwilioLikeClient);

  return {
    /**
     * Liga para os destinatários configurados do alerta. Aceita múltiplos
     * números de propósito (mitigação de TDoS e de coação com destinatário
     * único - ver SECURITY.md); tenta todos, não só o primeiro. Também envia
     * o PIN por WhatsApp a todos, se o canal estiver configurado.
     */
    async placeAlertCall(params: {
      toNumbers: string[];
      event: DetectionEvent;
      alertId: string;
      /** PIN de uso único já gerado pelo chamador (ver alerts/pin.ts) - este módulo nunca gera PIN, só entrega. */
      pin: string;
      locale?: AlertLocale;
    }) {
      const locale = params.locale ?? resolveLocale();
      const message = buildAlertMessage(params.event, locale);
      assertNoSensitiveData(message); // nunca confie só na revisão manual

      const whatsappConfigured = Boolean(config.whatsappFromNumber);
      const twiml = buildGatherTwiml({
        message,
        locale,
        pin: params.pin,
        whatsappConfigured,
        actionUrl: `${config.gatherActionUrl}?alertId=${encodeURIComponent(params.alertId)}`,
      });

      const callResults = await Promise.allSettled(
        params.toNumbers.map((to) => twilioClient.calls.create({ to, from: config.fromNumber, twiml })),
      );

      let whatsappResults: PromiseSettledResult<unknown>[] = [];
      if (config.whatsappFromNumber) {
        const body = WHATSAPP_PIN_MESSAGE[locale](params.pin);
        const fromWhatsApp = toWhatsAppAddress(config.whatsappFromNumber);
        whatsappResults = await Promise.allSettled(
          params.toNumbers.map((to) => twilioClient.messages.create({ to: toWhatsAppAddress(to), from: fromWhatsApp, body })),
        );
      }

      return { callResults, whatsappResults };
    },
  };
}

function toWhatsAppAddress(e164: string): string {
  return e164.startsWith("whatsapp:") ? e164 : `whatsapp:${e164}`;
}

function spacedOutDigits(pin: string): string {
  return pin.split("").join(" "); // TTS lê "1 2 3 4" muito mais claro que "mil duzentos e trinta e quatro"
}

function buildGatherTwiml(params: {
  message: string;
  actionUrl: string;
  locale: AlertLocale;
  pin: string;
  whatsappConfigured: boolean;
}): string {
  // numDigits=4 casa com pin.ts (PIN de 4 dígitos). timeout curto - isto é
  // um alerta urgente, não um menu de atendimento.
  const sayLanguage = twilioSayLanguage(params.locale);
  const prompt = params.whatsappConfigured ? GATHER_PROMPT[params.locale] : SPOKEN_PIN_PROMPT[params.locale](params.pin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="4" timeout="10" action="${params.actionUrl}" method="POST">
    <Say language="${sayLanguage}">${escapeXml(params.message)} ${escapeXml(prompt)}</Say>
  </Gather>
  <Say language="${sayLanguage}">${escapeXml(NO_CODE_FALLBACK[params.locale])}</Say>
</Response>`;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
