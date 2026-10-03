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

const NAV = `
<nav>
  <a href="/dashboard">Painel</a>
  <a href="/accounts">Contas monitoradas</a>
  <a href="/thresholds">Limiares</a>
  <a href="/alerts">Histórico de alertas</a>
  <a href="/logout">Sair</a>
</nav>`;

function layout(params: { title: string; body: string; authed?: boolean; error?: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — ${escapeHtml(params.title)}</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0b0f19; color:#e5e7eb; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:0; }
  header { padding: 16px 24px; border-bottom: 1px solid #1f2937; display:flex; align-items:center; justify-content:space-between; }
  header .brand { color:#22d3ee; font-weight:700; font-size:1.1rem; text-decoration:none; }
  nav a { color:#9aa4b2; text-decoration:none; margin-left:16px; font-size:0.9rem; }
  nav a:hover { color:#22d3ee; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size:1.4rem; margin-bottom:4px; }
  .muted { color:#9aa4b2; font-size:0.9rem; }
  label { display:block; margin-top:16px; margin-bottom:4px; font-size:0.9rem; color:#9aa4b2; }
  input, select { width:100%; box-sizing:border-box; background:#0f1420; border:1px solid #1f2937; color:#e5e7eb; padding:10px 12px; border-radius:6px; font-size:0.95rem; }
  button { margin-top:20px; background:#22d3ee; color:#0b0f19; border:none; padding:10px 18px; border-radius:6px; font-weight:600; cursor:pointer; }
  button.secondary { background:transparent; border:1px solid #1f2937; color:#e5e7eb; }
  button.danger { background:#f87171; color:#0b0f19; }
  table { width:100%; border-collapse: collapse; margin-top:16px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #1f2937; font-size:0.9rem; }
  th { color:#9aa4b2; font-weight:600; }
  .card { background:#0f1420; border:1px solid #1f2937; border-radius:8px; padding:20px; margin-top:16px; }
  .error { background:#3b1414; border:1px solid #7f1d1d; color:#fca5a5; padding:10px 14px; border-radius:6px; margin-top:16px; font-size:0.9rem; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.75rem; font-weight:600; }
  .pill.critical { background:#3b1414; color:#fca5a5; }
  .pill.normal { background:#0f2a2e; color:#67e8f9; }
  code { background:#0f1420; padding:2px 6px; border-radius:4px; font-size:0.85rem; }
  form { margin-top: 8px; }
</style>
</head>
<body>
<header>
  <a class="brand" href="/">VILIGION</a>
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

export function signupPage(params: { nonce: string; error?: string }): string {
  const body = `
<p class="muted">Prova de que você controla o endereço, telefone virtual pra alerta, e usuário/senha do painel. Tudo numa etapa só.</p>
<div class="card">
  <p class="muted" id="status">1. Conecte sua carteira pra assinar a prova de propriedade.</p>
  <button id="connectBtn" type="button">Conectar carteira</button>

  <form id="signupForm" method="POST" action="/signup" style="display:none">
    <input type="hidden" name="nonce" value="${escapeHtml(params.nonce)}">
    <input type="hidden" name="address" id="addressField">
    <input type="hidden" name="signature" id="signatureField">

    <label for="virtualPhoneNumber">Telefone virtual (formato internacional, ex: +5511999999999)</label>
    <input type="tel" id="virtualPhoneNumber" name="virtualPhoneNumber" required>

    <label for="username">Usuário do painel</label>
    <input type="text" id="username" name="username" required>

    <label for="password">Senha do painel</label>
    <input type="password" id="password" name="password" required minlength="8">

    <button type="submit">Finalizar cadastro</button>
  </form>
</div>
<script>
(function () {
  var nonce = ${JSON.stringify(params.nonce)};
  var statusEl = document.getElementById("status");
  var connectBtn = document.getElementById("connectBtn");
  var form = document.getElementById("signupForm");

  connectBtn.addEventListener("click", async function () {
    if (!window.ethereum) {
      statusEl.textContent = "Nenhuma carteira encontrada no navegador (ex: MetaMask).";
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
  return layout({ title: "Cadastro", body, error: params.error });
}

export function signupSuccessPage(params: { username: string; otpAuthUri: string }): string {
  const body = `
<div class="card">
  <p>Cadastro concluído. Configure o autenticador (Google Authenticator, Authy, 1Password) com este código antes de fazer login — ele não será mostrado de novo:</p>
  <p><code>${escapeHtml(params.otpAuthUri)}</code></p>
  <p class="muted">Usuário: <code>${escapeHtml(params.username)}</code></p>
  <a href="/login"><button type="button">Ir para o login</button></a>
</div>`;
  return layout({ title: "Cadastro concluído", body });
}

export function loginPage(params: { error?: string }): string {
  const body = `
<form method="POST" action="/session">
  <label for="username">Usuário</label>
  <input type="text" id="username" name="username" required autofocus>

  <label for="password">Senha</label>
  <input type="password" id="password" name="password" required>

  <label for="totpCode">Código do autenticador</label>
  <input type="text" id="totpCode" name="totpCode" inputmode="numeric" pattern="[0-9]{6}" required>

  <button type="submit">Entrar</button>
</form>
<p class="muted">Ainda não tem conta? <a href="/signup" style="color:#22d3ee">Cadastre-se</a></p>`;
  return layout({ title: "Login", body, error: params.error });
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
  <p class="muted">${params.accountsCount} conta(s) monitorada(s) — <a href="/accounts" style="color:#22d3ee">gerenciar</a></p>
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
          <button type="submit" class="secondary danger">Remover</button>
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
  <p class="muted">Adicionar conta — qualquer chain EVM-compatível já suportada, qualquer token</p>
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
  <p class="muted">Abaixo do limiar crítico, o alerta sai por e-mail; no limiar crítico ou acima, por ligação (ver SECURITY.md/ARCHITECTURE.md sobre por quê).</p>
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
