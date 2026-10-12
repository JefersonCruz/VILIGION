import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createDashboardServer, type DashboardServerDeps, type MonitorControlPort } from "./server.js";
import { hashPassword } from "./password.js";
import { generateBase32Secret, generateTotp } from "./totp.js";

/**
 * Exercita o servidor real (HTTP de verdade, não chamada direta de função)
 * contra fakes injetados nas portas - mesmo princípio dos smoke tests manuais
 * por curl já feitos nesta sessão, automatizado aqui porque não há Postgres
 * disponível neste ambiente pra repetir via mainWithDatabase de verdade.
 *
 * Prova especificamente a correção de 2026-10-04 ("conta nova só era
 * monitorada depois de reiniciar o processo"): /accounts deve chamar
 * monitorControl.start/stop em tempo real, não só gravar no banco.
 */
describe("dashboard server - registro dinâmico de monitor", () => {
  const USERNAME = "dono";
  const PASSWORD = "senha-forte-123";
  const USER_ID = "user-1";
  const totpSecret = generateBase32Secret();
  /** Enderecos com formato VALIDO: /accounts passou a validar via viem#isAddress. */
  const TOKEN_ADDRESS = "0x20c0000000000000000000000000000000000000";
  const WATCHED_ADDRESS = "0x4f3a9c2b7e81d5460a1f8c3b2d9e7f6a0b1c2d34";

  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;
  let monitorControl: MonitorControlPort & { started: unknown[]; stopped: string[] };

  function buildDeps(): DashboardServerDeps {
    const accountsById = new Map<string, { id: string; chainKey: string; tokenAddress: string; watchedAddress: string }>();

    monitorControl = {
      started: [],
      stopped: [],
      async start(account) {
        this.started.push(account);
      },
      async stop(accountId) {
        this.stopped.push(accountId);
      },
    };

    return {
      users: {
        async findByUsername(username) {
          if (username !== USERNAME) return null;
          return { userId: USER_ID, passwordHash: hashPassword(PASSWORD), totpSecret };
        },
      },
      accounts: {
        async getDetails() {
          return { address: "0x0", balanceRaw: "0", lastAlerts: [] };
        },
      },
      monitoredAccounts: {
        async listForUser(userId) {
          return [...accountsById.values()].filter(() => userId === USER_ID);
        },
        async add(input) {
          const id = `acc-${accountsById.size + 1}`;
          accountsById.set(id, { id, chainKey: input.chainKey, tokenAddress: input.tokenAddress, watchedAddress: input.watchedAddress });
          return id;
        },
        async remove(id, userId) {
          if (userId !== USER_ID || !accountsById.has(id)) return false;
          accountsById.delete(id);
          return true;
        },
      },
      thresholds: {
        async get() {
          return null;
        },
        async upsert() {},
      },
      alertHistory: {
        async detailedForUser() {
          return [];
        },
        async acknowledge() {
          return false;
        },
      },
      signup: {
        async signup() {
          throw new Error("não usado neste teste");
        },
      },
      recipients: {
        async listForUser() {
          return [];
        },
        async add() {
          return "r1";
        },
        async remove() {
          return true;
        },
      },
      monitorControl,
    };
  }

  beforeEach(async () => {
    server = createDashboardServer(buildDeps());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function login(): Promise<string> {
    const code = generateTotp(totpSecret);
    const res = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: USERNAME, password: PASSWORD, totpCode: code }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const cookie = res.headers.get("set-cookie");
    if (!cookie) throw new Error("login não devolveu cookie de sessão");
    return cookie.split(";")[0] as string;
  }

  it("POST /accounts sobe o monitor na hora, sem precisar reiniciar o processo", async () => {
    const cookie = await login();

    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ chainKey: "tempo", tokenAddress: TOKEN_ADDRESS, watchedAddress: WATCHED_ADDRESS }),
      redirect: "manual",
    });

    expect(res.status).toBe(302); // redireciona pra /accounts normalmente
    expect(monitorControl.started).toHaveLength(1);
    expect(monitorControl.started[0]).toMatchObject({ chainKey: "tempo", tokenAddress: TOKEN_ADDRESS, watchedAddress: WATCHED_ADDRESS });
  });

  it("POST /accounts/:id/delete para o monitor na hora", async () => {
    const cookie = await login();

    await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ chainKey: "base", tokenAddress: "0x8ba1f109551bd432803012645ac136ddd64dba72", watchedAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984" }),
      redirect: "manual",
    });
    const accountId = (monitorControl.started[0] as { id: string }).id;

    const res = await fetch(`${baseUrl}/accounts/${accountId}/delete`, {
      method: "POST",
      headers: { Cookie: cookie },
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(monitorControl.stopped).toEqual([accountId]);
  });

  it("rejeita endereço mal formatado e NÃO sobe monitor - um typo criava monitor que falhava pra sempre", async () => {
    const cookie = await login();

    // Antes da validação, qualquer string era gravada: o monitor subia,
    // falhava em todo ciclo ao chamar balanceOf, e deixava a faixa de
    // monitoramento do painel em "degradado" permanentemente, sem explicar.
    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ chainKey: "tempo", tokenAddress: TOKEN_ADDRESS, watchedAddress: "nao-e-endereco" }),
      redirect: "manual",
    });

    expect(res.status).toBe(200); // volta pra tela com erro, não redireciona
    expect(await res.text()).toContain("Endereço monitorado inválido");
    expect(monitorControl.started).toHaveLength(0);
  });

  it("rejeita endereço de token mal formatado também", async () => {
    const cookie = await login();

    const res = await fetch(`${baseUrl}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ chainKey: "tempo", tokenAddress: "0x123", watchedAddress: WATCHED_ADDRESS }),
      redirect: "manual",
    });

    expect(await res.text()).toContain("Endereço do token inválido");
    expect(monitorControl.started).toHaveLength(0);
  });

  it("não para monitor nenhum se a remoção falhar (conta de outro usuário, por exemplo)", async () => {
    const cookie = await login();

    const res = await fetch(`${baseUrl}/accounts/conta-inexistente/delete`, {
      method: "POST",
      headers: { Cookie: cookie },
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(monitorControl.stopped).toHaveLength(0);
  });

  it("GET /healthz responde 200 sem precisar de sessão nem token admin (pra monitor de uptime externo)", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ok" });
    expect(typeof body.uptimeSeconds).toBe("number");
  });
});
