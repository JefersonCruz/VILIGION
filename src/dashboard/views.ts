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
import { KNOWN_CHAINS } from "../engine/chains/known-chains.js";
import { THRESHOLDS_HEAD, thresholdsScript } from "./thresholds-ui.js";
import { pushEnrollScript } from "./pwa-assets.js";
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

/**
 * Rótulos legíveis para os valores que o motor grava no banco. O painel
 * mostrava `balance-drop`, `voice` e `delivery-failed` crus na tela - saída de
 * máquina vazando pra interface de um dono de PME, que não tem como saber o
 * que significam. O valor cru continua no `title` pra quem precisa depurar.
 */
const ALERT_KIND_LABELS: Record<string, string> = {
  "balance-drop": "Queda de saldo",
  "transfer-blocked": "Transferência bloqueada",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "Crítico",
  normal: "Normal",
};

const CHANNEL_LABELS: Record<string, string> = {
  voice: "Ligação",
  email: "E-mail",
  push: "Dispositivo",
  "push+voice": "Dispositivo + ligação",
};

/** `pinStatus` acumulou significados de entrega além da confirmação do PIN - ver index.ts. */
const PIN_STATUS_LABELS: Record<string, { text: string; pill: string }> = {
  valid: { text: "Confirmado", pill: "ok" },
  invalid: { text: "Código errado", pill: "warn" },
  expired: { text: "Expirou", pill: "warn" },
  "already-consumed": { text: "Já usado", pill: "normal" },
  locked: { text: "Bloqueado", pill: "warn" },
  "delivery-failed": { text: "Falha na entrega", pill: "critical" },
  // Desfechos informados pelo dono no painel (ver AlertHistoryPort#acknowledge).
  // "Nao reconheco" e o sinal mais valioso que o produto coleta - por isso
  // aparece em vermelho, igual severidade critica: nao e so um registro, e um
  // pedido de atencao.
  "acknowledged-expected": { text: "Era esperado", pill: "ok" },
  "acknowledged-unauthorized": { text: "NÃO reconhecido", pill: "critical" },
  "delivery-failed-no-recipient": { text: "Sem destinatário", pill: "critical" },
};

