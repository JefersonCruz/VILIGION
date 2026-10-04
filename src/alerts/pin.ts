/**
 * PIN de uso único atrelado a um alerta específico — nunca estático, nunca
 * reaproveitável (achado crítico do agente de segurança: um PIN fixo vira
 * trivial de forjar se a conta Twilio for comprometida, e já aconteceu com a
 * própria Twilio em 2022/2024 — ver SECURITY.md).
 *
 * Limite de tentativas (achado de auditoria de 2026-10-04): o endpoint que
 * recebe o PIN já exige assinatura válida da Twilio (ver
 * twilio-webhook-validator.ts), então um atacante externo não alcança esta
 * comparação sem forjar isso primeiro - mas quem está na ligação de verdade
 * (um destinatário, ou alguém que a interceptou) podia tentar os 10.000
 * valores possíveis de um PIN de 4 dígitos sem nenhum limite. Travar depois
 * de poucas tentativas erradas é defesa em profundidade padrão, não um gap
 * crítico isolado. Comparação em tempo constante pelo mesmo motivo que
 * dashboard/password.ts usa - não custa nada e fecha o vetor de temporização
 * residual.
 */

import { randomInt, timingSafeEqual } from "node:crypto";

export interface PendingPin {
  alertId: string;
  pin: string;
  expiresAt: Date;
  consumed: boolean;
  /** Tentativas erradas já feitas - ver MAX_ATTEMPTS. */
  attempts: number;
}

const PIN_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 3;

/** Gera um PIN novo de 4 dígitos, atrelado a um alertId específico. */
export function generatePin(alertId: string): PendingPin {
  const pin = randomInt(0, 10_000).toString().padStart(4, "0");
  return {
    alertId,
    pin,
    expiresAt: new Date(Date.now() + PIN_TTL_MINUTES * 60_000),
    consumed: false,
    attempts: 0,
  };
}

export type PinCheckResult = "valid" | "invalid" | "expired" | "already-consumed" | "locked";

/**
 * Valida um PIN recebido contra o pendente. Quem chama é responsável por
 * persistir `consumed: true` depois de "valid", e incrementar `attempts`
 * depois de "invalid" (ver webhook-server.ts) - este módulo não tem estado,
 * de propósito, pra não acoplar a lógica de validação a um banco específico.
 */
export function checkPin(pending: PendingPin, submitted: string, now: Date = new Date()): PinCheckResult {
  if (pending.consumed) return "already-consumed";
  if (pending.attempts >= MAX_ATTEMPTS) return "locked";
  if (now > pending.expiresAt) return "expired";
  return pinsMatch(pending.pin, submitted) ? "valid" : "invalid";
}

function pinsMatch(expected: string, submitted: string): boolean {
  if (submitted.length !== expected.length) return false; // timingSafeEqual exige buffers do mesmo tamanho
  return timingSafeEqual(Buffer.from(expected), Buffer.from(submitted));
}
