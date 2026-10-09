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
import { formatUsdDisplay } from "../engine/rules/token-units.js";
import { THRESHOLDS_HEAD, thresholdsScript } from "./thresholds-ui.js";
import { LOGO_FULL_DATA_URI, LOGO_ICON_DATA_URI } from "./logo-assets.js";
import type { Contributor } from "./contributors.js";

/** Null em vez de exceção quando o valor não é inteiro válido — a tela mostra "—" em vez de quebrar. */
function safeBigInt(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** `0x4f3a…c921`. O endereço inteiro vai no `title`, que é onde quem precisa confere. */
function shortenAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

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
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    background: radial-gradient(ellipse 80% 60% at 50% -10%, #e9e1f2 0%, #ebe6ef 55%), #ebe6ef;
    color:#1e1b29; margin:0; min-height:100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  header { padding: 18px 28px; border-bottom: 1px solid #ddd4e6; display:flex; align-items:center; justify-content:space-between; backdrop-filter: blur(6px); background:rgba(235,230,239,0.85); }
  header .brand { display:flex; align-items:center; gap:9px; color:#1e1b29; font-weight:700; font-size:1.05rem; letter-spacing:0.02em; text-decoration:none; }
  nav a { color:#6b6475; text-decoration:none; margin-left:20px; font-size:0.88rem; transition: color .15s ease; }
  nav a:hover { color:#7c3aed; }
  nav a.on { color:#1e1b29; font-weight:600; box-shadow: 0 2px 0 #7c3aed; padding-bottom:6px; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 24px 64px; }
  h1 { font-size:1.5rem; margin:0 0 6px; letter-spacing:-0.01em; }
  .muted { color:#6b6475; font-size:0.9rem; line-height:1.5; }
  label { display:block; margin-top:16px; margin-bottom:6px; font-size:0.82rem; color:#4b4558; font-weight:500; }
  input, select {
    width:100%; background:#ffffff; border:1px solid #d7d0e3; color:#1e1b29;
    padding:11px 13px; border-radius:8px; font-size:0.95rem; transition: border-color .15s ease, box-shadow .15s ease;
    font-family: inherit;
  }
  input:focus, select:focus {
    outline:none; border-color:#7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
  }
  input::placeholder { color:#9b94a8; }
  button {
    margin-top:22px; background: linear-gradient(180deg, #8b5cf6, #6d28d9); color:#ffffff; border:none;
    padding:11px 20px; border-radius:8px; font-weight:600; font-size:0.95rem; cursor:pointer;
    transition: transform .1s ease, box-shadow .15s ease, opacity .15s ease;
    box-shadow: 0 1px 2px rgba(30,20,46,0.2), 0 0 0 1px rgba(109,40,217,0.3) inset;
  }
  button:hover { box-shadow: 0 2px 10px rgba(109,40,217,0.3), 0 0 0 1px rgba(109,40,217,0.4) inset; }
  button:active { transform: translateY(1px); }
  button.secondary { background:transparent; border:1px solid #d7d0e3; color:#413c4d; box-shadow:none; }
  button.secondary:hover { border-color:#a89bbd; box-shadow:none; }
  button.danger { background: linear-gradient(180deg, #f87171, #dc2626); color:#fff6f6; box-shadow: 0 1px 2px rgba(30,20,46,0.2); }
  table { width:100%; border-collapse: collapse; margin-top:12px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #e3deec; font-size:0.88rem; }
  th { color:#6b6475; font-weight:600; font-size:0.78rem; text-transform:uppercase; letter-spacing:0.04em; }
  .card {
    background:#ffffff; border:1px solid #e3deec; border-radius:12px; padding:24px;
    margin-top:18px; box-shadow: 0 4px 24px rgba(30,20,46,0.07);
  }
  .error {
    background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:11px 15px;
    border-radius:8px; margin-top:18px; font-size:0.88rem;
  }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.74rem; font-weight:600; letter-spacing:0.02em; }
  .pill.critical { background:#fef2f2; color:#b91c1c; }
  .pill.normal { background:#f3effa; color:#6d28d9; }
  code { background:#f3f1f6; padding:2px 7px; border-radius:5px; font-size:0.85rem; border:1px solid #e3deec; }
  a.link { color:#7c3aed; text-decoration:none; }
  a.link:hover { text-decoration:underline; }
  .balance {
    font-size: 2.25rem; font-weight: 700; letter-spacing: -0.02em; color:#1e1b29;
    margin: 0 0 2px;
    /* dígitos de largura fixa: sem isto o número "dança" a cada atualização de saldo */
    font-variant-numeric: tabular-nums;
  }
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
  .auth-logo span { font-weight:800; font-size:1.3rem; letter-spacing:0.03em; color:#1e1b29; }
  .auth-card { background:#ffffff; border:1px solid #e3deec; border-radius:14px; padding:32px 28px; box-shadow: 0 8px 40px rgba(30,20,46,0.1), 0 0 0 1px rgba(30,20,46,0.02); }
  .auth-title { font-size:1.25rem; font-weight:700; margin:0 0 4px; text-align:center; }
  .auth-subtitle { color:#6b6475; font-size:0.88rem; text-align:center; margin:0 0 24px; line-height:1.5; }
  .auth-footer { text-align:center; margin-top:20px; font-size:0.86rem; color:#6b6475; }
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
    <div style="background:#ffffff; border:1px solid #e3deec; border-radius:10px; padding:16px; display:flex; justify-content:center;">${params.qrCodeSvg}</div>
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
<meta name="theme-color" content="#0a0e17">
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

/** Ícones inline da landing (stroke, 16-32px) - sem asset externo, mesmo padrão do GITHUB_ICON acima. */
const ICON_CLOCK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>`;
const ICON_CODE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m11 0h3a2 2 0 0 0 2-2v-3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PHONE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PHONE_ACCENT = ICON_PHONE.replace('stroke="#67e8f9"', 'stroke="#fbbf24"');
const ICON_CALENDAR = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18" stroke-linecap="round"/></svg>`;
const ICON_RADAR = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>`;
const ICON_LOCK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const ICON_LOCK_BIG = ICON_LOCK.replace('width="22" height="22"', 'width="32" height="32"').replace('stroke-width="1.8"', 'stroke-width="1.5"').replace('stroke="#67e8f9"', 'stroke="#22d3ee"');
const ICON_SHIELD_CHECK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l7.5 2.7v6.1c0 4.8-3.2 8.9-7.5 10.2-4.3-1.3-7.5-5.4-7.5-10.2V5.2L12 2.5z"/><path d="m9 12 2 2 4-4"/></svg>`;
const ICON_ARROW = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const ICON_CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;"><path d="M20 6 9 17l-5-5"/></svg>`;

/**
 * Estilo extra só da landing — hero próprio em grid (texto + formulário lado
 * a lado), não reaproveita o <main> estreito/h1 pequeno do layout() interno
 * (telas de app). Formulário fica dentro da primeira dobra, não exige rolar
 * (feedback de revisão: form empurrado pra baixo matava conversão).
 */
/**
 * Estilo completo e AUTOSSUFICIENTE da landing - não combina com BASE_STYLE
 * (claro/lilás, usado no painel/login/cadastro). Decisão: só a landing pública
 * vira dark/cyan (identidade "security-grade"); o resto do produto continua
 * claro, sem risco de regressão visual a poucos dias da submissão.
 */
const LANDING_STYLE = `
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin:0; min-height:100vh; background:#0a0e17; color:#e5e7eb;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased;
  }
  ::selection { background: rgba(34,211,238,0.3); }
  a { color:#67e8f9; text-decoration:none; }
  a:hover { color:#22d3ee; }
  a.link { color:#22d3ee; }
  a.link:hover { text-decoration:underline; }
  .muted { color:#8b95a7; font-size:0.9rem; line-height:1.55; }
  .container { max-width:1120px; margin:0 auto; padding-left:28px; padding-right:28px; }
  h1, h2 { font-family:'Space Grotesk', 'Inter', sans-serif; color:#f8fafc; }

  /* reveal-on-scroll: JS adds .is-visible when the element enters the viewport */
  .reveal { opacity:0; transform:translateY(18px); transition: opacity .6s ease-out, transform .6s ease-out; }
  .reveal.is-visible { opacity:1; transform:translateY(0); }
  @media (prefers-reduced-motion: reduce) {
    .reveal { opacity:1; transform:none; transition:none; }
  }

  /* header */
  .top-header { position:sticky; top:0; z-index:20; border-bottom:1px solid #1b2433; background:rgba(10,14,23,0.82); backdrop-filter:blur(10px); }
  .top-header .container { display:flex; align-items:center; justify-content:space-between; height:72px; }
  .top-header .brand { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; color:#f8fafc; }
  .top-nav { display:flex; align-items:center; gap:26px; }
  .top-nav a.nav-link { color:#9aa4b2; font-size:0.88rem; transition: color .15s ease; }
  .top-nav a.nav-link:hover { color:#e5e7eb; }
  .top-nav a.btn-ghost { color:#cbd5e1; font-size:0.88rem; border:1px solid #2a3449; padding:8px 16px; border-radius:8px; transition: border-color .15s ease; }
  .top-nav a.btn-ghost:hover { border-color:#3a4760; color:#f1f5f9; }
  @media (max-width:860px) { .top-nav .nav-link { display:none; } }

  /* buttons */
  button, a.btn { font-family:inherit; cursor:pointer; border:none; display:inline-flex; align-items:center; justify-content:center;
    padding:12px 22px; border-radius:9px; font-weight:600; font-size:0.95rem; text-decoration:none;
    transition: transform .1s ease, box-shadow .18s ease, opacity .15s ease; }
  button.cta, a.btn.cta {
    background: linear-gradient(180deg, #fbbf24, #f59e0b); color:#231703;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 0 0 1px rgba(245,158,11,0.4) inset, 0 0 0 rgba(245,158,11,0.3);
  }
  button.cta:hover, a.btn.cta:hover { box-shadow: 0 4px 22px rgba(245,158,11,0.35), 0 0 0 1px rgba(245,158,11,0.5) inset; transform: translateY(-1px); }
  button.cta:active, a.btn.cta:active { transform: translateY(0); }
  a.btn.secondary { background:transparent; border:1px solid #2a3449; color:#cbd5e1; }
  a.btn.secondary:hover { border-color:#3a4760; color:#f1f5f9; }

  /* form elements (waitlist card) */
  label { display:block; margin-top:14px; margin-bottom:6px; font-size:0.82rem; color:#9aa4b2; font-weight:500; }
  input, select { width:100%; background:#101726; border:1px solid #232d40; color:#e5e7eb;
    padding:11px 13px; border-radius:8px; font-size:0.95rem; font-family:inherit;
    transition: border-color .15s ease, box-shadow .15s ease; }
  input:focus, select:focus { outline:none; border-color:#22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,0.15); }
  input::placeholder { color:#4b5668; }
  .error { background:#2a1212; border:1px solid #5c1f1f; color:#fca5a5; padding:11px 15px; border-radius:8px; margin-bottom:18px; font-size:0.88rem; }

  /* hero */
  .hero { position:relative; padding:76px 0 64px; overflow:hidden;
    background: radial-gradient(ellipse 60% 55% at 12% -10%, rgba(34,211,238,0.14), transparent 60%), radial-gradient(ellipse 50% 45% at 100% 0%, rgba(245,158,11,0.07), transparent 55%);
    border-bottom:1px solid #1b2433; }
  .hero-grid { display:grid; grid-template-columns:1.15fr 0.85fr; gap:48px; align-items:start; }
  @media (max-width:860px) { .hero-grid { grid-template-columns:1fr; } .hero-copy { text-align:center; } .hero-copy .mark, .trust-row { justify-content:center; } }
  .hero-copy .mark { display:inline-block; margin-bottom:18px; }
  .hero-copy .mark img { display:block; border-radius:18%; }
  .hero-copy h1 { font-size: clamp(1.9rem, 3.6vw, 2.7rem); line-height:1.18; margin:0 0 16px; letter-spacing:-0.02em; font-weight:700; }
  .hero-copy .lead { font-size:1.04rem; color:#aab4c4; margin:0 0 8px; line-height:1.58; }
  .hero-copy .lead strong { color:#e5e7eb; }
  .trust-row { display:flex; gap:10px; flex-wrap:wrap; margin:18px 0 20px; }
  .hero-copy .mark, .hero-copy h1, .hero-copy .lead, .hero-copy .trust-row, .hero-copy > p.muted, .hero-form {
    animation: fade-up .6s ease-out both;
  }
  .hero-copy .mark { animation: fade-up .6s ease-out both, pulse-ring 2.6s cubic-bezier(.4,0,.6,1) .6s infinite; border-radius:18%; }
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
  .badge { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; border:1px solid #2a3449; color:#9aa4b2; font-size:0.78rem; font-weight:600; background:#0e1521; transition: border-color .15s ease, color .15s ease; }
  a.badge:hover { border-color:#3a4760; color:#cbd5e1; }
  .badge.accent { border-color:rgba(245,158,11,0.4); color:#fbbf24; }

  /* hero waitlist card */
  .hero-form { background:#0e1521; border:1px solid #1b2433; border-radius:14px; padding:24px; box-shadow:0 20px 50px rgba(0,0,0,0.35); }
  .hero-form .form-title { margin:0 0 4px; font-weight:700; font-size:1.05rem; color:#f8fafc; }
  .pills { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
  .pills input { position:absolute; opacity:0; width:1px; height:1px; }
  .pills label { cursor:pointer; padding:8px 14px; border-radius:999px; border:1px solid #232d40; background:#101726; color:#9aa4b2; font-size:0.82rem; font-weight:500; transition: all .15s ease; margin-top:0; }
  .pills input:checked + label { border-color:#22d3ee; color:#e5e7eb; background:#0c2228; }
  .pills input:focus-visible + label { outline:2px solid #22d3ee; outline-offset:2px; }
  details.note-toggle { margin-top:16px; }
  details.note-toggle summary { cursor:pointer; color:#8b95a7; font-size:0.82rem; list-style:none; }
  details.note-toggle summary::-webkit-details-marker { display:none; }
  details.note-toggle summary::before { content:"+ "; color:#22d3ee; font-weight:700; }
  details.note-toggle[open] summary::before { content:"− "; }

  /* sections, shared rhythm */
  .section { padding:72px 0; }
  .section.alt { background:#0b0f19; border-top:1px solid #1b2433; border-bottom:1px solid #1b2433; }
  .eyebrow { color:#67e8f9; font-size:0.78rem; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; margin:0 0 10px; }
  .section h2 { font-size:1.6rem; font-weight:700; margin:0 0 30px; max-width:600px; }

  /* trust bar */
  .trust-bar { border-top:1px solid #1b2433; border-bottom:1px solid #1b2433; background:#0b0f19; }
  .trust-bar .container { display:flex; flex-wrap:wrap; gap:26px; align-items:center; justify-content:space-between; padding:24px 28px; }
  .trust-bar .item { display:flex; align-items:center; gap:8px; color:#8b95a7; font-size:0.84rem; }
  .trust-bar svg { flex-shrink:0; }

  /* problem / stat */
  .stat-row { display:flex; gap:48px; align-items:center; flex-wrap:wrap; }
  .stat-number { font-family:'Space Grotesk', sans-serif; font-weight:700; font-size:4rem; color:#fbbf24; line-height:1; }
  .stat-row .stat-copy { flex:1 1 420px; border-left:1px solid #1b2433; padding-left:36px; }

  /* how it works: diagram */
  .steps-row { display:grid; grid-template-columns:repeat(4,1fr); gap:0; align-items:stretch; }
  @media (max-width:900px) { .steps-row { grid-template-columns:1fr; } .step-arrow { transform:rotate(90deg); margin:2px 0; } }
  .step-card { background:#0e1521; border:1px solid #1b2433; border-radius:12px; padding:22px; transition: border-color .2s ease, transform .2s ease; }
  .step-card:hover { border-color:#2a3449; transform:translateY(-3px); }
  .step-card .step-icon { margin-bottom:14px; }
  .step-card .step-title { margin:0 0 6px; color:#f1f5f9; font-weight:600; font-size:0.94rem; }
  .step-card .step-desc { margin:0; color:#8b95a7; font-size:0.84rem; line-height:1.55; }
  .step-arrow { display:flex; align-items:center; justify-content:center; color:#2a3449; animation: arrow-flow 1.8s ease-in-out infinite; }
  @keyframes arrow-flow { 0%,100% { opacity:0.45; transform:translateX(0); } 50% { opacity:1; transform:translateX(3px); } }
  @media (prefers-reduced-motion: reduce) { .step-arrow { animation:none; } }

  /* product preview */
  .product-frame { display:flex; background:#0b121d; border:1px solid #1b2433; border-radius:16px; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,0.35); }
  .product-frame .side { width:190px; flex-shrink:0; background:#0e1521; border-right:1px solid #1b2433; padding:20px 0; }
  .product-frame .side .item { padding:10px 20px; color:#8b95a7; font-size:0.84rem; }
  .product-frame .side .item.active { color:#e5e7eb; background:rgba(34,211,238,0.08); border-left:2px solid #22d3ee; }
  .product-frame .main { flex:1; padding:26px 30px; min-width:0; }
  .mini-table { width:100%; border-collapse:collapse; margin-bottom:22px; }
  .mini-table th { text-align:left; color:#8b95a7; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.04em; padding:8px 10px; border-bottom:1px solid #1b2433; }
  .mini-table td { padding:10px; border-bottom:1px solid #1b2433; color:#cbd5e1; font-size:0.85rem; }
  .pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:0.74rem; font-weight:600; letter-spacing:0.02em; }
  .pill.critical { background:#2a1212; color:#fca5a5; }
  .pill.normal { background:#0c2228; color:#67e8f9; }

  /* security section */
  .security-grid { display:flex; gap:44px; flex-wrap:wrap; align-items:flex-start; }
  .security-icon { flex-shrink:0; width:68px; height:68px; border-radius:16px; background:rgba(34,211,238,0.08); display:flex; align-items:center; justify-content:center; }
  .check-list { display:flex; flex-direction:column; gap:10px; margin-top:18px; }
  .check-list .row { display:flex; align-items:center; gap:10px; color:#cbd5e1; font-size:0.9rem; }

  /* comparison */
  .table-wrap { overflow-x:auto; border-radius:12px; border:1px solid #1b2433; }
  .compare-table { width:100%; border-collapse:collapse; min-width:620px; }
  .compare-table th { text-align:left; padding:14px 18px; background:#0e1521; font-size:0.8rem; border-bottom:1px solid #1b2433; }
  .compare-table th.them { color:#9aa4b2; font-weight:600; }
  .compare-table th.us { color:#67e8f9; font-weight:700; }
  .compare-table td { padding:14px 18px; font-size:0.86rem; border-bottom:1px solid #1b2433; }
  .compare-table tr:last-child td { border-bottom:none; }
  .compare-table td.row-label { color:#8b95a7; }
  .compare-table td.them { color:#8b95a7; }
  .compare-table td.us { color:#e5e7eb; }
  .compare-table tr:hover td { background:rgba(34,211,238,0.04); }

  /* status + contributors */
  .status-panel {
    background:#0b0f19; border:1px solid #1b2433; border-radius:10px; padding:14px 16px;
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size:0.82rem; position:relative; overflow:hidden;
  }
  .status-panel::before {
    content:""; position:absolute; inset:0;
    background-image: linear-gradient(rgba(34,211,238,0.04) 1px, transparent 1px);
    background-size: 100% 20px; pointer-events:none;
  }
  .status-line { display:flex; align-items:center; gap:10px; padding:4px 0; position:relative; flex-wrap:wrap; }
  .status-line .label { color:#67e8f9; min-width:110px; }
  .status-line .value { color:#aab4c4; }
  .dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .dot.ok { background:#34d399; animation: dot-pulse-ok 2.2s ease-out infinite; }
  .dot.active { background:#fbbf24; animation: dot-pulse-active 1.1s ease-out infinite; }
  @keyframes dot-pulse-ok {
    0% { box-shadow: 0 0 0 0 rgba(52,211,153,0.5); } 70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
  }
  @keyframes dot-pulse-active {
    0% { box-shadow: 0 0 0 0 rgba(251,191,36,0.55); } 70% { box-shadow: 0 0 0 6px rgba(251,191,36,0); } 100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); }
  }
  .loading-bar { position:relative; height:3px; border-radius:999px; background:#111827; overflow:hidden; margin-top:8px; }
  .loading-bar span { position:absolute; top:0; left:-40%; height:100%; width:40%; border-radius:999px;
    background: linear-gradient(90deg, transparent, #22d3ee, #fbbf24, transparent); animation: loading-sweep 1.6s ease-in-out infinite; }
  @keyframes loading-sweep { 0% { left:-40%; } 100% { left:100%; } }
  @media (prefers-reduced-motion: reduce) {
    .dot.ok, .dot.active, .loading-bar span { animation: none; }
  }
  .contributors-row { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin-top:14px; }
  .contributors-row a { display:block; width:36px; height:36px; border-radius:999px; overflow:hidden; border:2px solid #1b2433; transition: border-color .15s ease, transform .15s ease; }
  .contributors-row a:hover { border-color:#22d3ee; transform: translateY(-2px); }
  .contributors-row img { display:block; width:100%; height:100%; }
  .contributors-row .cta-join { font-size:0.84rem; }

  /* final CTA + footer */
  .final-cta { text-align:center; background:radial-gradient(ellipse 60% 70% at 50% 100%, rgba(34,211,238,0.1), transparent 60%); }
  .final-cta .container { max-width:640px; }
  .final-cta h2 { margin:0 0 14px; font-size:1.7rem; }
  .footer-grid { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:32px; }
  @media (max-width:700px) { .footer-grid { grid-template-columns:1fr 1fr; } }
  .footer-grid .col-title { color:#9aa4b2; font-size:0.76rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; margin:0 0 12px; }
  .footer-grid a { color:#8b95a7; font-size:0.86rem; display:block; margin-bottom:8px; }
  .footer-bottom { margin-top:28px; padding-top:20px; border-top:1px solid #151d2b; color:#4b5668; font-size:0.78rem; }
`;

/** Lista de avatares com link pro perfil - cresce sozinha conforme o GitHub reportar mais colaboradores (ver dashboard/contributors.ts). */
function contributorsRow(contributors: Contributor[]): string {
  const avatars = contributors
    .map(
      (c) =>
        `<a href="${escapeHtml(c.htmlUrl)}" target="_blank" rel="noopener" title="${escapeHtml(c.login)}"><img src="${escapeHtml(c.avatarUrl)}&s=72" width="36" height="36" alt="${escapeHtml(c.login)}" loading="lazy"></a>`,
    )
    .join("");
  return `<div class="contributors-row">${avatars}<a class="link cta-join" href="https://github.com/JefersonCruz/VILIGION/blob/master/CONTRIBUTING.md" target="_blank" rel="noopener">+ Quero contribuir</a></div>`;
}

export function landingPage(params: { joined?: boolean; error?: string; baseUrl: string; contributors: Contributor[] }): string {
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

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — Alerta de tesouraria feito para funcionar sob coação</title>
${shareMeta(params.baseUrl)}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap">
<style>${LANDING_STYLE}</style>
</head>
<body>
<header class="top-header">
  <div class="container">
    <a class="brand" href="/">${logoMark(28)}VILIGION</a>
    <div class="top-nav">
      <a class="nav-link" href="#como-funciona">Como funciona</a>
      <a class="nav-link" href="#seguranca">Segurança</a>
      <a class="nav-link" href="#comparativo">Comparativo</a>
      <a class="btn-ghost" href="/login">Entrar</a>
      <a class="btn cta" href="#lista">Lista de espera</a>
    </div>
  </div>
</header>

<section class="hero">
  <div class="container hero-grid">
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
    <div class="hero-form" id="lista">
      <p class="form-title">Entre na lista de espera</p>
      ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ""}
      ${form}
    </div>
  </div>
</section>

<div class="trust-bar">
  <div class="container">
    <div class="item">${ICON_CLOCK}Blockchain Tempo</div>
    <div class="item">${ICON_CODE}Código aberto · MIT</div>
    <div class="item">${ICON_PHONE}Alertas via Twilio Voice</div>
    <div class="item">${ICON_CALENDAR}Crypto World's Fair · Colosseum</div>
  </div>
</div>

<div class="section">
  <div class="container stat-row reveal">
    <div>
      <div class="stat-number"><span data-countup="33">+0</span>%</div>
      <p class="muted" style="max-width:220px; margin-top:8px;">no crescimento de ataques físicos ligados a cripto em 2026 (CertiK) — mais de US$ 30M só no primeiro semestre (Chainalysis).</p>
    </div>
    <div class="stat-copy">
      <p style="margin:0 0 6px; color:#f1f5f9; font-weight:600; font-size:1.02rem;">O problema</p>
      <p class="muted" style="margin:0;">Quem guarda a tesouraria de uma equipe ou empresa raramente tem alguém olhando o saldo o dia todo. Ferramentas institucionais (Hexagate, Elliptic, TRM Labs, Blockaid) são feitas pra equipes de segurança — não pra quem não tem esse time. E ligar um telefone a um saldo on-chain cria, por si só, um risco físico documentado.</p>
    </div>
  </div>
</div>

<div class="section alt" id="como-funciona">
  <div class="container">
    <p class="eyebrow">Como funciona</p>
    <h2>Do RPC até o telefone de alguém de confiança</h2>
    <div class="steps-row reveal">
      <div class="step-card">
        <div class="step-icon">${ICON_RADAR}</div>
        <p class="step-title">1. Monitoramento</p>
        <p class="step-desc">RPC direto (Viem) observa saldo, eventos de política de recebimento e padrões de transferência em endereços TIP-20.</p>
      </div>
      <div class="step-arrow" aria-hidden="true">${ICON_ARROW}</div>
      <div class="step-card">
        <div class="step-icon">${ICON_LOCK}</div>
        <p class="step-title">2. Privacidade</p>
        <p class="step-desc">Resolve endereço → contato e decide o que pode sair. Nenhum dado sensível cruza essa camada.</p>
      </div>
      <div class="step-arrow" aria-hidden="true">${ICON_ARROW}</div>
      <div class="step-card">
        <div class="step-icon">${ICON_PHONE_ACCENT}</div>
        <p class="step-title">3. Alerta por severidade</p>
        <p class="step-desc">Crítico vira ligação (Twilio Voice) + PIN. Normal vira e-mail. Conteúdo sempre genérico, nos dois canais.</p>
      </div>
      <div class="step-arrow" aria-hidden="true">${ICON_ARROW}</div>
      <div class="step-card">
        <div class="step-icon">${ICON_SHIELD_CHECK}</div>
        <p class="step-title">4. Painel autenticado</p>
        <p class="step-desc">Saldo real e histórico completo só aparecem depois do login — nunca pelo canal de alerta.</p>
      </div>
    </div>
  </div>
</div>

<div class="section">
  <div class="container">
    <p class="eyebrow">O produto</p>
    <h2>Não só a promessa — o painel de verdade</h2>
    <div class="product-frame reveal">
      <div class="side">
        <div class="item active">Painel</div>
        <div class="item">Contas monitoradas</div>
        <div class="item">Limiares</div>
        <div class="item">Destinatários</div>
        <div class="item">Alertas</div>
      </div>
      <div class="main">
        <p style="margin:0 0 14px; color:#f1f5f9; font-weight:600; font-size:0.92rem;">Contas monitoradas <span class="muted">(exemplo)</span></p>
        <table class="mini-table">
          <tr><th>Chain</th><th>Endereço</th><th>Status</th></tr>
          <tr><td>Tempo (Moderato)</td><td>0x4f3a…c921</td><td><span class="pill normal">normal</span></td></tr>
          <tr><td>Tempo (Moderato)</td><td>0x91bd…77ea</td><td><span class="pill critical">crítico</span></td></tr>
        </table>
        <p style="margin:0 0 14px; color:#f1f5f9; font-weight:600; font-size:0.92rem;">Histórico de alertas <span class="muted">(exemplo)</span></p>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #1b2433;">
          <span style="color:#cbd5e1; font-size:0.86rem;">Queda abrupta de saldo</span>
          <span class="pill critical">ligação enviada</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0;">
          <span style="color:#cbd5e1; font-size:0.86rem;">Transferência bloqueada pela policy</span>
          <span class="pill normal">e-mail enviado</span>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="section alt" id="seguranca">
  <div class="container security-grid reveal">
    <div class="security-icon">${ICON_LOCK_BIG}</div>
    <div style="flex:1 1 420px;">
      <h2 style="margin:0 0 14px;">Desenhado pra funcionar mesmo sob coação</h2>
      <p class="muted" style="max-width:620px;">O conteúdo do alerta nunca revela saldo, endereço ou número de telefone — isso é garantido por teste automatizado, não por revisão manual. Os destinatários são cadastrados depois do login, separados do endereço monitorado, e ficam criptografados (AES-256-GCM) — nunca em texto puro ao lado dele. Recomendamos usar um número dedicado em vez do telefone pessoal do dono; o produto não provisiona esse número pra você.</p>
      <div class="check-list">
        <div class="row">${ICON_CHECK}Nunca executa transação a partir de resposta por voz ou SMS</div>
        <div class="row">${ICON_CHECK}Não é produto de custódia — nunca guardamos sua chave privada</div>
        <div class="row">${ICON_CHECK}Prova de posse por assinatura EIP-191 no cadastro, sem mover fundos</div>
      </div>
    </div>
  </div>
</div>

<div class="section" id="comparativo">
  <div class="container">
    <p class="eyebrow">Comparativo</p>
    <h2>Por que não só uma ferramenta institucional</h2>
    <div class="table-wrap reveal">
      <table class="compare-table">
        <tr><th></th><th class="them">Hexagate · Elliptic · TRM · Blockaid</th><th class="us">VILIGION</th></tr>
        <tr><td class="row-label">Público-alvo</td><td class="them">Equipes de segurança institucional</td><td class="us">Dono de PME sem equipe de segurança</td></tr>
        <tr><td class="row-label">Canal de alerta</td><td class="them">Dashboard, Slack, webhook</td><td class="us">Ligação + e-mail, por severidade</td></tr>
        <tr><td class="row-label">Privacidade do destinatário</td><td class="them">Não é o foco do produto</td><td class="us">Conteúdo genérico por desenho + destinatário criptografado, separado do endereço</td></tr>
        <tr><td class="row-label">Custo e complexidade</td><td class="them">Alto, requer integração dedicada</td><td class="us">Cadastro direto, sem time dedicado</td></tr>
      </table>
    </div>
  </div>
</div>

<div class="section alt">
  <div class="container reveal">
    <p style="margin:0 0 18px; color:#f1f5f9; font-weight:600; font-size:1.02rem;">Em que estágio estamos</p>
    <div class="status-panel" role="img" aria-label="Status: motor de detecção validado na testnet Moderato, código aberto no GitHub, submissão em andamento.">
      <div class="status-line"><span class="dot ok" aria-hidden="true"></span><span class="label">core_engine</span><span class="value">validado · testnet Moderato</span></div>
      <div class="status-line"><span class="dot ok" aria-hidden="true"></span><span class="label">código</span><span class="value">aberto no GitHub · MIT</span></div>
      <div class="status-line"><span class="dot active" aria-hidden="true"></span><span class="label">submissão</span><span class="value">em andamento</span></div>
      <div class="loading-bar" aria-hidden="true"><span></span></div>
    </div>
    <p class="muted" style="margin:16px 0 0;">Entre na lista para testar primeiro &mdash; o seu feedback define o que construímos a seguir.</p>
    <p class="muted" style="margin:16px 0 0;"><strong style="color:#e5e7eb;">Quem constrói</strong> &mdash; direto do GitHub, atualiza sozinho conforme mais gente contribui:</p>
    ${contributorsRow(params.contributors)}
  </div>
</div>

<div class="section final-cta">
  <div class="container">
    <h2>Pronto pra saber antes de alguém precisar fazer essa ligação?</h2>
    <p class="muted" style="margin:0 0 28px;">Entre na lista de espera — seu feedback define o que construímos a seguir. Sem spam, sem repasse a terceiros.</p>
    <a class="btn cta" href="#lista">Entrar na lista de espera</a>
  </div>
</div>

<footer style="padding:48px 0 0;">
  <div class="container footer-grid">
    <div>
      <div style="display:flex; align-items:center; gap:9px; color:#f1f5f9; font-weight:700; margin-bottom:10px;">${logoMark(22)}VILIGION</div>
      <p class="muted" style="max-width:240px;">Alerta de tesouraria on-chain que continua funcionando sob coação.</p>
    </div>
    <div>
      <p class="col-title">Produto</p>
      <a href="#como-funciona">Como funciona</a>
      <a href="#seguranca">Segurança</a>
      <a href="#comparativo">Comparativo</a>
    </div>
    <div>
      <p class="col-title">Projeto</p>
      <a href="https://github.com/JefersonCruz/VILIGION" target="_blank" rel="noopener">GitHub</a>
      <a href="https://github.com/JefersonCruz/VILIGION/blob/master/LICENSE" target="_blank" rel="noopener">Licença MIT</a>
      <a href="https://github.com/JefersonCruz/VILIGION/blob/master/TERMS-OF-USE.md" target="_blank" rel="noopener">Termos de uso</a>
    </div>
    <div>
      <p class="col-title">Canais oficiais</p>
      <a href="https://x.com/viligion" target="_blank" rel="noopener">X · @viligion</a>
      <a href="https://t.me/viligionOficial" target="_blank" rel="noopener">Telegram · @viligionOficial</a>
      <a href="mailto:jefersonhenri1@gmail.com">jefersonhenri1@gmail.com</a>
      <p class="muted" style="font-size:0.78rem; margin:10px 0 0; max-width:240px;">Estes são os únicos canais oficiais. Nunca pedimos endereço, saldo, seed ou código 2FA — por canal nenhum — e nunca iniciamos conversa por mensagem privada.</p>
    </div>
  </div>
  <div class="container footer-bottom">© 2026 VILIGION — Construído para o Crypto World's Fair (Colosseum), track Tempo.</div>
</footer>

<script>
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var revealEls = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  var counters = document.querySelectorAll("[data-countup]");
  counters.forEach(function (el) {
    var target = parseInt(el.getAttribute("data-countup"), 10) || 0;
    if (reduceMotion) { el.textContent = "+" + target; return; }
    var start = null;
    var duration = 900;
    function step(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      el.textContent = "+" + Math.round(progress * target);
      if (progress < 1) requestAnimationFrame(step);
    }
    var started = false;
    var countIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !started) {
          started = true;
          requestAnimationFrame(step);
          countIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.6 });
    countIo.observe(el);
  });
})();
</script>
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

  // O saldo vinha pra tela como unidade bruta do token dentro de <code> - o
  // número mais importante do produto aparecia como "42180320000". A função de
  // formatação já existia e não era usada aqui (ver docs/UI-DESIGN-STUDY.md §0).
  // O valor bruto continua acessível no title, pra quem precisa conferir.
  const balanceUnits = safeBigInt(params.balanceRaw);
  const balanceLabel = balanceUnits === null ? "—" : `US$ ${formatUsdDisplay(balanceUnits)}`;

  const body = `
<div class="card">
  <p class="muted" style="margin:0 0 2px;">Saldo monitorado</p>
  <p class="balance" title="${escapeHtml(params.balanceRaw)} (menor unidade do token)">${escapeHtml(balanceLabel)}</p>
  <p class="muted" style="margin:0 0 18px;">PathUSD · Tempo</p>
  <p class="muted" style="margin:0 0 2px;">Endereço principal</p>
  <p style="margin:0 0 14px;"><code title="${escapeHtml(params.address)}">${escapeHtml(shortenAddress(params.address))}</code></p>
  <p class="muted" style="margin:0;">${params.accountsCount} conta(s) monitorada(s) — <a class="link" href="/accounts">gerenciar</a></p>
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
            <div class="lg" id="lg0" style="--hc:#bbf7d0;--hb:#f0fdf4"><span class="dot" style="background:var(--ok)"></span><b>Sem alerta</b><span class="amt" id="t0"></span></div>
            <div class="lg" id="lg1" style="--hc:#fde68a;--hb:#fffbeb"><span class="dot" style="background:var(--warn)"></span><b>E-mail</b><span class="amt" id="t1"></span></div>
            <div class="lg" id="lg2" style="--hc:#fecaca;--hb:#fef2f2"><span class="dot" style="background:var(--crit)"></span><b>Ligação + WhatsApp</b><span class="amt" id="t2"></span></div>
          </div>

          <div class="sim">
            <div class="top"><label for="sim">Simular uma saída de</label><strong id="simTxt"></strong></div>
            <input type="range" id="sim" min="0" max="100" step="1">
            <div class="result" id="result"></div>
          </div>

          <div class="note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" style="flex:none;margin-top:2px" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
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
