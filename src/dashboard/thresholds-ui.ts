/**
 * CSS e JS cliente da tela de limiares (ver docs/THRESHOLDS.md, componente C6).
 * O JS é só conveniência (perfis, prévia, simulador); o formulário funciona
 * sem ele e o servidor revalida tudo no POST.
 *
 * Cuidado ao editar: o JS vive dentro de um template literal, então não use
 * crases nem a sequência de cifrão + chave dentro dele.
 */

export const THRESHOLDS_HEAD = `<style>
main { max-width: 1120px; }
.th { --line:#1b2433; --line2:#232d40; --muted:#8b95a7; --cyan:#22d3ee; --ok:#34d399; --warn:#fbbf24; --crit:#f87171; padding-bottom: 90px; }
.th button { margin: 0; }
.th .live { display:inline-flex; align-items:center; gap:8px; font-size:.78rem; color:var(--ok); background:#0b2a1f; border:1px solid #14503a; padding:4px 11px; border-radius:999px; font-weight:600; margin:10px 0 14px; }
.th .live i { width:7px; height:7px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 3px rgba(52,211,153,.2); }
.th .lead { color:var(--muted); font-size:.95rem; line-height:1.55; margin:0 0 24px; max-width:720px; }
.th .presets { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:22px; }
.th .preset { text-align:left; background:#0e1521; border:1px solid var(--line); border-radius:12px; padding:16px 16px 14px; cursor:pointer; color:inherit; font:inherit; box-shadow:none; }
.th .preset:hover { border-color:#2a3a52; box-shadow:none; }
.th .preset.on { border-color:var(--cyan); box-shadow:0 0 0 3px rgba(34,211,238,.12); background:#0f1a29; }
.th .preset b { display:block; font-size:.98rem; margin-bottom:4px; font-weight:700; }
.th .preset span { color:var(--muted); font-size:.8rem; line-height:1.4; display:block; font-weight:400; }
.th .preset em { font-style:normal; display:inline-block; margin-top:10px; font-size:.74rem; color:#67e8f9; background:#0c2228; border-radius:999px; padding:3px 9px; font-weight:600; }
.th .layout { display:grid; grid-template-columns:1fr 400px; gap:22px; align-items:start; }
.th .card { margin-top:0; margin-bottom:18px; }
.th .card h2 { font-size:1.02rem; margin:0 0 4px; display:flex; align-items:center; gap:10px; }
.th .card .sub { color:var(--muted); font-size:.84rem; margin:0 0 20px; line-height:1.5; }
.th .ico { width:28px; height:28px; border-radius:8px; display:grid; place-items:center; background:#0c2228; color:var(--cyan); font-size:.9rem; }
.th .field { margin-bottom:22px; }
.th .field:last-child { margin-bottom:0; }
.th .row { display:flex; align-items:baseline; justify-content:space-between; margin-bottom:10px; }
.th .row label { margin:0; font-size:.88rem; font-weight:600; color:#e5e7eb; display:flex; align-items:center; gap:8px; }
.th .dot { width:9px; height:9px; border-radius:50%; display:inline-block; flex:none; }
.th .val { display:flex; align-items:center; gap:6px; }
.th .val input { width:84px; text-align:right; padding:7px 10px; font-weight:600; }
.th .val span { color:var(--muted); font-size:.88rem; }
.th .hint { color:var(--muted); font-size:.8rem; margin:8px 0 0; line-height:1.45; }
.th .hint b { color:#cbd5e1; font-weight:600; }
.th input[type=range] { -webkit-appearance:none; appearance:none; width:100%; height:6px; padding:0; border:0; border-radius:999px; background:#1b2433; }
.th input[type=range]:focus { box-shadow:none; }
.th input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:#fff; border:4px solid var(--c,var(--cyan)); cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.5); }
.th input[type=range]::-moz-range-thumb { width:14px; height:14px; border-radius:50%; background:#fff; border:4px solid var(--c,var(--cyan)); cursor:pointer; }
.th .seg { display:inline-flex; background:#101726; border:1px solid var(--line2); border-radius:10px; padding:3px; gap:2px; flex-wrap:wrap; }
.th .seg button { background:transparent; border:0; color:var(--muted); font:inherit; font-size:.84rem; padding:7px 14px; border-radius:7px; cursor:pointer; font-weight:600; box-shadow:none; }
.th .seg button:hover { box-shadow:none; color:#cbd5e1; }
.th .seg button.on { background:#17324a; color:#67e8f9; }
.th .money { position:relative; }
.th .money b { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--muted); font-size:.9rem; font-weight:600; }
.th .money input { padding-left:54px; }
.th .two { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.th .two label { margin:0 0 6px; }
.th .alert-box { display:none; background:#2a1212; border:1px solid #5c1f1f; color:#fca5a5; padding:10px 14px; border-radius:8px; font-size:.84rem; margin-top:14px; }
.th .alert-box.show { display:block; }
.th .side { position:sticky; top:20px; }
.th .eyebrow { font-size:.72rem; text-transform:uppercase; letter-spacing:.09em; color:var(--muted); font-weight:700; margin-bottom:14px; display:flex; justify-content:space-between; }
.th .bal { display:flex; align-items:baseline; gap:8px; margin-bottom:4px; flex-wrap:wrap; }
.th .bal strong { font-size:1.9rem; letter-spacing:-.02em; }
.th .bal small { color:var(--muted); font-size:.8rem; }
.th .gauge { position:relative; height:16px; border-radius:999px; overflow:hidden; display:flex; margin:26px 0 10px; background:#1b2433; }
.th .gauge .z { height:100%; transition:width .2s ease; }
.th .gauge .z1 { background:linear-gradient(90deg,#14503a,#1c7a58); }
.th .gauge .z2 { background:linear-gradient(90deg,#8a6a12,#b8890f); }
.th .gauge .z3 { background:linear-gradient(90deg,#8f2a2a,#c23b3b); }
.th .ticks { display:flex; font-size:.72rem; color:var(--muted); margin-bottom:20px; }
.th .ticks div { transition:width .2s ease; white-space:nowrap; }
.th .ticks div:last-child { text-align:right; }
.th .legend { display:grid; gap:10px; }
.th .lg { display:flex; gap:12px; align-items:flex-start; padding:12px 14px; border-radius:10px; background:#0b121d; border:1px solid var(--line); transition:border-color .15s, background .15s; }
.th .lg.hit { border-color:var(--hc); background:var(--hb); }
.th .lg .dot { margin-top:5px; }
.th .lg b { font-size:.88rem; display:block; margin-bottom:2px; }
.th .lg span { color:var(--muted); font-size:.8rem; line-height:1.4; }
.th .lg .amt { color:#e5e7eb; font-weight:600; }
.th .sim { margin-top:20px; padding-top:20px; border-top:1px solid var(--line); }
.th .sim .row { margin-bottom:8px; }
.th .result { margin-top:14px; display:flex; align-items:center; gap:12px; padding:13px 15px; border-radius:10px; font-size:.88rem; border:1px solid; }
.th .result.r0 { color:#6ee7b7; background:#0b2a1f; border-color:#14503a; }
.th .result.r1 { color:#fcd34d; background:#2a2209; border-color:#5c4a10; }
.th .result.r2 { color:#fca5a5; background:#2a1212; border-color:#5c1f1f; }
.th .result svg { flex:none; }
.th .note { display:flex; gap:10px; color:var(--muted); font-size:.8rem; line-height:1.5; margin-top:16px; }
.th .bar { position:fixed; left:0; right:0; bottom:0; background:rgba(11,15,25,.94); backdrop-filter:blur(8px); border-top:1px solid var(--line); padding:14px 28px; display:flex; align-items:center; justify-content:center; gap:18px; z-index:5; }
.th .bar .msg { color:var(--muted); font-size:.88rem; display:flex; align-items:center; gap:9px; }
.th .bar .msg i { width:8px; height:8px; border-radius:50%; background:var(--warn); }
.th button.btn:disabled { opacity:.4; cursor:not-allowed; }
.th button.ghost { background:transparent; border:1px solid #2a3449; color:#cbd5e1; box-shadow:none; padding:10px 18px; }
.th button.ghost:disabled { opacity:.4; cursor:not-allowed; }
@media (max-width:960px) {
  .th .layout { grid-template-columns:1fr; }
  .th .presets { grid-template-columns:1fr 1fr; }
  .th .side { position:static; }
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
  function presetTag(p) { return p.warnPct + "% e-mail · " + p.critPct + "% ligação"; }

  function buildPresets() {
    var html = PRESETS.map(function (p) {
      return '<button type="button" class="preset' + (matchPreset() === p.key ? " on" : "") + '" data-k="' + p.key + '"><b>' + p.name + "</b><span>" + p.description + "</span><em>" + presetTag(p) + "</em></button>";
    }).join("");
    html += '<button type="button" class="preset' + (matchPreset() === "custom" ? " on" : "") + '" data-k="custom"><b>Personalizado</b><span>Ajuste cada número do seu jeito. Os perfis ao lado são só atalhos.</span><em>você define</em></button>';
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
    $("win").innerHTML = windows().map(function (m) { return '<button type="button" data-m="' + m + '" class="' + (s.win === m ? "on" : "") + '">' + winLabel(m) + "</button>"; }).join("");
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

  function render(fromButtons) {
    buildPresets(); buildWindows();
    sync("pctWarn", s.warn); sync("pctCrit", s.crit);
    sync("pctWarnN", s.warn, true); sync("pctCritN", s.crit, true);
    sync("blkWarn", s.bw, true); sync("blkCrit", s.bc, true);
    $("windowMinutes").value = s.win;
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
    $("ticks").innerHTML = '<div style="width:' + p1 + '%">US$ 0</div><div style="width:' + p2 + '%">' + usd(w) + '</div><div style="width:' + p3 + '%">' + usd(c) + "</div>";
    $("t0").innerHTML = "Saídas abaixo de <span class='amt'>" + usd(w) + "</span> em " + winLabel(s.win) + ".";
    $("t1").innerHTML = "Saídas de <span class='amt'>" + usd(w) + "</span> até <span class='amt'>" + usd(c) + "</span>.";
    $("t2").innerHTML = "Saídas a partir de <span class='amt'>" + usd(c) + "</span>. O telefone toca.";

    var out = BALANCE * simPct / 100, level = out >= c ? 2 : out >= w ? 1 : 0;
    $("sim").value = simPct; $("simTxt").textContent = usd(out) + " (" + simPct + "%)";
    ["lg0", "lg1", "lg2"].forEach(function (id, i) { $(id).classList.toggle("hit", i === level); });
    $("result").className = "result r" + level; $("result").innerHTML = ICONS[level] + "<span>" + TXT[level] + "</span>";

    var dirty = JSON.stringify(s) !== JSON.stringify(SAVED);
    $("save").disabled = !dirty || bad; $("reset").disabled = !dirty;
    $("barMsg").innerHTML = bad ? '<i style="background:var(--crit)"></i> Corrija os campos em vermelho para salvar' : dirty ? "<i></i> Alterações não salvas" : '<i style="background:var(--ok)"></i> ' + (CFG.justSaved ? "Salvo e em vigor no próximo ciclo (15 s)" : "Tudo salvo e em vigor");
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
