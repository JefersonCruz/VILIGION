/**
 * Dreno lento: a perda que a janela deslizante não consegue ver.
 *
 * POR QUE ESTA REGRA EXISTE (medido, não suposto). A `BalanceWindow` compara
 * o saldo atual com o MAIOR saldo dentro de `windowMinutes`. Isso pega bem o
 * saque rápido, mas tem uma propriedade perversa contra quem tira devagar: a
 * queda é medida em PERCENTUAL DO PICO DA JANELA, e o pico da janela
 * acompanha o saldo que vai minguando. Quanto mais já se perdeu, menor fica a
 * base - então a mesma saída por hora só vira "percentual alto" perto do fim,
 * quando o dinheiro já foi. Medido com amostragem de 15s e o perfil
 * Equilibrado (10% aviso / 30% ligação, janela de 60 min):
 *
 *   | cenário                       | alertas | primeiro alerta       |
 *   |-------------------------------|---------|-----------------------|
 *   | 40% em 24h                    |       0 | nunca                 |
 *   | 40% em 6h                     |       1 | em 6h - o dreno acabou|
 *   | 95% em 24h (esvazia a conta)  |    1857 | em 16h, com 64% ido   |
 *
 * Ou seja: contra um dreno lento o produto ficava calado, e no caso extremo
 * falava tarde e depois repetia à exaustão. Esta regra observa a outra ponta
 * do problema - a perda ACUMULADA num horizonte longo, independente de a
 * velocidade instantânea ser baixa.
 *
 * O QUE ELA NÃO RESOLVE, e precisa ser dito: distinguir um atacante que tira
 * devagar de uma empresa que simplesmente gastou é impossível olhando só o
 * saldo. O que esta regra usa como discriminador é o dinheiro NÃO VOLTAR -
 * uma tesouraria em operação recebe, uma que está sendo drenada só paga. Isso
 * reduz o falso positivo, não o elimina. E há um piso de sensibilidade: com
 * horizonte de 24h e a barra do usuário em 10%, um dreno mais lento que ~10%
 * por dia continua invisível. Isso é limite conhecido, não bug.
 *
 * QUAL BARRA ESTA REGRA USA: `maxBalanceDropPct`, a mesma que o dono
 * configurou pro aviso por e-mail - não a crítica. É coerência, não economia:
 * o dreno sai por e-mail (ver a nota de severidade em `evaluate`), e seria
 * incoerente exigir a barra da ligação pra mandar um e-mail. Na prática é
 * também o que torna a regra útil: com a barra crítica do perfil Equilibrado
 * (30%), um dreno de 40% em 24h só seria visto com 18h de atraso - quando
 * três quartos do prejuízo já aconteceram.
 */

import {
  dropPercent,
  type DetectionEvent,
  type UserThresholds,
} from "./detection-rules.js";
import { MAX_WINDOW_MINUTES } from "./threshold-validation.js";

/**
 * Horizonte de observação do dreno. Igual ao teto de retenção já praticado
 * pela janela deslizante (`MAX_WINDOW_MINUTES`), de propósito: é o período
 * mais longo que o produto hoje afirma observar, e esticá-lo além disso sem
 * medir o falso positivo correspondente seria aumentar a promessa sem base.
 */
export const DRAIN_HORIZON_MINUTES = MAX_WINDOW_MINUTES;

/**
 * Resolução guardada: um ponto a cada 5 minutos, em vez de um por ciclo.
 *
 * Com polling de 15s, 24h de histórico são 5.760 pontos POR USUÁRIO, e o
 * monitor roda indefinidamente - a `BalanceWindow` já carrega esse custo
 * porque precisa de resolução fina para a janela curta. O dreno não precisa:
 * um evento que leva horas não muda de conclusão por causa de 5 minutos. 288
 * baldes cobrem o horizonte inteiro e o consumo deixa de depender do
 * intervalo de polling.
 */
export const DRAIN_BUCKET_MINUTES = 5;

/**
 * Quanta ENTRADA de dinheiro ainda é compatível com "está sendo drenado",
 * como fração da saída no mesmo período.
 *
 * Não é um limiar de usuário (ver a regra em detection-rules.ts: limiares do
 * usuário nunca ficam hardcoded) - é o parâmetro do mecanismo que separa
 * "saiu e não voltou" de "a conta está girando". Uma recarga de 5% no meio de
 * uma perda de 40% não desfaz o dreno; receitas da ordem da saída desfazem.
 */
export const DRAIN_MAX_INFLOW_RATIO = 0.1;

interface Bucket {
  /** início do balde, alinhado a DRAIN_BUCKET_MINUTES */
  atMs: number;
  /** maior saldo visto no balde - é o que define o pico do horizonte */
  max: bigint;
  /** último saldo visto no balde - é o que define entrada e saída entre baldes */
  last: bigint;
}

/**
 * Perda acumulada num horizonte longo, com anti-repetição própria.
 *
 * Composição com a `BalanceWindow`: as duas regras olham o mesmo saldo, e sem
 * coordenação a mesma perda geraria dois alertas. Quem resolve é
 * `noteFastAlert`, chamado pelo monitor quando a janela deslizante já alertou:
 * enquanto esse aviso estiver dentro do horizonte, o dreno fica calado,
 * porque o dono JÁ foi avisado sobre esse dinheiro. O custo é conhecido - um
 * dreno que comece logo depois de um susto demora a aparecer - e é o lado
 * certo do erro: alerta duplicado é o que faz alguém desligar o alerta.
 */
