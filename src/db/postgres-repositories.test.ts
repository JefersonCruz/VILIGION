import { describe, expect, it, vi } from "vitest";
import {
  PostgresAlertLog,
  PostgresMonitoredAccountRepository,
  PostgresPhoneMappingRepository,
  type Queryable,
} from "./postgres-repositories.js";
import type { EncryptedPayload } from "../privacy/encryption.js";

/** Queryable falso - grava a última chamada e devolve linhas pré-programadas, nunca toca rede/disco. */
function fakeDb(rows: unknown[] = []): Queryable & { lastSql: string; lastParams: unknown[] } {
  const state = { lastSql: "", lastParams: [] as unknown[] };
  return {
    ...state,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      state.lastSql = sql;
      state.lastParams = params ?? [];
      return { rows };
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
});
