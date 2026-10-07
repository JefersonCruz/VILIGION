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

import type { Address } from "viem";
import type { EvmAdapter, BalanceSnapshot } from "./engine/chains/evm-adapter.js";
import type { ChainExtension } from "./engine/chain-extension.js";
import type { DetectionEvent, UserThresholds } from "./engine/rules/detection-rules.js";
import { BalanceWindow } from "./engine/rules/balance-window.js";

/**
 * Fixo (testes, demo) ou uma função consultada a cada ciclo - assim uma
 * edição em /thresholds vale no ciclo seguinte, sem reiniciar o processo.
 */
export type ThresholdsSource = UserThresholds | (() => Promise<UserThresholds>);

export interface MonitorConfig {
  address: Address;
  thresholds: ThresholdsSource;
  pollIntervalMs: number;
}

export type AlertDispatcher = (event: DetectionEvent) => Promise<void>;

/**
 * Limite conservador de blocos por consulta eth_getLogs. Provedores de RPC
 * costumam rejeitar ranges grandes (o da Tempo rejeita acima de 100.000,
 * achado em produção em 2026-10-07 - ver nota em `tick()`); fica bem abaixo
 * disso de propósito, como margem de segurança.
 */
const MAX_LOG_RANGE_BLOCKS = 50_000n;

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

  constructor(
    private readonly adapter: EvmAdapter,
    private readonly config: MonitorConfig,
    private readonly dispatchAlert: AlertDispatcher,
    /** Opcional - só chains com particularidade de protocolo (ex: Tempo) passam uma */
    private readonly extension?: ChainExtension,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      await this.tick().catch((err) => {
        // um erro de leitura não deve derrubar o monitor inteiro - loga e
        // tenta de novo no próximo ciclo. Ver item "health-check" em
        // SECURITY.md: idealmente isto também avisa a equipe se persistir.
        console.error("[monitor] erro no ciclo de verificação:", err);
      });
      await sleep(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
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
        const fromBlock =
          confirmedBlock - this.lastCheckedBlock > MAX_LOG_RANGE_BLOCKS
            ? confirmedBlock - MAX_LOG_RANGE_BLOCKS + 1n
            : this.lastCheckedBlock + 1n;

        if (fromBlock > this.lastCheckedBlock + 1n) {
          console.error(
            `[monitor] gap de blocos maior que o limite de consulta (${MAX_LOG_RANGE_BLOCKS} blocos) - ` +
              `pulando de ${this.lastCheckedBlock} pra ${fromBlock - 1n}, eventos nesse intervalo foram perdidos`,
          );
        }

        // Passa o bloco confirmado que ACABAMOS de calcular, em vez de
        // deixar a extensão perguntar de novo à RPC (achado de performance
        // de 2026-10-03 - essa segunda chamada era pura duplicação).
        const extraEvents = await this.extension.checkExtra(fromBlock, confirmedBlock, thresholds);
        for (const event of extraEvents) await this.dispatchAlert(event);
        this.lastCheckedBlock = confirmedBlock;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
