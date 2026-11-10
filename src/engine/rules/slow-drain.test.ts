import { describe, expect, it } from "vitest";
import { BalanceWindow } from "./balance-window.js";
import { DRAIN_HORIZON_MINUTES, SlowDrain } from "./slow-drain.js";
import type { DetectionEvent, UserThresholds } from "./detection-rules.js";

/** Perfil "Equilibrado" dos presets - o recomendado pra maioria das tesourarias. */
const thresholds: UserThresholds = {
  userId: "u1",
  maxBalanceDropPct: 10,
  criticalBalanceDropPct: 30,
  windowMinutes: 60,
  blockedTransferAlertThreshold: 1n,
  criticalBlockedTransferThreshold: 10n,
};

const min = (m: number) => new Date(m * 60_000);
const INICIAL = 1_000_000n;

/** Saldo de um dreno linear: perde `pctTotal` ao longo de `minutosTotais`. */
function saldoDoDreno(pctTotal: number, minutosTotais: number, minuto: number): bigint {
  const fracao = (pctTotal / 100) * Math.min(1, minuto / minutosTotais);
  return INICIAL - (INICIAL * BigInt(Math.round(fracao * 1e6))) / 1_000_000n;
}

/** Roda um dreno nas duas regras ao mesmo tempo, como o monitor faz, e devolve o que cada uma falou. */
function rodarDreno(pctTotal: number, horas: number, passoMin = 5, t = thresholds) {
  const janela = new BalanceWindow();
  const dreno = new SlowDrain();
  const daJanela: { minuto: number; evento: DetectionEvent }[] = [];
  const doDreno: { minuto: number; evento: DetectionEvent }[] = [];

  for (let m = 0; m <= horas * 60; m += passoMin) {
    const saldo = saldoDoDreno(pctTotal, horas * 60, m);
    const a = janela.evaluate(saldo, min(m), t);
    const b = dreno.evaluate(saldo, min(m), t);
    if (a) {
      daJanela.push({ minuto: m, evento: a });
      dreno.noteFastAlert(min(m)); // o monitor silencia o dreno depois de entregar
    } else if (b) {
      doDreno.push({ minuto: m, evento: b });
    }
  }
  return { daJanela, doDreno };
}

