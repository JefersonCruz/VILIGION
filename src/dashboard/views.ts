/**
 * Templates HTML server-side, funções puras (string in, string out) - sem
 * framework de frontend, consistente com o resto do projeto (node:http cru,
 * sem Express). Ver docs/UI-SPEC.md pra justificativa da escolha de stack.
 *
 * A única página com JS no cliente é signupPage() - inevitável, assinar
 * mensagem com a carteira só é possível no navegador (window.ethereum).
 * Usa EIP-1193 cru, sem viem/ethers no cliente, pra não exigir bundler.
 */

import { WAITLIST_PROFILES } from "./waitlist.js";
import { THRESHOLD_PRESETS, WINDOW_CHOICES_MINUTES } from "../engine/rules/threshold-presets.js";
import { THRESHOLDS_HEAD, thresholdsScript } from "./thresholds-ui.js";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Ícone de escudo com "pulso" (monitoramento) - SVG inline, sem asset externo. */
const LOGO_MARK = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 2.5l7.5 2.7v6.1c0 4.8-3.2 8.9-7.5 10.2-4.3-1.3-7.5-5.4-7.5-10.2V5.2L12 2.5z" fill="url(#g)" stroke="#22d3ee" stroke-width="1.1"/>
  <path d="M7.2 12.4h2.3l1.3-2.6 1.6 4.8 1.2-2.2h2.3" stroke="#0b0f19" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  <defs><linearGradient id="g" x1="4.5" y1="2.5" x2="19.5" y2="21.5" gradientUnits="userSpaceOnUse">
    <stop stop-color="#22d3ee"/><stop offset="1" stop-color="#0891b2"/>
  </linearGradient></defs>
</svg>`;

const BASE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    background: radial-gradient(ellipse 80% 60% at 50% -10%, #132033 0%, #0b0f19 55%), #0b0f19;
    color:#e5e7eb; margin:0; min-height:100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  header { padding: 18px 28px; border-bottom: 1px solid #1b2433; display:flex; align-items:center; justify-content:space-between; backdrop-filter: blur(6px); }
  header .brand { display:flex; align-items:center; gap:9px; color:#f1f5f9; font-weight:700; font-size:1.05rem; letter-spacing:0.02em; text-decoration:none; }
  nav a { color:#8b95a7; text-decoration:none; margin-left:20px; font-size:0.88rem; transition: color .15s ease; }
  nav a:hover { color:#22d3ee; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 24px 64px; }
  h1 { font-size:1.5rem; margin:0 0 6px; letter-spacing:-0.01em; }
  .muted { color:#8b95a7; font-size:0.9rem; line-height:1.5; }
  label { display:block; margin-top:16px; margin-bottom:6px; font-size:0.82rem; color:#9aa4b2; font-weight:500; }
  input, select {
    width:100%; background:#101726; border:1px solid #232d40; color:#e5e7eb;
    padding:11px 13px; border-radius:8px; font-size:0.95rem; transition: border-color .15s ease, box-shadow .15s ease;
    font-family: inherit;
  }
  input:focus, select:focus {
    outline:none; border-color:#22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,0.15);
  }
  input::placeholder { color:#4b5668; }
  button {
    margin-top:22px; background: linear-gradient(180deg, #2dd9f0, #17b8d4); color:#06151b; border:none;
    padding:11px 20px; border-radius:8px; font-weight:600; font-size:0.95rem; cursor:pointer;
    transition: transform .1s ease, box-shadow .15s ease, opacity .15s ease;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(34,211,238,0.25) inset;
  }
  button:hover { box-shadow: 0 2px 10px rgba(34,211,238,0.25), 0 0 0 1px rgba(34,211,238,0.35) inset; }
  button:active { transform: translateY(1px); }
  button.secondary { background:transparent; border:1px solid #2a3449; color:#cbd5e1; box-shadow:none; }
  button.secondary:hover { border-color:#3a4760; box-shadow:none; }
  button.danger { background: linear-gradient(180deg, #fb7272, #ef4444); color:#1a0909; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
  table { width:100%; border-collapse: collapse; margin-top:12px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #1b2433; font-size:0.88rem; }
  th { color:#8b95a7; font-weight:600; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; }
  .card {
    background:#0e1521; border:1px solid #1b2433; border-radius:12px; padding:24px;
    margin-top:18px; box-shadow: 0 4px 24px rgba(0,0,0,0.25);
  }
  .error {
    background:#2a1212; border:1px solid #5c1f1f; color:#fca5a5; padding:11px 15px;
    border-radius:8px; margin-top:18px; font-size:0.88rem;
  }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.74rem; font-weight:600; letter-spacing:0.02em; }
  .pill.critical { background:#2a1212; color:#fca5a5; }
  .pill.normal { background:#0c2228; color:#67e8f9; }
  code { background:#101726; padding:2px 7px; border-radius:5px; font-size:0.85rem; border:1px solid #1b2433; }
  a.link { color:#22d3ee; text-decoration:none; }
  a.link:hover { text-decoration:underline; }
  form { margin-top: 4px; }`;

const NAV = `
<nav>
  <a href="/dashboard">Painel</a>
  <a href="/accounts">Contas monitoradas</a>
  <a href="/thresholds">Limiares</a>
  <a href="/recipients">Destinatários</a>
  <a href="/alerts">Histórico de alertas</a>
  <a href="/logout">Sair</a>
</nav>`;

/** Layout interno (painel autenticado) - header com nav, conteúdo em coluna única. */
function layout(params: { title: string; body: string; authed?: boolean; error?: string; head?: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — ${escapeHtml(params.title)}</title>
${params.head ?? ""}
<style>${BASE_STYLE}</style>
</head>
<body>
<header>
  <a class="brand" href="/">${LOGO_MARK}VILIGION</a>
  ${params.authed ? NAV : ""}
</header>
<main>
  <h1>${escapeHtml(params.title)}</h1>
  ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ""}
  ${params.body}
</main>
</body>
</html>`;
}

/**
 * Layout de autenticação (login/cadastro/sucesso) - card centralizado na
 * tela, sem header de navegação interna. Página de entrada do produto
 * merece tratamento visual separado do painel, não é "mais uma tela interna".
 */
function authLayout(params: { title: string; subtitle?: string; body: string; error?: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — ${escapeHtml(params.title)}</title>
<style>${BASE_STYLE}
  .auth-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .auth-box { width:100%; max-width:420px; }
  .auth-logo { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:28px; }
  .auth-logo span { font-weight:800; font-size:1.3rem; letter-spacing:0.03em; color:#f8fafc; }
  .auth-card { background:#0e1521; border:1px solid #1b2433; border-radius:14px; padding:32px 28px; box-shadow: 0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.02); }
  .auth-title { font-size:1.25rem; font-weight:700; margin:0 0 4px; text-align:center; }
  .auth-subtitle { color:#8b95a7; font-size:0.88rem; text-align:center; margin:0 0 24px; line-height:1.5; }
  .auth-footer { text-align:center; margin-top:20px; font-size:0.86rem; color:#8b95a7; }
  .auth-box button { width:100%; }
</style>
</head>
<body>
<div class="auth-wrap">
  <div class="auth-box">
    <div class="auth-logo">${LOGO_MARK}<span>VILIGION</span></div>
    <div class="auth-card">
      <p class="auth-title">${escapeHtml(params.title)}</p>
      ${params.subtitle ? `<p class="auth-subtitle">${params.subtitle}</p>` : ""}
      ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ""}
      ${params.body}
    </div>
  </div>
</div>
</body>
</html>`;
}

export function signupPage(params: { nonce: string; error?: string }): string {
  const body = `
  <div class="card" style="margin-bottom:18px;">
    <p class="muted" style="margin-bottom:10px;"><strong>Como funciona, em 3 passos:</strong></p>
    <ol class="muted" style="margin:0 0 10px; padding-left:20px; line-height:1.7;">
      <li>Você precisa de uma carteira cripto instalada no navegador (ex: <a class="link" href="https://metamask.io/download/" target="_blank" rel="noopener">MetaMask</a>, Rabby, Coinbase Wallet).</li>
      <li>Vamos pedir uma <strong>assinatura</strong> — não é uma transação: não custa nada, não gasta gás, e não move nenhum fundo. Só prova que você controla o endereço.</li>
      <li>Depois disso, você escolhe um usuário/senha pro painel e está pronto.</li>
    </ol>
    <p class="muted" style="margin:0;">Destinatários de alerta (telefone/e-mail) são cadastrados depois, já logado, em <code>/recipients</code>.</p>
  </div>
  <p class="muted" id="status" style="margin-bottom:14px;">1. Conecte sua carteira pra assinar a prova de propriedade.</p>
  <button id="connectBtn" type="button">Conectar carteira</button>

  <form id="signupForm" method="POST" action="/signup" style="display:none">
    <input type="hidden" name="nonce" value="${escapeHtml(params.nonce)}">
    <input type="hidden" name="address" id="addressField">
    <input type="hidden" name="signature" id="signatureField">

    <label for="username">Usuário do painel</label>
    <input type="text" id="username" name="username" required>

    <label for="password">Senha do painel</label>
    <input type="password" id="password" name="password" required minlength="8">

    <button type="submit">Finalizar cadastro</button>
  </form>
  <script>
  (function () {
    var nonce = ${JSON.stringify(params.nonce)};
    var statusEl = document.getElementById("status");
    var connectBtn = document.getElementById("connectBtn");
    var form = document.getElementById("signupForm");

    connectBtn.addEventListener("click", async function () {
      if (!window.ethereum) {
        statusEl.innerHTML = "Nenhuma carteira encontrada no navegador. Instale a <a class=\\"link\\" href=\\"https://metamask.io/download/\\" target=\\"_blank\\" rel=\\"noopener\\">MetaMask</a> (ou outra carteira compatível) e recarregue esta página.";
        return;
      }
      try {
        var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        var address = accounts[0];
        // Precisa bater EXATAMENTE com buildOwnershipChallenge em privacy/ownership-proof.ts
        var message = [
          "VILIGION - Prova de propriedade de endereço",
          "Endereço: " + address,
          "Nonce: " + nonce,
          "Esta assinatura não autoriza nenhuma transação, apenas comprova controle da chave.",
        ].join("\\n");

        statusEl.textContent = "2. Confirme a assinatura na sua carteira...";
        var signature = await window.ethereum.request({
          method: "personal_sign",
          params: [message, address],
        });

        document.getElementById("addressField").value = address;
        document.getElementById("signatureField").value = signature;
        statusEl.textContent = "Endereço verificado: " + address;
        connectBtn.style.display = "none";
        form.style.display = "block";
      } catch (err) {
        statusEl.textContent = "Assinatura cancelada ou falhou: " + (err && err.message ? err.message : err);
      }
    });
  })();
  </script>`;
  return authLayout({
    title: "Criar conta",
    subtitle: "Prova de posse do endereço e login do painel — cadastre os destinatários de alerta depois, em /recipients.",
    body,
    error: params.error,
  });
}

export function signupSuccessPage(params: { username: string; otpAuthUri: string; qrCodeSvg: string }): string {
  const body = `
    <p class="muted" style="margin-bottom:14px;">Escaneie o código abaixo com o autenticador (Google Authenticator, Authy, 1Password) antes de fazer login — ele não será mostrado de novo:</p>
    <div style="background:#e5e7eb; border-radius:10px; padding:16px; display:flex; justify-content:center;">${params.qrCodeSvg}</div>
    <p class="muted" style="margin-top:14px;">Não consegue escanear? Digite o código manualmente:</p>
    <p><code style="word-break:break-all; display:block; padding:12px;">${escapeHtml(params.otpAuthUri)}</code></p>
    <p class="muted">Usuário: <code>${escapeHtml(params.username)}</code></p>
    <a href="/login" style="text-decoration:none"><button type="button">Ir para o login</button></a>`;
  return authLayout({ title: "Cadastro concluído", body });
}

const SHARE_TITLE = "VILIGION: treasury alerts that still work under duress";
const SHARE_DESCRIPTION =
  "On-chain monitoring for stablecoin treasuries on Tempo. When balances drop abnormally, a trusted person gets a phone call plus a WhatsApp PIN, with no balances, addresses or phone numbers exposed in the alert. Built for the case where the key holder can't say no.";
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2.5l7.5 2.7v6.1c0 4.8-3.2 8.9-7.5 10.2-4.3-1.3-7.5-5.4-7.5-10.2V5.2L12 2.5z" fill="#22d3ee"/><path d="M7.2 12.4h2.3l1.3-2.6 1.6 4.8 1.2-2.2h2.3" stroke="#0b0f19" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
)}`;

/** Metatags de compartilhamento (Open Graph + X/Twitter Card). baseUrl precisa ser absoluta: os scrapers não resolvem URL relativa. */
function shareMeta(baseUrl: string): string {
  const url = escapeHtml(baseUrl);
  const image = `${url}/og-image.png`;
  return `<meta name="description" content="${escapeHtml(SHARE_DESCRIPTION)}">
