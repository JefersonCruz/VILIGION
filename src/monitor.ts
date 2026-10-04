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
import {
  checkBalanceDrop,
  type DetectionEvent,
  type UserThresholds,
} from "./engine/rules/detection-rules.js";

export interface MonitorConfig {
  address: Address;
  thresholds: UserThresholds;
  pollIntervalMs: number;
}

export type AlertDispatcher = (event: DetectionEvent) => Promise<void>;

export class Monitor {
  private previousSnapshot: BalanceSnapshot | null = null;
  private lastCheckedBlock = 0n;
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

  private async tick(): Promise<void> {
    const current = await this.adapter.getBalance(this.config.address);

    if (this.previousSnapshot) {
      // Soma de volta qualquer dedução de taxa entre os dois blocos antes de
      // comparar - sem isto, pagamento de taxa legítimo (ex: na Tempo, que
      // não tem gas token nativo) pode parecer queda de saldo real. Default
      // 0n pra chains sem essa particularidade (ver EvmAdapter.getFeeAdjustment).
      const feeAdjustment = await this.adapter.getFeeAdjustment(
        this.previousSnapshot.blockNumber,
        current.blockNumber,
        this.config.address,
      );
      const adjustedCurrent = { ...current, raw: current.raw + feeAdjustment };

      const event = checkBalanceDrop(this.previousSnapshot, adjustedCurrent, this.config.thresholds);
      if (event) await this.dispatchAlert(event);
    }
    this.previousSnapshot = current;

    if (this.extension) {
      const confirmedBlock = await this.adapter.getConfirmedBlockNumber();
      if (confirmedBlock > this.lastCheckedBlock) {
        // Passa o bloco confirmado que ACABAMOS de calcular, em vez de
        // deixar a extensão perguntar de novo à RPC (achado de performance
        // de 2026-10-03 - essa segunda chamada era pura duplicação).
        const extraEvents = await this.extension.checkExtra(
          this.lastCheckedBlock + 1n,
          confirmedBlock,
          this.config.thresholds,
        );
        for (const event of extraEvents) await this.dispatchAlert(event);
        this.lastCheckedBlock = confirmedBlock;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