describe("SlowDrain", () => {
  it("o dreno de 40% em 24h, que a janela deslizante nunca vê, passa a ser alertado", () => {
    const { daJanela, doDreno } = rodarDreno(40, 24);

    // o defeito que esta regra existe pra corrigir: a janela fica muda
    expect(daJanela).toHaveLength(0);

    expect(doDreno.length).toBeGreaterThan(0);
    expect(doDreno[0]!.evento).toMatchObject({ kind: "slow-drain", severity: "normal" });
    // 10% de 1.000.000 se perdem em 6h num dreno de 40%/24h
    expect(doDreno[0]!.minuto).toBeLessThanOrEqual(6 * 60);
    expect(doDreno[0]!.minuto).toBeGreaterThan(thresholds.windowMinutes);
  });

  it("o alerta carrega quanto tempo o dreno já durava, o que distingue dele de uma queda súbita", () => {
    const { doDreno } = rodarDreno(40, 24);
    const e = doDreno[0]!.evento;
    expect(e.kind).toBe("slow-drain");
    if (e.kind !== "slow-drain") throw new Error("tipo errado");
    expect(e.overMinutes).toBeGreaterThan(thresholds.windowMinutes);
    expect(e.pctDropped).toBeGreaterThanOrEqual(thresholds.maxBalanceDropPct);
  });

  it("nunca sai por ligação telefônica, mesmo esvaziando a conta inteira", () => {
    const { doDreno } = rodarDreno(95, 24);
    expect(doDreno.length).toBeGreaterThan(0);
    expect(doDreno.every((a) => a.evento.severity === "normal")).toBe(true);
  });

  it("um esvaziamento de 24h fala poucas vezes, uma por escalada - não a cada ciclo", () => {
    // mesma amostragem de produção: 15s. Antes da correção da anti-repetição
    // na janela, este cenário gerava 1.857 alertas pela mesma perda.
    const { daJanela, doDreno } = rodarDreno(95, 24, 0.25);
    const total = daJanela.length + doDreno.length;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(12);
  });

  it("não fala sobre um pico recente: essa queda é da janela deslizante", () => {
    const d = new SlowDrain();
    d.evaluate(1000n, min(0), thresholds);
    // 30% em 30 minutos: passa da barra, mas o pico está dentro de windowMinutes
    expect(d.evaluate(700n, min(30), thresholds)).toBeNull();
  });

  it("conta que gira (recebe tanto quanto paga) não é dreno", () => {
    const d = new SlowDrain();
    let saldo = INICIAL;
    let ultimo: DetectionEvent | null = null;
    for (let m = 0; m <= 24 * 60; m += 5) {
      // paga 0,2% a cada passo e recebe de volta quase tudo a cada quatro passos
      saldo -= (INICIAL * 2n) / 1000n;
      if (m % 20 === 0) saldo += (INICIAL * 7n) / 1000n;
      const e = d.evaluate(saldo, min(m), thresholds);
      if (e) ultimo = e;
    }
    expect(saldo).toBeLessThan(INICIAL); // de fato terminou mais baixo
    expect(ultimo).toBeNull();
  });

  it("uma recarga pequena no meio da perda não desfaz o dreno", () => {
    const d = new SlowDrain();
    let visto: DetectionEvent | null = null;
    for (let m = 0; m <= 12 * 60; m += 5) {
      let saldo = saldoDoDreno(40, 12 * 60, m);
      if (m === 300) saldo += (INICIAL * 20n) / 1000n; // 2% de volta, uma vez
      const e = d.evaluate(saldo, min(m), thresholds);
      if (e && !visto) visto = e;
    }
    expect(visto).toMatchObject({ kind: "slow-drain" });
  });

  it("depois de a janela deslizante alertar, o dreno fica calado - o dono já foi avisado", () => {
    const d = new SlowDrain();
    d.evaluate(INICIAL, min(0), thresholds);
    d.noteFastAlert(min(5));
    for (let m = 10; m <= 12 * 60; m += 5) {
      expect(d.evaluate(saldoDoDreno(40, 12 * 60, m), min(m), thresholds)).toBeNull();
    }
  });

  it("passado o horizonte desde aquele aviso, o dreno volta a poder falar", () => {
    const d = new SlowDrain();
    d.noteFastAlert(min(0));
    let visto: DetectionEvent | null = null;
    const base = DRAIN_HORIZON_MINUTES + 5;
    for (let m = base; m <= base + 12 * 60; m += 5) {
      const e = d.evaluate(saldoDoDreno(40, 12 * 60, m - base), min(m), thresholds);
      if (e && !visto) visto = e;
    }
    expect(visto).toMatchObject({ kind: "slow-drain" });
  });

  it("forgetLastAlert permite tentar o mesmo dreno de novo se o despacho falhou", () => {
    const d = new SlowDrain();
    for (let m = 0; m <= 8 * 60; m += 5) d.evaluate(saldoDoDreno(40, 24 * 60, m), min(m), thresholds);
    const repetido = d.evaluate(saldoDoDreno(40, 24 * 60, 8 * 60 + 5), min(8 * 60 + 5), thresholds);
    expect(repetido).toBeNull(); // já falou, não repete
    d.forgetLastAlert();
    expect(d.evaluate(saldoDoDreno(40, 24 * 60, 8 * 60 + 10), min(8 * 60 + 10), thresholds)).not.toBeNull();
  });

  it("histórico vazio e saldo zero não alertam nem quebram", () => {
    const d = new SlowDrain();
    expect(d.evaluate(0n, min(0), thresholds)).toBeNull();
    expect(d.evaluate(0n, min(600), thresholds)).toBeNull();
  });

  it("o histórico é limitado por tempo, não pelo intervalo de polling", () => {
    // O monitor roda indefinidamente: guardar um ponto por ciclo de 15s seriam
    // 5.760 pontos por usuário em 24h. Este teste olha o estado interno de
    // propósito - o limite de memória é uma afirmação sobre o produto em
    // produção, e sem olhar aqui ela não é verificável por teste.
    const d = new SlowDrain();
    for (let s = 0; s <= 36 * 3600; s += 15) {
      d.evaluate(INICIAL, new Date(s * 1000), thresholds);
    }
    const baldes = (d as unknown as { buckets: unknown[] }).buckets;
    expect(baldes.length).toBeLessThanOrEqual(DRAIN_HORIZON_MINUTES / 5 + 1);
  });
});
