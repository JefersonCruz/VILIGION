import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createDashboardServer, type DashboardServerDeps } from "./server.js";
import { hashPassword } from "./password.js";
import { generateBase32Secret, generateTotp } from "./totp.js";
import type { UserThresholds } from "../engine/rules/detection-rules.js";

describe("POST /thresholds - validação no servidor", () => {
  const totpSecret = generateBase32Secret();
  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;
  let saved: UserThresholds;

  beforeEach(async () => {
    saved = {
      userId: "user-1",
      maxBalanceDropPct: 20,
      criticalBalanceDropPct: 50,
      windowMinutes: 60,
      blockedTransferAlertThreshold: 1_000_000n,
      criticalBlockedTransferThreshold: 10_000_000n,
    };
    const deps = {
      users: { async findByUsername() { return { userId: "user-1", passwordHash: hashPassword("senha-forte-123"), totpSecret }; } },
      accounts: { async getDetails() { return { address: "0x0", balanceRaw: "250000000000", lastAlerts: [] }; } },
      thresholds: {
        async get() { return saved; },
        async upsert(t: UserThresholds) { saved = t; },
      },
    } as unknown as DashboardServerDeps;
    server = createDashboardServer(deps);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function login(): Promise<string> {
    const res = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "dono", password: "senha-forte-123", totpCode: generateTotp(totpSecret) }),
      redirect: "manual",
    });
    return (res.headers.get("set-cookie") as string).split(";")[0] as string;
  }

  function post(cookie: string, fields: Record<string, string>) {
    return fetch(`${baseUrl}/thresholds`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams(fields),
      redirect: "manual",
    });
  }

  const valid = {
    maxBalanceDropPct: "10",
    criticalBalanceDropPct: "30",
    windowMinutes: "60",
    blockedWarnUsd: "2",
    blockedCritUsd: "20,5",
  };

  it("grava e redireciona quando os valores são coerentes", async () => {
    const res = await post(await login(), valid);
    expect(res.status).toBe(302);
    expect(saved.maxBalanceDropPct).toBe(10);
    expect(saved.blockedTransferAlertThreshold).toBe(2_000_000n);
    expect(saved.criticalBlockedTransferThreshold).toBe(20_500_000n);
    expect(res.headers.get("location")).toBe("/thresholds?salvo=1");
  });

  it("rejeita crítico <= aviso com 400, mensagem clara, e não grava", async () => {
    const res = await post(await login(), { ...valid, criticalBalanceDropPct: "10" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("maior que o limite de e-mail");
    expect(saved.maxBalanceDropPct).toBe(20);
  });

  it("rejeita percentual absurdo, janela fora da faixa e campo vazio", async () => {
    const cookie = await login();
    expect((await post(cookie, { ...valid, criticalBalanceDropPct: "500" })).status).toBe(400);
    expect((await post(cookie, { ...valid, windowMinutes: "0" })).status).toBe(400);
    expect((await post(cookie, { ...valid, windowMinutes: "" })).status).toBe(400);
    expect(saved.maxBalanceDropPct).toBe(20);
  });

  it("GET /thresholds mostra os valores salvos em US$, o saldo real na prévia e os perfis", async () => {
    const res = await fetch(`${baseUrl}/thresholds`, { headers: { Cookie: await login() } });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('name="blockedWarnUsd" type="text" inputmode="decimal" value="1"'); // 1_000_000 unidades = US$ 1
    expect(html).toContain("US$ 250.000"); // saldo real, não o exemplo
    expect(html).toContain("saldo real");
    expect(html).toContain('"key":"equilibrado"');
  });

  it("aceita ?salvo=1 e mostra confirmação", async () => {
    const res = await fetch(`${baseUrl}/thresholds?salvo=1`, { headers: { Cookie: await login() } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"justSaved":true');
  });

  it("depois de um erro, a página volta com o que o usuário digitou, não com o valor salvo", async () => {
    const res = await post(await login(), { ...valid, maxBalanceDropPct: "40", criticalBalanceDropPct: "35" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('name="maxBalanceDropPct" type="number" min="0.1" max="100" step="0.1" value="40"');
    expect(html).toContain('"saved":{"warn":20');
  });

  it("valor em dólar inválido (mais de 6 casas) é rejeitado sem gravar", async () => {
    const res = await post(await login(), { ...valid, blockedWarnUsd: "1,1234567" });
    expect(res.status).toBe(400);
    expect(saved.maxBalanceDropPct).toBe(20);
  });
});
