/**
 * Validação e exibição segura de inscrição de Web Push (/recipients,
 * kind='push'). Mesmo espírito de recipient-validation.ts: validação mínima
 * pra pegar erro de integração na hora do cadastro, em vez de descobrir só
 * quando um alerta crítico de verdade não for entregue.
 *
 * Diferença importante em relação a telefone/e-mail: o endpoint de push é uma
 * CAPACIDADE, não um identificador. Quem tem o endpoint pode mandar
 * notificação pro dispositivo (a autenticação é VAPID, mas o endpoint é o
 * alvo). Por isso ele nunca é renderizado inteiro na tela - só o host, via
 * describePushSubscription(). O valor completo fica criptografado no banco,
 * igual telefone, e não aparece em log.
 */

import type { PushSubscriptionRecord } from "../alerts/web-push.js";

/**
 * Teto de tamanho: endpoints reais de FCM/Mozilla/WNS ficam bem abaixo disso.
 * Existe pra não aceitar blob arbitrário num campo que vai criptografado pro
 * banco - o ciphertext cresce com o claro.
 */
const MAX_SERIALIZED_LENGTH = 2048;

// Chaves do navegador são base64url (sem padding "=" obrigatório).
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Aceita o JSON que `PushSubscription.toJSON()` produz no navegador. Devolve
 * null em qualquer formato inesperado - o chamador decide o erro de UI, este
 * módulo não lança.
 */
export function parsePushSubscription(raw: string): PushSubscriptionRecord | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_SERIALIZED_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { endpoint?: unknown; keys?: unknown };

  if (typeof candidate.endpoint !== "string" || !isValidPushEndpoint(candidate.endpoint)) return null;
  if (typeof candidate.keys !== "object" || candidate.keys === null) return null;

  const keys = candidate.keys as { p256dh?: unknown; auth?: unknown };
  if (typeof keys.p256dh !== "string" || !BASE64URL.test(keys.p256dh)) return null;
  if (typeof keys.auth !== "string" || !BASE64URL.test(keys.auth)) return null;

  // Normaliza: guarda só o que o envio precisa, descartando campo extra que
  // o navegador tenha incluído (ex: expirationTime) - menos dado guardado.
  return { endpoint: candidate.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Só https e só URL absoluta - push service é sempre TLS, e http seria downgrade silencioso. */
export function isValidPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.includes(".");
}

/**
 * Rótulo curto pra listar o dispositivo em /recipients sem expor o endpoint.
 * Mostra só o host do push service (ex: "fcm.googleapis.com"), que identifica
 * o navegador/plataforma e é suficiente pro usuário reconhecer e remover a
 * inscrição certa.
 */
export function describePushSubscription(subscription: PushSubscriptionRecord): string {
  try {
    return new URL(subscription.endpoint).hostname;
  } catch {
    return "dispositivo desconhecido";
  }
}
