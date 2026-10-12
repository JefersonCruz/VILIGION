/**
 * Lista de espera pública da landing page: evidência de demanda (e-mail +
 * perfil de quem se inscreveu) pra seção "demand validation" da submissão.
 * O e-mail fica em texto puro de propósito - é dado de marketing que o
 * próprio visitante entrega pra ser contatado, não o dado sensível de
 * alerta (esse é criptografado, ver privacy/).
 */

import { createHmac } from "node:crypto";
import type { Pool } from "pg";

/** Só o que a lista de espera usa de MappingEncryption - mantém o acoplamento mínimo e testável. */
export interface WaitlistEncryption {
  encrypt(plaintext: string): Promise<{ encryptedDataKey: Buffer; iv: Buffer; authTag: Buffer; ciphertext: Buffer }>;
  decrypt(payload: { encryptedDataKey: Buffer; iv: Buffer; authTag: Buffer; ciphertext: Buffer }): Promise<string>;
}

export const WAITLIST_PROFILES = {
  treasury: "Tenho tesouraria cripto de empresa, DAO ou equipe",
  personal: "Tenho uma carteira pessoal de valor relevante",
  builder: "Construo ou opero na Tempo / com stablecoins",
  other: "Outro",
} as const;

export type WaitlistProfile = keyof typeof WAITLIST_PROFILES;

export function isWaitlistProfile(value: string): value is WaitlistProfile {
  return Object.prototype.hasOwnProperty.call(WAITLIST_PROFILES, value);
}

export interface WaitlistEntry {
  email: string;
  profile: WaitlistProfile;
  note: string;
  createdAt: Date;
}

export interface WaitlistPort {
  /** "exists" quando o e-mail já estava inscrito (não duplica, não vaza erro diferente pro visitante). */
  add(input: { email: string; profile: WaitlistProfile; note: string }): Promise<"added" | "exists">;
  list(): Promise<WaitlistEntry[]>;
}

export class InMemoryWaitlistRepository implements WaitlistPort {
  private readonly entries = new Map<string, WaitlistEntry>();

  async add(input: { email: string; profile: WaitlistProfile; note: string }): Promise<"added" | "exists"> {
    const key = input.email.toLowerCase();
    if (this.entries.has(key)) return "exists";
    this.entries.set(key, { ...input, email: key, createdAt: new Date() });
    return "added";
  }

  async list(): Promise<WaitlistEntry[]> {
    return [...this.entries.values()];
  }
}

/**
 * Impressão digital do e-mail, só para deduplicar.
 *
 * HMAC com pepper, NÃO SHA-256 puro: o conjunto de e-mails plausíveis é
 * pequeno o bastante para um atacante com o banco simplesmente testar
 * palpites contra um hash sem segredo. Com o pepper (que vive na variável de
 * ambiente, fora do banco), um vazamento SÓ do banco não permite nem testar.
 *
 * Trade-off honesto, para ficar registrado: quem tiver o banco E o ambiente
 * consegue CONFIRMAR um e-mail que já suspeite, embora não consiga listar os
 * e-mails. Eliminar isso exigiria abrir mão da deduplicação, ou cifrar no
 * navegador com uma chave que o servidor não tem (ver SECURITY.md).
 */
export function emailFingerprint(email: string, pepper: string): string {
  return createHmac("sha256", pepper).update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Lista de espera com e-mail e nota CIFRADOS em repouso (2026-10-12).
 *
 * Antes, `waitlist_signups` guardava `email TEXT PRIMARY KEY` - texto puro, e
 * ainda indexado. Era contato de TERCEIROS em claro, num produto cujo
 * SECURITY.md promete o contrário, e cujo `alert_recipients` já usava
 * envelope AES-256-GCM. A incoerência era só histórica, não deliberada.
 *
 * Agora: e-mail e nota vão juntos num payload cifrado com o MESMO esquema de
 * envelope do resto do projeto. Perfil e data ficam em claro de propósito -
 * são categoria e carimbo de tempo, não identificam ninguém, e é o que
 * permite estatística sem decifrar nada.
 *
 * Um vazamento apenas do banco entrega: quantas pessoas se inscreveram, de
 * que perfil e quando. Não entrega quem.
 */
export class PostgresWaitlistRepository implements WaitlistPort {
  private ready: Promise<unknown> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly encryption: WaitlistEncryption,
    private readonly pepper: string,
  ) {}

  /** Cria a tabela no primeiro uso - evita depender de rodar a migration contra o banco de produção antes do deploy. */
  private ensureTable(): Promise<unknown> {
    this.ready ??= this.pool.query(
      `CREATE TABLE IF NOT EXISTS waitlist_signups_enc (
         email_hash         TEXT PRIMARY KEY,
         profile            TEXT NOT NULL,
         encrypted_data_key BYTEA NOT NULL,
         iv                 BYTEA NOT NULL,
         auth_tag           BYTEA NOT NULL,
         ciphertext         BYTEA NOT NULL,
         created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    return this.ready;
  }

  async add(input: { email: string; profile: WaitlistProfile; note: string }): Promise<"added" | "exists"> {
    await this.ensureTable();
    const email = input.email.trim().toLowerCase();
    // E-mail e nota viajam juntos num payload só: a nota é texto livre escrito
    // por uma pessoa sobre a própria tesouraria, então merece o mesmo cuidado.
    const payload = await this.encryption.encrypt(JSON.stringify({ email, note: input.note }));

    const result = await this.pool.query(
      `INSERT INTO waitlist_signups_enc (email_hash, profile, encrypted_data_key, iv, auth_tag, ciphertext)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email_hash) DO NOTHING`,
      [emailFingerprint(email, this.pepper), input.profile, payload.encryptedDataKey, payload.iv, payload.authTag, payload.ciphertext],
    );
    return result.rowCount === 1 ? "added" : "exists";
  }

  async list(): Promise<WaitlistEntry[]> {
    await this.ensureTable();
    const result = await this.pool.query(
      `SELECT profile, encrypted_data_key, iv, auth_tag, ciphertext, created_at FROM waitlist_signups_enc ORDER BY created_at`,
    );

    return Promise.all(
      result.rows.map(async (r) => {
        const open = JSON.parse(
          await this.encryption.decrypt({
            encryptedDataKey: r.encrypted_data_key,
            iv: r.iv,
            authTag: r.auth_tag,
            ciphertext: r.ciphertext,
          }),
        ) as { email: string; note: string };
        return { email: open.email, profile: r.profile, note: open.note, createdAt: r.created_at };
      }),
    );
  }
}
