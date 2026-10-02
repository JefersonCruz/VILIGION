/**
 * Valida o header X-Twilio-Signature em TODO endpoint que recebe resposta da
 * Twilio (confirmação de PIN via <Gather>, status de WhatsApp, etc).
 *
 * Sem isto, qualquer pessoa que descubra a URL do webhook (comum em deploy
 * de demo tipo ngrok/Vercel sem auth) pode forjar uma "confirmação de PIN"
 * chamando o endpoint diretamente, sem nunca passar pela Twilio de verdade.
 * Este foi o item #3 dos riscos críticos apontados na revisão de segurança -
 * não é boa prática genérica, é o ponto exato onde o PIN inteiro vira teatro
 * se for esquecido.
 */

import twilio from "twilio";

export interface WebhookValidationInput {
  authToken: string;
  /** URL completa exatamente como a Twilio a viu (protocolo+host+path+querystring) */
  fullUrl: string;
  /** valor do header X-Twilio-Signature */
  signatureHeader: string | undefined;
  /** corpo do POST, já parseado como objeto chave-valor (form-urlencoded da Twilio) */
  params: Record<string, string>;
}

export function isValidTwilioWebhook(input: WebhookValidationInput): boolean {
  if (!input.signatureHeader) return false;

  return twilio.validateRequest(
    input.authToken,
    input.signatureHeader,
    input.fullUrl,
    input.params,
  );
}

/**
 * Helper pensado pra um handler Express/Fastify-like: lança erro 403 se a
 * assinatura não validar, pra garantir que ninguém "esqueça" de checar o
 * retorno booleano no meio da pressa de prazo.
 */
export function assertValidTwilioWebhook(input: WebhookValidationInput): void {
  if (!isValidTwilioWebhook(input)) {
    throw new Error(
      "Webhook Twilio com assinatura inválida ou ausente - requisição rejeitada. " +
        "Isto impede forjar confirmação de PIN sem passar pela Twilio real.",
    );
  }
}
