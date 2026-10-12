import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createDashboardServer, type DashboardServerDeps } from "./server.js";
import { hashPassword } from "./password.js";
import { generateBase32Secret, generateTotp } from "./totp.js";

/**
 * Exercita o canal crítico SEM número de telefone (Web Push) pelo servidor
 * HTTP de verdade - ver src/alerts/web-push.ts sobre por que este canal
 * existe (o número de telefone é o único dado do fluxo de alerta que não dá
 * pra proteger depois de criado).
 *
 * O teste que mais importa aqui é o último: a tela de destinatários NUNCA
 * pode renderizar o endpoint de push inteiro. Um endpoint é uma capacidade -
 * quem tem, notifica o dispositivo -, então vazá-lo no HTML seria o mesmo
 * tipo de erro que imprimir o telefone do dono.
 */
describe("dashboard server - Web Push (canal crítico sem telefone)", () => {
  const USERNAME = "dono";
  const PASSWORD = "senha-forte-123";
  const USER_ID = "user-1";
  const VAPID_PUBLIC = "BFakePublicKeyForTests_1234567890";
  const totpSecret = generateBase32Secret();

  const ENDPOINT = "https://fcm.googleapis.com/fcm/send/ENDPOINT-SECRETO-NAO-PODE-APARECER";
  const subscription = { endpoint: ENDPOINT, keys: { p256dh: "chaveP256dh", auth: "chaveAuth" } };

  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;
  let stored: Array<{ id: string; kind: "phone" | "email" | "push"; value: string }>;

  function buildDeps(overrides?: Partial<DashboardServerDeps>): DashboardServerDeps {
    stored = [];
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
          return stored;
        },
        async add(input) {
          const id = `r-${stored.length + 1}`;
          stored.push({ id, kind: input.kind, value: input.value });
          return id;
        },
        async remove() {
          return true;
        },
      },
      monitorControl: {
        async start() {},
        async stop() {},
      },
      pushPublicKey: VAPID_PUBLIC,
      ...overrides,
    };
  }

  async function start(deps: DashboardServerDeps): Promise<void> {
    server = createDashboardServer(deps);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  }

  beforeEach(async () => {
    await start(buildDeps());
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
    if (!cookie) throw new Error("login não devolveu cookie de sessão");
    return cookie.split(";")[0] as string;
  }

  async function subscribe(cookie: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
      redirect: "manual",
    });
  }

  describe("ativos de PWA", () => {
    it("serve o service worker com escopo de raiz - sem isso ele não recebe push da aba fechada", async () => {
      const res = await fetch(`${baseUrl}/sw.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/javascript");
      expect(res.headers.get("service-worker-allowed")).toBe("/");
      expect(await res.text()).toContain('addEventListener("push"');
    });

    it("serve o manifest apontando pro painel, não pra landing - quem instalou já é usuário", async () => {
      const res = await fetch(`${baseUrl}/manifest.json`);
      expect(res.status).toBe(200);
      const manifest = await res.json();
      expect(manifest.start_url).toBe("/dashboard");
      expect(manifest.icons[0].src).toBe("/icon.png");
    });

    it("serve o ícone do app como PNG de verdade", async () => {
      const res = await fetch(`${baseUrl}/icon.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    });

    it("ativos de PWA não exigem sessão - o service worker é registrado antes de qualquer alerta", async () => {
      for (const path of ["/sw.js", "/manifest.json", "/icon.png"]) {
        expect((await fetch(`${baseUrl}${path}`)).status).toBe(200);
      }
    });
  });

  describe("GET /push/config", () => {
    it("entrega a chave VAPID pública quando configurada", async () => {
      const res = await fetch(`${baseUrl}/push/config`, { headers: { Cookie: await login() } });
      expect(res.status).toBe(200);
      expect((await res.json()).publicKey).toBe(VAPID_PUBLIC);
    });

    it("responde 404 sem chave configurada - capacidade ausente não finge existir", async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await start(buildDeps({ pushPublicKey: undefined }));

      expect((await fetch(`${baseUrl}/push/config`)).status).toBe(404);
    });
  });

  describe("POST /push/subscribe", () => {
    it("guarda a inscrição como destinatário kind='push', na mesma tabela criptografada do telefone", async () => {
      const res = await subscribe(await login(), subscription);

      expect(res.status).toBe(200);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.kind).toBe("push");
      expect(JSON.parse(stored[0]!.value).endpoint).toBe(ENDPOINT);
    });

    it("exige sessão - sem login não registra dispositivo nenhum", async () => {
      const res = await subscribe("", subscription);

      expect(res.status).not.toBe(200);
      expect(stored).toHaveLength(0);
    });

    it("rejeita inscrição inválida com 400, em vez de guardar lixo que só falharia no alerta", async () => {
      const cookie = await login();

      expect((await subscribe(cookie, { endpoint: "http://inseguro.example.com/x", keys: { p256dh: "a", auth: "b" } })).status).toBe(400);
      expect((await subscribe(cookie, { endpoint: ENDPOINT })).status).toBe(400);
      expect((await subscribe(cookie, "nem é objeto")).status).toBe(400);
      expect(stored).toHaveLength(0);
    });

    it("é idempotente por dispositivo - clicar duas vezes não cria duplicata indistinguível na lista", async () => {
      const cookie = await login();

      await subscribe(cookie, subscription);
      await subscribe(cookie, subscription);

      expect(stored).toHaveLength(1);
    });

    it("não registra nada se o push não estiver configurado no servidor", async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await start(buildDeps({ pushPublicKey: undefined }));

      const res = await subscribe(await login(), subscription);

      expect(res.status).toBe(404);
      expect(stored).toHaveLength(0);
    });
  });

  describe("privacidade na tela de destinatários", () => {
    it("NUNCA renderiza o endpoint de push inteiro - só o host do push service", async () => {
      const cookie = await login();
      await subscribe(cookie, subscription);

      const html = await (await fetch(`${baseUrl}/recipients`, { headers: { Cookie: cookie } })).text();

      expect(html).not.toContain("ENDPOINT-SECRETO-NAO-PODE-APARECER");
      expect(html).not.toContain("chaveP256dh");
      expect(html).not.toContain("chaveAuth");
      expect(html).toContain("fcm.googleapis.com");
    });

    it("oferece o registro de dispositivo só quando o canal está configurado", async () => {
      const cookie = await login();
      expect(await (await fetch(`${baseUrl}/recipients`, { headers: { Cookie: cookie } })).text()).toContain("pushEnable");

      await new Promise<void>((resolve) => server.close(() => resolve()));
      await start(buildDeps({ pushPublicKey: undefined }));

      const cookieSemPush = await login();
      expect(await (await fetch(`${baseUrl}/recipients`, { headers: { Cookie: cookieSemPush } })).text()).not.toContain("pushEnable");
    });

    it("mostra que um dispositivo corrompido no banco não quebra a tela", async () => {
      const cookie = await login();
      stored.push({ id: "r-ruim", kind: "push", value: "{json quebrado" });

      const res = await fetch(`${baseUrl}/recipients`, { headers: { Cookie: cookie } });

      expect(res.status).toBe(200);
      expect(await res.text()).toContain("dispositivo desconhecido");
    });
  });
});