<meta name="theme-color" content="#0b0f19">
<link rel="icon" href="${FAVICON}">
<link rel="canonical" href="${url}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="VILIGION">
<meta property="og:title" content="${escapeHtml(SHARE_TITLE)}">
<meta property="og:description" content="${escapeHtml(SHARE_DESCRIPTION)}">
<meta property="og:url" content="${url}/">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="VILIGION: when the key holder can't say no, someone else gets the call.">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(SHARE_TITLE)}">
<meta name="twitter:description" content="${escapeHtml(SHARE_DESCRIPTION)}">
<meta name="twitter:image" content="${image}">
<meta name="twitter:image:alt" content="VILIGION: when the key holder can't say no, someone else gets the call.">`;
}

export function landingPage(params: { joined?: boolean; error?: string; baseUrl: string }): string {
  const profileOptions = Object.entries(WAITLIST_PROFILES)
    .map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`)
    .join("");

  const form = params.joined
    ? `<p style="margin:0;"><strong>Você está na lista.</strong> <span class="muted">Avisamos por e-mail quando abrirmos o acesso.</span></p>`
    : `<form method="POST" action="/waitlist">
    <label for="email">Seu e-mail</label>
    <input type="email" id="email" name="email" required maxlength="200" placeholder="voce@empresa.com">

    <label for="profile">Qual é o seu caso?</label>
    <select id="profile" name="profile" required>${profileOptions}</select>

    <label for="note">O que mais te preocupa na segurança da sua tesouraria? (opcional)</label>
    <input type="text" id="note" name="note" maxlength="500">

    <button type="submit">Entrar na lista de espera</button>
    <p class="muted" style="margin:12px 0 0;">Usamos o e-mail só para avisar do acesso e pedir feedback. Sem spam, sem repasse a terceiros.</p>
  </form>`;

  const body = `
<p class="muted" style="font-size:1.02rem; margin-top:0;">O VILIGION vigia a tesouraria de stablecoins na <strong>Tempo</strong> e avisa por <strong>ligação</strong> quando algo anormal acontece &mdash; sem expor saldo, endereço ou telefone no alerta.</p>
<p class="muted"><a class="link" href="/login">Já tenho conta &rarr; Entrar</a></p>

<div class="card">
  <p style="margin:0 0 8px;"><strong>O problema</strong></p>
  <p class="muted" style="margin:0;">Quem guarda a tesouraria de uma equipe ou empresa raramente tem alguém olhando o saldo o dia todo. Se a pessoa que controla a chave for coagida a transferir, ou a chave vazar, ninguém mais fica sabendo a tempo.</p>
</div>

<div class="card">
  <p style="margin:0 0 8px;"><strong>Como funciona</strong></p>
  <ol class="muted" style="margin:0; padding-left:20px; line-height:1.7;">
    <li>Você cadastra o endereço da tesouraria (prova de posse por assinatura, sem mover fundos).</li>
    <li>Você escolhe <strong>quem deve ser avisado</strong> &mdash; de preferência alguém de confiança que <em>não</em> seja a pessoa sob risco.</li>
    <li>Queda forte de saldo vira alerta crítico: <strong>ligação + código de confirmação por WhatsApp</strong>. Alertas menores vão por e-mail.</li>
  </ol>
  <p class="muted" style="margin:10px 0 0;">O conteúdo do alerta nunca traz saldo nem endereço, e os destinatários ficam criptografados.</p>
</div>

<div class="card">
  <p style="margin:0 0 8px;"><strong>Em que estágio estamos</strong></p>
  <p class="muted" style="margin:0;">Em construção, rodando na testnet da Tempo, com código aberto no <a class="link" href="https://github.com/JefersonCruz/VILIGION" target="_blank" rel="noopener">GitHub</a>. Entre na lista para testar primeiro &mdash; o seu feedback define o que construímos a seguir.</p>
</div>

<div class="card" id="lista">
  <p style="margin:0 0 4px;"><strong>Lista de espera</strong></p>
  ${form}
</div>`;
  return layout({
    title: "Alerta de tesouraria feito para funcionar sob coação",
    body,
    error: params.error,
    head: shareMeta(params.baseUrl),
  });
}

