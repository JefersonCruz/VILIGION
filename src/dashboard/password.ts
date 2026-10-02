/**
 * Hash de senha com scrypt (nativo do Node, sem dependência extra). Salt
 * único por senha, comparação em tempo constante.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plaintext, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(plaintext: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(plaintext, salt, KEY_LENGTH);

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
