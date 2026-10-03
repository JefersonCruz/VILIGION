import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { verifyPassword } from "./password.js";
import { verifyTotp } from "./totp.js";
import {
  InMemoryAccountDetailsRepository,
  InMemoryAlertLog,
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

  it("getDetails reflete o saldo atual e os alertas registrados, mais recente primeiro", async () => {
    const log = new InMemoryAlertLog();
    log.record("balance-drop");
    log.record("transfer-blocked");

    const accounts = new InMemoryAccountDetailsRepository(ADDRESS, log, async () => 123_456n);
    const details = await accounts.getDetails("qualquer-user-id");

    expect(details.address).toBe(ADDRESS);
    expect(details.balanceRaw).toBe("123456");
    expect(details.lastAlerts.map((a) => a.kind)).toEqual(["transfer-blocked", "balance-drop"]);
  });

  it("sem alertas, lastAlerts vem vazio", async () => {
    const log = new InMemoryAlertLog();
    const accounts = new InMemoryAccountDetailsRepository(ADDRESS, log, async () => 0n);
    const details = await accounts.getDetails("qualquer-user-id");

    expect(details.lastAlerts).toHaveLength(0);
  });

  it("recent() respeita o limite passado", () => {
    const log = new InMemoryAlertLog();
    for (let i = 0; i < 15; i++) log.record(`evento-${i}`);

    expect(log.recent(5)).toHaveLength(5);
  });
});
