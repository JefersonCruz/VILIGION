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
import type { DashboardUser, UserRepository } from "../dashboard/server.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";

export interface QueryResult<Row> {
  rows: Row[];
  rowCount?: number | null;
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

export interface CreateDashboardUserInput {
  userId: string;
  username: string;
  passwordHash: string;
  totpSecret: string;
}

/**
 * user_id é O MESMO UUID de phone_mappings.id - unifica a identidade de
 * login do painel com quem provou posse do endereço no cadastro (ver
 * privacy/signup-service.ts e a nota de design em docs/UI-SPEC.md).
 */
export class PostgresDashboardUserRepository implements UserRepository {
  constructor(private readonly db: Queryable) {}

  async findByUsername(username: string): Promise<DashboardUser | null> {
    const result = await this.db.query<{ user_id: string; password_hash: string; totp_secret: string }>(
      `SELECT user_id, password_hash, totp_secret FROM dashboard_users WHERE username = $1`,
      [username],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { userId: row.user_id, passwordHash: row.password_hash, totpSecret: row.totp_secret };
  }

  async create(input: CreateDashboardUserInput): Promise<void> {
    await this.db.query(
      `INSERT INTO dashboard_users (user_id, username, password_hash, totp_secret) VALUES ($1, $2, $3, $4)`,
      [input.userId, input.username, input.passwordHash, input.totpSecret],
    );
  }
}

export class PostgresThresholdsRepository {
  constructor(private readonly db: Queryable) {}

  async upsert(thresholds: UserThresholds): Promise<void> {
    await this.db.query(
      `INSERT INTO user_thresholds
         (user_id, max_balance_drop_pct, critical_balance_drop_pct, window_minutes,
          blocked_transfer_alert_threshold, critical_blocked_transfer_threshold)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         max_balance_drop_pct = EXCLUDED.max_balance_drop_pct,
         critical_balance_drop_pct = EXCLUDED.critical_balance_drop_pct,
         window_minutes = EXCLUDED.window_minutes,
         blocked_transfer_alert_threshold = EXCLUDED.blocked_transfer_alert_threshold,
         critical_blocked_transfer_threshold = EXCLUDED.critical_blocked_transfer_threshold`,
      [
        thresholds.userId,
        thresholds.maxBalanceDropPct,
        thresholds.criticalBalanceDropPct,
        thresholds.windowMinutes,
        thresholds.blockedTransferAlertThreshold.toString(),
        thresholds.criticalBlockedTransferThreshold.toString(),
      ],
    );
  }

  async get(userId: string): Promise<UserThresholds | null> {
    const result = await this.db.query<{
      user_id: string;
      max_balance_drop_pct: string;
      critical_balance_drop_pct: string;
      window_minutes: number;
      blocked_transfer_alert_threshold: string;
      critical_blocked_transfer_threshold: string;
    }>(
      `SELECT user_id, max_balance_drop_pct, critical_balance_drop_pct, window_minutes,
              blocked_transfer_alert_threshold, critical_blocked_transfer_threshold
       FROM user_thresholds WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      maxBalanceDropPct: Number(row.max_balance_drop_pct),
      criticalBalanceDropPct: Number(row.critical_balance_drop_pct),
      windowMinutes: Number(row.window_minutes),
      blockedTransferAlertThreshold: BigInt(row.blocked_transfer_alert_threshold),
      criticalBlockedTransferThreshold: BigInt(row.critical_blocked_transfer_threshold),
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

    return result.rows.map(mapAccountRow);
  }

  /** Usado na tela "gerenciar contas" - só as contas do usuário logado. */
  async listForUser(userId: string): Promise<MonitoredAccountRow[]> {
    const result = await this.db.query<{
      id: string;
      user_id: string;
      chain_key: string;
      token_address: string;
      watched_address: string;
    }>(
      `SELECT id, user_id, chain_key, token_address, watched_address FROM monitored_accounts
       WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return result.rows.map(mapAccountRow);
  }

  /** Remove só se a conta pertencer ao usuário - nunca deixa um usuário apagar conta de outro. Retorna se de fato removeu algo. */
  async remove(id: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM monitored_accounts WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

function mapAccountRow(row: {
  id: string;
  user_id: string;
  chain_key: string;
  token_address: string;
  watched_address: string;
}): MonitoredAccountRow {
  return {
    id: row.id,
    userId: row.user_id,
    chainKey: row.chain_key,
    tokenAddress: row.token_address,
    watchedAddress: row.watched_address,
  };
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

  /** Versão completa pra tela de histórico (UI-SPEC.md item 4) - inclui severidade, canal e status do PIN. */
  async detailedForUser(userId: string, limit = 50): Promise<
    Array<{ alertId: string; kind: string; severity: string; deliveredVia: string; pinStatus: string | null; createdAt: Date }>
  > {
    const result = await this.db.query<{
      alert_id: string;
      kind: string;
      severity: string;
      delivered_via: string;
      pin_status: string | null;
      created_at: Date;
    }>(
      `SELECT alert_id, kind, severity, delivered_via, pin_status, created_at
       FROM alert_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      alertId: row.alert_id,
      kind: row.kind,
      severity: row.severity,
      deliveredVia: row.delivered_via,
      pinStatus: row.pin_status,
      createdAt: row.created_at,
    }));
  }
}
