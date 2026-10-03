import { describe, expect, it, vi } from "vitest";
import {
  PostgresAlertLog,
  PostgresDashboardUserRepository,
  PostgresMonitoredAccountRepository,
  PostgresPhoneMappingRepository,
  PostgresThresholdsRepository,
  type Queryable,
} from "./postgres-repositories.js";
import type { EncryptedPayload } from "../privacy/encryption.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";

/** Queryable falso - grava a última chamada e devolve linhas/rowCount pré-programados, nunca toca rede/disco. */
function fakeDb(
  rows: unknown[] = [],
  rowCount?: number,
): Queryable & { lastSql: string; lastParams: unknown[] } {
  const state = { lastSql: "", lastParams: [] as unknown[] };
  return {
    ...state,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      state.lastSql = sql;
      state.lastParams = params ?? [];
      return { rows, rowCount: rowCount ?? rows.length };
    }) as Queryable["query"],
    get lastSql() {
      return state.lastSql;
    },
    get lastParams() {
      return state.lastParams;
    },
  } as unknown as Queryable & { lastSql: string; lastParams: unknown[] };
}

const payload: EncryptedPayload = {
  encryptedDataKey: Buffer.from("key"),
  iv: Buffer.from("iv"),
  authTag: Buffer.from("tag"),
  ciphertext: Buffer.from("cipher"),
};

describe("PostgresPhoneMappingRepository", () => {
  it("save() faz upsert por address_hash e retorna o id", async () => {
    const db = fakeDb([{ id: "user-1" }]);
    const repo = new PostgresPhoneMappingRepository(db);

    const id = await repo.save("hash-abc", payload);

    expect(id).toBe("user-1");
    expect(db.lastSql).toMatch(/ON CONFLICT \(address_hash\) DO UPDATE/);
    expect(db.lastParams).toEqual(["hash-abc", payload.encryptedDataKey, payload.iv, payload.authTag, payload.ciphertext]);
  });

  it("save() lança erro claro se nenhuma linha voltar", async () => {
    const db = fakeDb([]);
    const repo = new PostgresPhoneMappingRepository(db);

    await expect(repo.save("hash-abc", payload)).rejects.toThrow(/nenhum id retornado/);
  });

  it("findById() devolve null quando não encontra", async () => {
    const db = fakeDb([]);
    const repo = new PostgresPhoneMappingRepository(db);

    expect(await repo.findById("nao-existe")).toBeNull();
  });
});

describe("PostgresMonitoredAccountRepository", () => {
  it("add() registra conta em qualquer chain/token informado, sem lista fechada no SQL", async () => {
    const db = fakeDb([{ id: "account-1" }]);
    const repo = new PostgresMonitoredAccountRepository(db);

    const id = await repo.add({
      userId: "user-1",
      chainKey: "base",
      tokenAddress: "0xTOKEN",
      watchedAddress: "0xWATCHED",
    });

    expect(id).toBe("account-1");
    expect(db.lastParams).toEqual(["user-1", "base", "0xTOKEN", "0xWATCHED"]);
  });

  it("listAll() mapeia snake_case do banco pra camelCase do domínio", async () => {
    const db = fakeDb([
      { id: "a1", user_id: "u1", chain_key: "tempo", token_address: "0xT", watched_address: "0xW" },
    ]);
    const repo = new PostgresMonitoredAccountRepository(db);

    const accounts = await repo.listAll();

    expect(accounts).toEqual([
      { id: "a1", userId: "u1", chainKey: "tempo", tokenAddress: "0xT", watchedAddress: "0xW" },
    ]);
  });

  it("listForUser() filtra só as contas daquele usuário", async () => {
    const db = fakeDb([
      { id: "a1", user_id: "u1", chain_key: "tempo", token_address: "0xT", watched_address: "0xW" },
    ]);
    const repo = new PostgresMonitoredAccountRepository(db);

    await repo.listForUser("u1");

    expect(db.lastSql).toMatch(/WHERE user_id = \$1/);
    expect(db.lastParams).toEqual(["u1"]);
  });

  it("remove() só apaga se a conta pertencer ao usuário, retorna false se nada foi apagado", async () => {
    const dbHit = fakeDb([], 1);
    const repo = new PostgresMonitoredAccountRepository(dbHit);
    expect(await repo.remove("a1", "u1")).toBe(true);
    expect(dbHit.lastSql).toMatch(/WHERE id = \$1 AND user_id = \$2/);

    const dbMiss = fakeDb([], 0);
    const repoMiss = new PostgresMonitoredAccountRepository(dbMiss);
    expect(await repoMiss.remove("a1", "outro-usuario")).toBe(false);
  });
});

