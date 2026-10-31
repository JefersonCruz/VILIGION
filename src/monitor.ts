/**
 * Loop de monitoramento: observa um endereço em QUALQUER chain EVM, roda as
 * regras de detecção genéricas (saldo) contra os limiares do usuário, e
 * dispara o pipeline de alerta quando algo bate. Verificações específicas de
 * protocolo (ex: TransferBlocked da Tempo) entram via uma extensão opcional
 * - este arquivo não sabe nada sobre Tempo especificamente, prova em código
 * o padrão "núcleo + adaptador" descrito em ARCHITECTURE.md.
 *
 * Usa polling (não assinatura via websocket) de propósito - é mais simples
 * de demonstrar de forma confiável num prazo curto, e a Indexer API da
 * Tempo é descrita pela própria doc oficial como "ainda evoluindo", então
 * preferimos o caminho mais previsível pro caminho crítico do alerta.
 */

import type { BalanceSnapshot, ChainAddress, MonitoredChainAdapter } from "./engine/chains/chain-adapter.js";
import type { ChainExtension } from "./engine/chain-extension.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";
import { BalanceWindow } from "./engine/rules/balance-window.js";

/**
 * Fixo (testes, demo) ou uma função consultada a cada ciclo - assim uma
 * edição em /thresholds vale no ciclo seguinte, sem reiniciar o processo.
 */
export type ThresholdsSource = UserThresholds | (() => Promise<UserThresholds>);

export interface MonitorConfig {
  /**
   * Endereco vigiado, na notacao da rede do adaptador. `ChainAddress` e nao o
   * `Address` da viem: o nucleo nao sabe - e nao deve saber - se a rede usa
   * 0x hex ou base58. Quem valida e normaliza e o adaptador, via
   * `checkAddress`.
   */
  address: ChainAddress;
  thresholds: ThresholdsSource;
  pollIntervalMs: number;
}

export type AlertDispatcher = (event: DetectionEvent) => Promise<void>;

/**
 * Depois de quantas falhas consecutivas de ciclo o monitor considera a si
 * mesmo "não saudável" e chama onUnhealthy (issue #8, parte 2 - "health
 * check"). Reseta pra 0 no primeiro ciclo bem-sucedido depois de uma falha.
 * Múltiplos desse valor (3, 6, 9...) notificam de novo, pra não ficar calado
 * numa falha longa, mas também não espamar a cada 15s.
 */
export const UNHEALTHY_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * Quantos eventos de extensão já entregues o monitor lembra, pra não entregar
 * o mesmo duas vezes (ver `extensionEventKey` e o campo
 * `deliveredExtensionEvents`).
 *
 * Limitado porque um monitor roda indefinidamente: um conjunto que só cresce
 * é um vazamento de memória lento, do tipo que só aparece semanas depois em
 * produção. Com um evento de bloqueio por ciclo de 15s, 1.000 chaves cobrem
 * mais de 4 horas de histórico - muito mais que a janela em que uma
 * reentrega plausível acontece (um ciclo falho, ou uma reorg), que é da ordem
 * de minutos.
 */
export const MAX_REMEMBERED_DELIVERED_EVENTS = 1_000;

/**
 * Chave estável de um evento de extensão já entregue, ou `null` quando o
 * evento não tem identificador próprio.
 *
 * `null` significa "não dá pra desduplicar isto", e nesse caso o evento é
 * entregue sempre. É deliberadamente conservador: numa dúvida entre repetir
 * um alerta e engolir um, repetir é o erro menos grave. `balance-drop` cai
 * aqui - é derivado de amostragem de saldo (ver balance-window.ts, que já tem
 * a própria proteção contra repetição), não de uma ocorrência identificável
 * na cadeia.
 *
 * O `kind` entra na chave pra que dois eventos de tipos diferentes que por
 * acaso compartilhem o mesmo identificador não se desduplifiquem entre si.
 */
function extensionEventKey(event: DetectionEvent): string | null {
  if (event.kind === "transfer-blocked") return `${event.kind}:${event.blockedNonce}`;
  return null;
}

/** Chamado quando o monitor cruza (ou segue cruzando) o limiar de falhas consecutivas - index.ts decide o que "avisar alguém" significa de verdade (hoje: e-mail de ops, se configurado). */
export type HealthListener = (info: { consecutiveFailures: number; lastError: unknown }) => void;

