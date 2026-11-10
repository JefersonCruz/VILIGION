/**
 * Regra rígida e testável: o conteúdo de um alerta (voz/e-mail) NUNCA
 * contém saldo, valor monetário ou endereço completo. É a decisão de design
 * mais importante do projeto (ver README.md) — este módulo existe pra tornar
 * essa regra verificável por teste automatizado, não só uma promessa no pitch.
 */

import type { DetectionEvent } from "../engine/rules/detection-rules.js";
import { type AlertLocale, resolveLocale } from "./locale.js";

const MESSAGES: Record<AlertLocale, Record<DetectionEvent["kind"], string>> = {
  en: {
    "balance-drop": "VILIGION alert: unusual activity detected in your treasury. Check the dashboard for details.",
    "slow-drain": "VILIGION alert: your treasury has been declining steadily for hours. Check the dashboard for details.",
    "transfer-blocked": "VILIGION alert: a transfer was blocked by your receive policy. Check the dashboard for details.",
  },
  pt: {
    "balance-drop": "Alerta VILIGION: atividade incomum detectada na sua tesouraria. Acesse o painel pra ver os detalhes.",
    "slow-drain": "Alerta VILIGION: sua tesouraria vem caindo de forma contínua há horas. Acesse o painel pra ver os detalhes.",
    "transfer-blocked": "Alerta VILIGION: uma transferência foi bloqueada pela sua política de recebimento. Acesse o painel pra ver os detalhes.",
  },
};

/*
 * Sobre o texto do dreno dizer "vem caindo há horas": é mais específico que o
 * de queda súbita, e isso foi pesado contra a política. O que a política
 * proíbe é saldo, valor e endereço - nada disso aparece, e nenhum número
 * aparece. O que o texto revela a quem interceptasse o e-mail é que a conta
 * está perdendo saldo há horas; quem está drenando já sabe disso melhor que
 * ninguém. Em troca, o dono distingue "alguém sacou agora" de "isso vem
 * acontecendo desde ontem", que pedem reação diferente. Sem essa distinção, o
 * tipo de evento separado não serviria pra nada.
 */

/** Mensagem genérica pronta pra enviar por voz/e-mail - nunca inclui dado sensível, em nenhum idioma. */
export function buildAlertMessage(event: DetectionEvent, locale: AlertLocale = resolveLocale()): string {
  return MESSAGES[locale][event.kind];
}

/**
 * Forma CURTA, para notificação em celular.
 *
 * Por que não reusar buildAlertMessage: ali o texto começa com "Alerta
 * VILIGION:" porque é falado numa ligação ou lido num e-mail, onde a marca
 * precisa aparecer no próprio corpo. Na notificação o título já carrega a
 * marca, então repetir o prefixo gasta os poucos caracteres que o Android
 * mostra antes de truncar - e o que fica cortado é justamente a parte que diz
 * o que aconteceu.
 *
 * Mora aqui, e não em web-push.ts, porque todo texto de alerta tem que passar
 * pela mesma política e pelo mesmo teste de dado sensível. Copy de alerta
 * espalhada por módulo de canal é como a regra se perde.
 */
const SHORT_TITLE: Record<AlertLocale, string> = {
  en: "VILIGION · critical alert",
  pt: "VILIGION · alerta crítico",
};

const SHORT_MESSAGES: Record<AlertLocale, Record<DetectionEvent["kind"], string>> = {
  en: {
    "balance-drop": "Unusual activity in your treasury. Tap to open the dashboard.",
    // hoje inalcançável: o push só sai em severidade crítica, e o dreno é
    // sempre normal (ver slow-drain.ts). Fica escrito porque o compilador
    // cobra a variante, e porque o dia em que a barra da ligação virar
    // configurável este texto passa a sair - melhor existir do que ser
    // improvisado depois.
    "slow-drain": "Your treasury has been declining for hours. Tap to open the dashboard.",
    "transfer-blocked": "A transfer was blocked by your receive policy. Tap to open the dashboard.",
  },
  pt: {
    "balance-drop": "Atividade incomum na sua tesouraria. Toque para abrir o painel.",
    "slow-drain": "Sua tesouraria vem caindo há horas. Toque para abrir o painel.",
    "transfer-blocked": "Transferência bloqueada pela sua política de recebimento. Toque para abrir o painel.",
  },
};

/** Título curto da notificação - leva a marca, pra o corpo não precisar repetir. */
export function buildShortAlertTitle(locale: AlertLocale = resolveLocale()): string {
  return SHORT_TITLE[locale];
}

/** Corpo curto da notificação - mesma garantia de conteúdo genérico da forma longa. */
export function buildShortAlertMessage(event: DetectionEvent, locale: AlertLocale = resolveLocale()): string {
  return SHORT_MESSAGES[locale][event.kind];
}

const FORBIDDEN_PATTERNS = [
  /\d{1,3}(,\d{3})*(\.\d+)?\s*(usdc|usdt|tip-?20|%|percent)/i,
  /0x[a-fA-F0-9]{6,}/, // endereço ou hash
  /\$\s?\d/,
];

/**
 * Usado em teste automatizado (e idealmente num hook de CI) pra garantir que
 * nenhuma mudança futura reintroduza dado sensível no conteúdo do alerta,
 * em nenhum dos idiomas suportados.
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
