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

/**
 * Caracteres que a sintaxe de endereço do RFC 5322 trata como ESTRUTURA, e
 * que um endereço de verdade praticamente nunca tem.
 *
 * Por que existem aqui: três avisos do nodemailer (10.1.4) descrevem o
 * addressparser terminando cedo demais num `;`, num `>` ou num comentário
 * aninhado, e entregando a mensagem a um destinatário que o cabeçalho não
 * nomeia. `SIMPLE_EMAIL` sozinho não barra nenhuma dessas formas - ele só
 * proíbe espaço e exige um `@`, então `"a;b"@x.com` e `a(b)c@x.com` passam.
 *
 * Atualizar a biblioteca corrige o parser (PR #36). Esta lista é a
 * outra metade: o destinatário é cadastrado pelo usuário em /recipients, e
 * quem tiver acesso ao painel poderia deixar ali um endereço que PARECE um e
 * entrega em outro - um destinatário extra escondido à vista. A defesa que
 * não depende da versão de uma dependência é não aceitar a forma.
 *
 * Endereços legítimos com estes caracteres existem no papel e são raros o
 * bastante para que recusá-los, com mensagem clara, seja melhor do que
 * entregar um alerta a um domínio que o dono não escolheu.
 */
const ESTRUTURA_DE_ENDERECO = /[;,<>()[\]\\"]/;

export function isValidPhone(value: string): boolean {
  return E164_PHONE.test(value.trim());
}

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (ESTRUTURA_DE_ENDERECO.test(v)) return false;
  return SIMPLE_EMAIL.test(v);
}