export class Monitor {
  private previousSnapshot: BalanceSnapshot | null = null;
  private readonly window = new BalanceWindow();
  private cumulativeFeeAdjustment = 0n;
  private lastGoodThresholds: UserThresholds | null = null;
  /**
   * null = "este monitor ainda não rodou nenhum ciclo". Inicializar em 0n
   * aqui foi o bug real encontrado em produção: todo monitor tentava reler
   * a chain inteira do bloco 1 em diante no primeiro ciclo (uma chain com
   * dezenas de milhões de blocos), e o provedor RPC rejeita qualquer range
   * de eth_getLogs acima de 100.000 blocos - a consulta falhava sempre,
   * indefinidamente, gerando só spam de log, nunca uma leitura bem-sucedida.
   * Correção: na primeira vez, só anota o bloco confirmado atual como ponto
   * de partida - um monitor recém-criado deve observar dali pra frente, não
   * reprocessar o histórico inteiro da chain.
   */
  private lastCheckedBlock: bigint | null = null;
  private running = false;
  private consecutiveFailures = 0;
  private lastError: unknown = null;
  /**
   * Quando o ultimo ciclo COMPLETOU com sucesso. Existe pra o painel do
   * usuario poder provar que a vigilancia esta viva ("ultimo ciclo ha 12s")
   * em vez de so afirmar que esta - o produto e vigilancia, e "running:true"
   * nao distingue um monitor saudavel de um travado no meio de um tick.
   */
  private lastSuccessAt: Date | null = null;
  /**
   * Eventos de extensão já ENTREGUES com sucesso, pra não entregar de novo.
   *
   * Bug real que isto corrige (encontrado por teste nesta etapa, ver
   * monitor-event-delivery.test.ts): quando a extensão devolve vários eventos
   * no mesmo intervalo e a entrega de UM deles falha, o erro sobe do `tick` e
   * `lastCheckedBlock` não avança - o que é correto, porque o evento que
   * falhou ainda não chegou a ninguém e seria perdido pra sempre. Mas o ciclo
   * seguinte reconsulta o mesmo intervalo, recebe os mesmos eventos, e
   * reentrega os que JÁ tinham sido entregues. Medido no teste: um único
   * bloqueio de transferência gerava cinco alertas - cinco ligações
   * telefônicas pro dono pela mesma ocorrência.
   *
   * A marcação acontece DEPOIS da entrega bem-sucedida, nunca antes: marcar
   * antes transformaria uma falha de entrega em evento silenciosamente
   * descartado, que é o modo de falha oposto e pior.
   *
   * Set, não array, pela busca; e a ordem de inserção do Set é o que permite
   * descartar a chave mais antiga quando passa do limite.
   */
  private readonly deliveredExtensionEvents = new Set<string>();

