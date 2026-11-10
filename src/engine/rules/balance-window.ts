import {
  balanceDropEvent,
  dropPercent,
  type AlertSeverity,
  type DetectionEvent,
  type UserThresholds,
} from "./detection-rules.js";
import { MAX_WINDOW_MINUTES } from "./threshold-validation.js";

interface WindowPoint {
  atMs: number;
  /** saldo já somado de volta das taxas pagas desde o início da observação */
  balance: bigint;
}

/** Nível já comunicado ao dono. Sem o pico que o gerou - ver a nota na comparação, em `evaluate`. */
interface AlertedState {
  severity: AlertSeverity;
  pct: number;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { normal: 0, critical: 1 };

/**
 * Janela deslizante de saldo: compara o saldo atual com o MAIOR saldo dentro
 * de `windowMinutes`, então esvaziar a conta em parcelas pequenas soma a
 * queda em vez de passar despercebido (comparar só snapshots vizinhos, a cada
 * 15s, nunca alcançaria o percentual).
 *
 * Anti-repetição: depois de alertar sobre um pico, só alerta de novo se a
 * severidade escalar ou a queda crescer mais `maxBalanceDropPct` pontos; o
 * estado só é limpo quando o saldo volta bem abaixo do limiar (histerese de
 * metade dele), pra oscilação em torno do limite não gerar uma ligação a cada ciclo.
 */
export class BalanceWindow {
  private points: WindowPoint[] = [];
  private alerted: AlertedState | null = null;

  evaluate(balance: bigint, observedAt: Date, thresholds: UserThresholds): DetectionEvent | null {
    const nowMs = observedAt.getTime();
    this.points.push({ atMs: nowMs, balance });
    const storeFromMs = nowMs - MAX_WINDOW_MINUTES * 60_000;
    while (this.points.length > 1 && this.points[0]!.atMs < storeFromMs) this.points.shift();

    const windowFromMs = nowMs - thresholds.windowMinutes * 60_000;
    let peak: WindowPoint | null = null;
    for (const p of this.points) {
      if (p.atMs < windowFromMs) continue;
      if (!peak || p.balance >= peak.balance) peak = p;
    }
    if (!peak) return null;

    const pct = dropPercent(peak.balance, balance);
    if (pct < thresholds.maxBalanceDropPct / 2) this.alerted = null;

    const elapsedMinutes = (nowMs - peak.atMs) / 60_000;
    const event = balanceDropEvent(peak.balance, balance, elapsedMinutes, thresholds);
    if (!event || event.kind !== "balance-drop") return null;

    /*
     * A anti-repetição NÃO pode depender de qual ponto é o pico.
     *
     * Era isso que ela fazia (`last.peak === peak.balance && last.peakAtMs ===
     * peak.atMs`), e num dreno contínuo o pico escorrega pra fora da janela a
     * cada ciclo: o pico passa a ser outro ponto, a condição falha, e o
     * alerta é tratado como incidente novo. Medido, perfil Equilibrado,
     * amostragem de 15s: perder 40% em 2h gerava 242 alertas, e esvaziar 95%
     * em 24h gerava 1.857 - pela MESMA perda. Um alerta que chega 242 vezes é
     * um alerta que a pessoa desliga.
     *
     * Agora a comparação é com o nível já comunicado, independente de qual
     * pico o produziu. Quem libera o estado é a histerese acima: quando a
     * queda recua pra menos de metade do limiar, o incidente acabou.
     */
    const last = this.alerted;
    if (last) {
      const escalated = SEVERITY_RANK[event.severity] > SEVERITY_RANK[last.severity];
      const grew = event.pctDropped >= last.pct + thresholds.maxBalanceDropPct;
      if (!escalated && !grew) return null;
    }

    this.alerted = { severity: event.severity, pct: event.pctDropped };
    return event;
  }

  /** Chamar se o despacho do alerta falhou, para o mesmo evento poder ser tentado de novo no próximo ciclo. */
  forgetLastAlert(): void {
    this.alerted = null;
  }
}
