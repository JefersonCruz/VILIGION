/**
 * Validação mínima de formato pros destinatários de alerta (/recipients) -
 * não é validação completa de RFC 5322/E.164, só o suficiente pra pegar
 * erro de digitação na hora do cadastro, em vez de descobrir só quando o
 * Twilio/SMTP rejeitar de verdade na hora de um alerta real (achado de
 * auditoria de 2026-10-04).
 */

// E.164: "+", primeiro dígito não-zero, até 15 dígitos no total - formato
// que Twilio exige pra `calls.create`/`messages.create` (voz e WhatsApp).
const E164_PHONE = /^\+[1-9]\d{7,14}$/;

// Verificação pragmática (tem @, tem domínio, tem um ponto depois do @) -
// de propósito não tenta validar RFC 5322 completo, isso é over-engineering
// pra um campo que o SMTP real ainda vai validar de novo no envio.
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPhone(value: string): boolean {
  return E164_PHONE.test(value.trim());
}

export function isValidEmail(value: string): boolean {
  return SIMPLE_EMAIL.test(value.trim());
}
