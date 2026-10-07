/**
 * CSS e JS cliente da tela de limiares (ver docs/THRESHOLDS.md, componente C6).
 * O JS é só conveniência (perfis, prévia, simulador); o formulário funciona
 * sem ele e o servidor revalida tudo no POST.
 *
 * Cuidado ao editar: o JS vive dentro de um template literal, então não use
 * crases nem a sequência de cifrão + chave dentro dele.
 */

export const THRESHOLDS_HEAD = `<style>
body main { max-width: 1180px; padding-top: 48px; }
body main > h1 { font-size: 2.1rem; letter-spacing: -.025em; margin-bottom: 10px; }
.th { --line:#1b2433; --line2:#273248; --muted:#9aa6b8; --cyan:#22d3ee; --ok:#34d399; --warn:#fbbf24; --crit:#f87171; --track:#1a2334; padding-bottom: 96px; }
.th button { margin: 0; }
.th .lead { color:var(--muted); font-size:1.02rem; line-height:1.6; margin:0 0 32px; max-width:640px; }
.th .sect { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); font-weight:700; margin:0 0 12px; }

.th .presets { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:36px; }
.th .preset { position:relative; display:flex; flex-direction:column; text-align:left; background:#0e1521; border:1px solid var(--line); border-radius:14px; padding:18px 18px 16px; cursor:pointer; color:inherit; font:inherit; box-shadow:none; transition:border-color .15s, background .15s, transform .15s; }
.th .preset:hover { border-color:#34435e; box-shadow:none; transform:translateY(-1px); }
.th .preset.on { border-color:var(--cyan); background:linear-gradient(180deg,#112135,#0e1a2a); box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.th .preset.on::after { content:"\\2713"; position:absolute; top:14px; right:14px; width:22px; height:22px; border-radius:50%; background:var(--cyan); color:#04222a; font-size:.8rem; font-weight:800; display:grid; place-items:center; }
.th .preset b { font-size:1.02rem; font-weight:700; margin-bottom:6px; }
.th .preset .d { color:var(--muted); font-size:.84rem; line-height:1.45; font-weight:400; flex:1; }
.th .preset .st { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:16px; padding-top:14px; border-top:1px solid var(--line); min-height:52px; }
.th .preset .st div { display:flex; flex-direction:column; gap:1px; }
.th .preset .st strong { font-size:1.35rem; letter-spacing:-.02em; font-weight:700; }
.th .preset .st small { font-size:.72rem; color:var(--muted); display:flex; align-items:center; gap:6px; }
.th .preset .st small i { width:7px; height:7px; border-radius:50%; }
.th .preset .st .free { grid-column:1 / -1; font-size:.84rem; color:var(--muted); align-self:center; }

.th .layout { display:grid; grid-template-columns:minmax(0,1fr) 420px; gap:24px; align-items:start; }
.th .col { display:grid; gap:24px; }
.th .card { margin:0; padding:28px; display:flex; flex-direction:column; gap:26px; border-radius:16px; }
.th .card .head h2 { font-size:1.15rem; margin:0 0 6px; display:flex; align-items:center; gap:12px; letter-spacing:-.01em; }
.th .card .head p { color:var(--muted); font-size:.9rem; margin:0; line-height:1.55; }
.th .ico { width:32px; height:32px; border-radius:9px; display:grid; place-items:center; background:#0c2228; color:var(--cyan); font-size:1rem; flex:none; }
.th .field { display:flex; flex-direction:column; gap:12px; }
.th .field > label { margin:0; font-size:.92rem; font-weight:600; color:#e8ecf2; display:flex; align-items:center; gap:9px; }
.th .dot { width:9px; height:9px; border-radius:50%; display:inline-block; flex:none; }
.th .ctl { display:grid; grid-template-columns:minmax(0,1fr) 108px; gap:20px; align-items:center; }
.th .num { position:relative; }
.th .num input { text-align:right; padding:10px 34px 10px 12px; font-size:1.2rem; font-weight:700; letter-spacing:-.01em; }
.th .num span { position:absolute; right:13px; top:50%; transform:translateY(-50%); color:var(--muted); font-size:.95rem; font-weight:600; pointer-events:none; }
.th .hint { color:var(--muted); font-size:.84rem; margin:0; line-height:1.55; }
.th .hint b { color:#d5dbe6; font-weight:600; }

.th input[type=range] { -webkit-appearance:none; appearance:none; width:100%; height:8px; padding:0; border:0; border-radius:999px; background:linear-gradient(90deg,var(--c,var(--cyan)) var(--p,0%),var(--track) var(--p,0%)); cursor:pointer; }
.th input[type=range]:focus { box-shadow:none; outline:none; }
.th input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 4px rgba(34,211,238,.3), 0 2px 8px rgba(0,0,0,.5); }
.th input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:22px; height:22px; border-radius:50%; background:#fff; border:5px solid var(--c,var(--cyan)); cursor:grab; box-shadow:0 2px 8px rgba(0,0,0,.55); }
.th input[type=range]::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#fff; border:5px solid var(--c,var(--cyan)); cursor:grab; box-shadow:0 2px 8px rgba(0,0,0,.55); }
.th input[type=range]::-moz-range-track { background:var(--track); height:8px; border-radius:999px; }
.th input[type=range]::-moz-range-progress { background:var(--c,var(--cyan)); height:8px; border-radius:999px; }

.th .seg { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; background:#0f1624; border:1px solid var(--line2); border-radius:11px; padding:4px; gap:3px; }
.th .seg button { background:transparent; border:0; color:var(--muted); font:inherit; font-size:.9rem; padding:9px 4px; border-radius:8px; cursor:pointer; font-weight:600; box-shadow:none; transition:background .15s, color .15s; }
.th .seg button:hover { box-shadow:none; color:#e2e8f0; }
.th .seg button.on { background:#17324a; color:#7ee9fb; box-shadow:inset 0 0 0 1px rgba(34,211,238,.35); }

.th .two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.th .two label { margin:0 0 8px; font-size:.92rem; font-weight:600; color:#e8ecf2; display:flex; align-items:center; gap:9px; }
.th .money { position:relative; }
.th .money b { position:absolute; left:14px; top:50%; transform:translateY(-50%); color:var(--muted); font-size:.9rem; font-weight:600; }
.th .money input { padding:12px 14px 12px 52px; font-size:1.1rem; font-weight:700; }
.th .alert-box { display:none; background:#2a1212; border:1px solid #5c1f1f; color:#fca5a5; padding:11px 14px; border-radius:9px; font-size:.86rem; line-height:1.5; }
.th .alert-box.show { display:block; }

.th .side { position:sticky; top:20px; }
.th .side .card { gap:22px; background:linear-gradient(180deg,#0f1827,#0d1420); }
.th .eyebrow { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); font-weight:700; display:flex; justify-content:space-between; align-items:center; }
.th .balwrap strong { display:block; font-size:2.3rem; letter-spacing:-.03em; line-height:1.1; }
.th .balwrap small { color:var(--muted); font-size:.82rem; }

.th .rule { margin:0 36px; }
.th .rtop, .th .rbot { position:relative; height:40px; }
.th .lab { position:absolute; transform:translateX(-50%); text-align:center; white-space:nowrap; line-height:1.25; transition:left .2s ease; }
.th .lab small { display:block; font-size:.68rem; text-transform:uppercase; letter-spacing:.08em; font-weight:700; color:var(--c); }
.th .lab b { font-size:.86rem; font-weight:700; }
.th .lab::after { content:""; position:absolute; left:50%; width:1px; height:7px; background:var(--c); }
.th .rtop .lab { bottom:0; padding-bottom:9px; }
.th .rtop .lab::after { bottom:0; }
.th .rbot .lab { top:0; padding-top:9px; }
.th .rbot .lab::after { top:0; }
.th .track { position:relative; }
.th .gauge { height:14px; border-radius:999px; overflow:hidden; display:flex; background:var(--track); }
.th .gauge .z { height:100%; transition:width .2s ease; }
.th .gauge .z1 { background:linear-gradient(90deg,#17604a,#22906a); }
.th .gauge .z2 { background:linear-gradient(90deg,#9a7414,#d4a017); }
.th .gauge .z3 { background:linear-gradient(90deg,#a53030,#d94a4a); }
.th .mk { position:absolute; top:-5px; bottom:-5px; width:4px; margin-left:-2px; border-radius:3px; background:#fff; box-shadow:0 0 0 2px #0d1420, 0 2px 8px rgba(0,0,0,.6); transition:left .1s linear; }

.th .legend { display:grid; gap:8px; }
.th .cap { color:var(--muted); font-size:.8rem; margin:0 0 2px; }
.th .cap b { color:#d5dbe6; font-weight:600; }
.th .lg { display:flex; gap:12px; align-items:center; padding:11px 14px; border-radius:11px; background:#0b121d; border:1px solid var(--line); transition:border-color .15s, background .15s; }
.th .lg b { font-size:.9rem; flex:1; font-weight:600; }
.th .lg span.amt { color:var(--muted); font-size:.84rem; font-variant-numeric:tabular-nums; }
.th .lg.hit { border-color:var(--hc); background:var(--hb); }
.th .lg.hit span.amt { color:#f1f5f9; font-weight:600; }

.th .sim { padding-top:22px; border-top:1px solid var(--line); display:flex; flex-direction:column; gap:14px; }
.th .sim .top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
.th .sim label { margin:0; font-size:.92rem; font-weight:600; color:#e8ecf2; }
.th .sim strong { font-size:1.05rem; font-variant-numeric:tabular-nums; }
.th .result { display:flex; align-items:center; gap:12px; padding:13px 15px; border-radius:11px; font-size:.9rem; border:1px solid; }
.th .result.r0 { color:#6ee7b7; background:#0b2a1f; border-color:#14503a; }
.th .result.r1 { color:#fcd34d; background:#2a2209; border-color:#5c4a10; }
.th .result.r2 { color:#fca5a5; background:#2a1212; border-color:#5c1f1f; }
.th .result svg { flex:none; }
.th .note { display:flex; gap:10px; color:var(--muted); font-size:.8rem; line-height:1.5; }

.th .bar { position:fixed; left:0; right:0; bottom:0; background:rgba(11,15,25,.94); backdrop-filter:blur(8px); border-top:1px solid var(--line); padding:14px 28px; display:flex; align-items:center; justify-content:center; gap:18px; z-index:5; }
.th .bar .msg { color:var(--muted); font-size:.9rem; display:flex; align-items:center; gap:9px; margin-right:auto; max-width:1180px; }
.th .bar .msg i { width:8px; height:8px; border-radius:50%; background:var(--warn); }
.th button.btn { padding:11px 24px; }
.th button.btn:disabled { opacity:.4; cursor:not-allowed; }
.th button.ghost { background:transparent; border:1px solid #2a3449; color:#cbd5e1; box-shadow:none; padding:10px 18px; }
.th button.ghost:hover { border-color:#3a4760; box-shadow:none; }
.th button.ghost:disabled { opacity:.4; cursor:not-allowed; }
@media (min-width:1240px) {
  .th .bar { padding-left:calc((100vw - 1180px) / 2 + 24px); padding-right:calc((100vw - 1180px) / 2 + 24px); }
}
@media (max-width:960px) {
  body main > h1 { font-size:1.7rem; }
  .th .layout { grid-template-columns:1fr; }
  .th .presets { grid-template-columns:1fr 1fr; }
  .th .side { position:static; }
  .th .card { padding:22px; }
}
@media (max-width:520px) {
  .th .presets { grid-template-columns:1fr; }
  .th .two { grid-template-columns:1fr; }
  .th .ctl { grid-template-columns:minmax(0,1fr) 96px; gap:14px; }
}
</style>`;

