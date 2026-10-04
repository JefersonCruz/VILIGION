/**
 * Templates HTML server-side, funções puras (string in, string out) - sem
 * framework de frontend, consistente com o resto do projeto (node:http cru,
 * sem Express). Ver docs/UI-SPEC.md pra justificativa da escolha de stack.
 *
 * A única página com JS no cliente é signupPage() - inevitável, assinar
 * mensagem com a carteira só é possível no navegador (window.ethereum).
 * Usa EIP-1193 cru, sem viem/ethers no cliente, pra não exigir bundler.
 */

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
function layout(params: { title: string; body: string; authed?: boolean; error?: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — ${escapeHtml(params.title)}</title>
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

export function thresholdsPage(params: {
  maxBalanceDropPct: number;
  criticalBalanceDropPct: number;
  windowMinutes: number;
  blockedTransferAlertThreshold: string;
  criticalBlockedTransferThreshold: string;
  error?: string;
}): string {
  const body = `
<div class="card">
  <p class="muted" style="margin-bottom:10px;">Abaixo do limiar crítico, o alerta sai por e-mail; no limiar crítico ou acima, por ligação + WhatsApp com o PIN (ver <a class="link" href="/recipients">destinatários</a>, e SECURITY.md/ARCHITECTURE.md sobre o porquê da divisão por severidade).</p>
  <p class="muted" style="margin:0 0 14px;"><strong>Exemplo prático:</strong> com os valores padrão (20% / 50%), uma queda de 15% não alerta nada; uma queda de 30% manda e-mail; uma queda de 55% liga por telefone. "Menor unidade do token" é o valor bruto (ex: um TIP-20 com 6 casas decimais → 1.000.000 = 1 token inteiro).</p>
  <form method="POST" action="/thresholds">
    <label for="maxBalanceDropPct">Queda de saldo que dispara alerta (%)</label>
    <input type="number" step="0.1" id="maxBalanceDropPct" name="maxBalanceDropPct" value="${params.maxBalanceDropPct}" required>

    <label for="criticalBalanceDropPct">Queda de saldo que vira ligação (%)</label>
    <input type="number" step="0.1" id="criticalBalanceDropPct" name="criticalBalanceDropPct" value="${params.criticalBalanceDropPct}" required>

    <label for="windowMinutes">Janela de tempo pro cálculo de queda (minutos)</label>
    <input type="number" id="windowMinutes" name="windowMinutes" value="${params.windowMinutes}" required>

    <label for="blockedTransferAlertThreshold">Valor bloqueado que dispara alerta (menor unidade do token)</label>
    <input type="text" id="blockedTransferAlertThreshold" name="blockedTransferAlertThreshold" value="${escapeHtml(params.blockedTransferAlertThreshold)}" required>

    <label for="criticalBlockedTransferThreshold">Valor bloqueado que vira ligação (menor unidade do token)</label>
    <input type="text" id="criticalBlockedTransferThreshold" name="criticalBlockedTransferThreshold" value="${escapeHtml(params.criticalBlockedTransferThreshold)}" required>

    <button type="submit">Salvar</button>
  </form>
</div>`;
  return layout({ title: "Limiares de detecção", body, authed: true, error: params.error });
}

export function recipientsPage(params: {
  recipients: Array<{ id: string; kind: string; value: string }>;
  error?: string;
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
</div>`;
  return layout({ title: "Destinatários de alerta", body, authed: true, error: params.error });
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