export class SlowDrain {
  private buckets: Bucket[] = [];
  private lastFastAlertAtMs: number | null = null;
  private alertedPct: number | null = null;

  /** O monitor avisa aqui que a janela deslizante já alertou - ver nota de composição na classe. */
  noteFastAlert(at: Date): void {
    this.lastFastAlertAtMs = at.getTime();
  }

  evaluate(balance: bigint, observedAt: Date, thresholds: UserThresholds): DetectionEvent | null {
    const nowMs = observedAt.getTime();
    this.record(balance, nowMs);

    // o aviso da janela curta cobre este dinheiro; não falar duas vezes
    if (this.lastFastAlertAtMs !== null && nowMs - this.lastFastAlertAtMs < DRAIN_HORIZON_MINUTES * 60_000) {
      return null;
    }

    const peakIndex = this.peakIndex();
    if (peakIndex === null) return null;
    const peak = this.buckets[peakIndex]!;

    const pct = dropPercent(peak.max, balance);
    // histerese: quando a perda recua pra bem abaixo da barra, o incidente
    // acabou e o estado é liberado - senão um dreno novo, meses depois, ficaria
    // preso no percentual do anterior.
    if (pct < thresholds.maxBalanceDropPct / 2) this.alertedPct = null;
    if (pct < thresholds.maxBalanceDropPct) return null;

    // Território da janela deslizante: se o pico é recente, ela vê (ou viu)
    // esta queda com a resolução dela, e é ela quem deve falar.
    const elapsedMinutes = (nowMs - peak.atMs) / 60_000;
    if (elapsedMinutes <= thresholds.windowMinutes) return null;

    if (!this.wentOutAndDidNotComeBack(peakIndex)) return null;

    // Repete só quando mais uma barra inteira de tesouraria se foi: com a
    // barra em 10%, um esvaziamento completo fala em ~10%, ~20%, ~30%... e não
    // a cada ciclo de 15s. Cada repetição é uma escalada real, não um lembrete.
    if (this.alertedPct !== null && pct < this.alertedPct + thresholds.maxBalanceDropPct) {
      return null;
    }
    this.alertedPct = pct;

    return {
      kind: "slow-drain",
      userId: thresholds.userId,
      pctDropped: pct,
      /**
       * Severidade `normal` (e-mail), nunca ligação, por decisão de produto:
       * quando esta regra fala, o evento já tem horas de idade, e o argumento
       * que justifica o custo e a exposição de uma ligação telefônica (ver
       * SECURITY.md) é o minuto importar. Aqui não importa. Tornar a barra da
       * ligação configurável pelo dono é o passo seguinte, e precisa de campo
       * novo em UserThresholds - não de um número cravado neste arquivo.
       */
      severity: "normal",
      overMinutes: elapsedMinutes,
    };
  }

  /** Chamar se o despacho falhou, pro mesmo dreno poder ser tentado de novo no próximo ciclo. */
  forgetLastAlert(): void {
    this.alertedPct = null;
  }

  private record(balance: bigint, nowMs: number): void {
    const slotMs = DRAIN_BUCKET_MINUTES * 60_000;
    const atMs = Math.floor(nowMs / slotMs) * slotMs;
    const current = this.buckets[this.buckets.length - 1];
    if (current && current.atMs === atMs) {
      if (balance > current.max) current.max = balance;
      current.last = balance;
    } else {
      this.buckets.push({ atMs, max: balance, last: balance });
    }

    const fromMs = nowMs - DRAIN_HORIZON_MINUTES * 60_000;
    while (this.buckets.length > 1 && this.buckets[0]!.atMs < fromMs) this.buckets.shift();
  }

  /** Índice do balde com o maior saldo do horizonte; o mais ANTIGO em caso de empate, pra medir o dreno desde o começo dele. */
  private peakIndex(): number | null {
    if (this.buckets.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.buckets.length; i++) {
      if (this.buckets[i]!.max > this.buckets[best]!.max) best = i;
    }
    return this.buckets[best]!.max > 0n ? best : null;
  }

  /**
   * Soma entrada e saída depois do pico e responde se a conta está sendo
   * drenada em vez de girando. Resolução de 5 minutos, então movimentos
   * dentro do mesmo balde se cancelam - aproximação aceita de propósito,
   * porque num evento de horas ela não muda a conclusão.
   */
  private wentOutAndDidNotComeBack(peakIndex: number): boolean {
    let inflow = 0n;
    let outflow = 0n;
    for (let i = peakIndex + 1; i < this.buckets.length; i++) {
      const delta = this.buckets[i]!.last - this.buckets[i - 1]!.last;
      if (delta > 0n) inflow += delta;
      else outflow += -delta;
    }
    if (outflow === 0n) return false;
    return inflow * 100n < outflow * BigInt(Math.round(DRAIN_MAX_INFLOW_RATIO * 100));
  }
}