/** Recebe `cfg` já serializado em JSON seguro (ver thresholdsPage). */
export function thresholdsScript(cfgJson: string): string {
  return `<script>
(function () {
  var CFG = ${cfgJson};
  var PRESETS = CFG.presets;
  var BALANCE = CFG.balanceUsd === null ? 100000 : CFG.balanceUsd;
  var SAVED = JSON.parse(JSON.stringify(CFG.saved));
  var s = JSON.parse(JSON.stringify(CFG.current));
  var simPct = 22;
  var COLORS = ["var(--ok)", "var(--warn)", "var(--crit)"];
  var $ = function (id) { return document.getElementById(id); };

  var usd = function (n) { return "US$ " + Math.round(n).toLocaleString("pt-BR"); };
  var parseMoney = function (v) { var n = Number(String(v).trim().replace(",", ".")); return isFinite(n) ? n : NaN; };
  function winLabel(m) {
    if (m < 60) return m + " min";
    if (m === 60) return "1 hora";
    if (m % 60 === 0 && m < 1440) return (m / 60) + " horas";
    if (m === 1440) return "24 horas";
    return m + " min";
  }
  function winShort(m) {
    if (m < 60) return m + " min";
    if (m % 60 === 0) return (m / 60) + " h";
    return m + " min";
  }
  function windows() {
    var list = CFG.windows.slice();
    if (list.indexOf(s.win) === -1 && isFinite(s.win) && s.win > 0) list.push(s.win);
    return list.sort(function (a, b) { return a - b; });
  }
  function matchPreset() {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      if (p.warnPct === s.warn && p.critPct === s.crit && p.windowMinutes === s.win && p.blockedWarnUsd === s.bw && p.blockedCritUsd === s.bc) return p.key;
    }
    return "custom";
  }

  function buildPresets() {
    var cur = matchPreset();
    var html = PRESETS.map(function (p) {
      return '<button type="button" class="preset' + (cur === p.key ? " on" : "") + '" data-k="' + p.key + '"><b>' + p.name + '</b><span class="d">' + p.description + '</span>'
        + '<div class="st"><div><strong>' + p.warnPct + '%</strong><small><i style="background:var(--warn)"></i>e-mail</small></div>'
        + '<div><strong>' + p.critPct + '%</strong><small><i style="background:var(--crit)"></i>ligação</small></div></div></button>';
    }).join("");
    html += '<button type="button" class="preset' + (cur === "custom" ? " on" : "") + '" data-k="custom"><b>Personalizado</b><span class="d">Ajuste cada número do seu jeito.</span><div class="st"><span class="free">Os perfis são só atalhos.</span></div></button>';
    $("presets").innerHTML = html;
    Array.prototype.forEach.call($("presets").children, function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-k");
        for (var i = 0; i < PRESETS.length; i++) {
          if (PRESETS[i].key === k) { var p = PRESETS[i]; s.warn = p.warnPct; s.crit = p.critPct; s.win = p.windowMinutes; s.bw = p.blockedWarnUsd; s.bc = p.blockedCritUsd; }
        }
        render(true);
      };
    });
  }
  function buildWindows() {
    $("win").innerHTML = windows().map(function (m) { return '<button type="button" data-m="' + m + '" class="' + (s.win === m ? "on" : "") + '">' + winShort(m) + "</button>"; }).join("");
    Array.prototype.forEach.call($("win").children, function (b) { b.onclick = function () { s.win = Number(b.getAttribute("data-m")); render(true); }; });
  }

  function validate() {
    var e1 = "", e2 = "";
    if (!isFinite(s.warn) || !isFinite(s.crit)) e1 = "Informe os dois percentuais.";
    else if (s.warn < 0.1 || s.crit > 100) e1 = "Use valores entre 0,1% e 100%.";
    else if (s.warn >= s.crit) e1 = "O limite da ligação precisa ser maior que o do e-mail. Hoje: e-mail " + s.warn + "%, ligação " + s.crit + "%.";
    if (!isFinite(s.bw) || !isFinite(s.bc) || s.bw < 0) e2 = "Informe valores em dólar válidos (ex.: 2000 ou 2000,50).";
    else if (s.bw >= s.bc) e2 = "O valor que liga precisa ser maior que o valor que só manda e-mail.";
    return [e1, e2];
  }

  var ICONS = [
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5 9-10"/></svg>',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>'
  ];
  var TXT = ["Nenhum alerta seria enviado.", "Você receberia um <b>e-mail</b>.", "Você receberia uma <b>ligação</b> e o código por WhatsApp."];

  function sync(id, value, skipIfFocused) {
    var el = $(id);
    if (skipIfFocused && document.activeElement === el) return;
    el.value = isFinite(value) ? value : "";
  }
  function fill(id, color) {
    var el = $(id);
    var pct = (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min)) * 100;
    el.style.setProperty("--p", Math.max(0, Math.min(100, pct)) + "%");
    if (color) el.style.setProperty("--c", color);
  }

  function render(fromButtons) {
    buildPresets(); buildWindows();
    sync("pctWarn", s.warn); sync("pctCrit", s.crit);
    sync("pctWarnN", s.warn, true); sync("pctCritN", s.crit, true);
    sync("blkWarn", s.bw, true); sync("blkCrit", s.bc, true);
    $("windowMinutes").value = s.win;
    fill("pctWarn"); fill("pctCrit");
    var third = Math.round(s.warn / 3 * 10) / 10;
    $("winHint").innerHTML = "Somamos todas as saídas dentro de <b>" + winLabel(s.win) + "</b>. Ex.: três saídas de " + third + "% somam " + s.warn + "% e contam como <b>uma queda só</b>.";

    var errs = validate();
    $("err1").textContent = errs[0]; $("err1").classList.toggle("show", !!errs[0]);
    $("err2").textContent = errs[1]; $("err2").classList.toggle("show", !!errs[1]);
    var bad = !!(errs[0] || errs[1]);

    var warnPct = isFinite(s.warn) ? s.warn : 0, critPct = isFinite(s.crit) ? s.crit : 0;
    var w = BALANCE * warnPct / 100, c = BALANCE * critPct / 100;
    var p1 = Math.min(warnPct, 100), p2 = Math.max(Math.min(critPct, 100) - p1, 0), p3 = Math.max(100 - p1 - p2, 0);
    var z = $("gauge").children; z[0].style.width = p1 + "%"; z[1].style.width = p2 + "%"; z[2].style.width = p3 + "%";
    $("ruleTop").innerHTML = '<div class="lab" style="left:' + p1 + '%;--c:var(--warn)"><small>E-mail</small><b>' + usd(w) + "</b></div>";
    $("ruleBot").innerHTML = '<div class="lab" style="left:' + (p1 + p2) + '%;--c:var(--crit)"><small>Ligação</small><b>' + usd(c) + "</b></div>";
    $("cap").innerHTML = "Saídas somadas em <b>" + winLabel(s.win) + "</b>";
    $("t0").textContent = "abaixo de " + usd(w);
    $("t1").textContent = usd(w) + " a " + usd(c);
    $("t2").textContent = "a partir de " + usd(c);

    var out = BALANCE * simPct / 100, level = out >= c ? 2 : out >= w ? 1 : 0;
    $("sim").value = simPct; fill("sim", COLORS[level]);
    $("mk").style.left = simPct + "%";
    $("simTxt").textContent = usd(out) + " (" + simPct + "%)";
    ["lg0", "lg1", "lg2"].forEach(function (id, i) { $(id).classList.toggle("hit", i === level); });
    $("result").className = "result r" + level; $("result").innerHTML = ICONS[level] + "<span>" + TXT[level] + "</span>";

    var dirty = JSON.stringify(s) !== JSON.stringify(SAVED);
    $("save").disabled = !dirty || bad; $("reset").disabled = !dirty;
    $("barMsg").innerHTML = bad ? '<i style="background:var(--crit)"></i> Corrija os campos em vermelho para salvar' : dirty ? "<i></i> Alterações não salvas" : '<i style="background:var(--ok)"></i> ' + (CFG.justSaved ? "Salvo. Vale no próximo ciclo do monitor (até 15 s), sem reiniciar." : "Tudo salvo e em vigor. Mudanças valem em até 15 s, sem reiniciar.");
  }

  $("pctWarn").oninput = function () { s.warn = Number(this.value); render(); };
  $("pctCrit").oninput = function () { s.crit = Number(this.value); render(); };
  $("pctWarnN").oninput = function () { s.warn = this.value === "" ? NaN : Number(this.value); render(); };
  $("pctCritN").oninput = function () { s.crit = this.value === "" ? NaN : Number(this.value); render(); };
  $("blkWarn").oninput = function () { s.bw = parseMoney(this.value); render(); };
  $("blkCrit").oninput = function () { s.bc = parseMoney(this.value); render(); };
  $("blkWarn").onblur = $("blkCrit").onblur = $("pctWarnN").onblur = $("pctCritN").onblur = function () { render(); };
  $("sim").oninput = function () { simPct = Number(this.value); render(); };
  $("reset").onclick = function () { s = JSON.parse(JSON.stringify(SAVED)); CFG.justSaved = false; render(); };
  $("thForm").onsubmit = function () { return !$("save").disabled; };
  render();
})();
</script>`;
}
