/**
 * Criptografia do vínculo telefone↔endereço usando envelope encryption:
 * a chave que criptografa o dado (DEK) nunca fica solta em env var — ela
 * mesma é criptografada por uma chave mestra que vive num KMS gerenciado
 * (AWS KMS / GCP KMS). Sem isso, "chave perto dos dados" anula a
 * criptografia inteira (achado crítico #6 da revisão de segurança):
 * quem compromete o servidor pega os dois pedaços juntos.
 *
 * Para produção: implemente KeyProvider usando @aws-sdk/client-kms
 * (GenerateDataKey + Decrypt) ou o equivalente do GCP KMS. A classe
 * LocalDevKeyProvider abaixo é só pra desenvolvimento/teste local — nunca
 * use em produção, está marcada explicitamente.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recomendado pro GCM

/** Abstrai de onde vem a chave de dados (DEK), pra poder trocar o backend de KMS sem tocar na lógica de criptografia. */
export interface KeyProvider {
  /** Gera uma nova DEK. Retorna a chave em claro (pra uso imediato em memória) e a versão criptografada (pra persistir). */
  generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: Buffer }>;
  /** Decripta uma DEK previamente persistida, usando a chave mestra do KMS. */
  decryptDataKey(encryptedKey: Buffer): Promise<Buffer>;
}

/**
 * ⚠️ APENAS PARA DESENVOLVIMENTO LOCAL / TESTES.
 * Não protege nada de verdade - mantém a chave mestra em memória do processo.
 * Em produção, troque por um KeyProvider real (AWS KMS / GCP KMS) antes de
 * processar qualquer dado real de usuário.
 */
export class LocalDevKeyProvider implements KeyProvider {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex?: string) {
    this.masterKey = masterKeyHex
      ? Buffer.from(masterKeyHex, "hex")
      : randomBytes(32);
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; encryptedKey: Buffer }> {
    const plaintextKey = randomBytes(32);
    const encryptedKey = this.localEncrypt(plaintextKey);
    return { plaintextKey, encryptedKey };
  }

  async decryptDataKey(encryptedKey: Buffer): Promise<Buffer> {
    return this.localDecrypt(encryptedKey);
  }

  private localEncrypt(data: Buffer): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  private localDecrypt(payload: Buffer): Buffer {
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = payload.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export interface EncryptedPayload {
  /** DEK criptografada pela chave mestra do KMS - seguro de guardar junto do dado */
  encryptedDataKey: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

export class MappingEncryption {
  constructor(private readonly keyProvider: KeyProvider) {}

  /** Criptografa o payload (ex: JSON com telefone+endereço) usando uma DEK nova a cada chamada. */
  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    const { plaintextKey, encryptedKey } = await this.keyProvider.generateDataKey();

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, plaintextKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    plaintextKey.fill(0); // não deixa a DEK em claro mais tempo que o necessário em memória

    return { encryptedDataKey: encryptedKey, iv, authTag, ciphertext };
  }

  async decrypt(payload: EncryptedPayload): Promise<string> {
    const plaintextKey = await this.keyProvider.decryptDataKey(payload.encryptedDataKey);

    const decipher = createDecipheriv(ALGORITHM, plaintextKey, payload.iv);
    decipher.setAuthTag(payload.authTag);
    const result = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);

    plaintextKey.fill(0);
    return result.toString("utf8");
  }
}