export function loginPage(params: { error?: string }): string {
  const body = `
    <form method="POST" action="/session">
      <label for="username">Usuário</label>
      <input type="text" id="username" name="username" required autofocus>

      <label for="password">Senha</label>
      <input type="password" id="password" name="password" required>

      <label for="totpCode">Código do autenticador</label>
      <input type="text" id="totpCode" name="totpCode" inputmode="numeric" pattern="[0-9]{6}" placeholder="000000" required>

      <button type="submit">Entrar</button>
    </form>
    <p class="auth-footer">Ainda não tem conta? <a class="link" href="/signup">Cadastre-se</a></p>`;
  return authLayout({ title: "Entrar", subtitle: "Acesse o painel de monitoramento da sua tesouraria.", body, error: params.error });
}

export function dashboardPage(params: {
  address: string;
  balanceRaw: string;
  accountsCount: number;
  recentAlerts: Array<{ kind: string; createdAt: string }>;
}): string {
  const alertsRows =
    params.recentAlerts.length === 0
      ? `<tr><td colspan="2" class="muted">Nenhum alerta ainda.</td></tr>`
      : params.recentAlerts
          .map((a) => `<tr><td>${escapeHtml(a.kind)}</td><td>${escapeHtml(a.createdAt)}</td></tr>`)
          .join("");

  const body = `
<div class="card">
  <p class="muted">Endereço principal</p>
  <p><code>${escapeHtml(params.address)}</code></p>
  <p class="muted">Saldo bruto (menor unidade do token)</p>
  <p><code>${escapeHtml(params.balanceRaw)}</code></p>
  <p class="muted">${params.accountsCount} conta(s) monitorada(s) — <a class="link" href="/accounts">gerenciar</a></p>
</div>
<div class="card">
  <p class="muted">Últimos alertas</p>
  <table><thead><tr><th>Tipo</th><th>Quando</th></tr></thead><tbody>${alertsRows}</tbody></table>
</div>`;
  return layout({ title: "Painel", body, authed: true });
}

