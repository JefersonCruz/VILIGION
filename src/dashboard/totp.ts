/**
 * TOTP (RFC 6238) implementado direto com Node crypto, sem dependência
 * externa - compatível com qualquer app autenticador padrão (Google
 * Authenticator, Authy, 1Password). Escolhido em vez de SMS/voz pro segundo
 * fator do painel justamente pra não criar mais uma dependência de terceiro
 * (ver ARCHITECTURE.md, seção sobre reduzir dependência da Twilio).
 *
 * Isto existe porque "painel sem MFA anula todo o cuidado da ligação" foi
 * um dos riscos críticos apontados na revisão de segurança - o atacante
 * racional ataca o login simples antes de tentar engenharia social por
 * telefone.
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateBase32Secret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: bigint): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const hmac = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;

  const binCode =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);

  return (binCode % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export function generateTotp(base32Secret: string, time: Date = new Date()): string {
  const counter = BigInt(Math.floor(time.getTime() / 1000 / STEP_SECONDS));
  return hotp(base32Decode(base32Secret), counter);
}

/**
 * Verifica aceitando uma pequena janela de tolerância de relógio (±1 passo =
 * ±30s), prática padrão de TOTP pra não falhar por dessincronia pequena de
 * horário entre servidor e celular do usuário.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: { windowSteps?: number; time?: Date } = {},
): boolean {
  const windowSteps = options.windowSteps ?? 1;
  const time = options.time ?? new Date();
  const currentCounter = BigInt(Math.floor(time.getTime() / 1000 / STEP_SECONDS));
  const secretBytes = base32Decode(base32Secret);

  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const candidate = hotp(secretBytes, currentCounter + BigInt(delta));
    if (constantTimeEquals(candidate, code)) return true;
  }
  return false;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** URI padrão `otpauth://` pra gerar QR code de setup em qualquer app autenticador. */
export function buildOtpAuthUri(params: { secret: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const issuer = encodeURIComponent(params.issuer);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${issuer}&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