  constructor(
    /**
     * Qualquer coisa que cumpra `MonitoredChainAdapter` - não a classe
     * concreta `EvmAdapter`, como era antes. Era a razão pela qual uma rede
     * de outra família (Solana) não conseguia ser monitorada sem editar este
     * arquivo, que é justamente o núcleo que um colaborador externo não
     * deveria precisar tocar pra integrar uma rede. Ver chain-adapter.ts e o
     * teste de conformidade, que monitora um adaptador não-EVM de mentira
     * exatamente pra provar que este construtor não tem mais preferência por
     * família de rede.
     */
    private readonly adapter: MonitoredChainAdapter,
    private readonly config: MonitorConfig,
    private readonly dispatchAlert: AlertDispatcher,
    /** Opcional - só chains com particularidade de protocolo (ex: Tempo) passam uma */
    private readonly extension?: ChainExtension,
    /** Opcional - sem isto, uma falha persistente só aparece no log local (ver issue #8). */
    private readonly onUnhealthy?: HealthListener,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.tick();
        this.lastSuccessAt = new Date();
        if (this.consecutiveFailures > 0) {
          console.log(`[monitor] recuperado depois de ${this.consecutiveFailures} falha(s) consecutiva(s)`);
        }
        this.consecutiveFailures = 0;
        // lastError NÃO é limpo aqui de propósito - "recuperado, mas o
        // último erro foi X há pouco" é informação útil pro painel admin;
        // sumir com isso silenciosamente esconderia instabilidade recente.
      } catch (err) {
        // um erro de leitura não deve derrubar o monitor inteiro - loga e
        // tenta de novo no próximo ciclo.
        this.consecutiveFailures++;
        this.lastError = err;
        console.error(`[monitor] erro no ciclo de verificação (falha consecutiva #${this.consecutiveFailures}):`, err);

        if (this.onUnhealthy && this.consecutiveFailures % UNHEALTHY_AFTER_CONSECUTIVE_FAILURES === 0) {
          try {
            this.onUnhealthy({ consecutiveFailures: this.consecutiveFailures, lastError: err });
          } catch (notifyErr) {
            // notificação quebrada não pode derrubar o monitor por cima do erro original
            console.error("[monitor] falha ao notificar saúde degradada:", notifyErr);
          }
        }
      }
      await sleep(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  /** Leitura pura de estado, sem efeito colateral - usada pelo painel admin (`/admin/status`) e pela faixa de monitoramento do painel do usuario. */
  getHealthStatus(): {
    running: boolean;
    consecutiveFailures: number;
    lastError: string | null;
    lastCheckedBlock: string | null;
    lastSuccessAt: string | null;
  } {
    return {
      running: this.running,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError === null ? null : describeError(this.lastError),
      lastCheckedBlock: this.lastCheckedBlock === null ? null : this.lastCheckedBlock.toString(),
      lastSuccessAt: this.lastSuccessAt === null ? null : this.lastSuccessAt.toISOString(),
    };
  }

  /** Anota uma chave como entregue, descartando as mais antigas acima do limite (ver MAX_REMEMBERED_DELIVERED_EVENTS). */
  private rememberDelivered(key: string): void {
    this.deliveredExtensionEvents.add(key);
    while (this.deliveredExtensionEvents.size > MAX_REMEMBERED_DELIVERED_EVENTS) {
      const oldest = this.deliveredExtensionEvents.values().next();
      if (oldest.done) break;
      this.deliveredExtensionEvents.delete(oldest.value);
    }
  }

  private async resolveThresholds(): Promise<UserThresholds> {
    const source = this.config.thresholds;
    if (typeof source !== "function") return source;
    try {
      const fresh = await source();
      this.lastGoodThresholds = fresh;
      return fresh;
    } catch (err) {
      // banco indisponível não pode deixar a conta sem proteção: segue com o último limiar válido
      if (!this.lastGoodThresholds) throw err;
      console.error("[monitor] falha ao ler limiares, usando o último válido:", err);
      return this.lastGoodThresholds;
    }
  }

  private async tick(): Promise<void> {
    const thresholds = await this.resolveThresholds();
    const current = await this.adapter.getBalance(this.config.address);

    if (this.previousSnapshot) {
      // Soma de volta qualquer dedução de taxa entre os dois blocos antes de
      // comparar - sem isto, pagamento de taxa legítimo (ex: na Tempo, que
      // não tem gas token nativo) pode parecer queda de saldo real. Default
      // 0n pra chains sem essa particularidade (ver EvmAdapter.getFeeAdjustment).
      // Acumulado, porque a janela compara o saldo atual com um pico mais antigo.
      this.cumulativeFeeAdjustment += await this.adapter.getFeeAdjustment(
        this.previousSnapshot.blockNumber,
        current.blockNumber,
        this.config.address,
      );
    }
    const adjusted = current.raw + this.cumulativeFeeAdjustment;
    const event = this.window.evaluate(adjusted, current.observedAt, thresholds);
    if (event) {
      try {
        await this.dispatchAlert(event);
      } catch (err) {
        this.window.forgetLastAlert();
        throw err;
      }
    }
    this.previousSnapshot = current;

    if (this.extension) {
      const confirmedBlock = await this.adapter.getConfirmedBlockNumber();

      if (this.lastCheckedBlock === null) {
        // Primeiro ciclo deste monitor - começa a observar a partir de
        // agora, não tenta reler a chain inteira (ver nota no campo acima).
        this.lastCheckedBlock = confirmedBlock;
      } else if (confirmedBlock > this.lastCheckedBlock) {
        // Clamp defensivo: mesmo já inicializado corretamente, um gap longo
        // sem ciclo bem-sucedido (RPC fora do ar por horas, processo preso)
        // ainda poderia acumular mais blocos que o provedor aceita numa
        // consulta só. Em vez de voltar a falhar pra sempre como antes,
        // aceita perder eventos mais antigos que o limite e segue andando -
        // um monitor que se recupera sozinho é melhor que um que trava.
        //
        // O limite vem do ADAPTADOR (`maxHistoryWindow`), não de uma
        // constante de EVM importada aqui como era antes: o teto é uma
        // propriedade do provedor/protocolo de cada rede, e o núcleo não
        // tem como saber o de uma rede que ele nunca viu.
        const maxWindow = this.adapter.maxHistoryWindow;
        const fromBlock =
          confirmedBlock - this.lastCheckedBlock > maxWindow
            ? confirmedBlock - maxWindow + 1n
            : this.lastCheckedBlock + 1n;

        if (fromBlock > this.lastCheckedBlock + 1n) {
          console.error(
            `[monitor] gap de blocos maior que o limite de consulta (${maxWindow} blocos) - ` +
              `pulando de ${this.lastCheckedBlock} pra ${fromBlock - 1n}, eventos nesse intervalo foram perdidos`,
          );
        }

        // Passa o bloco confirmado que ACABAMOS de calcular, em vez de
        // deixar a extensão perguntar de novo à RPC (achado de performance
        // de 2026-10-03 - essa segunda chamada era pura duplicação).
        const extraEvents = await this.extension.checkExtra(fromBlock, confirmedBlock, thresholds);
        for (const event of extraEvents) {
          const key = extensionEventKey(event);
          if (key !== null && this.deliveredExtensionEvents.has(key)) continue;
          await this.dispatchAlert(event);
          if (key !== null) this.rememberDelivered(key);
        }
        this.lastCheckedBlock = confirmedBlock;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resumo de 1 linha de um erro desconhecido - pro painel admin, nunca o stack inteiro (isso já vai pro log do Railway). */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
