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
import { LOGO_FULL_DATA_URI, LOGO_ICON_DATA_URI } from "./logo-assets.js";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Logo oficial VILIGION (ícone "V"), embutido como data URI - ver
 * dashboard/logo-assets.ts. Era um SVG placeholder (escudo com pulso) até a
 * marca oficial ser compartilhada; trocado pra usar a imagem real.
 */
function logoMark(size = 28): string {
  return `<img src="${LOGO_ICON_DATA_URI}" width="${size}" height="${size}" alt="VILIGION" style="display:block; border-radius:${Math.round(size * 0.18)}px;">`;
}

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
  nav a.on { color:#f1f5f9; font-weight:600; box-shadow: 0 2px 0 #22d3ee; padding-bottom:6px; }
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

const NAV_LINKS: Array<[string, string]> = [
  ["/dashboard", "Painel"],
  ["/accounts", "Contas monitoradas"],
  ["/thresholds", "Limiares"],
  ["/recipients", "Destinatários"],
  ["/alerts", "Histórico de alertas"],
  ["/logout", "Sair"],
];

function nav(active?: string): string {
  const links = NAV_LINKS.map(([href, text]) => `<a href="${href}"${href === active ? ' class="on" aria-current="page"' : ""}>${text}</a>`).join("\n  ");
  return `<nav>\n  ${links}\n</nav>`;
}

/** Layout interno (painel autenticado) - header com nav, conteúdo em coluna única. */
function layout(params: { title: string; body: string; authed?: boolean; active?: string; error?: string; head?: string }): string {
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
  <a class="brand" href="/">${logoMark(28)}VILIGION</a>
  ${params.authed ? nav(params.active) : ""}
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
    <div class="auth-logo">${logoMark(28)}<span>VILIGION</span></div>
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

/** Ícone do GitHub, 14px, inline - prova de autoridade (open-source) perto do topo, sem asset externo. */
const GITHUB_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

/**
 * Estilo extra só da landing — hero próprio em grid (texto + formulário lado
 * a lado), não reaproveita o <main> estreito/h1 pequeno do layout() interno
 * (telas de app). Formulário fica dentro da primeira dobra, não exige rolar
 * (feedback de revisão: form empurrado pra baixo matava conversão).
 */
const LANDING_STYLE = `
  html { scroll-behavior: smooth; }
  .hero { padding:48px 24px 56px; background: radial-gradient(ellipse 70% 55% at 15% -15%, rgba(34,211,238,0.12), transparent 60%); border-bottom:1px solid #1b2433; }
  .hero-grid { max-width:1040px; margin:0 auto; display:grid; grid-template-columns:1.15fr 0.85fr; gap:40px; align-items:start; }
  @media (max-width:860px) { .hero-grid { grid-template-columns:1fr; } .hero-copy { text-align:center; } .hero-copy .mark, .trust-row { justify-content:center; } }
  .hero-copy .mark { display:inline-block; margin-bottom:18px; }
  .hero-copy .mark img { display:block; border-radius:18%; }
  .hero-copy h1 { font-size: clamp(1.8rem, 3.6vw, 2.5rem); line-height:1.22; margin:0 0 14px; letter-spacing:-0.02em; font-weight:800; color:#f8fafc; }
  .hero-copy .lead { font-size:1.02rem; color:#aab4c4; margin:0 0 8px; line-height:1.55; }
  .hero-copy .lead strong { color:#e5e7eb; }
  .trust-row { display:flex; gap:10px; flex-wrap:wrap; margin:18px 0 20px; }
  .hero-copy .mark, .hero-copy h1, .hero-copy .lead, .hero-copy .trust-row, .hero-copy > p.muted, .hero-form {
    animation: fade-up .6s ease-out both;
  }
  .hero-copy .mark { animation: fade-up .6s ease-out both, pulse-ring 2.6s cubic-bezier(.4,0,.6,1) 0.6s infinite; }
  .hero-copy h1 { animation-delay: .08s; }
  .hero-copy .lead:nth-of-type(1) { animation-delay: .14s; }
  .hero-copy .lead:nth-of-type(2) { animation-delay: .2s; }
  .hero-copy .trust-row { animation-delay: .26s; }
  .hero-copy > p.muted { animation-delay: .32s; }
  .hero-form { animation-delay: .38s; }
  @keyframes fade-up { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform: translateY(0); } }
  @keyframes pulse-ring {
    0%   { box-shadow: 0 0 0 0 rgba(34,211,238,0.45), 0 0 26px rgba(34,211,238,0.3); }
    70%  { box-shadow: 0 0 0 16px rgba(34,211,238,0), 0 0 26px rgba(34,211,238,0.3); }
    100% { box-shadow: 0 0 0 0 rgba(34,211,238,0), 0 0 26px rgba(34,211,238,0.3); }
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-copy .mark img, .hero-copy .mark, .hero-copy h1, .hero-copy .lead, .hero-copy .trust-row, .hero-copy > p.muted, .hero-form {
      animation: none;
    }
  }
  .badge { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; border:1px solid #2a3449; color:#9aa4b2; font-size:0.78rem; font-weight:600; text-decoration:none; background:#0e1521; transition: border-color .15s ease, color .15s ease; }
  a.badge:hover { border-color:#3a4760; color:#cbd5e1; }
  .badge.accent { border-color:rgba(245,158,11,0.4); color:#fbbf24; }
  .hero-form { margin-top:0; }
  .hero-form .form-title { margin:0 0 4px; font-weight:700; font-size:1.05rem; color:#f8fafc; }
  .pills { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
  .pills input { position:absolute; opacity:0; width:1px; height:1px; }
  .pills label { cursor:pointer; padding:8px 14px; border-radius:999px; border:1px solid #232d40; background:#101726; color:#9aa4b2; font-size:0.82rem; font-weight:500; transition: all .15s ease; }
  .pills input:checked + label { border-color:#22d3ee; color:#e5e7eb; background:#0c2228; }
  .pills input:focus-visible + label { outline:2px solid #22d3ee; outline-offset:2px; }
  details.note-toggle { margin-top:16px; }
  details.note-toggle summary { cursor:pointer; color:#8b95a7; font-size:0.82rem; list-style:none; }
  details.note-toggle summary::-webkit-details-marker { display:none; }
  details.note-toggle summary::before { content:"+ "; color:#22d3ee; font-weight:700; }
  details.note-toggle[open] summary::before { content:"− "; }
  details.note-toggle label { margin-top:12px; }
  button.cta, a.btn.cta { background: linear-gradient(180deg, #fbbf24, #f59e0b); color:#231703;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(245,158,11,0.4) inset, 0 0 22px rgba(245,158,11,0.22); }
  button.cta:hover, a.btn.cta:hover { box-shadow: 0 2px 14px rgba(245,158,11,0.35), 0 0 0 1px rgba(245,158,11,0.5) inset; }
  a.btn { display:inline-flex; align-items:center; justify-content:center; text-decoration:none;
    padding:11px 22px; border-radius:8px; font-weight:600; font-size:0.95rem; margin-top:0;
    transition: box-shadow .15s ease, border-color .15s ease; }
  a.btn.secondary { background:transparent; border:1px solid #2a3449; color:#cbd5e1; }
  a.btn.secondary:hover { border-color:#3a4760; }
  .landing-main { max-width:760px; margin:0 auto; padding:48px 24px 64px; }
  .steps { display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-top:4px; }
  @media (max-width:700px) { .steps { grid-template-columns:1fr; } }
  .step { background:#0b121d; border:1px solid #1b2433; border-radius:10px; padding:16px; }
  .step .num { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:999px; background:#0c2228; color:#67e8f9; font-weight:700; font-size:0.85rem; margin-bottom:10px; }
  .step .step-title { font-weight:600; color:#e5e7eb; margin:0 0 4px; font-size:0.92rem; }
  .step .step-desc { color:#8b95a7; font-size:0.84rem; line-height:1.5; margin:0; }`;

export function landingPage(params: { joined?: boolean; error?: string; baseUrl: string }): string {
  const pills = Object.entries(WAITLIST_PROFILES)
    .map(
      ([key, label], i) =>
        `<input type="radio" id="profile-${key}" name="profile" value="${escapeHtml(key)}" required${i === 0 ? " checked" : ""}>
    <label for="profile-${key}">${escapeHtml(label)}</label>`,
    )
    .join("\n    ");

  const form = params.joined
    ? `<p style="margin:0;"><strong>Você está na lista.</strong> <span class="muted">Avisamos por e-mail quando abrirmos o acesso.</span></p>`
    : `<form method="POST" action="/waitlist">
    <label for="email">Seu e-mail</label>
    <input type="email" id="email" name="email" required maxlength="200" placeholder="voce@empresa.com" autofocus>

    <label>Qual é o seu caso?</label>
    <div class="pills">
    ${pills}
    </div>

    <details class="note-toggle">
      <summary>Adicionar um comentário (opcional)</summary>
      <label for="note">O que mais te preocupa na segurança da sua tesouraria?</label>
      <input type="text" id="note" name="note" maxlength="500">
    </details>

    <button type="submit" class="cta">Entrar na lista de espera</button>
    <p class="muted" style="margin:12px 0 0;">Usamos o e-mail só para avisar do acesso e pedir feedback. Sem spam, sem repasse a terceiros.</p>
  </form>`;

  const body = `
<div class="card">
  <p style="margin:0 0 8px;"><strong>O problema</strong></p>
  <p class="muted" style="margin:0;">Quem guarda a tesouraria de uma equipe ou empresa raramente tem alguém olhando o saldo o dia todo. Se a pessoa que controla a chave for coagida a transferir, ou a chave vazar, ninguém mais fica sabendo a tempo.</p>
</div>

<div class="card">
  <p style="margin:0 0 12px;"><strong>Como funciona</strong></p>
  <div class="steps">
    <div class="step">
      <span class="num">1</span>
      <p class="step-title">Cadastre o endereço</p>
      <p class="step-desc">Prova de posse por assinatura da carteira — sem mover fundos.</p>
    </div>
    <div class="step">
      <span class="num">2</span>
      <p class="step-title">Escolha quem é avisado</p>
      <p class="step-desc">De preferência alguém de confiança que não seja a pessoa sob risco.</p>
    </div>
    <div class="step">
      <span class="num">3</span>
      <p class="step-title">Alerta por severidade</p>
      <p class="step-desc">Crítico: ligação + PIN por WhatsApp. Normal: e-mail.</p>
    </div>
  </div>
  <p class="muted" style="margin:14px 0 0;">O conteúdo do alerta nunca traz saldo nem endereço, e os destinatários ficam criptografados.</p>
</div>

<div class="card">
  <p style="margin:0 0 8px;"><strong>Em que estágio estamos</strong></p>
  <p class="muted" style="margin:0;">Em construção, rodando na testnet da Tempo. Entre na lista para testar primeiro &mdash; o seu feedback define o que construímos a seguir.</p>
</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — Alerta de tesouraria feito para funcionar sob coação</title>
${shareMeta(params.baseUrl)}
<style>${BASE_STYLE}${LANDING_STYLE}</style>
</head>
<body>
<header>
  <a class="brand" href="/">${logoMark(28)}VILIGION</a>
  <nav><a href="/login">Entrar</a></nav>
</header>
<section class="hero">
  <div class="hero-grid">
    <div class="hero-copy">
      <div class="mark"><img src="${LOGO_FULL_DATA_URI}" width="88" height="88" alt="VILIGION"></div>
      <h1>Alerta de tesouraria feito para funcionar sob coação</h1>
      <p class="lead">Monitoramento em tempo real da tesouraria de stablecoins na <strong>Tempo</strong>.</p>
      <p class="lead">Quando algo foge do padrão, alguém de confiança recebe uma <strong>ligação</strong> — sem expor saldo, endereço ou telefone no alerta.</p>
      <div class="trust-row">
        <a class="badge accent" href="https://github.com/JefersonCruz/VILIGION" target="_blank" rel="noopener">${GITHUB_ICON}Código aberto</a>
        <span class="badge">Rodando na testnet Tempo</span>
      </div>
      <p class="muted"><a class="link" href="/login">Já tenho conta &rarr; Entrar</a></p>
    </div>
    <div class="card hero-form" id="lista">
      <p class="form-title">Entre na lista de espera</p>
      ${form}
    </div>
  </div>
</section>
<main class="landing-main">
  ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ""}
  ${body}
</main>
</body>
</html>`;
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
  return layout({ title: "Painel", body, authed: true, active: "/dashboard" });
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
  return layout({ title: "Contas monitoradas", body, authed: true, active: "/accounts", error: params.error });
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
  <p class="lead">Escolha um perfil e ajuste se precisar. A prévia ao lado usa o seu saldo para mostrar quanto dinheiro precisa sair para disparar cada tipo de alerta.</p>

  <form method="POST" action="/thresholds" id="thForm">
    <p class="sect">Ponto de partida</p>
    <div class="presets" id="presets"></div>

    <div class="layout">
      <div class="col">
        <div class="card">
          <div class="head">
            <h2><span class="ico">&#8595;</span> Queda de saldo</h2>
            <p>Somamos as saídas dentro da janela escolhida, mesmo que venham em várias transferências pequenas.</p>
          </div>

          <div class="field">
            <label for="pctWarnN"><span class="dot" style="background:var(--warn)"></span> Avisar por e-mail a partir de</label>
            <div class="ctl">
              <input type="range" id="pctWarn" min="1" max="100" step="1" style="--c:var(--warn)" aria-label="Limite de e-mail em porcentagem">
              <div class="num"><input id="pctWarnN" name="maxBalanceDropPct" type="number" min="0.1" max="100" step="0.1" value="${c.warn}" required><span>%</span></div>
            </div>
          </div>

          <div class="field">
            <label for="pctCritN"><span class="dot" style="background:var(--crit)"></span> Ligar por telefone a partir de</label>
            <div class="ctl">
              <input type="range" id="pctCrit" min="1" max="100" step="1" style="--c:var(--crit)" aria-label="Limite de ligação em porcentagem">
              <div class="num"><input id="pctCritN" name="criticalBalanceDropPct" type="number" min="0.1" max="100" step="0.1" value="${c.crit}" required><span>%</span></div>
            </div>
            <p class="hint">A ligação traz o <b>código por WhatsApp</b> e é o alerta mais intrusivo. Use um limite que só um evento sério alcance.</p>
          </div>

          <div class="field">
            <label>Janela de tempo</label>
            <div class="seg" id="win"></div>
            <input type="hidden" id="windowMinutes" name="windowMinutes" value="${c.win}">
            <p class="hint" id="winHint"></p>
          </div>
          <div class="alert-box" id="err1" role="alert"></div>
        </div>

        <div class="card">
          <div class="head">
            <h2><span class="ico">&#9940;</span> Transferência bloqueada</h2>
            <p>Quando a política de recebimento da Tempo bloqueia um valor, você é avisado conforme o tamanho dele.</p>
          </div>
          <div class="two">
            <div>
              <label for="blkWarn"><span class="dot" style="background:var(--warn)"></span> E-mail a partir de</label>
              <div class="money"><b>US$</b><input id="blkWarn" name="blockedWarnUsd" type="text" inputmode="decimal" value="${c.bw}" required></div>
            </div>
            <div>
              <label for="blkCrit"><span class="dot" style="background:var(--crit)"></span> Ligação a partir de</label>
              <div class="money"><b>US$</b><input id="blkCrit" name="blockedCritUsd" type="text" inputmode="decimal" value="${c.bc}" required></div>
            </div>
          </div>
          <p class="hint">Digite em dólares, até 6 casas. O sistema converte para a menor unidade do token.</p>
          <div class="alert-box" id="err2" role="alert"></div>
        </div>
      </div>

      <aside class="side">
        <div class="card">
          <div class="eyebrow"><span>Prévia com seu saldo</span><span style="color:${live ? "var(--ok)" : "var(--warn)"}">&#9679; ${live ? "saldo real" : "exemplo"}</span></div>
          <div class="balwrap"><strong>${live ? escapeHtml("US$ " + Math.round(params.balanceUsd as number).toLocaleString("pt-BR")) : "US$ 100.000"}</strong><small>${live ? "saldo atual monitorado" : "exemplo: o monitor ainda não leu seu saldo"}</small></div>

          <div class="rule">
            <div class="rtop" id="ruleTop"></div>
            <div class="track"><div class="gauge" id="gauge"><div class="z z1"></div><div class="z z2"></div><div class="z z3"></div></div><i class="mk" id="mk"></i></div>
            <div class="rbot" id="ruleBot"></div>
          </div>

          <div class="legend">
            <p class="cap" id="cap"></p>
            <div class="lg" id="lg0" style="--hc:#14503a;--hb:#0b2a1f"><span class="dot" style="background:var(--ok)"></span><b>Sem alerta</b><span class="amt" id="t0"></span></div>
            <div class="lg" id="lg1" style="--hc:#7a5f12;--hb:#241d08"><span class="dot" style="background:var(--warn)"></span><b>E-mail</b><span class="amt" id="t1"></span></div>
            <div class="lg" id="lg2" style="--hc:#7a2a2a;--hb:#241010"><span class="dot" style="background:var(--crit)"></span><b>Ligação + WhatsApp</b><span class="amt" id="t2"></span></div>
          </div>

          <div class="sim">
            <div class="top"><label for="sim">Simular uma saída de</label><strong id="simTxt"></strong></div>
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
  return layout({ title: "Quando você quer ser avisado", body, authed: true, active: "/thresholds", error: params.error, head: THRESHOLDS_HEAD });
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
  return layout({ title: "Destinatários de alerta", body: params.notice ? `<div class="card"><p>${escapeHtml(params.notice)}</p></div>${body}` : body, authed: true, active: "/recipients", error: params.error });
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
  return layout({ title: "Histórico de alertas", body, authed: true, active: "/alerts" });
}
