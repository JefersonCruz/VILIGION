import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createDashboardServer, type DashboardServerDeps, type MonitorControlPort } from "./server.js";
import { hashPassword } from "./password.js";
import { generateBase32Secret } from "./totp.js";

/**
 * O acesso de avaliação (jurado) é UM FATOR, e por isso a promessa que o
 * sustenta é a restrição de escrita e a negação de `/recipients` - o README e
 * o SECURITY.md afirmam que essa sessão não troca destinatário, não dispara
 * alerta e não vê para onde o alerta vai.
 *
 * Esta suíte existe porque essa promessa dependia de um `Set` em memória com
 * limite de 200 tokens que DESCARTA O MAIS ANTIGO quando enche. O descarte é
 * por VOLUME, não por idade - e quem abre as sessões escolhe o volume. Pior:
 * o login de jurado chama `loginLimiter.reset()` quando dá certo, então
 * repetir o login não encontra limite nenhum.
 *
 * O número de telefone usado aqui é inventado, e os dados vêm de fakes
 * injetados nas portas - nada real entra em teste.
 */
describe("sessão de avaliação: a restrição não pode se perder por volume", () => {
  const USERNAME = "dono";
  const JUDGE_PASSWORD = "avaliacao-longa-o-suficiente";
  const USER_ID = "user-1";
  const TELEFONE_FICTICIO = "+55 11 90000-0000";

  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;

  function buildDeps(): DashboardServerDeps {
    const monitorControl: MonitorControlPort = {
      async start() {},
      async stop() {},
    };
    return {
      users: {
        async findByUsername(username) {
          if (username !== USERNAME) return null;
          return { userId: USER_ID, passwordHash: hashPassword("senha-forte-123"), totpSecret: generateBase32Secret() };
        },
      },
      accounts: {
        async getDetails() {
          return { address: "0x0", balanceRaw: "0", lastAlerts: [] };
        },
      },
      monitoredAccounts: {
        async listForUser() {
          return [];
        },
        async add() {
          return "acc-1";
        },
        async remove() {
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
          return [{ id: "r1", kind: "phone" as const, value: TELEFONE_FICTICIO, verified: true }];
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
    /*
     * Relógio fixado ANTES do prazo de `JUDGE_ACCESS_EXPIRES_AT`.
     *
     * Sem isto o teste pararia de exercitar o caminho quando o prazo
     * passasse - e passaria a "passar" sem testar nada, que é o pior estado
     * possível para um teste de controle de acesso. `shouldAdvanceTime` mantém
     * os temporizadores reais andando, senão o HTTP do próprio teste travaria.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-11-01T12:00:00Z") });
    process.env.JUDGE_ACCESS_USERNAME = USERNAME;
    process.env.JUDGE_ACCESS_PASSWORD = JUDGE_PASSWORD;
    server = createDashboardServer(buildDeps());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    delete process.env.JUDGE_ACCESS_USERNAME;
    delete process.env.JUDGE_ACCESS_PASSWORD;
    vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Login de jurado: um fator, sem código de autenticador. Devolve o cookie. */
  async function loginDeJurado(): Promise<string> {
    const res = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: USERNAME, password: JUDGE_PASSWORD }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const cookie = res.headers.get("set-cookie");
    if (!cookie) throw new Error("login de jurado não devolveu cookie");
    return cookie.split(";")[0] as string;
  }

  const verRecipients = (cookie: string) => fetch(`${baseUrl}/recipients`, { headers: { Cookie: cookie }, redirect: "manual" });

  it("a sessão de avaliação não vê para onde o alerta vai", async () => {
    const cookie = await loginDeJurado();
    const res = await verRecipients(cookie);

    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(TELEFONE_FICTICIO);
  });

  it("abrir muitas sessões NÃO derruba a restrição da primeira", async () => {
    const primeira = await loginDeJurado();
    expect((await verRecipients(primeira)).status).toBe(403);

    /*
     * Cada login de jurado bem-sucedido chama `loginLimiter.reset()`, então
     * isto não encontra barreira alguma. O teto do conjunto antigo era 200;
     * este número fica acima dele de propósito, pra o teste não depender de
     * uma constante que não existe mais nem de qual era o valor dela.
     */
    for (let i = 0; i < 250; i++) await loginDeJurado();

    const res = await verRecipients(primeira);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(TELEFONE_FICTICIO);
  }, 60_000);
});
