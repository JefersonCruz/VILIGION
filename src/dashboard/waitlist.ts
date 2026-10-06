/**
 * Lista de espera pública da landing page: evidência de demanda (e-mail +
 * perfil de quem se inscreveu) pra seção "demand validation" da submissão.
 * O e-mail fica em texto puro de propósito - é dado de marketing que o
 * próprio visitante entrega pra ser contatado, não o dado sensível de
 * alerta (esse é criptografado, ver privacy/).
 */

import type { Pool } from "pg";

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

export class PostgresWaitlistRepository implements WaitlistPort {
  private ready: Promise<unknown> | null = null;

  constructor(private readonly pool: Pool) {}

  /** Cria a tabela no primeiro uso - evita depender de rodar a migration contra o banco de produção antes do deploy. */
  private ensureTable(): Promise<unknown> {
    this.ready ??= this.pool.query(
      `CREATE TABLE IF NOT EXISTS waitlist_signups (
         email TEXT PRIMARY KEY,
         profile TEXT NOT NULL,
         note TEXT NOT NULL DEFAULT '',
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    return this.ready;
  }

  async add(input: { email: string; profile: WaitlistProfile; note: string }): Promise<"added" | "exists"> {
    await this.ensureTable();
    const result = await this.pool.query(
      `INSERT INTO waitlist_signups (email, profile, note) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [input.email.toLowerCase(), input.profile, input.note],
    );
    return result.rowCount === 1 ? "added" : "exists";
  }

  async list(): Promise<WaitlistEntry[]> {
    await this.ensureTable();
    const result = await this.pool.query(`SELECT email, profile, note, created_at FROM waitlist_signups ORDER BY created_at`);
    return result.rows.map((r) => ({ email: r.email, profile: r.profile, note: r.note, createdAt: r.created_at }));
  }
}
