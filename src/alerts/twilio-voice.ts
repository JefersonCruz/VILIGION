/**
 * Dispara a ligação telefônica real do alerta. O conteúdo falado vem sempre
 * de alert-content-policy.ts (nunca escreva texto de alerta direto aqui) e
 * pede confirmação por PIN via <Gather>, que a Twilio envia pro webhook de
 * action — validado em twilio-webhook-validator.ts.
 */

import twilio from "twilio";
import type { DetectionEvent } from "../engine/rules/detection-rules.js";
import { assertNoSensitiveData, buildAlertMessage } from "./alert-content-policy.js";

export interface TwilioVoiceConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** URL pública (webhook) que recebe a resposta do <Gather> - precisa de validação de assinatura */
  gatherActionUrl: string;
}

export function createTwilioVoiceClient(config: TwilioVoiceConfig) {
  const client = twilio(config.accountSid, config.authToken);

  return {
    /**
     * Liga para os destinatários configurados do alerta. Aceita múltiplos
     * números de propósito (mitigação de TDoS e de coação com destinatário
     * único - ver SECURITY.md); tenta todos, não só o primeiro.
     */
    async placeAlertCall(params: {
      toNumbers: string[];
      event: DetectionEvent;
      alertId: string;
    }) {
      const message = buildAlertMessage(params.event);
      assertNoSensitiveData(message); // nunca confie só na revisão manual

      const twiml = buildGatherTwiml({
        message,
        actionUrl: `${config.gatherActionUrl}?alertId=${encodeURIComponent(params.alertId)}`,
      });

      const results = await Promise.allSettled(
        params.toNumbers.map((to) =>
          client.calls.create({
            to,
            from: config.fromNumber,
            twiml,
          }),
        ),
      );

      return results;
    },
  };
}

function buildGatherTwiml(params: { message: string; actionUrl: string }): string {
  // numDigits=4 casa com pin.ts (PIN de 4 dígitos). timeout curto - isto é
  // um alerta urgente, não um menu de atendimento.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="4" timeout="10" action="${params.actionUrl}" method="POST">
    <Say language="pt-BR">${escapeXml(params.message)} Digite o código de 4 dígitos enviado por WhatsApp para confirmar que recebeu este alerta.</Say>
  </Gather>
  <Say language="pt-BR">Nenhum código recebido. Acesse o painel para ver os detalhes.</Say>
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
