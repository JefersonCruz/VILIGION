import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createDashboardServer, type DashboardServerDeps } from "./server.js";
import { InMemoryWaitlistRepository } from "./waitlist.js";

describe("waitlist - landing pública", () => {
  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;
  let waitlist: InMemoryWaitlistRepository;

  function buildDeps(): DashboardServerDeps {
    waitlist = new InMemoryWaitlistRepository();
    return { waitlist } as unknown as DashboardServerDeps;
  }

  beforeEach(async () => {
    delete process.env.WAITLIST_ADMIN_TOKEN;
    server = createDashboardServer(buildDeps());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    delete process.env.WAITLIST_ADMIN_TOKEN;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function submit(fields: Record<string, string>, ip = "1.1.1.1") {
    return fetch(`${baseUrl}/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": ip },
      body: new URLSearchParams(fields),
      redirect: "manual",
    });
  }

  it("GET / mostra a landing com o formulário para visitante sem sessão", async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('action="/waitlist"');
  });

  it("inscrição válida grava e redireciona; e-mail repetido não duplica", async () => {
    const res = await submit({ email: "Ana@Empresa.com", profile: "treasury", note: "medo de coação" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("ok=1");
    await submit({ email: "ana@empresa.com", profile: "treasury", note: "" });

    const entries = await waitlist.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ email: "ana@empresa.com", profile: "treasury", note: "medo de coação" });
  });

  it("rejeita e-mail inválido e perfil desconhecido", async () => {
    expect((await submit({ email: "nao-e-email", profile: "treasury" })).status).toBe(400);
    expect((await submit({ email: "a@b.com", profile: "hacker" })).status).toBe(400);
    expect(await waitlist.list()).toHaveLength(0);
  });

  it("limita inscrições por IP", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await submit({ email: `u${i}@b.com`, profile: "other" }, "9.9.9.9")).status).toBe(302);
    }
    expect((await submit({ email: "u6@b.com", profile: "other" }, "9.9.9.9")).status).toBe(429);
  });

  it("/admin/waitlist: 404 sem token configurado; 401 com token errado; 200 com token certo", async () => {
    expect((await fetch(`${baseUrl}/admin/waitlist`)).status).toBe(404);

    process.env.WAITLIST_ADMIN_TOKEN = "segredo-de-teste";
    expect((await fetch(`${baseUrl}/admin/waitlist`, { headers: { Authorization: "Bearer errado" } })).status).toBe(401);

    await submit({ email: "x@y.com", profile: "builder" });
    const ok = await fetch(`${baseUrl}/admin/waitlist`, { headers: { Authorization: "Bearer segredo-de-teste" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ total: 1 });
  });
});