function labelFor(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

/**
 * Endereço on-chain como o usuário realmente usa: truncado no meio, em mono
 * tabular, com botão de copiar. O gesto real é conferir e copiar - antes era
 * um `<code>` sem truncar nem copiar.
 */
function addressWithCopy(address: string): string {
  return `<span class="row" style="gap:6px;">
    <code class="mono" title="${escapeHtml(address)}">${escapeHtml(shortenAddress(address))}</code>
    <button type="button" class="copy" data-copy="${escapeHtml(address)}" aria-label="Copiar endereço" title="Copiar endereço">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>
    </button>
  </span>`;
}

/**
 * Feedback de cópia sem dependência nenhuma. `navigator.clipboard` falha em
 * contexto não seguro (http), então há fallback - e o botão confirma
 * visualmente, porque cópia sem confirmação deixa o usuário na dúvida.
 */
function copyScript(): string {
  return `<script>
document.addEventListener("click", function (event) {
  var btn = event.target.closest ? event.target.closest(".copy") : null;
  if (!btn) return;
  var value = btn.getAttribute("data-copy");
  if (!value) return;

  function done() {
    btn.setAttribute("data-done", "1");
    btn.setAttribute("title", "Copiado");
    setTimeout(function () {
      btn.removeAttribute("data-done");
      btn.setAttribute("title", "Copiar endereço");
    }, 1600);
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(value).then(done, fallback);
  } else {
    fallback();
  }

  function fallback() {
    var area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); done(); } catch (err) { btn.setAttribute("title", "Não foi possível copiar"); }
    document.body.removeChild(area);
  }
});
</script>`;
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

/**
 * Design system do painel — implementa `docs/UI-DESIGN-STUDY.md`.
 *
 * Três decisões que explicam quase tudo aqui, porque são as que o estudo
 * identificou como causa da aparência de "template gerado":
 *
 * 1. **Uma identidade só.** Antes eram dois produtos: a landing dark/ciano e o
 *    painel lilás com botão roxo em gradiente — quem se cadastrava atravessava
 *    uma troca de identidade no meio do fluxo. O painel agora usa a MESMA
 *    paleta da landing (neutros frios azulados + acento ciano). Zero violeta,
 *    zero gradiente em botão ou fundo.
 * 2. **Sombra significa elevação real.** Quando todo cartão tem sombra, ela
 *    deixa de significar e vira textura. São três níveis só (§5 do estudo):
 *    nível 0 (o padrão) separa por borda de 1px, sem sombra nenhuma; nível 1 é
 *    hover/ativo; nível 2 é reservado pro que de fato flutua.
 * 3. **Escala, não tamanhos soltos.** Tipografia em escala truncada e
 *    espaçamento em múltiplos de 4. O saldo é o dado mais importante do
 *    produto e tem tamanho de saldo, não de parágrafo.
 *
 * `font-variant-numeric: tabular-nums` em número/data não é detalhe estético:
 * sem isso os dígitos mudam de largura entre linhas da tabela e a coluna
 * "dança" a cada atualização — é o que separa produto financeiro de protótipo.
 */
const BASE_STYLE = `
  :root {
    color-scheme: dark;

    /* Paleta adotada de JefersonCruz/sora-manrope-vibe (2026-10-12), convertida
       de oklch pra hex. Neutros quase-neutros com leve viés quente, acento
       lavanda suave. Substituiu a escala fria + ciano: a arte do hero tem
       brilho lavanda, e ciano contra ela brigava.
       Os nove pares de contraste foram medidos e todos passam AA (4.5:1);
       o mais apertado é apoio sobre superfície-2, em 6.33:1. */
    --bg: #131217;
    --surface: #1B1921;
    --surface-2: #2C2833;
    --border: #3A3740;
    --border-strong: #4A4653;
    --text: #F3F2F5;
    --text-muted: #AEAAB7;

    /* Acentos — usar pouco. É o uso escasso que dá ar profissional. */
    --accent: #D3B6FF;
    --accent-ink: #1B1921;
    --critical: #F78765;
    --critical-bg: rgba(247,135,101,0.10);
    --warning: #FBBF24;
    --warning-bg: rgba(251,191,36,0.10);
    --ok: #9BE6B4;
    --ok-bg: rgba(155,230,180,0.10);

    /* Raio: três valores, cada um com significado. */
    --r-control: 6px;
    --r-container: 10px;
    --r-full: 999px;

    /* Elevação: três níveis (ver nota 2 acima). */
    --e1: 0 1px 2px rgba(0,0,0,.35);
    --e2: 0 12px 32px -8px rgba(0,0,0,.55);

    /* Sora + Manrope, adotadas de JefersonCruz/sora-manrope-vibe (2026-10-12).
       Sora tem formas geometricas com terminais retos - le bem em numero
       grande, que e o caso do saldo. Manrope e humanista e aguenta texto
       corrido denso, que e o caso de tabela e rotulo. O stack de sistema
       continua como fallback: se a fonte nao carregar, nada quebra. */
    --font-display: "Sora", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --font-text: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--bg); color: var(--text); margin:0; min-height:100vh;
    font-family: var(--font-text); font-size:15px; line-height:1.55;
    -webkit-font-smoothing: antialiased;
  }

  /* --- Cabeçalho e navegação --- */
  header {
    padding: 14px 24px; border-bottom:1px solid var(--border);
    display:flex; align-items:center; justify-content:space-between; gap:16px;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(8px); position:sticky; top:0; z-index:10;
  }
  header .brand {
    display:flex; align-items:center; gap:10px; color:var(--text);
    font-family:var(--font-display); font-weight:700; font-size:1rem;
    letter-spacing:0.04em; text-decoration:none; flex:0 0 auto;
  }
  /* A nav tem 6 itens: em tela estreita ela rola sozinha em vez de empurrar a
     página e criar rolagem horizontal no documento inteiro. */
  nav { display:flex; align-items:center; gap:4px; overflow-x:auto; scrollbar-width:none; }
  nav::-webkit-scrollbar { display:none; }
  nav a {
    color:var(--text-muted); text-decoration:none; font-size:13.5px; font-weight:500;
    padding:7px 10px; border-radius:var(--r-control); white-space:nowrap;
    transition: color .12s ease, background-color .12s ease;
  }
  nav a:hover { color:var(--text); background:var(--surface-2); }
  nav a.on { color:var(--text); font-weight:600; background:var(--surface-2); box-shadow: inset 0 0 0 1px var(--border-strong); }

  /* Painel de monitoramento pede densidade e tabela larga, não coluna de blog. */
  main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 64px; }

  /* --- Escala tipográfica (máx. 4 tamanhos por tela) --- */
  h1 { font-family:var(--font-display); font-size:24px; font-weight:700; letter-spacing:-0.015em; margin:0 0 4px; }
  h2 { font-family:var(--font-display); font-size:18px; font-weight:600; letter-spacing:-0.01em; margin:0 0 8px; }
  .muted { color:var(--text-muted); font-size:14px; line-height:1.55; }
  .eyebrow {
    font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase;
    color:var(--text-muted); margin:0 0 8px;
  }

  /* --- Formulário --- */
  label { display:block; margin-top:16px; margin-bottom:6px; font-size:13px; color:var(--text); font-weight:500; }
  input, select {
    width:100%; background:var(--surface-2); border:1px solid var(--border-strong); color:var(--text);
    padding:10px 12px; border-radius:var(--r-control); font-size:14px; font-family:inherit;
    transition: border-color .12s ease, box-shadow .12s ease;
  }
  input:hover, select:hover { border-color:#56525F; }
  /* #9A96A6 e nao um cinza mais escuro: medido em 4.71:1 sobre --surface-2 e
     5.05:1 sobre --surface, passando AA. O valor anterior ficava em 3.03:1 -
     placeholder que o usuario precisa adivinhar nao e decisao de estilo. */
  input::placeholder { color:#9A96A6; }
  select { appearance:none; background-image:linear-gradient(45deg,transparent 50%,var(--text-muted) 50%),linear-gradient(135deg,var(--text-muted) 50%,transparent 50%); background-position:calc(100% - 17px) 50%, calc(100% - 12px) 50%; background-size:5px 5px,5px 5px; background-repeat:no-repeat; padding-right:34px; }
  form { margin-top:4px; }

  /* Foco visível em TUDO que é interativo - 2px no acento, nunca outline:none sozinho. */
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, [tabindex]:focus-visible {
    outline:2px solid var(--accent); outline-offset:2px; border-radius:var(--r-control);
  }
  input:focus, select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(211,182,255,.18); }

  /* --- Botões: fundo chapado, sem gradiente. Altura mínima de 40px pra toque. --- */
  button {
    margin-top:20px; background:var(--accent); color:var(--accent-ink); border:none;
    padding:10px 18px; min-height:40px; border-radius:var(--r-control);
    font-family:inherit; font-weight:600; font-size:14px; cursor:pointer;
    transition: filter .12s ease, transform .08s ease;
  }
  button:hover { filter:brightness(1.08); }
  button:active { transform:translateY(1px); }
  button:disabled { opacity:.5; cursor:not-allowed; filter:none; }
  button.secondary { background:var(--surface-2); color:var(--text); box-shadow:inset 0 0 0 1px var(--border-strong); }
  button.secondary:hover { background:#262230; filter:none; }
  button.danger { background:transparent; color:var(--critical); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--critical) 35%, transparent); }
  button.danger:hover { background:var(--critical-bg); filter:none; }

  /* --- Tabelas: densidade de log, cabeçalho em superfície secundária --- */
  .table-wrap { overflow-x:auto; margin:12px -4px 0; padding:0 4px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:0 12px; height:44px; border-bottom:1px solid var(--border); font-size:14px; }
  th {
    color:var(--text-muted); font-weight:600; font-size:12px; text-transform:uppercase;
    letter-spacing:0.05em; background:var(--surface-2); height:36px; white-space:nowrap;
  }
  th:first-child { border-top-left-radius:var(--r-control); }
  th:last-child { border-top-right-radius:var(--r-control); }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr { transition: background-color .12s ease; }
  tbody tr:hover { background:color-mix(in srgb, var(--surface-2) 60%, transparent); }
  /* Número e data sempre tabulares - ver nota no topo. */
  td.num, td.when, .tabular { font-variant-numeric: tabular-nums; }

  /* --- Contêineres: nível 0 de elevação, separação por borda --- */
  .card {
    background:var(--surface); border:1px solid var(--border); border-radius:var(--r-container);
    padding:20px; margin-top:16px;
  }
  .card > :first-child { margin-top:0; }
  .card.flush { padding:0; overflow:hidden; }
  .card.flush .table-wrap { margin:0; padding:0; }
  .card.flush th:first-child, .card.flush th:last-child { border-radius:0; }

  /* --- Estado e severidade: cor SEMPRE acompanhada de forma/texto (daltonismo) --- */
  .pill {
    display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border-radius:var(--r-full);
    font-size:12px; font-weight:600; letter-spacing:0.01em; white-space:nowrap;
  }
  .pill::before { content:""; width:6px; height:6px; border-radius:var(--r-full); background:currentColor; flex:0 0 auto; }
  .pill.critical { background:var(--critical-bg); color:var(--critical); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--critical) 25%, transparent); }
  .pill.normal { background:var(--surface-2); color:var(--text-muted); box-shadow:inset 0 0 0 1px var(--border-strong); }
  .pill.ok { background:var(--ok-bg); color:var(--ok); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--ok) 25%, transparent); }
  .pill.warn { background:var(--warning-bg); color:var(--warning); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--warning) 25%, transparent); }
  .badge {
    display:inline-block; padding:2px 8px; border-radius:var(--r-control); background:var(--surface-2);
    color:var(--text-muted); font-size:12px; font-weight:600; box-shadow:inset 0 0 0 1px var(--border);
  }

  .error {
    background:var(--critical-bg); border:1px solid color-mix(in srgb, var(--critical) 30%, transparent);
    border-left:3px solid var(--critical); color:var(--critical);
    padding:11px 14px; border-radius:var(--r-control); margin-top:16px; font-size:14px;
  }
  .notice {
    background:var(--ok-bg); border:1px solid color-mix(in srgb, var(--ok) 25%, transparent);
    border-left:3px solid var(--ok); color:var(--ok);
    padding:11px 14px; border-radius:var(--r-control); font-size:14px;
  }

  /* Estado vazio: nunca só "nada aqui" - diz o que vai acontecer e a próxima ação. */
  .empty { color:var(--text-muted); font-size:14px; line-height:1.6; }

  code, .mono {
    font-family:var(--font-mono); font-size:13px; font-variant-numeric:tabular-nums;
  }
  code {
    background:var(--surface-2); padding:2px 7px; border-radius:var(--r-control);
    border:1px solid var(--border); color:var(--text);
  }
  a.link { color:var(--accent); text-decoration:none; }
  a.link:hover { text-decoration:underline; text-underline-offset:2px; }

  .balance {
    font-family:var(--font-display); font-size:40px; font-weight:700; letter-spacing:-0.02em;
    color:var(--text); margin:0 0 2px; font-variant-numeric: tabular-nums;
  }

  /* Faixa de monitoramento: o produto é vigilância, então a prova de que está
     vigiando precisa ser a primeira coisa na tela. */
  .watchbar {
    display:flex; align-items:center; gap:10px; padding:10px 14px; margin-top:16px;
    background:var(--surface); border:1px solid var(--border); border-radius:var(--r-container);
    font-size:13.5px; color:var(--text-muted);
  }
  .watchbar .dot {
    width:8px; height:8px; border-radius:var(--r-full); background:var(--ok); flex:0 0 auto;
    box-shadow:0 0 0 3px var(--ok-bg); animation: pulse 2.4s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.45; } }

  .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .grid-2 { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; }

  /* Botão de copiar: o gesto real do usuário com um endereço é conferir e copiar. */
  .copy {
    background:none; border:none; margin:0; padding:4px; min-height:0; color:var(--text-muted);
    cursor:pointer; border-radius:var(--r-control); line-height:0; box-shadow:none;
  }
  .copy:hover { color:var(--accent); background:var(--surface-2); filter:none; }
  .copy[data-done="1"] { color:var(--ok); }

  @media (max-width: 700px) {
    header { flex-direction:column; align-items:stretch; gap:10px; padding:12px 16px; }
    nav { margin:0 -16px; padding:0 16px; }
    main { padding:24px 16px 48px; }
    .balance { font-size:32px; }
    h1 { font-size:21px; }
  }

  /* Respeita quem pediu menos movimento no sistema. */
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; }
  }`;

/**
 * Mesma fonte display da landing (ver LANDING_STYLE) - o painel usa a marca
 * inteira, não uma versão empobrecida dela. `display=swap` pra não bloquear
 * o render: se a fonte demorar, o texto aparece no stack de sistema primeiro.
 */
const DISPLAY_FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap">`;

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
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.png" type="image/png">
<meta name="theme-color" content="#131217">
${DISPLAY_FONT_LINK}
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
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.png" type="image/png">
<meta name="theme-color" content="#131217">
${DISPLAY_FONT_LINK}
<style>${BASE_STYLE}
  .auth-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .auth-box { width:100%; max-width:400px; }
  .auth-logo { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:24px; }
  .auth-logo span { font-family:var(--font-display); font-weight:700; font-size:1.15rem; letter-spacing:0.05em; color:var(--text); }
  /* Nível 2 de elevação: o cartão de login é a única coisa na tela e de fato
     flutua sobre o fundo - é o caso que justifica sombra (ver §5 do estudo). */
  .auth-card {
    background:var(--surface); border:1px solid var(--border); border-radius:var(--r-container);
    padding:28px 24px; box-shadow: var(--e2);
  }
  .auth-title { font-family:var(--font-display); font-size:18px; font-weight:600; margin:0 0 4px; }
  .auth-subtitle { color:var(--text-muted); font-size:14px; margin:0 0 20px; line-height:1.55; }
  .auth-footer { text-align:center; margin-top:18px; font-size:13.5px; color:var(--text-muted); }
  .install-hint { margin-top:22px; padding:14px 16px; border:1px solid var(--border, rgba(255,255,255,.12)); border-radius:10px; font-size:13px; line-height:1.55; color:var(--text-muted); }
  .install-hint strong { color:var(--text, #fff); font-weight:600; }
  .install-hint p { margin:0 0 8px; }
  .install-hint p:last-child { margin-bottom:0; }
  .install-hint .os { display:block; margin-top:6px; }
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
<meta name="theme-color" content="#131217">
<link rel="icon" href="${FAVICON}">
<!-- Sem este link o Chrome nao oferece "Instalar" nesta pagina. Faltava na
     landing E no login ate 2026-10-12, entao o PWA so era instalavel de
     dentro do painel - inutil pra quem acabou de chegar no site. -->
<link rel="manifest" href="/manifest.json">
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
/**
 * Estilo da landing — porte do design JefersonCruz/sora-manrope-vibe
 * (2026-10-12), que já era uma landing do VILIGION redesenhada.
 *
 * Mudanças de fundo em relação ao que havia antes, e o porquê de cada uma:
 *
 * - Seções separadas por BORDA, não por cartão. Quando tudo é cartão, nada
 *   tem hierarquia e a página vira um tabuleiro de retângulos.
 * - Passos com `border-top` em vez de caixa, numerados 01–04.
 * - Comparativo com a ÚLTIMA coluna destacada — a nossa.
 * - Tokens locais espelham os de BASE_STYLE: a mesma paleta nas duas
 *   superfícies, pra não recriar o problema de "dois produtos visualmente".
 */
const LANDING_STYLE = `
  :root {
    --bg:#131217; --card:#1B1921; --secondary:#2C2833; --border:#3A3740;
    --fg:#F3F2F5; --muted:#AEAAB7; --primary:#D3B6FF; --primary-ink:#1B1921;
    --destructive:#F78765;
    --hero-shade: linear-gradient(90deg, var(--bg) 0%, rgba(19,18,23,.95) 25%, rgba(19,18,23,.48) 51%, transparent 78%);
    --surface-shade: linear-gradient(0deg, var(--bg), transparent 65%);
  }
  * { box-sizing:border-box; border-color:var(--border); }
  html { scroll-behavior:smooth; scroll-padding-top:95px; }
  body {
    margin:0; background:var(--bg); color:var(--fg); font-size:14px;
    font-family:'Manrope', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3 { font-family:'Sora', sans-serif; letter-spacing:0; font-weight:500; }
  a { text-decoration:none; color:inherit; }
  img { max-width:100%; }
  .shell { width:min(1184px, calc(100% - 96px)); margin-inline:auto; }

  .site-header { height:90px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid var(--border); }
  .wordmark { display:flex; align-items:center; gap:10px; font-family:'Sora',sans-serif; font-size:20px; font-weight:600; }
  .wordmark img { width:26px; height:26px; border-radius:6px; display:block; }
  .desktop-nav { display:flex; align-items:center; gap:32px; }
  .nav-link { color:var(--muted); font-size:12px; transition:color .2s; }
  .nav-link:hover { color:var(--primary); }
  .header-actions { display:flex; align-items:center; gap:22px; }

  .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; border:none;
    font-family:inherit; font-weight:600; border-radius:8px; transition:filter .15s ease, background .15s ease, box-shadow .15s ease; }
  .btn-primary { background:var(--primary); color:var(--primary-ink); padding:12px 20px; font-size:13px; }
  .btn-primary:hover { filter:brightness(1.07); }
  .btn-outline { background:transparent; color:var(--fg); box-shadow:inset 0 0 0 1px var(--border); padding:12px 20px; font-size:13px; }
  .btn-outline:hover { box-shadow:inset 0 0 0 1px var(--primary); color:var(--primary); }
  .btn-sm { padding:9px 15px; font-size:12px; }
  a:focus-visible, button:focus-visible, input:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }

  .hero { position:relative; min-height:630px; isolation:isolate; display:flex; align-items:center; }
  .hero-image { position:absolute; right:-48px; top:0; width:83%; height:100%; object-fit:cover; object-position:center; z-index:-3; }
  .hero::before { content:""; position:absolute; inset:0 -48px; background:var(--hero-shade); z-index:-2; }
  .hero::after { content:""; position:absolute; inset:0 -48px; background:var(--surface-shade); z-index:-1; }
  .hero-copy { width:610px; max-width:100%; padding:60px 0 75px; }
  .eyebrow { display:flex; align-items:center; gap:9px; color:var(--primary); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; }
  .status-dot { width:6px; height:6px; border-radius:50%; background:var(--primary); box-shadow:0 0 0 4px rgba(211,182,255,.09); flex:none; }
  .hero h1 { font-size:58px; line-height:1.14; margin:25px 0 24px; }
  .hero-copy p { max-width:425px; font-size:14px; line-height:1.9; color:var(--muted); }
  .hero-buttons { display:flex; gap:14px; margin:30px 0 24px; flex-wrap:wrap; }
  .hero-note { display:flex; align-items:center; gap:8px; font-size:10px; color:var(--muted); }
  .image-caption { position:absolute; right:0; bottom:44px; color:var(--muted); font-size:9px; display:flex; gap:10px; align-items:center; }

  .trust-strip { border-block:1px solid var(--border); display:grid; grid-template-columns:repeat(4,1fr); padding:26px 0; gap:20px; }
  .trust-item { display:flex; align-items:center; justify-content:center; gap:10px; color:var(--muted); font-size:11px; text-align:center; }

  .section { padding-block:78px; border-bottom:1px solid var(--border); }
  .section-label { font-size:10px; letter-spacing:1.6px; text-transform:uppercase; color:var(--primary); font-weight:700; display:flex; align-items:center; gap:10px; }
  .section-label span { color:var(--muted); font-size:9px; }
  .section h2 { font-size:34px; line-height:1.3; margin:19px 0; }
  .section-intro { display:flex; justify-content:space-between; align-items:end; gap:30px; margin-bottom:34px; flex-wrap:wrap; }
  .section-intro p { color:var(--muted); line-height:1.8; font-size:12px; max-width:340px; }

  .problem-grid { display:grid; grid-template-columns:1.1fr 1fr; gap:95px; }
  .problem-copy { color:var(--muted); line-height:1.9; font-size:13px; }
  .problem-stat { border-left:1px solid var(--border); padding-left:45px; display:flex; flex-direction:column; justify-content:center; }
  .problem-stat strong { font-family:'Sora',sans-serif; font-size:62px; font-weight:500; color:var(--primary); line-height:1.1; }
  .problem-stat p { font-size:13px; line-height:1.8; max-width:320px; color:var(--muted); }
  .problem-stat small { font-size:10px; color:var(--muted); }

  .steps { display:grid; grid-template-columns:repeat(4,1fr); gap:30px; }
  .step { border-top:1px solid var(--border); padding-top:24px; }
  .step-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
  .step-top span { font-size:11px; color:var(--primary); font-family:'Sora',sans-serif; }
  .step h3 { font-size:15px; margin:0 0 8px; }
  .step p { color:var(--muted); font-size:12px; line-height:1.9; margin:0; }

  .product-preview { border:1px solid var(--border); border-radius:8px; overflow:hidden; display:grid; grid-template-columns:195px 1fr; background:var(--card); }
  .preview-sidebar { padding:26px 17px; border-right:1px solid var(--border); }
  .preview-sidebar .wordmark { font-size:13px; margin:0 6px 30px; }
  .preview-sidebar .wordmark img { width:18px; height:18px; }
  .preview-nav { width:100%; display:flex; align-items:center; gap:9px; justify-content:flex-start; margin-bottom:5px; font-size:11px;
    background:transparent; border:none; color:var(--muted); font-family:inherit; padding:9px 10px; border-radius:6px; cursor:pointer; text-align:left; }
  .preview-nav:hover { color:var(--fg); }
  .preview-nav[aria-selected="true"] { background:var(--secondary); color:var(--fg); }
  .preview-content { padding:30px; min-height:290px; }
  .preview-heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:28px; gap:14px; flex-wrap:wrap; }
  .preview-heading h3 { margin:0; font-size:17px; }
  .preview-badge { font-size:9px; color:var(--primary); display:flex; align-items:center; gap:7px; }
  .preview-table { width:100%; border-collapse:collapse; font-size:11px; }
  .preview-table th { text-align:left; color:var(--muted); font-weight:400; font-size:10px; padding:13px 10px; background:var(--secondary); }
  .preview-table td { padding:20px 10px; border-bottom:1px solid var(--border); }
  .preview-panel[hidden] { display:none; }
  .state { color:var(--primary); font-size:10px; display:inline-flex; align-items:center; gap:5px; }
  .state.critical { color:var(--destructive); }
  .preview-footnote { font-size:10px; color:var(--muted); margin-top:22px; display:flex; gap:6px; align-items:center; }

  .security-grid { display:grid; grid-template-columns:1fr 1fr; gap:85px; }
  .security-grid p { color:var(--muted); font-size:13px; line-height:1.9; }
  .security-feature { display:flex; gap:16px; border-bottom:1px solid var(--border); padding:23px 0; }
  .security-feature:first-child { padding-top:0; }
  .security-feature h3 { font-size:13px; margin:0 0 7px; }
  .security-feature p { font-size:11px; margin:0; }

  .comparison-wrap { overflow-x:auto; }
  .comparison { width:100%; border-collapse:collapse; font-size:12px; min-width:600px; }
  .comparison th { font-weight:500; text-align:left; padding:20px; color:var(--muted); font-size:11px; border-bottom:1px solid var(--border); }
  .comparison th:last-child { color:var(--primary); font-family:'Sora',sans-serif; font-size:16px; }
  .comparison td { padding:22px 20px; border-bottom:1px solid var(--border); line-height:1.7; color:var(--muted); }
  .comparison td:first-child { color:var(--fg); width:25%; }
  .comparison td:last-child, .comparison th:last-child { background:rgba(211,182,255,.05); width:38%; }
  .comparison td:last-child { color:var(--fg); }

  .install-grid { display:grid; grid-template-columns:1fr 1fr; gap:85px; }
  .install-item { border-bottom:1px solid var(--border); padding:20px 0; font-size:12px; color:var(--muted); line-height:1.8; }
  .install-item:first-child { padding-top:0; }
  .install-item strong { color:var(--fg); font-weight:600; }

  .waitlist { padding:75px 0; display:grid; grid-template-columns:1fr 420px; gap:60px; align-items:start; }
  .waitlist h2 { max-width:620px; margin:18px 0; font-size:34px; line-height:1.3; }
  .waitlist-copy p { font-size:12px; color:var(--muted); line-height:1.8; }
  .wl-form { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:26px; }
  .wl-form label { display:block; font-size:11px; color:var(--muted); margin:0 0 8px; }
  .wl-form input[type=email], .wl-form input[type=text] {
    width:100%; background:var(--bg); border:1px solid var(--border); color:var(--fg);
    padding:11px 13px; border-radius:6px; font-size:13px; font-family:inherit; }
  .wl-form input::placeholder { color:#7C7887; }
  .wl-form input:focus { outline:none; border-color:var(--primary); box-shadow:0 0 0 3px rgba(211,182,255,.16); }
  .wl-profiles { display:flex; flex-direction:column; gap:7px; margin:18px 0; }
  .wl-profiles input { position:absolute; opacity:0; pointer-events:none; }
  .wl-profiles label { display:block; margin:0; padding:10px 12px; border:1px solid var(--border); border-radius:6px;
    font-size:11.5px; color:var(--muted); cursor:pointer; transition:border-color .15s, color .15s, background .15s; }
  .wl-profiles label:hover { border-color:var(--primary); }
  .wl-profiles input:checked + label { border-color:var(--primary); color:var(--fg); background:rgba(211,182,255,.07); }
  .wl-profiles input:focus-visible + label { outline:2px solid var(--primary); outline-offset:2px; }
  .wl-form .btn { width:100%; margin-top:6px; }
  .wl-note { display:block; margin-top:14px; color:var(--muted); font-size:9px; text-align:center; }
  .wl-msg { padding:11px 14px; border-radius:6px; font-size:12px; margin-bottom:16px; line-height:1.5; }
  .wl-msg.ok { background:rgba(155,230,180,.1); border:1px solid rgba(155,230,180,.3); color:#9BE6B4; }
  .wl-msg.err { background:rgba(247,135,101,.1); border:1px solid rgba(247,135,101,.3); color:var(--destructive); }

  footer { border-top:1px solid var(--border); padding:45px 0 24px; }
  .footer-top { display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:36px; }
  .footer-top p { color:var(--muted); font-size:11px; line-height:1.8; max-width:245px; margin-top:16px; }
  .footer-column h3 { font-size:10px; font-weight:500; margin:0 0 19px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); }
  .footer-column a { display:block; font-size:11px; color:var(--muted); margin-bottom:12px; }
  .footer-column a:hover { color:var(--primary); }
  .footer-bottom { border-top:1px solid var(--border); margin-top:35px; padding-top:21px; display:flex; justify-content:space-between; gap:20px; color:var(--muted); font-size:9px; line-height:1.7; flex-wrap:wrap; }
  .contributors-row { display:flex; align-items:center; gap:8px; margin-top:16px; flex-wrap:wrap; }
  .contributors-row img { width:24px; height:24px; border-radius:50%; border:1px solid var(--border); }

  @media (max-width: 1000px) {
    .shell { width:calc(100% - 40px); }
    .problem-grid, .security-grid, .install-grid { grid-template-columns:1fr; gap:40px; }
    .problem-stat { border-left:none; border-top:1px solid var(--border); padding:30px 0 0; }
    .steps { grid-template-columns:repeat(2,1fr); }
    .waitlist { grid-template-columns:1fr; gap:36px; }
    .hero-image { width:100%; opacity:.28; right:0; }
    .hero h1 { font-size:40px; }
    .product-preview { grid-template-columns:1fr; }
    .preview-sidebar { border-right:none; border-bottom:1px solid var(--border); display:flex; flex-wrap:wrap; gap:6px; padding:14px; }
    .preview-sidebar .wordmark { display:none; }
    .preview-nav { width:auto; margin:0; }
    .trust-strip { grid-template-columns:repeat(2,1fr); gap:16px; }
    .footer-top { grid-template-columns:1fr 1fr; }
    .desktop-nav { display:none; }
  }
  @media (max-width: 560px) {
    .steps, .trust-strip, .footer-top { grid-template-columns:1fr; }
    .hero h1 { font-size:32px; }
    .section h2, .waitlist h2 { font-size:26px; }
    .section { padding-block:52px; }
    .preview-content, .wl-form { padding:18px; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition-duration:.001ms !important; animation-duration:.001ms !important; } }
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

/**
 * Landing — porte da estrutura de JefersonCruz/sora-manrope-vibe.
 *
 * O que foi preservado do que já existia, e NÃO pode regredir:
 * - o formulário real de lista de espera (POST /waitlist com email, profile,
 *   note). A referência só tinha um link âncora; aqui o formulário é o
 *   produto da página.
 * - os estados de sucesso (`?ok=1`) e erro, que a referência não tinha.
 * - shareMeta (OG, canonical, manifest), colaboradores do GitHub, e a seção
 *   de instalação do PWA.
 *
 * Toda afirmação aqui é checável no repositório. Em especial, o passo de
 * monitoramento NÃO diz "padrões de transferência" — detecção estatística é
 * roadmap, não existe (ver SECURITY.md).
 */
export function landingPage(params: { joined?: boolean; error?: string; baseUrl: string; contributors: Contributor[] }): string {
  const profiles = Object.entries(WAITLIST_PROFILES)
    .map(
      ([key, label]) =>
        `<input type="radio" id="wl-${key}" name="profile" value="${escapeHtml(key)}"${key === "treasury" ? " checked" : ""}>
        <label for="wl-${key}">${escapeHtml(label)}</label>`,
    )
    .join("\n        ");

  const steps = ([
    ["01", "Monitoramento contínuo", "RPC direto observa saldo e eventos de bloqueio por política de recebimento (TIP-403) em endereços TIP-20."],
    ["02", "Privacidade por desenho", "Endereço e contato ficam separados. A camada de privacidade decide o que pode sair."],
    ["03", "O alerta certo", "Evento crítico vira ligação com PIN e notificação no dispositivo, sem telefone. Evento normal, e-mail. Conteúdo sempre genérico."],
    ["04", "Acesso autenticado", "Saldo real e histórico completo só depois do login. Nunca no canal de alerta."],
  ] as Array<[string, string, string]>)
    .map(
      ([n, title, text]) =>
        `<article class="step"><div class="step-top"><span>${n}</span></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`,
    )
    .join("\n      ");

  const security = ([
    ["Contatos criptografados", "AES-256-GCM. Separados do endereço monitorado, nunca em texto puro ao lado dele."],
    ["Sua chave continua sua", "Sem custódia. Nunca guardamos sua chave privada e nunca executamos transação por voz ou SMS."],
    ["Posse verificada, sem mover fundos", "Assinatura EIP-191 no cadastro para comprovar a posse da carteira."],
  ] as Array<[string, string]>)
    .map(([t, d]) => `<article class="security-feature">${ICON_CHECK}<div><h3>${escapeHtml(t)}</h3><p>${escapeHtml(d)}</p></div></article>`)
    .join("\n        ");

  const comparison = ([
    ["Para quem", "Equipes de segurança institucional", "Empresas e equipes sem time de segurança"],
    ["Canal de alerta", "Dashboard, Slack e webhooks", "Ligação, notificação sem telefone e e-mail, por severidade"],
    ["Privacidade", "Não é o foco do produto", "Conteúdo genérico e contatos criptografados"],
    ["Complexidade", "Integração dedicada", "Cadastro direto, sem equipe dedicada"],
  ] as Array<[string, string, string]>)
    .map(([l, them, us]) => `<tr><td>${escapeHtml(l)}</td><td>${escapeHtml(them)}</td><td>${ICON_CHECK}${escapeHtml(us)}</td></tr>`)
    .join("\n          ");

  const tabs = ([
    ["contas", "Contas monitoradas", `<tr><td>Tempo (Moderato)</td><td>0x4f3a…c921</td><td><span class="state">${ICON_CHECK}Normal</span></td></tr>
            <tr><td>Tempo (Moderato)</td><td>0x91bd…77ea</td><td><span class="state critical">Crítico</span></td></tr>`, "Rede", "Endereço", "Status"],
    ["limiares", "Limiares", `<tr><td>Queda abrupta de saldo</td><td><span class="state critical">Crítico</span></td><td>Ligação + PIN · dispositivo</td></tr>
            <tr><td>Bloqueio por política de recebimento</td><td>Normal</td><td>E-mail</td></tr>`, "Evento monitorado", "Severidade", "Canal"],
    ["destinatarios", "Destinatários", `<tr><td>Contato de confiança</td><td>••••••••</td><td><span class="state">${ICON_LOCK}Criptografado</span></td></tr>
            <tr><td>Este dispositivo</td><td>sem número de telefone</td><td><span class="state">${ICON_LOCK}Endpoint opaco</span></td></tr>`, "Destinatário", "Dados de contato", "Proteção"],
    ["alertas", "Alertas", `<tr><td>Queda abrupta de saldo</td><td>Ligação + dispositivo</td><td><span class="state">Confirmado</span></td></tr>
            <tr><td>Transferência bloqueada pela policy</td><td>E-mail</td><td><span class="state">Enviado</span></td></tr>`, "Evento", "Canal", "Status"],
  ] as Array<[string, string, string, string, string, string]>);

  const tabButtons = tabs
    .map(([id, name]) => `<button type="button" class="preview-nav" role="tab" aria-selected="${id === "contas"}" aria-controls="panel-${id}" data-tab="${id}">${escapeHtml(name)}</button>`)
    .join("\n        ");

  const tabPanels = tabs
    .map(
      ([id, name, rows, c1, c2, c3]) => `<div class="preview-panel" id="panel-${id}" role="tabpanel"${id === "contas" ? "" : " hidden"}>
          <div class="preview-heading"><h3>${escapeHtml(name)}</h3><span class="preview-badge"><span class="status-dot"></span>Tempo · Testnet</span></div>
          <table class="preview-table"><thead><tr><th>${escapeHtml(c1)}</th><th>${escapeHtml(c2)}</th><th>${escapeHtml(c3)}</th></tr></thead>
          <tbody>${rows}</tbody></table>
        </div>`,
    )
    .join("\n        ");

  const message = params.joined
    ? `<div class="wl-msg ok">Inscrição registrada. Você recebe novidades no e-mail informado — sem spam, sem repasse a terceiros.</div>`
    : params.error
      ? `<div class="wl-msg err">${escapeHtml(params.error)}</div>`
      : "";

  const contributors = contributorsRow(params.contributors);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VILIGION — Segurança e alertas de tesouraria on-chain</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap">
${shareMeta(params.baseUrl)}
<style>${LANDING_STYLE}</style>
</head>
<body>
<div class="shell">

<header class="site-header">
  <a href="/" aria-label="VILIGION — início"><span class="wordmark">${logoMark(26)}VILIGION</span></a>
  <nav class="desktop-nav" aria-label="Principal">
    <a class="nav-link" href="#como-funciona">Como funciona</a>
    <a class="nav-link" href="#seguranca">Segurança</a>
    <a class="nav-link" href="#app">No celular</a>
    <a class="nav-link" href="#comparativo">Comparativo</a>
  </nav>
  <div class="header-actions">
    <a class="nav-link" href="/login">Entrar</a>
    <a class="btn btn-primary btn-sm" href="#lista">Lista de espera</a>
  </div>
</header>

<section class="hero">
  <img class="hero-image" src="/hero.jpg" alt="" aria-hidden="true" width="1264" height="848" fetchpriority="high">
  <div class="hero-copy">
    <div class="eyebrow"><span class="status-dot"></span>Segurança de tesouraria on-chain</div>
    <h1>VILIGION.<br>Sua tesouraria,<br>sob vigilância.</h1>
    <p>Quando algo foge do padrão, alguém de confiança recebe uma ligação. Sua segurança não precisa expor o que você protege.</p>
    <div class="hero-buttons">
      <a class="btn btn-primary" href="#lista">Entrar na lista de espera</a>
      <a class="btn btn-outline" href="#como-funciona">Como funciona</a>
    </div>
    <div class="hero-note">${ICON_LOCK}Sem custódia. Sem chaves privadas. Sem exposição.</div>
  </div>
  <div class="image-caption"><span class="status-dot"></span>Projetado para funcionar sob coação</div>
</section>

<div class="trust-strip">
  <div class="trust-item">Construído na Tempo</div>
  <a class="trust-item" href="https://github.com/JefersonCruz/VILIGION" target="_blank" rel="noopener">Código aberto · MIT</a>
  <div class="trust-item">Alertas via Twilio Voice</div>
  <div class="trust-item">Colosseum · Crypto World's Fair</div>
</div>

<section class="section problem-grid">
  <div>
    <div class="section-label"><span>01 /</span>O problema</div>
    <h2>O risco é real.<br>A proteção precisa ser também.</h2>
    <p class="problem-copy">Quem cuida da tesouraria de uma empresa ou equipe não pode olhar o saldo o dia todo. E conectar um telefone a um saldo on-chain pode criar um novo risco.</p>
    <p class="problem-copy">O VILIGION monitora o que importa e alerta quem você confia — sem revelar o que precisa continuar privado.</p>
  </div>
  <div class="problem-stat">
    <strong>US$ 30M+</strong>
    <p>em perdas ligadas a ataques físicos envolvendo cripto, só no primeiro semestre de 2026.</p>
    <small>Segundo a Chainalysis · dado citado pelo VILIGION</small>
  </div>
</section>

<section class="section" id="como-funciona">
  <div class="section-intro">
    <div><div class="section-label"><span>02 /</span>Como funciona</div><h2>Da blockchain à pessoa certa.</h2></div>
    <p>Quatro camadas. Um objetivo: transformar um evento crítico em um alerta, sem transformar seus dados em um risco.</p>
  </div>
  <div class="steps">
      ${steps}
  </div>
</section>

<section class="section">
  <div class="section-intro">
    <div><div class="section-label"><span>03 /</span>O produto</div><h2>Visibilidade para você.<br>Discrição para todo o resto.</h2></div>
    <p>Contas, limiares, destinatários e alertas em um só lugar. O que é sensível fica onde deve ficar.</p>
  </div>
  <div class="product-preview">
    <aside class="preview-sidebar" role="tablist" aria-label="Telas do painel">
      <span class="wordmark">${logoMark(18)}VILIGION</span>
        ${tabButtons}
    </aside>
    <div class="preview-content">
        ${tabPanels}
      <div class="preview-footnote">${ICON_LOCK}Demonstração ilustrativa · Dados sensíveis disponíveis apenas após o login.</div>
    </div>
  </div>
</section>

<section class="section security-grid" id="seguranca">
  <div>
    <div class="section-label"><span>04 /</span>Segurança</div>
    <h2>Mesmo sob pressão,<br>seus dados não falam.</h2>
    <p>O conteúdo dos alertas não revela saldo, endereço ou telefone. Essa regra é verificada por teste automatizado, não apenas por revisão manual.</p>
    <p>Recomendamos um número dedicado, separado do telefone pessoal. O VILIGION não provisiona esse número.</p>
    <p style="margin-top:14px;"><a class="nav-link" style="color:var(--primary);" href="https://github.com/JefersonCruz/VILIGION" target="_blank" rel="noopener">Confira o código. Não só a promessa. ↗</a></p>
  </div>
  <div class="security-list">
        ${security}
  </div>
</section>

<section class="section install-grid" id="app">
  <div>
    <div class="section-label"><span>05 /</span>No celular</div>
    <h2>Sem app store.<br>E sem número de telefone.</h2>
    <p style="color:var(--muted); font-size:13px; line-height:1.9;">O VILIGION instala direto do navegador. Instalado, o alerta crítico chega como notificação em tela cheia — e <strong style="color:var(--fg);">sem nenhum número envolvido</strong>. Não existe número para vincular à sua conta, nem registro de operadora: o destino é um endereço opaco que o seu navegador emite e você revoga quando quiser.</p>
    <p style="color:var(--muted); font-size:11.5px; line-height:1.8;">Duas limitações que preferimos dizer antes: a notificação toca o som padrão do sistema — a API dos navegadores não permite som próprio — e o modo Não Perturbe silencia. Uma ligação pode ser configurada para furar o Não Perturbe. Por isso os dois canais convivem.</p>
  </div>
  <div class="install-list">
    <div class="install-item"><strong>Android (Chrome)</strong><br>Menu ⋮ → "Instalar app". A notificação funciona mesmo sem instalar.</div>
    <div class="install-item"><strong>iPhone (Safari)</strong><br>Compartilhar → "Adicionar à Tela de Início". Obrigatório: o iOS só aceita notificação depois disso.</div>
    <div class="install-item"><strong>Computador</strong><br>Ícone de instalar na barra de endereço do Chrome ou Edge.</div>
  </div>
</section>

<section class="section" id="comparativo">
  <div class="section-intro">
    <div><div class="section-label"><span>06 /</span>Comparativo</div><h2>Proteção sem uma equipe de segurança.</h2></div>
    <p>Uma abordagem para quem cuida da tesouraria — não apenas para quem opera ferramentas institucionais.</p>
  </div>
  <div class="comparison-wrap">
    <table class="comparison">
      <thead><tr><th>O que importa</th><th>Ferramentas institucionais¹</th><th>VILIGION</th></tr></thead>
      <tbody>
          ${comparison}
      </tbody>
    </table>
  </div>
  <p class="preview-footnote">¹ Hexagate, Elliptic, TRM Labs e Blockaid — todas parceiras do ecossistema Tempo. O recorte do VILIGION é segmento e modelo de ameaça, não cobertura de rede. Comparativo apresentado pelo VILIGION.</p>
</section>

<section class="waitlist" id="lista">
  <div class="waitlist-copy">
    <div class="eyebrow"><span class="status-dot"></span>Em desenvolvimento · Testnet Moderato</div>
    <h2>Esteja um passo à frente.<br>Não uma ligação atrasado.</h2>
    <p>Entre na lista para testar primeiro.<br>Seu feedback define o que construímos a seguir.</p>
  </div>
  <div class="wl-form">
    ${message}
    <form method="POST" action="/waitlist">
      <label for="wl-email">Seu e-mail</label>
      <input type="email" id="wl-email" name="email" placeholder="voce@empresa.com" required>
      <div class="wl-profiles" role="radiogroup" aria-label="Qual é o seu caso">
        ${profiles}
      </div>
      <label for="wl-note">O que mais te preocupa na sua tesouraria? (opcional)</label>
      <input type="text" id="wl-note" name="note" maxlength="500" placeholder="Em uma frase">
      <button type="submit" class="btn btn-primary">Quero entrar na lista</button>
      <small class="wl-note">Sem spam. Sem repasse a terceiros.</small>
    </form>
  </div>
</section>

<footer>
  <div class="footer-top">
    <div class="footer-brand">
      <span class="wordmark">${logoMark(26)}VILIGION</span>
      <p>Alerta de tesouraria on-chain.<br>Construído para continuar funcionando sob coação.</p>
      ${contributors}
    </div>
    <div class="footer-column"><h3>Produto</h3>
      <a href="#como-funciona">Como funciona</a><a href="#seguranca">Segurança</a><a href="#app">No celular</a><a href="#comparativo">Comparativo</a>
    </div>
    <div class="footer-column"><h3>Projeto</h3>
      <a href="https://github.com/JefersonCruz/VILIGION" target="_blank" rel="noopener">GitHub ↗</a>
      <a href="https://github.com/JefersonCruz/VILIGION/blob/master/LICENSE" target="_blank" rel="noopener">Licença MIT</a>
      <a href="https://github.com/JefersonCruz/VILIGION/blob/master/TERMS-OF-USE.md" target="_blank" rel="noopener">Termos de uso</a>
    </div>
    <div class="footer-column"><h3>Canais oficiais</h3>
      <a href="https://x.com/viligion" target="_blank" rel="noopener">X · @viligion ↗</a>
      <a href="https://t.me/viligionOficial" target="_blank" rel="noopener">Telegram ↗</a>
      <a href="https://github.com/JefersonCruz/VILIGION/issues" target="_blank" rel="noopener">Suporte ↗</a>
      <a href="https://github.com/JefersonCruz/VILIGION/security/advisories/new" target="_blank" rel="noopener">Relatar vulnerabilidade ↗</a>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2026 VILIGION · Crypto World's Fair / Colosseum</span>
    <span>Nunca pedimos seed, saldo ou código 2FA. Nunca iniciamos conversa por mensagem privada.</span>
  </div>
</footer>

</div>
<script>
(function () {
  var tabs = document.querySelectorAll(".preview-nav");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () {
      var id = this.getAttribute("data-tab");
      var all = document.querySelectorAll(".preview-nav");
      for (var j = 0; j < all.length; j++) all[j].setAttribute("aria-selected", String(all[j] === this));
      var panels = document.querySelectorAll(".preview-panel");
      for (var k = 0; k < panels.length; k++) panels[k].hidden = panels[k].id !== "panel-" + id;
    });
  }
})();
</script>
</body>
</html>`;
}

/**
 * Aviso de instalacao do PWA na tela de login.
 *
 * Fica aqui, e nao so na landing, por um motivo de produto: o canal critico
 * sem telefone (Web Push) so funciona num aparelho onde o app foi instalado -
 * e no iOS a instalacao e OBRIGATORIA pra notificacao funcionar (ver
 * alerts/web-push.ts e SECURITY.md). Quem chega direto no /login, por link
 * salvo ou por um alerta antigo, nunca passa pela landing e nao descobre isso.
 *
 * Os dois caminhos sao mostrados juntos, sem detectar o sistema por
 * user-agent: a deteccao erra (iPad se anuncia como Mac ha anos), e errar aqui
 * manda o usuario procurar um menu que nao existe no aparelho dele. Duas
 * linhas de texto custam menos que isso.
 *
 * Sem script: o layout de autenticacao usa CSP com nonce, e um aviso
 * estatico nao justifica abrir superficie de script numa tela de login.
 */
const INSTALL_HINT = `
    <div class="install-hint">
      <p><strong>Instale no celular</strong> para receber o alerta crítico como notificação — sem número de telefone envolvido.</p>
      <p>
        <span class="os"><strong>Android (Chrome):</strong> menu ⋮ → “Instalar app”.</span>
        <span class="os"><strong>iPhone (Safari):</strong> Compartilhar → “Adicionar à Tela de Início”. Obrigatório: o iOS só aceita notificação depois disso.</span>
      </p>
    </div>`;

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
    <p class="auth-footer">Ainda não tem conta? <a class="link" href="/signup">Cadastre-se</a></p>
    ${INSTALL_HINT}`;
  return authLayout({ title: "Entrar", subtitle: "Acesse o painel de monitoramento da sua tesouraria.", body, error: params.error });
}

/** Monitor do usuário como medido pelo processo - ver MonitorHealthPort em server.ts. */
export interface MonitorHealthView {
  accountId: string;
  chainKey: string;
  running: boolean;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastCheckedBlock: string | null;
}

/**
 * Faixa de monitoramento com estado MEDIDO, não decorativo.
 *
 * O produto é vigilância, então a prova de que está vigiando é a informação
 * mais importante da tela - e "running: true" não distingue monitor saudável
 * de monitor travado no meio de um ciclo. Por isso o critério é o horário do
 * último ciclo COMPLETO (Monitor.lastSuccessAt).
 *
 * `monitors === null` significa que o processo não expõe essa medição (modo
 * demo): nesse caso a faixa mostra só a contagem de contas, em vez de afirmar
 * um estado que ninguém mediu.
 */
function watchbar(accountsCount: number, monitors: MonitorHealthView[] | null): string {
  if (monitors === null) {
    return `<div class="watchbar">
  <span class="dot" style="background:var(--text-muted); box-shadow:none; animation:none;" aria-hidden="true"></span>
  <span>${accountsCount} conta(s) monitorada(s) — <a class="link" href="/accounts">ver redes e endereços</a></span>
</div>`;
  }

  if (monitors.length === 0) {
    return `<div class="watchbar" style="border-color:color-mix(in srgb, var(--warning) 35%, transparent);">
  <span class="dot" style="background:var(--warning); box-shadow:0 0 0 3px var(--warning-bg); animation:none;" aria-hidden="true"></span>
  <span><strong style="color:var(--text); font-weight:600;">Nada está sendo vigiado.</strong> Nenhuma conta monitorada — <a class="link" href="/accounts">adicione a primeira</a>.</span>
</div>`;
  }

  const degraded = monitors.filter((m) => m.consecutiveFailures > 0);
  const stopped = monitors.filter((m) => !m.running);
  // O ciclo mais ANTIGO entre os monitores, não o mais recente: se uma conta
  // está parada há 10 minutos, dizer "há 3s" porque outra acabou de rodar
  // esconderia exatamente o problema que esta faixa existe pra mostrar.
  const oldest = monitors
    .map((m) => m.lastSuccessAt)
    .filter((v): v is string => typeof v === "string")
    .sort()[0];

  if (stopped.length === monitors.length) {
    return `<div class="watchbar" style="border-color:color-mix(in srgb, var(--critical) 40%, transparent);">
  <span class="dot" style="background:var(--critical); box-shadow:0 0 0 3px var(--critical-bg); animation:none;" aria-hidden="true"></span>
  <span><strong style="color:var(--text); font-weight:600;">Monitoramento parado.</strong> ${monitors.length} conta(s) cadastrada(s), nenhuma sendo verificada agora.</span>
</div>`;
  }

  const relative = oldest
    ? `último ciclo <time class="ago" datetime="${escapeHtml(oldest)}">agora</time>`
    : "primeiro ciclo ainda rodando";

  if (degraded.length > 0) {
    const worst = Math.max(...degraded.map((m) => m.consecutiveFailures));
    return `<div class="watchbar" style="border-color:color-mix(in srgb, var(--warning) 35%, transparent);">
  <span class="dot" style="background:var(--warning); box-shadow:0 0 0 3px var(--warning-bg);" aria-hidden="true"></span>
  <span><strong style="color:var(--text); font-weight:600;">Monitoramento degradado</strong> — ${worst} falha(s) consecutiva(s) de leitura em ${degraded.length} de ${monitors.length} conta(s). ${relative}. Alertas podem atrasar.</span>
</div>`;
  }

  return `<div class="watchbar">
  <span class="dot" aria-hidden="true"></span>
  <span><strong style="color:var(--text); font-weight:600;">Monitorando</strong> ${monitors.length} conta(s) — ${relative}.</span>
</div>`;
}

/**
 * Mantém o "há Xs" vivo no cliente. Renderizar o relativo no servidor
 * entregaria um número que fica velho no segundo seguinte - e numa tela cuja
 * função é provar que a vigilância está acordada, isso é pior que não mostrar.
 */
function agoScript(): string {
  return `<script>
(function () {
  function render() {
    var nodes = document.querySelectorAll("time.ago");
    for (var i = 0; i < nodes.length; i++) {
      var iso = nodes[i].getAttribute("datetime");
      var secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      var text;
      if (secs < 60) text = "há " + secs + "s";
      else if (secs < 3600) text = "há " + Math.floor(secs / 60) + "min";
      else if (secs < 86400) text = "há " + Math.floor(secs / 3600) + "h";
      else text = "há " + Math.floor(secs / 86400) + "d";
      nodes[i].textContent = text;
      nodes[i].setAttribute("title", new Date(iso).toLocaleString());
    }
  }
  render();
  setInterval(render, 1000);
})();
</script>`;
}

export function dashboardPage(params: {
  address: string;
  balanceRaw: string;
  accountsCount: number;
  recentAlerts: Array<{ kind: string; createdAt: string }>;
  monitors?: MonitorHealthView[] | null;
}): string {
  const alertsRows =
    params.recentAlerts.length === 0
      ? `<tr><td colspan="2" class="empty" style="padding:16px 12px; height:auto;">Nenhum alerta desde que o monitoramento começou. Ajuste em <a class="link" href="/thresholds">quando avisar</a> se quiser ser avisado mais cedo.</td></tr>`
      : params.recentAlerts
          .map(
            (a) => `<tr>
        <td><span title="${escapeHtml(a.kind)}">${escapeHtml(labelFor(ALERT_KIND_LABELS, a.kind))}</span></td>
        <td class="when muted">${escapeHtml(a.createdAt)}</td>
      </tr>`,
          )
          .join("");

  // O saldo vinha pra tela como unidade bruta do token dentro de <code> - o
  // número mais importante do produto aparecia como "42180320000". A função de
  // formatação já existia e não era usada aqui (ver docs/UI-DESIGN-STUDY.md §0).
  // O valor bruto continua acessível no title, pra quem precisa conferir.
  const balanceUnits = safeBigInt(params.balanceRaw);
  const balanceLabel = balanceUnits === null ? "—" : `US$ ${formatUsdDisplay(balanceUnits)}`;

  const body = `
${watchbar(params.accountsCount, params.monitors ?? null)}
<div class="grid-2">
  <div class="card">
    <p class="eyebrow">Saldo monitorado</p>
    <p class="balance" title="${escapeHtml(params.balanceRaw)} (menor unidade do token)">${escapeHtml(balanceLabel)}</p>
    <p class="muted" style="margin:0;">PathUSD · Tempo</p>
  </div>
  <div class="card">
    <p class="eyebrow">Endereço principal</p>
    <p style="margin:0 0 14px;">${addressWithCopy(params.address)}</p>
    <p class="muted" style="margin:0;">${params.accountsCount} conta(s) monitorada(s) — <a class="link" href="/accounts">gerenciar</a></p>
  </div>
</div>
<div class="card flush">
  <div style="padding:16px 20px 0;"><h2>Últimos alertas</h2></div>
  <div class="table-wrap">
    <table><thead><tr><th>Tipo</th><th>Quando</th></tr></thead><tbody>${alertsRows}</tbody></table>
  </div>
</div>${copyScript()}${agoScript()}`;
  return layout({ title: "Painel", body, authed: true, active: "/dashboard" });
}

export function accountsPage(params: {
  accounts: Array<{ id: string; chainKey: string; tokenAddress: string; watchedAddress: string }>;
  knownChainKeys: string[];
  error?: string;
}): string {
  const rows =
    params.accounts.length === 0
      ? `<tr><td colspan="4" class="empty" style="padding:16px 12px; height:auto;">Nenhuma conta monitorada ainda — <strong>nada está sendo vigiado</strong>. Adicione a primeira no formulário abaixo.</td></tr>`
      : params.accounts
          .map((a) => {
            // Nome vem do registro real (known-chains.ts). NÃO há badge de
            // "testnet" aqui de propósito: o registro só tem mainnets, e a rede
            // efetiva depende de TEMPO_RPC_URL, que esta view não recebe -
            // inventar o rótulo seria afirmar na tela algo que o código não sabe.
            const chainName = KNOWN_CHAINS[a.chainKey]?.name;
            const chainBadge = `<span class="badge" title="${escapeHtml(a.chainKey)}">${escapeHtml(chainName ?? a.chainKey)}</span>`;
            return `<tr>
        <td>${chainBadge}</td>
        <td>${addressWithCopy(a.tokenAddress)}</td>
        <td>${addressWithCopy(a.watchedAddress)}</td>
        <td style="text-align:right;"><form method="POST" action="/accounts/${escapeHtml(a.id)}/delete" style="margin:0">
          <button type="submit" class="danger" style="margin-top:0; min-height:32px; padding:4px 10px; font-size:13px;">Remover</button>
        </form></td>
      </tr>`;
          })
          .join("");

  const chainOptions = params.knownChainKeys
    .map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(KNOWN_CHAINS[k]?.name ?? k)}</option>`)
    .join("");

  const body = `
<div class="card flush">
  <div class="table-wrap">
    <table><thead><tr><th>Rede</th><th>Token</th><th>Endereço monitorado</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
</div>
<div class="card">
  <h2>Adicionar conta</h2>
  <p class="muted" style="margin:0 0 4px;">São dois endereços diferentes, e confundi-los é o erro mais comum aqui.</p>
  <form method="POST" action="/accounts">
    <label for="chainKey">Rede</label>
    <select id="chainKey" name="chainKey">${chainOptions}</select>

    <label for="tokenAddress">Endereço do token (ERC-20/TIP-20)</label>
    <input type="text" id="tokenAddress" name="tokenAddress" placeholder="0x..." required aria-describedby="tokenHelp">
    <p class="muted" id="tokenHelp" style="margin:6px 0 0; font-size:13px;">O contrato da stablecoin que você guarda (ex: PathUSD na Tempo). É igual para todos que usam esse token — <strong>não é a sua carteira</strong>.</p>

    <label for="watchedAddress">Endereço/carteira a monitorar</label>
    <input type="text" id="watchedAddress" name="watchedAddress" placeholder="0x..." required aria-describedby="watchedHelp">
    <p class="muted" id="watchedHelp" style="margin:6px 0 0; font-size:13px;">A sua tesouraria — o endereço cujo saldo desse token será vigiado. Normalmente é o mesmo que você assinou no cadastro.</p>

    <button type="submit">Adicionar</button>
  </form>
</div>${copyScript()}`;
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
            <div class="lg" id="lg0" style="--hc:color-mix(in srgb, var(--ok) 40%, transparent);--hb:var(--ok-bg)"><span class="dot" style="background:var(--ok)"></span><b>Sem alerta</b><span class="amt" id="t0"></span></div>
            <div class="lg" id="lg1" style="--hc:color-mix(in srgb, var(--warning) 40%, transparent);--hb:var(--warning-bg)"><span class="dot" style="background:var(--warn)"></span><b>E-mail</b><span class="amt" id="t1"></span></div>
            <div class="lg" id="lg2" style="--hc:color-mix(in srgb, var(--critical) 40%, transparent);--hb:var(--critical-bg)"><span class="dot" style="background:var(--crit)"></span><b>Canal crítico</b><span class="amt" id="t2"></span></div>
          </div>

          <div class="sim">
            <div class="top"><label for="sim">Simular uma saída de</label><strong id="simTxt"></strong></div>
            <input type="range" id="sim" min="0" max="100" step="1">
            <div class="result" id="result"></div>
          </div>

          <div class="note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="flex:none;margin-top:2px;color:var(--accent)" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
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

/**
 * Canal + a severidade que ele atende. Separados de propósito: o canal é um
 * rótulo neutro (badge), e a severidade é a informação colorida. Antes
 * telefone e dispositivo usavam a pill "critical" - vermelho de severidade
 * aplicado ao nome de um canal, que confunde "canal de alerta crítico" com
 * "algo está errado aqui".
 */
const RECIPIENT_LABELS: Record<string, { text: string; serves: string }> = {
  phone: { text: "Telefone", serves: "Alerta crítico — ligação + WhatsApp" },
  push: { text: "Dispositivo", serves: "Alerta crítico — notificação, sem telefone" },
  email: { text: "E-mail", serves: "Alerta normal" },
};

export function recipientsPage(params: {
  recipients: Array<{ id: string; kind: string; value: string }>;
  error?: string;
  notice?: string;
  canTest?: boolean;
  canPush?: boolean;
}): string {
  const rows =
    params.recipients.length === 0
      ? `<tr><td colspan="3" class="muted">Nenhum destinatário cadastrado — hoje nenhum alerta sairia. Cadastre abaixo um dispositivo (sem telefone), um número ou um e-mail.</td></tr>`
      : params.recipients
          .map((r) => {
            const label = RECIPIENT_LABELS[r.kind] ?? { text: r.kind, serves: "" };
            return `<tr>
        <td>
          <span class="badge">${escapeHtml(label.text)}</span>
          ${label.serves ? `<div class="muted" style="font-size:12.5px; margin-top:3px;">${escapeHtml(label.serves)}</div>` : ""}
        </td>
        <td><code class="mono">${escapeHtml(r.value)}</code></td>
        <td style="text-align:right;"><form method="POST" action="/recipients/${escapeHtml(r.id)}/delete" style="margin:0">
          <button type="submit" class="danger" style="margin-top:0; min-height:32px; padding:4px 10px; font-size:13px;">Remover</button>
        </form></td>
      </tr>`;
          })
          .join("");

  const body = `
<div class="card">
  <p class="muted" style="margin-bottom:10px;">Alertas críticos (ex: queda forte de saldo) ligam pros números cadastrados aqui <strong>e também mandam o código de confirmação por WhatsApp</strong> pro mesmo número; alertas normais vão por e-mail — ver <a class="link" href="/thresholds">limiares</a> pra ajustar o que conta como crítico.</p>
  <p class="muted" style="margin:0 0 10px;">Pode cadastrar mais de um telefone e mais de um e-mail — todos recebem o alerta, não só o primeiro. Use um número com WhatsApp ativo, senão o código de confirmação não chega.</p>
  <p class="muted" style="margin:0;">Quer ver o que cada canal diz, sem disparar nada? <a class="link" href="/alerts/preview">Veja como o alerta funciona</a>.</p>
  <div class="table-wrap">
    <table><thead><tr><th>Canal</th><th>Destino</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
</div>${
    params.canPush
      ? `
<div class="card">
  <h2>Alerta crítico sem telefone <span class="badge" style="color:var(--accent); vertical-align:middle;">mais privado</span></h2>
  <p class="muted" style="margin-bottom:10px;">Registra <strong>este dispositivo</strong> para receber o alerta crítico como notificação em tela cheia, com som e vibração — <strong>sem número de telefone envolvido</strong>. Não existe número para vincular à sua conta, nem registro de operadora: o destino é um endereço opaco que o seu navegador emite e que você pode revogar aqui a qualquer momento.</p>
  <p class="muted" style="margin-bottom:10px;">Em troca, depende do navegador aceitar notificação e não é tão garantido quanto uma ligação — por isso os dois canais convivem. Dois pontos honestos: a notificação toca o <strong>som padrão do sistema</strong> (a API de notificação não permite som próprio), e o modo <strong>Não Perturbe silencia</strong>. Uma ligação pode ser configurada para furar o Não Perturbe.</p>
  <details style="margin-bottom:12px;">
    <summary class="muted" style="cursor:pointer; font-size:13.5px;">Como instalar o app no celular (opcional, melhora a entrega)</summary>
    <ul class="muted" style="margin:10px 0 0; padding-left:20px; line-height:1.7; font-size:13.5px;">
      <li><strong>Android (Chrome):</strong> menu ⋮ → "Instalar app" ou "Adicionar à tela inicial". Notificação funciona mesmo sem instalar.</li>
      <li><strong>iPhone (Safari):</strong> botão de compartilhar → "Adicionar à Tela de Início". <strong>Obrigatório</strong> — o iOS só aceita notificação depois disso.</li>
      <li><strong>Computador (Chrome/Edge):</strong> ícone de instalar na barra de endereço.</li>
    </ul>
  </details>
  <button type="button" id="pushEnable">Registrar este dispositivo</button>
  <p class="muted" id="pushMsg" style="margin:10px 0 0;"></p>
</div>`
      : ""
  }
<div class="card">
  <h2>Adicionar destinatário</h2>
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
  <h2>Testar o canal crítico</h2>
  <p class="muted" style="margin-bottom:10px;">Dispara agora um alerta crítico de teste: liga pros telefones cadastrados e manda o código de confirmação por WhatsApp. Confira em <a class="link" href="/alerts">histórico</a> se o código foi confirmado.</p>
  <form method="POST" action="/recipients/test"><button type="submit">Enviar alerta de teste</button></form>
</div>`
      : ""
  }${params.canPush ? pushEnrollScript() : ""}`;
  return layout({ title: "Destinatários de alerta", body: params.notice ? `<div class="notice" style="margin-top:16px;">${escapeHtml(params.notice)}</div>${body}` : body, authed: true, active: "/recipients", error: params.error });
}

/**
 * "Ver como funciona" — mostra o conteúdo EXATO de cada canal sem enviar nada.
 *
 * Por que existe, já havendo o botão de alerta de teste: o teste dispara um
 * alerta de verdade (ligação que custa dinheiro, toca o telefone de todos os
 * destinatários e entra no histórico). Isso serve pra PROVAR que funciona, não
 * pra ENTENDER o que vai acontecer. Quem acabou de cadastrar um destinatário
 * precisa do segundo antes do primeiro.
 *
 * O conteúdo aqui vem das mesmas funções que a entrega usa de verdade
 * (buildAlertMessage, buildPushPayload, buildAlertEmail) — nunca de texto
 * reescrito nesta tela. Se o conteúdo real mudar, esta tela muda com ele; um
 * preview que mente é pior que não ter preview.
 *
 * E o preview ensina o diferencial do produto melhor que qualquer parágrafo de
 * marketing: o usuário vê, com os próprios olhos, que nenhuma mensagem contém
 * saldo, valor ou endereço.
 */
export function alertPreviewPage(params: {
  voiceMessage: string;
  pushTitle: string;
  pushBody: string;
  emailSubject: string;
  emailText: string;
  hasPhone: boolean;
  hasPush: boolean;
  hasEmail: boolean;
  canTest?: boolean;
}): string {
  function channel(opts: { title: string; registered: boolean; severity: "critical" | "normal"; body: string; note: string }): string {
    return `
<div class="card">
  <div class="row" style="justify-content:space-between; align-items:flex-start;">
    <h2 style="margin:0;">${escapeHtml(opts.title)}</h2>
    <span class="pill ${opts.registered ? "ok" : "normal"}">${opts.registered ? "cadastrado" : "não cadastrado"}</span>
  </div>
  <p class="eyebrow" style="margin:14px 0 6px;">Severidade ${opts.severity === "critical" ? "crítica" : "normal"} · conteúdo entregue</p>
  <blockquote style="margin:0; padding:12px 14px; background:var(--surface-2); border-left:3px solid var(--accent); border-radius:var(--r-control); font-size:14px; line-height:1.6;">${opts.body}</blockquote>
  <p class="muted" style="margin:12px 0 0; font-size:13px;">${opts.note}</p>
</div>`;
  }

  const body = `
<p class="muted" style="margin:0 0 4px; max-width:70ch;">Isto é exatamente o que cada canal entrega — gerado pelas mesmas funções que o envio real usa, e <strong>sem disparar nada</strong>. Repare no que falta em todas as mensagens: nenhuma diz o saldo, o valor ou o endereço. Esse é o ponto.</p>

${channel({
  title: "Ligação telefônica",
  registered: params.hasPhone,
  severity: "critical",
  body: escapeHtml(params.voiceMessage),
  note: "Em seguida a ligação pede um código de 4 dígitos para confirmar que você recebeu o alerta. Digitar o código <strong>não</strong> move fundo nenhum — só confirma o recebimento.",
})}

${channel({
  title: "Notificação no dispositivo",
  registered: params.hasPush,
  severity: "critical",
  body: `<strong>${escapeHtml(params.pushTitle)}</strong><br>${escapeHtml(params.pushBody)}`,
  note: "Chega em tela cheia, com som e vibração, e <strong>sem nenhum número de telefone envolvido</strong> — não existe número para vincular à sua conta.",
})}

${channel({
  title: "E-mail",
  registered: params.hasEmail,
  severity: "normal",
  body: `<strong>${escapeHtml(params.emailSubject)}</strong><br>${escapeHtml(params.emailText).replace(/\n/g, "<br>")}`,
  note: "Severidade normal não liga nem notifica — o e-mail não tem custo por mensagem e não deixa registro em operadora.",
})}

<div class="card">
  <h2>Onde o detalhe real aparece</h2>
  <p class="muted" style="margin:0 0 4px;">Em nenhum desses canais. Saldo, endereço e histórico completo só no painel, depois do login — é por isso que um alerta interceptado não entrega informação a quem o leu.</p>
  <div class="row" style="margin-top:16px; gap:10px;">
    <a class="link" href="/recipients">Gerenciar destinatários</a>
    <span class="muted">·</span>
    <a class="link" href="/thresholds">Quando avisar</a>
  </div>
</div>${
    params.canTest
      ? `
<div class="card" style="border-color:color-mix(in srgb, var(--warning) 35%, transparent);">
  <h2>Disparar de verdade <span class="pill warn">custa uma ligação</span></h2>
  <p class="muted" style="margin:0 0 10px;">O teste real liga para todos os telefones cadastrados, notifica os dispositivos registrados e entra no histórico de alertas. Use quando quiser <strong>provar</strong> que o canal funciona — o preview acima já mostra o que ele diz.</p>
  <form method="POST" action="/recipients/test"><button type="submit" class="secondary">Enviar alerta de teste</button></form>
</div>`
      : ""
  }`;
  return layout({ title: "Como o alerta funciona", body, authed: true, active: "/alerts" });
}

export function alertsHistoryPage(params: {
  alerts: Array<{ alertId: string; kind: string; severity: string; deliveredVia: string; pinStatus: string | null; createdAt: string }>;
}): string {
  const rows =
    params.alerts.length === 0
      ? `<tr><td colspan="5" class="empty" style="padding:20px 12px; height:auto;">Nenhum alerta disparado ainda. Quando um limiar for atingido, o evento aparece aqui com o canal usado e se a confirmação chegou — defina os limiares em <a class="link" href="/thresholds">quando avisar</a>.</td></tr>`
      : params.alerts
          .map((a) => {
            const pin = a.pinStatus ? PIN_STATUS_LABELS[a.pinStatus] : null;
            // Sem desfecho registrado, o dono responde aqui. Isto existe porque
            // ate 2026-10-12 a unica forma de confirmar era digitar o PIN na
            // ligacao - quem usa so o canal de push nao tinha NENHUMA forma de
            // confirmar, e o historico ficava "—" pra sempre.
            const ackForm = `<form method="POST" action="/alerts/${encodeURIComponent(a.alertId)}/ack" style="margin:0; display:flex; gap:6px; flex-wrap:wrap;">
          <button type="submit" name="outcome" value="mine" class="secondary" style="margin-top:0; min-height:30px; padding:3px 10px; font-size:12.5px;">Fui eu</button>
          <button type="submit" name="outcome" value="not-mine" class="danger" style="margin-top:0; min-height:30px; padding:3px 10px; font-size:12.5px;">Não reconheço</button>
        </form>`;
            const pinCell = a.pinStatus
              ? `<span class="pill ${pin?.pill ?? "normal"}" title="${escapeHtml(a.pinStatus)}">${escapeHtml(pin?.text ?? a.pinStatus)}</span>`
              : ackForm;
            return `<tr>
        <td><span title="${escapeHtml(a.kind)}">${escapeHtml(labelFor(ALERT_KIND_LABELS, a.kind))}</span></td>
        <td><span class="pill ${a.severity === "critical" ? "critical" : "normal"}" title="${escapeHtml(a.severity)}">${escapeHtml(labelFor(SEVERITY_LABELS, a.severity))}</span></td>
        <td><span class="muted" title="${escapeHtml(a.deliveredVia)}">${escapeHtml(labelFor(CHANNEL_LABELS, a.deliveredVia))}</span></td>
        <td>${pinCell}</td>
        <td class="when muted">${escapeHtml(a.createdAt)}</td>
      </tr>`;
          })
          .join("");

  const body = `
<div class="card flush">
  <div class="table-wrap">
    <table><thead><tr><th>Tipo</th><th>Severidade</th><th>Canal</th><th>Confirmação</th><th>Quando</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>
</div>
<p class="muted" style="margin-top:12px;">A coluna <strong>Confirmação</strong> registra o desfecho de cada alerta. Digitar o código na ligação confirma que você <em>ouviu</em>; responder aqui registra o que você <em>concluiu</em> — e <strong>"Não reconheço"</strong> é o sinal mais importante que este produto coleta, porque é o que separa uma saída esperada de uma movimentação que você não autorizou. "Falha na entrega" significa que nenhum canal crítico conseguiu entregar. <a class="link" href="/alerts/preview">Veja o conteúdo de cada canal</a>.</p>`;
  return layout({ title: "Histórico de alertas", body, authed: true, active: "/alerts" });
}