describe("PostgresDashboardUserRepository", () => {
  it("findByUsername() mapeia a linha pro formato DashboardUser", async () => {
    const db = fakeDb([{ user_id: "u1", password_hash: "hash", totp_secret: "secret" }]);
    const repo = new PostgresDashboardUserRepository(db);

    expect(await repo.findByUsername("dono")).toEqual({
      userId: "u1",
      passwordHash: "hash",
      totpSecret: "secret",
    });
  });

  it("findByUsername() devolve null quando não encontra", async () => {
    const repo = new PostgresDashboardUserRepository(fakeDb([]));
    expect(await repo.findByUsername("nao-existe")).toBeNull();
  });

  it("create() grava com o MESMO userId de phone_mappings - unifica identidade", async () => {
    const db = fakeDb();
    const repo = new PostgresDashboardUserRepository(db);

    await repo.create({ userId: "u1", username: "dono", passwordHash: "hash", totpSecret: "secret" });

    expect(db.lastParams).toEqual(["u1", "dono", "hash", "secret"]);
  });
});

describe("PostgresThresholdsRepository", () => {
  const thresholds: UserThresholds = {
    userId: "u1",
    maxBalanceDropPct: 20,
    criticalBalanceDropPct: 50,
    windowMinutes: 10,
    blockedTransferAlertThreshold: 1_000_000n,
    criticalBlockedTransferThreshold: 10_000_000n,
  };

  it("upsert() converte bigint pra string nos parâmetros (NUMERIC do Postgres)", async () => {
    const db = fakeDb();
    const repo = new PostgresThresholdsRepository(db);

    await repo.upsert(thresholds);

    expect(db.lastParams).toEqual(["u1", 20, 50, 10, "1000000", "10000000"]);
  });

  it("get() converte de volta string/NUMERIC pra number/bigint", async () => {
    const db = fakeDb([
      {
        user_id: "u1",
        max_balance_drop_pct: "20",
        critical_balance_drop_pct: "50",
        window_minutes: 10,
        blocked_transfer_alert_threshold: "1000000",
        critical_blocked_transfer_threshold: "10000000",
      },
    ]);
    const repo = new PostgresThresholdsRepository(db);

    expect(await repo.get("u1")).toEqual(thresholds);
  });

  it("get() devolve null quando o usuário ainda não configurou limiares", async () => {
    const repo = new PostgresThresholdsRepository(fakeDb([]));
    expect(await repo.get("sem-config")).toBeNull();
  });
});

describe("PostgresAlertLog", () => {
  it("record() grava severidade e canal de entrega", async () => {
    const db = fakeDb();
    const log = new PostgresAlertLog(db);

    await log.record({ alertId: "a1", userId: "u1", kind: "balance-drop", severity: "critical", deliveredVia: "voice" });

    expect(db.lastParams).toEqual(["a1", "u1", "balance-drop", "critical", "voice"]);
  });

  it("updatePinStatus() atualiza pela alert_id", async () => {
    const db = fakeDb();
    const log = new PostgresAlertLog(db);

    await log.updatePinStatus("a1", "valid");

    expect(db.lastParams).toEqual(["a1", "valid"]);
  });

  it("detailedForUser() traz severidade, canal e status do PIN pra tela de histórico", async () => {
    const db = fakeDb([
      {
        alert_id: "a1",
        kind: "balance-drop",
        severity: "critical",
        delivered_via: "voice",
        pin_status: "valid",
        created_at: new Date("2026-10-03T00:00:00Z"),
      },
    ]);
    const log = new PostgresAlertLog(db);

    expect(await log.detailedForUser("u1")).toEqual([
      {
        alertId: "a1",
        kind: "balance-drop",
        severity: "critical",
        deliveredVia: "voice",
        pinStatus: "valid",
        createdAt: new Date("2026-10-03T00:00:00Z"),
      },
    ]);
  });
});