export function accountsPage(params: {
  accounts: Array<{ id: string; chainKey: string; tokenAddress: string; watchedAddress: string }>;
  knownChainKeys: string[];
  error?: string;
}): string {
  const rows =
    params.accounts.length === 0
      ? `<tr><td colspan="4" class="muted">Nenhuma conta monitorada ainda.</td></tr>`
      : params.accounts
          .map(
            (a) => `<tr>
        <td>${escapeHtml(a.chainKey)}</td>
        <td><code>${escapeHtml(a.tokenAddress)}</code></td>
        <td><code>${escapeHtml(a.watchedAddress)}</code></td>
        <td><form method="POST" action="/accounts/${escapeHtml(a.id)}/delete" style="margin:0">
          <button type="submit" class="secondary danger" style="margin-top:0">Remover</button>
        </form></td>
      </tr>`,
          )
          .join("");

  const chainOptions = params.knownChainKeys.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("");

  const body = `
<div class="card">
  <table><thead><tr><th>Chain</th><th>Token</th><th>Endereço monitorado</th><th></th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>
<div class="card">
  <p class="muted" style="margin-bottom:10px;"><strong>Dois endereços diferentes, não confunda:</strong></p>
  <ol class="muted" style="margin:0 0 14px; padding-left:20px; line-height:1.7;">
    <li><strong>Endereço do token</strong>: o contrato da stablecoin que você guarda (ex: PathUSD na Tempo) — é o mesmo pra todo mundo que usa esse token, não é sua carteira.</li>
    <li><strong>Endereço monitorado</strong>: a sua carteira/tesouraria — o endereço cujo saldo desse token vai ser vigiado. Normalmente é o endereço que você assinou no cadastro.</li>
  </ol>
  <form method="POST" action="/accounts">
    <label for="chainKey">Chain</label>
    <select id="chainKey" name="chainKey">${chainOptions}</select>

    <label for="tokenAddress">Endereço do token (ERC-20/TIP-20)</label>
    <input type="text" id="tokenAddress" name="tokenAddress" placeholder="0x..." required>

    <label for="watchedAddress">Endereço/carteira a monitorar</label>
    <input type="text" id="watchedAddress" name="watchedAddress" placeholder="0x..." required>

    <button type="submit">Adicionar</button>
  </form>
</div>`;
  return layout({ title: "Contas monitoradas", body, authed: true, error: params.error });
}

