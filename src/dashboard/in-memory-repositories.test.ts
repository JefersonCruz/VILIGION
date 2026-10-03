import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { verifyPassword } from "./password.js";
import { verifyTotp } from "./totp.js";
import {
  InMemoryAccountDetailsRepository,
  InMemoryAlertLog,
  InMemoryMonitoredAccountsRepository,
  InMemoryPhoneMappingRepository,
  InMemoryThresholdsRepository,
  InMemoryUserRepository,
} from "./in-memory-repositories.js";

describe("InMemoryUserRepository", () => {
  it("createDemoUser devolve credenciais que realmente validam contra o usuário criado", async () => {
    const users = new InMemoryUserRepository();
    const creds = users.createDemoUser("demo");

    const stored = await users.findByUsername("demo");
    expect(stored).not.toBeNull();
    expect(verifyPassword(creds.password, stored!.passwordHash)).toBe(true);
    expect(verifyTotp(stored!.totpSecret, "000000")).toBe(false); // sanity: TOTP não é sempre válido
  });

  it("otpAuthUri aponta pro mesmo segredo armazenado", async () => {
    const users = new InMemoryUserRepository();
    const creds = users.createDemoUser("demo");
    const stored = await users.findByUsername("demo");

    expect(creds.otpAuthUri).toContain(`secret=${stored!.totpSecret}`);
  });

  it("usuário inexistente retorna null, não lança erro", async () => {
    const users = new InMemoryUserRepository();
    expect(await users.findByUsername("ninguem")).toBeNull();
  });
});

describe("InMemoryAlertLog + InMemoryAccountDetailsRepository", () => {
  const ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;
  const USER_ID = "qualquer-user-id";

  function record(log: InMemoryAlertLog, kind: string, userId = USER_ID) {
    log.record({ alertId: `${kind}-${Math.random()}`, userId, kind, severity: "normal", deliveredVia: "email" });
  }

  it("getDetails reflete o saldo atual e os alertas registrados, mais recente primeiro", async () => {
    const log = new InMemoryAlertLog();
    record(log, "balance-drop");
    record(log, "transfer-blocked");

    const accounts = new InMemoryAccountDetailsRepository(ADDRESS, log, async () => 123_456n);
    const details = await accounts.getDetails(USER_ID);

    expect(details.address).toBe(ADDRESS);
    expect(details.balanceRaw).toBe("123456");
    expect(details.lastAlerts.map((a) => a.kind)).toEqual(["transfer-blocked", "balance-drop"]);
  });

  it("sem alertas, lastAlerts vem vazio", async () => {
    const log = new InMemoryAlertLog();
    const accounts = new InMemoryAccountDetailsRepository(ADDRESS, log, async () => 0n);
    const details = await accounts.getDetails(USER_ID);

    expect(details.lastAlerts).toHaveLength(0);
  });

  it("recentForUser() respeita o limite passado e isola por usuário", () => {
    const log = new InMemoryAlertLog();
    for (let i = 0; i < 15; i++) record(log, `evento-${i}`);
    record(log, "de-outro-usuario", "outro-user-id");

    expect(log.recentForUser(USER_ID, 5)).toHaveLength(5);
    expect(log.recentForUser("outro-user-id")).toHaveLength(1);
  });

  it("updatePinStatus() atualiza o status do PIN daquele alertId específico", () => {
    const log = new InMemoryAlertLog();
    log.record({ alertId: "a1", userId: USER_ID, kind: "balance-drop", severity: "critical", deliveredVia: "voice" });

    log.updatePinStatus("a1", "valid");

    expect(log.recentForUser(USER_ID)[0]?.pinStatus).toBe("valid");
  });
});

describe("InMemoryMonitoredAccountsRepository", () => {
  it("isola contas por usuário e permite remover só a do dono", async () => {
    const repo = new InMemoryMonitoredAccountsRepository();
    const id = await repo.add({ userId: "u1", chainKey: "tempo", tokenAddress: "0xT", watchedAddress: "0xW" });
    await repo.add({ userId: "u2", chainKey: "base", tokenAddress: "0xT2", watchedAddress: "0xW2" });

    expect(await repo.listForUser("u1")).toHaveLength(1);
    expect(await repo.remove(id, "u2")).toBe(false); // não é dono, não remove
    expect(await repo.listForUser("u1")).toHaveLength(1);
    expect(await repo.remove(id, "u1")).toBe(true);
    expect(await repo.listForUser("u1")).toHaveLength(0);
  });
});

describe("InMemoryThresholdsRepository", () => {
  it("get() devolve null antes de qualquer upsert, e os valores salvos depois", async () => {
    const repo = new InMemoryThresholdsRepository();
    expect(await repo.get("u1")).toBeNull();

    const thresholds = {
      userId: "u1",
      maxBalanceDropPct: 20,
      criticalBalanceDropPct: 50,
      windowMinutes: 10,
      blockedTransferAlertThreshold: 1_000_000n,
      criticalBlockedTransferThreshold: 10_000_000n,
    };
    await repo.upsert(thresholds);

    expect(await repo.get("u1")).toEqual(thresholds);
  });
});

describe("InMemoryPhoneMappingRepository", () => {
  it("save() é idempotente por address_hash - mesmo hash reusa o mesmo id", async () => {
    const repo = new InMemoryPhoneMappingRepository();
    const payload = {
      encryptedDataKey: Buffer.from("k"),
      iv: Buffer.from("i"),
      authTag: Buffer.from("t"),
      ciphertext: Buffer.from("c"),
    };

    const id1 = await repo.save("hash-abc", payload);
    const id2 = await repo.save("hash-abc", payload);

    expect(id1).toBe(id2);
  });
});
