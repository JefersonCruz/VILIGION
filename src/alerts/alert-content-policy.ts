/**
 * Regra rígida e testável: o conteúdo de um alerta (voz/WhatsApp) NUNCA
 * contém saldo, valor monetário ou endereço completo. É a decisão de design
 * mais importante do projeto (ver README.md) — este módulo existe pra tornar
 * essa regra verificável por teste automatizado, não só uma promessa no pitch.
 */

import type { DetectionEvent } from "../engine/rules/detection-rules.js";

/** Mensagem genérica pronta pra enviar por voz/WhatsApp - nunca inclui dado sensível. */
export function buildAlertMessage(event: DetectionEvent): string {
  switch (event.kind) {
    case "balance-drop":
      return "Alerta VILIGION: atividade incomum detectada na sua tesouraria. Acesse o painel pra ver os detalhes.";
    case "transfer-blocked":
      return "Alerta VILIGION: uma transferência foi bloqueada pela sua política de recebimento. Acesse o painel pra ver os detalhes.";
  }
}

const FORBIDDEN_PATTERNS = [
  /\d{1,3}(,\d{3})*(\.\d+)?\s*(usdc|usdt|tip-?20|%|percent)/i,
  /0x[a-fA-F0-9]{6,}/, // endereço ou hash
  /\$\s?\d/,
];

/**
 * Usado em teste automatizado (e idealmente num hook de CI) pra garantir que
 * nenhuma mudança futura reintroduza dado sensível no conteúdo do alerta.
 */
export function assertNoSensitiveData(message: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(message)) {
      throw new Error(
        `Violação de política: mensagem de alerta contém padrão proibido (${pattern}). ` +
          "Conteúdo de alerta nunca pode revelar saldo, valor ou endereço.",
      );
    }
  }
}
