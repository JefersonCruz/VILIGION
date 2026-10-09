import { generateTotp } from "./src/dashboard/totp.ts";

const BASE = "https://viligion.com";
const USER = "henri";
const PASS = "dSjmGANqxMSdAwzTsTUJ";
const SECRET = "XSKAP6LIQMO3CRLYXP3GLT5DMOES52PS";

const body = new URLSearchParams({ username: USER, password: PASS, totpCode: generateTotp(SECRET) });
const login = await fetch(`${BASE}/session`, {
  method: "POST",
  body,
  headers: { "content-type": "application/x-www-form-urlencoded" },
  redirect: "manual",
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
console.log(`login -> ${login.status} ${login.headers.get("location") ?? ""} | cookie: ${cookie ? "ok" : "NENHUM"}`);
if (!cookie) process.exit(1);

for (const path of ["/dashboard", "/recipients", "/accounts", "/alerts", "/thresholds"]) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  const html = await res.text();
  const err = /class="error"/.test(html);
  console.log(`${path} -> ${res.status}${err ? "  *** BLOCO DE ERRO NA PAGINA ***" : ""}  (${html.length} bytes)`);
  if (path === "/recipients") {
    const rows = [...html.matchAll(/<td[^>]*>([^<]{3,60})<\/td>/g)].map((m) => m[1].trim());
    console.log("   destinatarios visiveis:", rows.length ? JSON.stringify(rows.slice(0, 8)) : "(nenhum)");
  }
  if (path === "/dashboard") {
    const code = [...html.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1]);
    console.log("   valores em <code>:", JSON.stringify(code.slice(0, 4)));
  }
}