export interface ThresholdsFormValues {
  warn: number;
  crit: number;
  win: number;
  /** transferência bloqueada em US$ */
  bw: number;
  bc: number;
}

/** Tela de limiares (docs/THRESHOLDS.md, C6): perfis, controles, prévia com saldo real e simulador. */
export function thresholdsPage(params: {
  current: ThresholdsFormValues;
  saved: ThresholdsFormValues;
  /** saldo atual monitorado em US$; null se ainda não foi lido (a prévia usa um exemplo e avisa) */
  balanceUsd: number | null;
  justSaved?: boolean;
  error?: string;
}): string {
  const cfg = JSON.stringify({
    presets: THRESHOLD_PRESETS,
    windows: WINDOW_CHOICES_MINUTES,
    current: params.current,
    saved: params.saved,
    balanceUsd: params.balanceUsd,
    justSaved: params.justSaved === true,
  }).replace(/</g, "\\u003c");
  const c = params.current;
  const live = params.balanceUsd !== null;
  const body = `
<div class="th">
  <span class="live"><i></i> Alterações valem no ciclo seguinte do monitor (até 15 s), sem reiniciar</span>
  <p class="lead">Escolha um perfil e ajuste se precisar. A prévia ao lado mostra, com o seu saldo, quanto dinheiro precisa sair para disparar cada tipo de alerta.</p>

  <form method="POST" action="/thresholds" id="thForm">
    <div class="presets" id="presets"></div>

    <div class="layout">
      <div>
        <div class="card">
          <h2><span class="ico">&#8595;</span> Queda de saldo</h2>
          <p class="sub">Somamos todas as saídas dentro da janela escolhida, mesmo que venham em várias transferências pequenas.</p>

          <div class="field">
            <div class="row">
              <label for="pctWarnN"><span class="dot" style="background:var(--warn)"></span> Avisar por e-mail a partir de</label>
              <div class="val"><input id="pctWarnN" name="maxBalanceDropPct" type="number" min="0.1" max="100" step="0.1" value="${c.warn}" required><span>%</span></div>
            </div>
            <input type="range" id="pctWarn" min="1" max="100" step="1" style="--c:var(--warn)" aria-label="Limite de e-mail em porcentagem">
          </div>

          <div class="field">
            <div class="row">
              <label for="pctCritN"><span class="dot" style="background:var(--crit)"></span> Ligar por telefone a partir de</label>
              <div class="val"><input id="pctCritN" name="criticalBalanceDropPct" type="number" min="0.1" max="100" step="0.1" value="${c.crit}" required><span>%</span></div>
            </div>
            <input type="range" id="pctCrit" min="1" max="100" step="1" style="--c:var(--crit)" aria-label="Limite de ligação em porcentagem">
            <p class="hint">A ligação traz o <b>código por WhatsApp</b> e é o alerta mais intrusivo. Use um limite que só um evento sério alcance.</p>
          </div>

          <div class="field">
            <div class="row"><label>Janela de tempo</label></div>
            <div class="seg" id="win"></div>
            <input type="hidden" id="windowMinutes" name="windowMinutes" value="${c.win}">
            <p class="hint" id="winHint"></p>
          </div>
          <div class="alert-box" id="err1" role="alert"></div>
        </div>

        <div class="card">
          <h2><span class="ico">&#9940;</span> Transferência bloqueada</h2>
          <p class="sub">Quando a política de recebimento da Tempo bloqueia um valor, você é avisado conforme o tamanho dele.</p>
          <div class="two">
            <div>
              <label for="blkWarn">E-mail a partir de</label>
              <div class="money"><b>US$</b><input id="blkWarn" name="blockedWarnUsd" type="text" inputmode="decimal" value="${c.bw}" required></div>
            </div>
            <div>
              <label for="blkCrit">Ligação a partir de</label>
              <div class="money"><b>US$</b><input id="blkCrit" name="blockedCritUsd" type="text" inputmode="decimal" value="${c.bc}" required></div>
            </div>
          </div>
          <p class="hint">Digite em dólares (até 6 casas). O sistema converte para a menor unidade do token sozinho.</p>
          <div class="alert-box" id="err2" role="alert"></div>
        </div>
      </div>

      <aside class="side">
        <div class="card">
          <div class="eyebrow"><span>Prévia com seu saldo</span><span style="color:${live ? "var(--ok)" : "var(--warn)"}">&#9679; ${live ? "saldo real" : "exemplo"}</span></div>
          <div class="bal"><strong>${live ? escapeHtml("US$ " + Math.round(params.balanceUsd as number).toLocaleString("pt-BR")) : "US$ 100.000"}</strong><small>${live ? "saldo atual monitorado" : "exemplo: o monitor ainda não leu seu saldo"}</small></div>

          <div class="gauge" id="gauge"><div class="z z1"></div><div class="z z2"></div><div class="z z3"></div></div>
          <div class="ticks" id="ticks"></div>

          <div class="legend">
            <div class="lg" id="lg0" style="--hc:#14503a;--hb:#0b2a1f"><span class="dot" style="background:var(--ok)"></span><div><b>Sem alerta</b><span id="t0"></span></div></div>
            <div class="lg" id="lg1" style="--hc:#7a5f12;--hb:#241d08"><span class="dot" style="background:var(--warn)"></span><div><b>E-mail</b><span id="t1"></span></div></div>
            <div class="lg" id="lg2" style="--hc:#7a2a2a;--hb:#241010"><span class="dot" style="background:var(--crit)"></span><div><b>Ligação + código no WhatsApp</b><span id="t2"></span></div></div>
          </div>

          <div class="sim">
            <div class="row"><label for="sim">Simular uma saída de</label><strong id="simTxt" style="font-size:.95rem"></strong></div>
            <input type="range" id="sim" min="0" max="100" step="1">
            <div class="result" id="result"></div>
          </div>

          <div class="note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" style="flex:none;margin-top:2px" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
            <span>Os alertas nunca trazem saldo ou endereço. Esta prévia só aparece aqui, dentro do painel autenticado.</span>
          </div>
        </div>
      </aside>
    </div>

    <div class="bar">
      <div class="msg" id="barMsg"></div>
      <button type="button" class="ghost" id="reset">Descartar</button>
      <button type="submit" class="btn" id="save">Salvar limiares</button>
    </div>
  </form>
</div>
${thresholdsScript(cfg)}`;
  return layout({ title: "Quando você quer ser avisado", body, authed: true, error: params.error, head: THRESHOLDS_HEAD });
}

