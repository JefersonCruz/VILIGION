/**
 * PIN de uso único atrelado a um alerta específico — nunca estático, nunca
 * reaproveitável (achado crítico do agente de segurança: um PIN fixo vira
 * trivial de forjar se a conta Twilio for comprometida, e já aconteceu com a
 * própria Twilio em 2022/2024 — ver SECURITY.md).
 */

import { randomInt } from "node:crypto";

export interface PendingPin {
  alertId: string;
  pin: string;
  expiresAt: Date;
  consumed: boolean;
}

const PIN_TTL_MINUTES = 5;

/** Gera um PIN novo de 4 dígitos, atrelado a um alertId específico. */
export function generatePin(alertId: string): PendingPin {
  const pin = randomInt(0, 10_000).toString().padStart(4, "0");
  return {
    alertId,
    pin,
    expiresAt: new Date(Date.now() + PIN_TTL_MINUTES * 60_000),
    consumed: false,
  };
}

export type PinCheckResult = "valid" | "invalid" | "expired" | "already-consumed";

/**
 * Valida um PIN recebido contra o pendente. Quem chama é responsável por
 * persistir `consumed: true` depois de "valid" — este módulo não tem estado,
 * de propósito, pra não acoplar a lógica de validação a um banco específico.
 */
export function checkPin(pending: PendingPin, submitted: string, now: Date = new Date()): PinCheckResult {
  if (pending.consumed) return "already-consumed";
  if (now > pending.expiresAt) return "expired";
  if (pending.pin !== submitted) return "invalid";
  return "valid";
}
