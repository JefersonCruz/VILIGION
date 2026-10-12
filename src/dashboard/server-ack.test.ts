import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createDashboardServer, type DashboardServerDeps } from "./server.js";
import { InMemoryAlertLog } from "./in-memory-repositories.js";
import { hashPassword } from "./password.js";
import { generateBase32Secret, generateTotp } from "./totp.js";

/**
 * Confirmação de alerta pelo painel.
 *
 * Existe porque até 2026-10-12 o único caminho de confirmação era digitar o
 * PIN na ligação - quem usa só o canal de push não tinha NENHUMA forma de
 * confirmar, e o histórico ficava "—" para sempre.
 *
 * Usa o InMemoryAlertLog de verdade, não um fake inventado no teste: as
 * proteções que importam (só o dono; não sobrescreve desfecho existente)
 * moram na implementação do repositório, então testá-las contra um fake
 * provaria só que o fake funciona.
 */
describe("dashboard server - confirmação de alerta pelo dono", () => {
  const USERNAME = "dono";
  const PASSWORD = "senha-forte-123";
  const USER_ID = "user-1";
  const OUTRO_USER = "user-2";
  const totpSecret = generateBase32Secret();

  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;
  let alertLog: InMemoryAlertLog;

  beforeEach(async () => {
    alertLog = new InMemoryAlertLog();

    const deps: DashboardServerDeps = {
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
      alertHistory: alertLog,
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
      monitorControl: {
        async start() {},
        async stop() {},
      },
    };

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
      body: new URLSearchParams({ username: USERNAME, password: PASSWORD, totpCode: generateTotp(totpSecret) }),
      redirect: "manual",
    });
    const cookie = res.headers.get("set-cookie");
    if (!cookie) throw new Error("login não devolveu cookie");
    return cookie.split(";")[0] as string;
  }

  function registrarAlerta(alertId: string, userId = USER_ID): void {
    alertLog.record({ alertId, userId, kind: "balance-drop", severity: "critical", deliveredVia: "push" });
  }

  async function confirmar(cookie: string, alertId: string, outcome: string): Promise<Response> {
    return fetch(`${baseUrl}/alerts/${encodeURIComponent(alertId)}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ outcome }),
      redirect: "manual",
    });
  }

  function statusDe(alertId: string): string | null {
    return alertLog.recentForUser(USER_ID, 50).find((e) => e.alertId === alertId)?.pinStatus ?? null;
  }

  it("dono confirma que a movimentação era esperada", async () => {
    registrarAlerta("a1");

    const res = await confirmar(await login(), "a1", "mine");

    expect(res.status).toBe(302);
    expect(statusDe("a1")).toBe("acknowledged-expected");
  });

  it("dono registra que NÃO reconhece a movimentação - o sinal mais valioso do produto", async () => {
    registrarAlerta("a2");

    await confirmar(await login(), "a2", "not-mine");

    expect(statusDe("a2")).toBe("acknowledged-unauthorized");
  });

  it("não sobrescreve desfecho já registrado - confirmar algo que falhou na entrega seria registro falso", async () => {
    registrarAlerta("a3");
    alertLog.updatePinStatus("a3", "delivery-failed");

    await confirmar(await login(), "a3", "mine");

    expect(statusDe("a3")).toBe("delivery-failed");
  });

  it("não sobrescreve o PIN digitado na ligação", async () => {
    registrarAlerta("a4");
    alertLog.updatePinStatus("a4", "valid");

    await confirmar(await login(), "a4", "not-mine");

    expect(statusDe("a4")).toBe("valid");
  });

  it("um usuário não confirma alerta de outro", async () => {
    registrarAlerta("a5", OUTRO_USER);

    await confirmar(await login(), "a5", "mine");

    expect(alertLog.recentForUser(OUTRO_USER, 50).find((e) => e.alertId === "a5")?.pinStatus).toBeNull();
  });

  it("exige sessão - sem login não grava nada", async () => {
    registrarAlerta("a6");

    const res = await confirmar("", "a6", "mine");

    // Sem sessão também responde 302 - mas pro /login, não de volta pro
    // histórico. O que prova a proteção é o destino somado ao não-gravado.
    expect(res.headers.get("location")).toBe("/login");
    expect(statusDe("a6")).toBeNull();
  });

  it("ignora desfecho fora dos dois valores aceitos, em vez de gravar texto arbitrário", async () => {
    registrarAlerta("a7");

    await confirmar(await login(), "a7", "qualquer-coisa");

    expect(statusDe("a7")).toBeNull();
  });

  describe("tela de histórico", () => {
    it("oferece os dois botões enquanto não há desfecho", async () => {
      registrarAlerta("a8");

      const html = await (await fetch(`${baseUrl}/alerts`, { headers: { Cookie: await login() } })).text();

      expect(html).toContain('value="mine"');
      expect(html).toContain('value="not-mine"');
    });

    it("troca os botões pelo rótulo depois de confirmado", async () => {
      registrarAlerta("a9");
      alertLog.updatePinStatus("a9", "acknowledged-unauthorized");

      const html = await (await fetch(`${baseUrl}/alerts`, { headers: { Cookie: await login() } })).text();

      expect(html).toContain("NÃO reconhecido");
      expect(html).not.toContain('value="not-mine"');
    });
  });
});