export function recipientsPage(params: {
  recipients: Array<{ id: string; kind: string; value: string }>;
  error?: string;
  notice?: string;
  canTest?: boolean;
}): string {
  const rows =
    params.recipients.length === 0
      ? `<tr><td colspan="3" class="muted">Nenhum destinatário cadastrado ainda.</td></tr>`
      : params.recipients
          .map(
            (r) => `<tr>
        <td><span class="pill ${r.kind === "phone" ? "critical" : "normal"}">${r.kind === "phone" ? "Telefone (ligação)" : "E-mail"}</span></td>
        <td><code>${escapeHtml(r.value)}</code></td>
        <td><form method="POST" action="/recipients/${escapeHtml(r.id)}/delete" style="margin:0">
          <button type="submit" class="secondary danger" style="margin-top:0">Remover</button>
        </form></td>
      </tr>`,
          )
          .join("");

  const body = `
<div class="card">
  <p class="muted" style="margin-bottom:10px;">Alertas críticos (ex: queda forte de saldo) ligam pros números cadastrados aqui <strong>e também mandam o código de confirmação por WhatsApp</strong> pro mesmo número; alertas normais vão por e-mail — ver <a class="link" href="/thresholds">limiares</a> pra ajustar o que conta como crítico.</p>
  <p class="muted" style="margin:0;">Pode cadastrar mais de um telefone e mais de um e-mail — todos recebem o alerta, não só o primeiro. Use um número com WhatsApp ativo, senão o código de confirmação não chega.</p>
  <table><thead><tr><th>Canal</th><th>Destino</th><th></th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>
<div class="card">
  <p class="muted">Adicionar destinatário</p>
  <form method="POST" action="/recipients">
    <label for="kind">Tipo</label>
    <select id="kind" name="kind">
      <option value="phone">Telefone (ligação + WhatsApp — severidade crítica)</option>
      <option value="email">E-mail (severidade normal)</option>
    </select>

    <label for="value">Número no formato internacional (+5511999999999) ou e-mail</label>
    <input type="text" id="value" name="value" required>

    <button type="submit">Adicionar</button>
  </form>
</div>${
    params.canTest
      ? `
<div class="card">
  <p class="muted">Testar o canal crítico</p>
  <p class="muted" style="margin-bottom:10px;">Dispara agora um alerta crítico de teste: liga pros telefones cadastrados e manda o código de confirmação por WhatsApp. Confira em <a class="link" href="/alerts">histórico</a> se o código foi confirmado.</p>
  <form method="POST" action="/recipients/test"><button type="submit">Enviar alerta de teste</button></form>
</div>`
      : ""
  }`;
  return layout({ title: "Destinatários de alerta", body: params.notice ? `<div class="card"><p>${escapeHtml(params.notice)}</p></div>${body}` : body, authed: true, error: params.error });
}

export function alertsHistoryPage(params: {
  alerts: Array<{ kind: string; severity: string; deliveredVia: string; pinStatus: string | null; createdAt: string }>;
}): string {
  const rows =
    params.alerts.length === 0
      ? `<tr><td colspan="5" class="muted">Nenhum alerta ainda.</td></tr>`
      : params.alerts
          .map(
            (a) => `<tr>
        <td>${escapeHtml(a.kind)}</td>
        <td><span class="pill ${a.severity === "critical" ? "critical" : "normal"}">${escapeHtml(a.severity)}</span></td>
        <td>${escapeHtml(a.deliveredVia)}</td>
        <td>${escapeHtml(a.pinStatus ?? "—")}</td>
        <td>${escapeHtml(a.createdAt)}</td>
      </tr>`,
          )
          .join("");

  const body = `
<div class="card">
  <table><thead><tr><th>Tipo</th><th>Severidade</th><th>Canal</th><th>PIN</th><th>Quando</th></tr></thead>
  <tbody>${rows}</tbody></table>
</div>`;
  return layout({ title: "Histórico de alertas", body, authed: true });
}
