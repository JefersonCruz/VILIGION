/**
 * Implementações reais (Postgres) do que hoje só existe em memória -
 * fecha a lacuna "DATABASE_URL existe mas nada usa" (ver ARCHITECTURE.md
 * → "Lacunas de arquitetura"). Schema em privacy/mapping-schema.sql.
 *
 * `Queryable` é o mesmo formato de `pg.Pool`/`pg.PoolClient` - injetável de
 * propósito, pra testar a lógica de SQL sem precisar de Postgres de verdade
 * rodando (mesmo padrão de transporter injetável de alerts/email-notifier.ts).
 */

import type { EncryptedPayload } from "../privacy/encryption.js";

export interface QueryResult<Row> {
  rows: Row[];
}

export interface Queryable {
  query<Row = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
}

export class PostgresPhoneMappingRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Upsert por address_hash - registrar de novo o mesmo endereço atualiza o
   * vínculo (ex: trocou o telefone virtual) em vez de duplicar linha.
   * Retorna o UUID da linha, usado como user_id em todo o resto do schema.
   */
  async save(addressHash: string, payload: EncryptedPayload): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO phone_mappings (address_hash, encrypted_data_key, iv, auth_tag, ciphertext)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address_hash) DO UPDATE SET
         encrypted_data_key = EXCLUDED.encrypted_data_key,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         ciphertext = EXCLUDED.ciphertext,
         updated_at = now()
       RETURNING id`,
      [addressHash, payload.encryptedDataKey, payload.iv, payload.authTag, payload.ciphertext],
    );

    const id = result.rows[0]?.id;
    if (!id) throw new Error("Falha ao salvar vínculo telefone↔endereço - nenhum id retornado.");
    return id;
  }

  async findById(userId: string): Promise<EncryptedPayload | null> {
    const result = await this.db.query<{
      encrypted_data_key: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      ciphertext: Buffer;
    }>(`SELECT encrypted_data_key, iv, auth_tag, ciphertext FROM phone_mappings WHERE id = $1`, [userId]);

    const row = result.rows[0];
    if (!row) return null;
    return {
      encryptedDataKey: row.encrypted_data_key,
      iv: row.iv,
      authTag: row.auth_tag,
      ciphertext: row.ciphertext,
    };
  }
}

export interface MonitoredAccountInput {
  userId: string;
  /** chave em engine/chains/known-chains.ts (ex: "tempo", "base") - validar com getKnownChain ANTES de chamar */
  chainKey: string;
  tokenAddress: string;
  watchedAddress: string;
}

export interface MonitoredAccountRow extends MonitoredAccountInput {
  id: string;
}

export class PostgresMonitoredAccountRepository {
  constructor(private readonly db: Queryable) {}

  async add(input: MonitoredAccountInput): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO monitored_accounts (user_id, chain_key, token_address, watched_address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, chain_key, token_address, watched_address) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id`,
      [input.userId, input.chainKey, input.tokenAddress, input.watchedAddress],
    );

    const id = result.rows[0]?.id;
    if (!id) throw new Error("Falha ao registrar conta monitorada - nenhum id retornado.");
    return id;
  }

  /** Usado no bootstrap (index.ts) pra levantar um Monitor por linha, de TODOS os usuários. */
  async listAll(): Promise<MonitoredAccountRow[]> {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      chain_key: string;
      token_address: string;
      watched_address: string;
    }>(`SELECT id, user_id, chain_key, token_address, watched_address FROM monitored_accounts ORDER BY created_at`);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      chainKey: row.chain_key,
      tokenAddress: row.token_address,
      watchedAddress: row.watched_address,
    }));
  }
}

export interface AlertLogRecordInput {
  alertId: string;
  userId: string;
  kind: string;
  severity: "normal" | "critical";
  deliveredVia: "voice" | "email";
}

export class PostgresAlertLog {
  constructor(private readonly db: Queryable) {}

  async record(input: AlertLogRecordInput): Promise<void> {
    await this.db.query(
      `INSERT INTO alert_log (alert_id, user_id, kind, severity, delivered_via)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.alertId, input.userId, input.kind, input.severity, input.deliveredVia],
    );
  }

  /** Chamado pelo webhook da Twilio quando o PIN é conferido (ver webhook-server.ts). */
  async updatePinStatus(alertId: string, pinStatus: string): Promise<void> {
    await this.db.query(`UPDATE alert_log SET pin_status = $2 WHERE alert_id = $1`, [alertId, pinStatus]);
  }

  async recentForUser(userId: string, limit = 10): Promise<Array<{ kind: string; createdAt: Date }>> {
    const result = await this.db.query<{ kind: string; created_at: Date }>(
      `SELECT kind, created_at FROM alert_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({ kind: row.kind, createdAt: row.created_at }));
  }
}
