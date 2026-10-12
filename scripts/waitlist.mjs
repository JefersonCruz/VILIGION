/**
 * Mostra a lista de espera no terminal.
 *
 * Existe porque /admin/waitlist e protegido por Bearer token e, por isso, nao
 * abre no navegador - e nao ha (nem deve haver, de improviso) uma tela de
 * login de administrador. Em vez de criar superficie de autenticacao nova,
 * este script usa a protecao que ja existe.
 *
 * Rode pelo Railway, pra nao precisar manipular o token na mao:
 *
 *   railway run --service viligion-app -- node scripts/waitlist.mjs
 *
 * O `railway run` executa AQUI na sua maquina, mas com as variaveis do
 * servico injetadas - entao WAITLIST_ADMIN_TOKEN e PUBLIC_BASE_URL vem
 * prontos e nunca passam pelo seu historico de shell.
 *
 * Com --notas, imprime so perfil, nota e data, SEM os e-mails. Use essa forma
 * quando for colar o resultado em algum lugar: e-mail de terceiro e dado
 * pessoal, e este e um produto sobre nao vazar exatamente esse tipo de coisa.
 */

const token = process.env.WAITLIST_ADMIN_TOKEN;
const base = (process.env.PUBLIC_BASE_URL ?? "https://viligion.com").replace(/\/+$/, "");
const semEmail = process.argv.includes("--notas");

if (!token) {
  console.error("WAITLIST_ADMIN_TOKEN nao esta no ambiente.");
  console.error("Rode assim:  railway run --service viligion-app -- node scripts/waitlist.mjs");
  process.exit(1);
}

const res = await fetch(`${base}/admin/waitlist`, { headers: { Authorization: `Bearer ${token}` } });

if (!res.ok) {
  console.error(`${base}/admin/waitlist respondeu ${res.status}.`);
  if (res.status === 401) console.error("Token nao confere com o do servico em producao.");
  if (res.status === 404) console.error("Ou a rota nao existe nesse deploy, ou WAITLIST_ADMIN_TOKEN nao esta configurado la.");
  process.exit(1);
}

const { total, entries } = await res.json();

if (!total) {
  console.log("Nenhuma inscricao ainda.");
  process.exit(0);
}

console.log(`\n${total} inscricao(oes) na lista de espera — ${base}\n`);

for (const [i, e] of entries.entries()) {
  const quando = e.createdAt ? new Date(e.createdAt).toLocaleString("pt-BR") : "(sem data)";
  console.log(`${String(i + 1).padStart(2)}. [${e.profile ?? "?"}]  ${quando}`);
  if (!semEmail) console.log(`    e-mail: ${e.email}`);
  // A nota e o unico texto de usuario real que o projeto tem. E o que
  // alimenta a validacao de mercado - por isso ganha destaque aqui.
  console.log(`    nota  : ${e.note ? e.note : "(em branco)"}`);
  console.log();
}

const comNota = entries.filter((e) => e.note && e.note.trim()).length;
const porPerfil = entries.reduce((acc, e) => ({ ...acc, [e.profile ?? "?"]: (acc[e.profile ?? "?"] ?? 0) + 1 }), {});

console.log(`Resumo: ${comNota} de ${total} escreveram uma nota.`);
console.log("Por perfil:", Object.entries(porPerfil).map(([k, v]) => `${k}=${v}`).join("  "));
if (semEmail) console.log("\n(e-mails omitidos por causa de --notas)");
